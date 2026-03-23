#!/usr/bin/env bash
# ============================================================
# prepare-usb.sh — Package The Claw onto a USB drive
# ============================================================
# Run this on the Queen machine to prepare a flash drive that
# can assimilate any Linux machine into the hive.
#
# Usage:
#   ./scripts/prepare-usb.sh /Volumes/MYUSB
#   ./scripts/prepare-usb.sh /Volumes/MYUSB --profile scout    # 4GB drive
#   ./scripts/prepare-usb.sh /Volumes/MYUSB --profile worker   # 8GB drive
#   ./scripts/prepare-usb.sh /Volumes/MYUSB --profile scholar  # 16GB drive
#   ./scripts/prepare-usb.sh /Volumes/MYUSB --profile arsenal  # 32GB drive
#
# Profiles (models cached per profile):
#   scout    → phi4-mini only                          (~4GB required)
#   worker   → qwen3:8b + phi4-mini                   (~8GB required)
#   scholar  → qwen3:8b + phi4-mini + gemma3:27b       (~16GB required)
#   arsenal  → all locally available models             (~32GB+ required)
#   auto     → detect from drive free space (default)
#
# What it puts on the drive:
#   THE-CLAW/
#     setup.sh          — The one script the user runs
#     the-claw          — Pre-compiled Go binary (Linux amd64)
#     ollama-install.sh — Cached Ollama installer
#     lightpanda/       — Placeholder dir for Lightpanda browser binaries
#     browser-worker/   — Python browser worker script
#     models/           — Pre-cached model blobs (profile-specific)
#     config/           — Node config template
#     README.txt        — Quick instructions
#
# The target machine needs: Linux (Debian/Ubuntu/Fedora/Arch),
# internet for first Ollama install (or use cached installer),
# and 4GB+ RAM.
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${CYAN}→${NC} $1"; }

# --- Resolve paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BORGCLAW_HOME="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_DIR="$BORGCLAW_HOME/node"

# ============================================================
# Profile definitions
# ============================================================
# Each profile maps to a list of Ollama model names to cache.
# The minimum free space (GB) guards against writing a partial
# cache onto a drive that won't fit.
# ============================================================

profile_models_scout=("phi4-mini")
profile_min_gb_scout=3

profile_models_worker=("qwen3:8b" "phi4-mini")
profile_min_gb_worker=7

profile_models_scholar=("qwen3:8b" "phi4-mini" "gemma3:27b")
profile_min_gb_scholar=14

# arsenal is resolved dynamically from locally available models
profile_min_gb_arsenal=30

# ============================================================
# Argument parsing
# ============================================================

if [ $# -lt 1 ]; then
  echo "Usage: $0 <usb-mount-path> [--profile scout|worker|scholar|arsenal|auto]"
  echo ""
  echo "  Profiles:"
  echo "    scout    phi4-mini only                          (~4GB)"
  echo "    worker   qwen3:8b + phi4-mini                   (~8GB)"
  echo "    scholar  qwen3:8b + phi4-mini + gemma3:27b       (~16GB)"
  echo "    arsenal  all local models                        (~32GB+)"
  echo "    auto     detect from drive free space (default)"
  echo ""
  echo "  Examples:"
  echo "    $0 /Volumes/MYUSB"
  echo "    $0 /Volumes/MYUSB --profile worker"
  echo "    $0 /media/usb    --profile scholar"
  exit 1
fi

USB_PATH="$1"
PROFILE="auto"

# Parse remaining flags
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --profile)
      shift
      PROFILE="${1:-auto}"
      ;;
    --profile=*)
      PROFILE="${1#--profile=}"
      ;;
    *)
      err "Unknown argument: $1"
      exit 1
      ;;
  esac
  shift
done

# Validate profile value
case "$PROFILE" in
  scout|worker|scholar|arsenal|auto) ;;
  *)
    err "Unknown profile: $PROFILE"
    err "Valid profiles: scout, worker, scholar, arsenal, auto"
    exit 1
    ;;
esac

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

# ============================================================
# Auto-detect profile from drive free space
# ============================================================

get_free_gb() {
  local path="$1"
  # df -g is macOS; df --block-size=1G is Linux. Try both.
  if df -g "$path" &>/dev/null 2>&1; then
    df -g "$path" | awk 'NR==2 {print $4}'
  else
    df --block-size=1G "$path" 2>/dev/null | awk 'NR==2 {print $4}'
  fi
}

FREE_GB=$(get_free_gb "$USB_PATH" 2>/dev/null || echo "0")

if [ "$PROFILE" = "auto" ]; then
  info "Drive free space: ${FREE_GB}GB — auto-selecting profile..."

  if   [ "${FREE_GB:-0}" -ge "$profile_min_gb_arsenal" ]; then
    PROFILE="arsenal"
  elif [ "${FREE_GB:-0}" -ge "$profile_min_gb_scholar" ]; then
    PROFILE="scholar"
  elif [ "${FREE_GB:-0}" -ge "$profile_min_gb_worker" ]; then
    PROFILE="worker"
  elif [ "${FREE_GB:-0}" -ge "$profile_min_gb_scout" ]; then
    PROFILE="scout"
  else
    warn "Drive has only ${FREE_GB}GB free — defaulting to scout profile (phi4-mini only)"
    PROFILE="scout"
  fi
fi

ok "Profile selected: ${BOLD}${PROFILE}${NC}"

# ============================================================
# Resolve model list for profile
# ============================================================

resolve_models() {
  local profile="$1"
  case "$profile" in
    scout)
      echo "${profile_models_scout[@]}"
      ;;
    worker)
      echo "${profile_models_worker[@]}"
      ;;
    scholar)
      echo "${profile_models_scholar[@]}"
      ;;
    arsenal)
      # Discover all locally cached Ollama models
      local ollama_models_dir="$HOME/.ollama/models/manifests"
      if [ ! -d "$ollama_models_dir" ]; then
        warn "No local Ollama models found — falling back to scout profile models"
        echo "${profile_models_scout[@]}"
        return
      fi
      # List model names from manifests (registry/library/modelname/tag)
      find "$ollama_models_dir" -type f | \
        sed "s|$ollama_models_dir/||" | \
        awk -F'/' 'NF>=3 {print $(NF-1) ":" $NF}' | \
        sort -u | tr '\n' ' '
      ;;
  esac
}

MODELS_TO_CACHE=($(resolve_models "$PROFILE"))

if [ ${#MODELS_TO_CACHE[@]} -eq 0 ]; then
  warn "No models resolved for profile $PROFILE — drive will cache no models (node pulls on first boot)"
fi

echo ""
info "Models for profile ${BOLD}${PROFILE}${NC}:"
for m in "${MODELS_TO_CACHE[@]}"; do
  info "  - $m"
done
echo ""

# ============================================================
# Detect Queen IP
# ============================================================

QUEEN_IP=$(ipconfig getifaddr en0 2>/dev/null || ip route get 1 2>/dev/null | awk '{print $7; exit}' || echo "UNKNOWN")
info "Queen IP detected: $QUEEN_IP"

# ============================================================
# Cross-compile The Claw if needed
# ============================================================

LINUX_BINARY="$NODE_DIR/the-claw-linux-amd64"
if [ ! -f "$LINUX_BINARY" ]; then
  info "Cross-compiling The Claw for Linux amd64..."
  (cd "$NODE_DIR" && GOOS=linux GOARCH=amd64 go build -o the-claw-linux-amd64 .)
  ok "Binary compiled"
else
  ok "Linux binary already exists ($(du -h "$LINUX_BINARY" | cut -f1))"
fi

# ============================================================
# Create directory structure
# ============================================================

info "Creating THE-CLAW directory on drive..."
mkdir -p \
  "$CLAW_DIR/models" \
  "$CLAW_DIR/config" \
  "$CLAW_DIR/lightpanda" \
  "$CLAW_DIR/browser-worker" \
  "$CLAW_DIR/knowledge"

# ============================================================
# Copy binary
# ============================================================

info "Copying The Claw binary ($(du -h "$LINUX_BINARY" | cut -f1))..."
cp "$LINUX_BINARY" "$CLAW_DIR/the-claw"
chmod +x "$CLAW_DIR/the-claw"
ok "Binary copied"

# ============================================================
# Cache Ollama installer
# ============================================================

OLLAMA_CACHE="$CLAW_DIR/ollama-install.sh"
if [ ! -f "$OLLAMA_CACHE" ]; then
  info "Downloading Ollama installer..."
  curl -fsSL https://ollama.com/install.sh -o "$OLLAMA_CACHE"
  chmod +x "$OLLAMA_CACHE"
  ok "Ollama installer cached"
else
  ok "Ollama installer already cached"
fi

# ============================================================
# Copy browser-worker script
# ============================================================

BROWSER_WORKER_SRC="$BORGCLAW_HOME/scripts/browser-worker"
if [ -d "$BROWSER_WORKER_SRC" ]; then
  cp -r "$BROWSER_WORKER_SRC/." "$CLAW_DIR/browser-worker/"
  ok "browser-worker scripts copied"
else
  warn "browser-worker dir not found at $BROWSER_WORKER_SRC — skipping"
fi

# Lightpanda placeholder (actual binary install happens on target machine)
cat > "$CLAW_DIR/lightpanda/README.txt" << 'LP'
Lightpanda browser binaries are not pre-cached on this drive.
On the target machine, install manually:

  curl -sSf https://github.com/lightpanda-io/browser/releases/latest/download/lightpanda-linux-amd64 \
    -o ~/.local/bin/lightpanda && chmod +x ~/.local/bin/lightpanda

BorgClaw browser-worker tasks require Lightpanda or Chromium.
Set BORGCLAW_BROWSER_WORKER env var to your worker.py path.
LP
ok "Lightpanda placeholder created"

# ============================================================
# Knowledge pack directory (scholar + arsenal profiles)
# ============================================================
# A knowledge/ directory is always created. For scholar and
# arsenal profiles the README explains recommended ZIM packs.
# The operator drops .zim files into ~/.config/borgclaw/knowledge/
# on the target machine; the drone auto-detects them on boot.
# ============================================================

KNOWLEDGE_README="$CLAW_DIR/knowledge/README.txt"

if [ "$PROFILE" = "scholar" ] || [ "$PROFILE" = "arsenal" ]; then
  cat > "$KNOWLEDGE_README" << 'KREADME'
BorgClaw Knowledge Packs
========================
This directory holds offline knowledge packs for the Scholar/Arsenal drone.

SETUP:
  Copy .zim files here before deployment, then the setup.sh script will
  install them to ~/.config/borgclaw/knowledge/ on the target machine.

  Alternatively, after running setup.sh, add .zim files directly to:
    ~/.config/borgclaw/knowledge/

  The drone scans this directory on boot and every heartbeat, then
  reports available domains to the Queen. No restart required.

RECOMMENDED PACKS (download from library.kiwix.org):
  WikiMed-mini        — Medical reference, offline (~100MB)
                        https://library.kiwix.org  →  search "wikimed mini"
  wikipedia_en_simple — Wikipedia Simple English (~1GB)
                        Good for general queries without the full 20GB dump
  devdocs             — Developer documentation for common languages/frameworks
                        https://library.kiwix.org  →  search "devdocs"
  stackoverflow       — Stack Overflow top answers (~10GB or mini ~800MB)
  gutenberg           — Project Gutenberg full-text library

NAMING:
  The domain name Queen sees is the filename without .zim extension.
  "wikimed-mini.zim"        → domain "wikimed-mini"
  "wikipedia_en_simple.zim" → domain "wikipedia_en_simple"

QUEEN ROUTING:
  Send tasks with "required_domain" to route to drones with that pack:
    POST /api/tasks/dispatch
    { "required_domain": "wikimed-mini", ... }

  See which drones have which packs:
    GET /api/tasks/knowledge-nodes

MORE INFO: docs/KNOWLEDGE-PACKS.md in the BorgClaw source repo.
KREADME
  ok "Knowledge README written (${PROFILE} profile — ZIM packs recommended)"
else
  cat > "$KNOWLEDGE_README" << 'KREADME'
BorgClaw Knowledge Packs
========================
This directory is a placeholder for offline knowledge packs (.zim files).

The scout and worker profiles do not require knowledge packs, but you can
add them anytime. Drop .zim files into ~/.config/borgclaw/knowledge/ on
the target machine — the drone auto-detects them.

Upgrade to the scholar profile for recommended pack suggestions:
  ./scripts/prepare-usb.sh <drive> --profile scholar

More info: docs/KNOWLEDGE-PACKS.md in the BorgClaw source repo.
KREADME
  ok "Knowledge directory created (${PROFILE} profile — no packs required)"
fi

# ============================================================
# Cache models (profile-specific)
# ============================================================

OLLAMA_MODELS="$HOME/.ollama/models"

if [ ${#MODELS_TO_CACHE[@]} -eq 0 ]; then
  warn "No models to cache — node will pull on first boot"
elif [ ! -d "$OLLAMA_MODELS" ]; then
  warn "No local Ollama models dir found at $OLLAMA_MODELS"
  warn "Run 'ollama pull <model>' on this machine first, then re-run this script"
else
  info "Caching models for profile: $PROFILE"

  for model in "${MODELS_TO_CACHE[@]}"; do
    # Resolve the manifest path: registry.ollama.ai/library/<name>/<tag>
    # or handle user/model:tag format
    if [[ "$model" == *":"* ]]; then
      MODEL_NAME="${model%%:*}"
      MODEL_TAG="${model##*:}"
    else
      MODEL_NAME="$model"
      MODEL_TAG="latest"
    fi

    # Standard Ollama path: manifests/registry.ollama.ai/library/<name>/<tag>
    MANIFEST_PATH="$OLLAMA_MODELS/manifests/registry.ollama.ai/library/${MODEL_NAME}/${MODEL_TAG}"

    if [ -f "$MANIFEST_PATH" ]; then
      info "  Caching $model..."
      # Copy manifest
      mkdir -p "$CLAW_DIR/models/manifests/registry.ollama.ai/library/${MODEL_NAME}"
      cp "$MANIFEST_PATH" "$CLAW_DIR/models/manifests/registry.ollama.ai/library/${MODEL_NAME}/${MODEL_TAG}"

      # Copy blobs referenced in manifest (sha256:xxxx entries)
      BLOBS=$(grep -o '"sha256:[^"]*"' "$MANIFEST_PATH" 2>/dev/null | tr -d '"' | sed 's/sha256:/sha256-/')
      if [ -n "$BLOBS" ]; then
        mkdir -p "$CLAW_DIR/models/blobs"
        for blob in $BLOBS; do
          BLOB_PATH="$OLLAMA_MODELS/blobs/$blob"
          if [ -f "$BLOB_PATH" ]; then
            cp "$BLOB_PATH" "$CLAW_DIR/models/blobs/"
          fi
        done
      fi
      ok "  $model cached"
    else
      warn "  $model not found locally (manifest: $MANIFEST_PATH)"
      warn "  Run: ollama pull $model — then re-run this script"
    fi
  done
fi

# ============================================================
# Read hive secret
# ============================================================

HIVE_SECRET=""
HIVE_IDENTITY="$BORGCLAW_HOME/data/hive-identity.json"
if [ -f "$HIVE_IDENTITY" ]; then
  HIVE_SECRET=$(python3 -c "import json; print(json.load(open('$HIVE_IDENTITY'))['secret'])" 2>/dev/null || echo "")
fi
if [ -z "$HIVE_SECRET" ]; then
  warn "No hive-identity.json found — drone will need --secret flag manually"
fi

# ============================================================
# Write node config
# ============================================================

# Build preferred_models JSON array from profile models
PREFERRED_JSON="["
first=true
for m in "${MODELS_TO_CACHE[@]}"; do
  if [ "$first" = true ]; then
    PREFERRED_JSON+="\"$m\""
    first=false
  else
    PREFERRED_JSON+=", \"$m\""
  fi
done
PREFERRED_JSON+="]"

# Default to scout fallback if no models resolved
if [ "$PREFERRED_JSON" = "[]" ]; then
  PREFERRED_JSON='["phi4-mini"]'
fi

cat > "$CLAW_DIR/config/drone.json" << CJSON
{
  "queen_url": "http://${QUEEN_IP}:9090",
  "listen_addr": ":9091",
  "ollama_url": "http://localhost:11434",
  "hive_secret": "${HIVE_SECRET}",
  "contribution": 50,
  "heartbeat_sec": 30,
  "preferred_models": ${PREFERRED_JSON}
}
CJSON
ok "Node config written (Queen: http://${QUEEN_IP}:9090, profile: ${PROFILE}, secret: ${HIVE_SECRET:+included}${HIVE_SECRET:-NOT FOUND})"

# ============================================================
# Write setup script (what the target machine runs)
# ============================================================

cat > "$CLAW_DIR/setup.sh" << 'SETUP'
#!/usr/bin/env bash
# ============================================================
# BORGCLAW — WAREZ-STYLE ASSIMILATION SCRIPT
# ============================================================
# Works on: Linux, macOS (Intel + ARM)
# Plug in the drive. Run this script. Machine joins the hive.
# Flags: --uninstall   Remove BorgClaw from this machine
#        --silent      Skip theatrics (for automation)
# ============================================================

set -euo pipefail

# --- Colors ---
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'
BG='\033[38;2;0;255;136m'; DIM='\033[2m'; B='\033[1m'; NC='\033[0m'
ok()   { echo -e "  ${G}[+]${NC} $1"; }
warn() { echo -e "  ${Y}[!]${NC} $1"; }
info() { echo -e "  ${C}[>]${NC} $1"; }
err()  { echo -e "  ${R}[X]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SILENT=0

# --- Parse flags ---
for arg in "$@"; do
  case "$arg" in
    --silent) SILENT=1 ;;
    --uninstall) ;;
  esac
done

# --- Theatrics helpers ---
scene() {
  [ "$SILENT" -eq 1 ] && return
  echo ""
  echo -e "  ${DIM}${C}----[ ${NC}${BG}$1${NC}${DIM}${C} ]----${NC}"
  echo ""
}

slow() {
  [ "$SILENT" -eq 1 ] && echo -e "$1" && return
  echo -e "$1"
  sleep "$2"
}

progress_bar() {
  [ "$SILENT" -eq 1 ] && return
  local label="$1" pct=0 total=30 filled=0 empty=0
  for pct in 5 12 24 38 55 70 82 91 100; do
    filled=$((pct * total / 100))
    empty=$((total - filled))
    printf "\r  ${DIM}${C}%s${NC} [" "$label"
    printf '%0.s\xe2\x96\x93' $(seq 1 $filled) 2>/dev/null
    printf '%0.s\xe2\x96\x91' $(seq 1 $empty) 2>/dev/null
    printf '] %3d%%' "$pct"
    sleep 0.06
  done
  echo ""
}

open_chiptune() {
  [ "$SILENT" -eq 1 ] && return
  local html="$SCRIPT_DIR/browser-worker/chiptune.html"
  [ ! -f "$html" ] && return
  case "$(uname -s)" in
    Darwin*) open "$html" 2>/dev/null & ;;
    Linux*)  xdg-open "$html" 2>/dev/null & ;;
  esac
}

# ============================================================
# UNINSTALL
# ============================================================
if [ "${1:-}" = "--uninstall" ]; then
  echo ""
  echo -e "  ${R}============================================${NC}"
  echo -e "  ${R}   S E V E R I N G   H I V E   L I N K     ${NC}"
  echo -e "  ${R}============================================${NC}"
  echo ""
  pkill -f "the-claw" 2>/dev/null && ok "Claw process terminated" || echo -e "  ${DIM}(no claw running)${NC}"
  rm -f "$HOME/.local/bin/the-claw" 2>/dev/null
  ok "Binary removed"
  rm -rf "$HOME/.config/borgclaw" 2>/dev/null
  ok "Config purged"
  echo ""
  echo -e "  ${DIM}Ollama and models are NOT removed (shared resource).${NC}"
  echo -e "  ${DIM}To also remove: rm -rf ~/.ollama && sudo rm -f /usr/local/bin/ollama${NC}"
  echo ""
  echo -e "  ${R}DISCONNECTED FROM THE COLLECTIVE.${NC}"
  echo ""
  exit 0
fi

# ============================================================
# THE SHOW BEGINS
# ============================================================

open_chiptune

if [ "$SILENT" -eq 0 ]; then
  clear 2>/dev/null || true
  echo ""
  slow "" 0.1
  slow "  ${DIM}${G}initializing...${NC}" 0.3
  echo ""
  slow "  ${BG}    ____                    ________               ${NC}" 0.04
  slow "  ${BG}   / __ )____  _________ _/ ____/ /___ __      __ ${NC}" 0.04
  slow "  ${BG}  / __  / __ \\/ ___/ __ \`/ /   / / __ \`/ | /| / / ${NC}" 0.04
  slow "  ${BG}  / /_/ / /_/ / /  / /_/ / /___/ / /_/ /| |/ |/ /  ${NC}" 0.04
  slow "  ${BG} /_____/\\____/_/   \\__, /\\____/_/\\__,_/ |__/|__/   ${NC}" 0.04
  slow "  ${BG}                  /____/                            ${NC}" 0.04
  echo ""
  slow "  ${DIM}${C}+-----------------------------------------------+${NC}" 0.05
  slow "  ${DIM}${C}|${NC}  ${B}YOUR MACHINES. YOUR MODELS. YOUR RULES.${NC}     ${DIM}${C}|${NC}" 0.05
  slow "  ${DIM}${C}|${NC}  ${DIM}Resistance is optional.${NC}                     ${DIM}${C}|${NC}" 0.05
  slow "  ${DIM}${C}|${NC}  ${DIM}Adaptation is inevitable.${NC}                   ${DIM}${C}|${NC}" 0.05
  slow "  ${DIM}${C}+-----------------------------------------------+${NC}" 0.05
  echo ""
  sleep 0.5
fi

# ============================================================
# SCENE 1: PROBING HARDWARE
# ============================================================
scene "PROBING HARDWARE"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)   PLATFORM="linux" ;;
  Darwin*)  PLATFORM="mac" ;;
  *)        err "Unsupported OS: $OS"; exit 1 ;;
esac

ok "Platform: $OS / $ARCH"
progress_bar "HARDWARE SCAN"

if [ ! -f "$SCRIPT_DIR/the-claw" ]; then
  err "Binary not found: $SCRIPT_DIR/the-claw"
  exit 1
fi

# ============================================================
# SCENE 2: INITIALIZING NEURAL PATHWAYS (Ollama)
# ============================================================
scene "INITIALIZING NEURAL PATHWAYS"

if command -v ollama &>/dev/null; then
  ok "Ollama already present"
else
  info "Installing Ollama..."
  if [ -f "$SCRIPT_DIR/ollama-install.sh" ]; then
    bash "$SCRIPT_DIR/ollama-install.sh"
  else
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  ok "Ollama installed"
fi

progress_bar "NEURAL INIT"

# Start Ollama if not running
if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  info "Starting Ollama..."
  ollama serve &>/dev/null &
  sleep 3
  if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    ok "Ollama online"
  else
    warn "Ollama may still be starting -- continuing"
  fi
fi

# ============================================================
# SCENE 3: LOADING CONSCIOUSNESS (Models)
# ============================================================
scene "LOADING CONSCIOUSNESS"

if [ -d "$SCRIPT_DIR/models/blobs" ] && [ "$(ls -A "$SCRIPT_DIR/models/blobs" 2>/dev/null)" ]; then
  info "Injecting cached model blobs from drive..."
  OLLAMA_HOME="${OLLAMA_HOME:-$HOME/.ollama}"
  mkdir -p "$OLLAMA_HOME/models"
  rsync -a "$SCRIPT_DIR/models/" "$OLLAMA_HOME/models/"
  ok "Models loaded from cache (network bypass)"
else
  info "No cached models -- pulling phi4-mini (2.3GB)..."
  ollama pull phi4-mini
  ok "phi4-mini pulled"
fi

progress_bar "CONSCIOUSNESS"

# ============================================================
# SCENE 4: ESTABLISHING HIVE LINK (Config)
# ============================================================
scene "ESTABLISHING HIVE LINK"

INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/the-claw" "$INSTALL_DIR/the-claw"
chmod +x "$INSTALL_DIR/the-claw"
ok "Binary deployed to $INSTALL_DIR/the-claw"

CLAW_CONFIG_DIR="$HOME/.config/borgclaw"
mkdir -p "$CLAW_CONFIG_DIR"

QUEEN_URL="(unknown)"
if [ -f "$SCRIPT_DIR/config/drone.json" ]; then
  cp "$SCRIPT_DIR/config/drone.json" "$CLAW_CONFIG_DIR/drone.json"
  QUEEN_URL=$(grep -o '"queen_url"[[:space:]]*:[[:space:]]*"[^"]*"' "$CLAW_CONFIG_DIR/drone.json" | cut -d'"' -f4)
  ok "Hive config installed (Queen: $QUEEN_URL)"
fi

# Copy browser-worker if present
if [ -d "$SCRIPT_DIR/browser-worker" ]; then
  mkdir -p "$HOME/.local/share/borgclaw"
  cp -r "$SCRIPT_DIR/browser-worker/." "$HOME/.local/share/borgclaw/browser-worker/"
  ok "Browser-worker scripts deployed"
fi

# Copy knowledge packs if present
KNOWLEDGE_DIR="$HOME/.config/borgclaw/knowledge"
mkdir -p "$KNOWLEDGE_DIR"
ZIM_COUNT=0
if [ -d "$SCRIPT_DIR/knowledge" ]; then
  for zim in "$SCRIPT_DIR/knowledge"/*.zim; do
    [ -f "$zim" ] || continue
    cp "$zim" "$KNOWLEDGE_DIR/"
    ZIM_COUNT=$((ZIM_COUNT + 1))
  done
fi
[ "$ZIM_COUNT" -gt 0 ] && ok "Knowledge packs: $ZIM_COUNT .zim file(s) installed"

progress_bar "HIVE LINK"

# ============================================================
# SCENE 5: ACTIVATING DRONE
# ============================================================
scene "ACTIVATING DRONE"

CLAW_BIN="$INSTALL_DIR/the-claw"
"$CLAW_BIN" --config "$CLAW_CONFIG_DIR/drone.json" &
CLAW_PID=$!
sleep 2

progress_bar "ACTIVATION"

# ============================================================
# ASSIMILATION COMPLETE
# ============================================================

if kill -0 $CLAW_PID 2>/dev/null; then
  if [ "$SILENT" -eq 0 ]; then
    echo ""
    echo -e "  ${BG}    _   ____ ____ ____ _  _ ____ _    ____ ___ ____ ____ _  _  ${NC}"
    echo -e "  ${BG}    |   [__  [__  |  | |\/| |  | |    |__|  |  |  | |  | |\ |  ${NC}"
    echo -e "  ${BG}    |   ___] ___] |__| |  | |__| |___ |  |  |  |__| |__| | \|  ${NC}"
    echo -e "  ${BG}                                                                ${NC}"
    echo -e "  ${BG}          C O M P L E T E                                       ${NC}"
    echo ""
    echo -e "  ${DIM}${C}+-----------------------------------------------+${NC}"
    echo -e "  ${DIM}${C}|${NC}  ${G}DRONE ACTIVE${NC}  PID: $CLAW_PID"
    echo -e "  ${DIM}${C}|${NC}  ${G}QUEEN${NC}         $QUEEN_URL"
    echo -e "  ${DIM}${C}|${NC}  ${G}DASHBOARD${NC}     $QUEEN_URL/dashboard"
    echo -e "  ${DIM}${C}|${NC}"
    echo -e "  ${DIM}${C}|${NC}  Stop:      ${DIM}pkill the-claw${NC}"
    echo -e "  ${DIM}${C}|${NC}  Restart:   ${DIM}the-claw --config ~/.config/borgclaw/drone.json${NC}"
    echo -e "  ${DIM}${C}|${NC}  Remove:    ${DIM}bash $SCRIPT_DIR/setup.sh --uninstall${NC}"
    echo -e "  ${DIM}${C}+-----------------------------------------------+${NC}"
    echo ""
    echo -e "  ${DIM}GREETS TO: The Collective, Queen, All Drones Past And Future${NC}"
    echo -e "  ${DIM}           cracked by BORGCLAW CREW 2026 -- WE ARE ONE${NC}"
    echo ""
  else
    echo "BORGCLAW: Drone active (PID: $CLAW_PID) -- Queen: $QUEEN_URL"
  fi
else
  err "Drone failed to start. Run manually:"
  echo "  $CLAW_BIN --config $CLAW_CONFIG_DIR/drone.json"
  exit 1
fi
SETUP
chmod +x "$CLAW_DIR/setup.sh"
ok "Setup script written"

# ============================================================
# Write README
# ============================================================

# Build human-readable model list for README
MODEL_LIST_DISPLAY=""
for m in "${MODELS_TO_CACHE[@]}"; do
  MODEL_LIST_DISPLAY+="  - $m\n"
done
if [ -z "$MODEL_LIST_DISPLAY" ]; then
  MODEL_LIST_DISPLAY="  - (none pre-cached — node pulls on first boot)\n"
fi

cat > "$CLAW_DIR/README.txt" << README
THE CLAW — BorgClaw Node Installer
===================================
Profile: ${PROFILE}

This drive turns any Linux machine into a BorgClaw hive node.

QUICK START:
  1. Plug this drive into any Linux machine
  2. Open a terminal
  3. Run: bash /path/to/THE-CLAW/setup.sh
  4. Done. Check the Queen dashboard — the node will appear.

WHAT IT INSTALLS:
  - Ollama (local LLM inference engine)
  - The Claw binary (BorgClaw node agent)
  - Node config pointing at Queen: http://${QUEEN_IP}:9090

PRE-CACHED MODELS (${PROFILE} profile):
$(printf "$MODEL_LIST_DISPLAY")

REQUIREMENTS:
  - Linux (Debian, Ubuntu, Fedora, Arch, etc.)
  - 4GB+ RAM (8GB recommended for worker profile)
  - Internet for Ollama install (models are pre-cached)

QUEEN DASHBOARD:
  http://${QUEEN_IP}:9090/dashboard

STOP THE NODE:
  pkill the-claw

CONTRIBUTION DIAL:
  Adjust from the Queen dashboard, or:
  curl -X PUT http://localhost:9091/contribution -d '{"level": 30}'

PROFILES:
  scout    phi4-mini only              (~4GB drive)
  worker   qwen3:8b + phi4-mini        (~8GB drive)
  scholar  + gemma3:27b                (~16GB drive)
  arsenal  all local models            (~32GB+ drive)

README
ok "README written"

# ============================================================
# Summary
# ============================================================

echo ""
TOTAL_SIZE=$(du -sh "$CLAW_DIR" | cut -f1)
echo "  ╔══════════════════════════════════════╗"
printf "  ║   USB DRIVE READY — %s total" "$TOTAL_SIZE"
echo ""
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Profile: ${BOLD}${PROFILE}${NC}"
echo ""
echo "  Contents:"
echo "    THE-CLAW/setup.sh         — Run this on target machine"
echo "    THE-CLAW/the-claw         — Node binary (Linux amd64)"
echo "    THE-CLAW/models/          — Pre-cached LLM models (${PROFILE})"
echo "    THE-CLAW/browser-worker/  — Python browser task worker"
echo "    THE-CLAW/lightpanda/      — Lightpanda placeholder (install on target)"
echo "    THE-CLAW/knowledge/       — Offline ZIM knowledge packs (drop .zim files here)"
echo "    THE-CLAW/config/          — Queen URL: http://${QUEEN_IP}:9090"
echo "    THE-CLAW/README.txt       — Instructions"
echo ""
echo "  Cached models:"
if [ ${#MODELS_TO_CACHE[@]} -eq 0 ]; then
  echo "    (none — node will pull on first boot)"
else
  for m in "${MODELS_TO_CACHE[@]}"; do
    echo "    - $m"
  done
fi
echo ""
echo "  Plug into any Linux machine, run setup.sh, done."
echo ""
