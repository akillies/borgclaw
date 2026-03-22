#!/usr/bin/env bash
# ============================================================
# prepare-usb.sh — Package The Claw onto a USB drive
# ============================================================
# Run this on the Queen machine to prepare a flash drive that
# can assimilate any Linux machine into the hive.
#
# Usage:
#   ./scripts/prepare-usb.sh /Volumes/USBDRIVE
#   ./scripts/prepare-usb.sh /media/usb
#
# What it puts on the drive:
#   THE-CLAW/
#     setup.sh          — The one script the user runs
#     the-claw          — Pre-compiled Go binary (Linux amd64)
#     ollama-install.sh — Cached Ollama installer
#     models/           — Pre-cached model blobs
#     config/           — Node config template
#     README.txt        — Quick instructions
#
# The target machine needs: Linux (Debian/Ubuntu/Fedora/Arch),
# internet for first Ollama install (or use cached installer),
# and 4GB+ RAM.
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${CYAN}→${NC} $1"; }

# --- Resolve paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BORGCLAW_HOME="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_DIR="$BORGCLAW_HOME/node"

# --- Check args ---
if [ $# -lt 1 ]; then
  echo "Usage: $0 <usb-mount-path>"
  echo "  Example: $0 /Volumes/MYUSB"
  echo "  Example: $0 /media/usb"
  exit 1
fi

USB_PATH="$1"
CLAW_DIR="$USB_PATH/THE-CLAW"

if [ ! -d "$USB_PATH" ]; then
  err "Mount path does not exist: $USB_PATH"
  exit 1
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     PREPARING THE CLAW USB DRIVE     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# --- Detect Queen IP ---
QUEEN_IP=$(ipconfig getifaddr en0 2>/dev/null || ip route get 1 2>/dev/null | awk '{print $7; exit}' || echo "UNKNOWN")
info "Queen IP detected: $QUEEN_IP"

# --- Cross-compile The Claw if needed ---
LINUX_BINARY="$NODE_DIR/the-claw-linux-amd64"
if [ ! -f "$LINUX_BINARY" ]; then
  info "Cross-compiling The Claw for Linux amd64..."
  (cd "$NODE_DIR" && GOOS=linux GOARCH=amd64 go build -o the-claw-linux-amd64 .)
  ok "Binary compiled"
else
  ok "Linux binary already exists"
fi

# --- Create directory structure ---
info "Creating THE-CLAW directory on drive..."
mkdir -p "$CLAW_DIR/models" "$CLAW_DIR/config"

# --- Copy binary ---
info "Copying The Claw binary ($(du -h "$LINUX_BINARY" | cut -f1))..."
cp "$LINUX_BINARY" "$CLAW_DIR/the-claw"
chmod +x "$CLAW_DIR/the-claw"
ok "Binary copied"

# --- Cache Ollama installer ---
OLLAMA_CACHE="$CLAW_DIR/ollama-install.sh"
if [ ! -f "$OLLAMA_CACHE" ]; then
  info "Downloading Ollama installer..."
  curl -fsSL https://ollama.com/install.sh -o "$OLLAMA_CACHE"
  chmod +x "$OLLAMA_CACHE"
  ok "Ollama installer cached"
else
  ok "Ollama installer already cached"
fi

# --- Cache models ---
OLLAMA_MODELS="$HOME/.ollama/models"
if [ -d "$OLLAMA_MODELS" ]; then
  info "Copying cached models ($(du -sh "$OLLAMA_MODELS" | cut -f1))..."
  rsync -a "$OLLAMA_MODELS/" "$CLAW_DIR/models/"
  ok "Models cached on drive"
else
  warn "No local Ollama models found — node will pull on first boot"
fi

# --- Read hive secret ---
HIVE_SECRET=""
HIVE_IDENTITY="$BORGCLAW_HOME/data/hive-identity.json"
if [ -f "$HIVE_IDENTITY" ]; then
  HIVE_SECRET=$(python3 -c "import json; print(json.load(open('$HIVE_IDENTITY'))['secret'])" 2>/dev/null || echo "")
fi
if [ -z "$HIVE_SECRET" ]; then
  warn "No hive-identity.json found — drone will need --secret flag manually"
fi

# --- Write node config ---
cat > "$CLAW_DIR/config/drone.json" << CJSON
{
  "queen_url": "http://${QUEEN_IP}:9090",
  "listen_addr": ":9091",
  "ollama_url": "http://localhost:11434",
  "hive_secret": "${HIVE_SECRET}",
  "contribution": 50,
  "heartbeat_sec": 30,
  "preferred_models": ["phi4-mini", "qwen3:8b"]
}
CJSON
ok "Node config written (Queen: http://${QUEEN_IP}:9090, secret: ${HIVE_SECRET:+included}${HIVE_SECRET:-NOT FOUND})"

# --- Write setup script (this is what the user runs) ---
cat > "$CLAW_DIR/setup.sh" << 'SETUP'
#!/usr/bin/env bash
# ============================================================
# THE CLAW — One-Script Assimilation
# ============================================================
# Plug in the drive. Run this script. Machine joins the hive.
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
info() { echo -e "${CYAN}→${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║         T H E   C L A W              ║"
echo "  ║   Resistance is optional.            ║"
echo "  ║   Adaptation is inevitable.          ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Step 1: Install Ollama
if command -v ollama &>/dev/null; then
  ok "Ollama already installed ($(ollama --version 2>/dev/null || echo 'unknown version'))"
else
  info "Installing Ollama..."
  if [ -f "$SCRIPT_DIR/ollama-install.sh" ]; then
    bash "$SCRIPT_DIR/ollama-install.sh"
  else
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  ok "Ollama installed"
fi

# Step 2: Start Ollama if not running
if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  info "Starting Ollama..."
  ollama serve &>/dev/null &
  sleep 3
fi

# Step 3: Load cached models (or pull if no cache)
if [ -d "$SCRIPT_DIR/models/blobs" ] && [ "$(ls -A "$SCRIPT_DIR/models/blobs" 2>/dev/null)" ]; then
  info "Loading cached models from drive..."
  OLLAMA_HOME="${OLLAMA_HOME:-$HOME/.ollama}"
  mkdir -p "$OLLAMA_HOME/models"
  rsync -a "$SCRIPT_DIR/models/" "$OLLAMA_HOME/models/"
  ok "Models loaded from cache"
else
  info "No cached models on drive — pulling phi4-mini..."
  ollama pull phi4-mini
  ok "phi4-mini pulled"
fi

# Step 4: Install The Claw binary
INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/the-claw" "$INSTALL_DIR/the-claw"
chmod +x "$INSTALL_DIR/the-claw"
ok "The Claw installed to $INSTALL_DIR/the-claw"

# Step 5: Copy config
CLAW_CONFIG_DIR="$HOME/.config/borgclaw"
mkdir -p "$CLAW_CONFIG_DIR"
if [ -f "$SCRIPT_DIR/config/drone.json" ]; then
  cp "$SCRIPT_DIR/config/drone.json" "$CLAW_CONFIG_DIR/drone.json"
  QUEEN_URL=$(grep -o '"queen_url"[[:space:]]*:[[:space:]]*"[^"]*"' "$CLAW_CONFIG_DIR/drone.json" | cut -d'"' -f4)
  ok "Config installed (Queen: $QUEEN_URL)"
fi

# Step 6: Start The Claw
info "Starting The Claw..."
"$INSTALL_DIR/the-claw" --config "$CLAW_CONFIG_DIR/drone.json" &

echo ""
ok "═══════════════════════════════════════"
ok "  THIS MACHINE HAS JOINED THE HIVE    "
ok "═══════════════════════════════════════"
echo ""
echo "  The Claw is running in the background."
echo "  Check Queen dashboard to see this node."
echo ""
echo "  To stop:   pkill the-claw"
echo "  To restart: the-claw --config ~/.config/borgclaw/drone.json"
echo ""
SETUP
chmod +x "$CLAW_DIR/setup.sh"
ok "Setup script written"

# --- Write README ---
cat > "$CLAW_DIR/README.txt" << README
THE CLAW — BorgClaw Node Installer
===================================

This drive turns any Linux machine into a BorgClaw hive node.

QUICK START:
  1. Plug this drive into any Linux machine
  2. Open a terminal
  3. Run: bash /path/to/THE-CLAW/setup.sh
  4. Done. Check the Queen dashboard — the node will appear.

WHAT IT INSTALLS:
  - Ollama (local LLM inference engine)
  - phi4-mini model (2.3GB, pre-cached on this drive)
  - The Claw binary (BorgClaw node agent, 9.7MB)
  - Node config pointing at Queen: http://${QUEEN_IP}:9090

REQUIREMENTS:
  - Linux (Debian, Ubuntu, Fedora, Arch, etc.)
  - 4GB+ RAM (8GB recommended)
  - Internet for Ollama install (model is pre-cached)

QUEEN DASHBOARD:
  http://${QUEEN_IP}:9090/dashboard

STOP THE NODE:
  pkill the-claw

CONTRIBUTION DIAL:
  Adjust from the Queen dashboard, or:
  curl -X PUT http://localhost:9091/contribution -d '{"level": 30}'

README
ok "README written"

# --- Summary ---
echo ""
TOTAL_SIZE=$(du -sh "$CLAW_DIR" | cut -f1)
echo "  ╔══════════════════════════════════════╗"
echo "  ║   USB DRIVE READY — $TOTAL_SIZE total"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Contents:"
echo "    THE-CLAW/setup.sh       — Run this on target machine"
echo "    THE-CLAW/the-claw       — Node binary (Linux amd64)"
echo "    THE-CLAW/models/        — Pre-cached LLM models"
echo "    THE-CLAW/config/        — Queen URL: http://${QUEEN_IP}:9090"
echo "    THE-CLAW/README.txt     — Instructions"
echo ""
echo "  Plug into any Linux machine, run setup.sh, done."
echo ""
