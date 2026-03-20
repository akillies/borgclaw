#!/usr/bin/env bash
# ============================================================
# BorgClaw Bootstrap — The Assimilator (macOS / Linux)
# ============================================================
# Detects hardware, installs dependencies, configures node,
# pulls models, indexes QMD, and gets this machine running.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/.../bootstrap.sh | bash
#   or:  bash bootstrap.sh [--role queen|worker|satellite] [--queen-ip IP]
#
# Spec: BOOTSTRAP-COMPATIBILITY.md
# ============================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

# --- Config ---
AKOS_DIR="${AKOS_DIR:-$HOME/akos}"
MIN_RAM_GB=8
MIN_DISK_GB=10
MIN_NODE_MAJOR=22
MIN_PYTHON_MINOR=10   # 3.10+
QMD_PACKAGE="@tobilu/qmd"
OLLAMA_INSTALL_URL="https://ollama.com/install.sh"

# --- State ---
OS=""
ARCH=""
CHIP=""
PROFILE=""
ROLE=""
RAM_GB=0
GPU_TYPE="none"
GPU_VRAM_MB=0
QUEEN_IP=""
ERRORS=()
WARNINGS=()

# ============================================================
# STEP 0: Parse Arguments
# ============================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)     ROLE="$2"; shift 2 ;;
    --queen-ip) QUEEN_IP="$2"; shift 2 ;;
    --help)
      echo "Usage: bootstrap.sh [--role queen|worker|satellite] [--queen-ip IP]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ============================================================
# Helpers
# ============================================================
log()  { echo -e "${BLUE}[BORGCLAW]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; WARNINGS+=("$*"); }
err()  { echo -e "${RED}  ✗${NC} $*"; ERRORS+=("$*"); }
fail() { echo -e "${RED}[FATAL]${NC} $*"; exit 1; }

check_command() { command -v "$1" &>/dev/null; }

version_ge() {
  # Returns 0 if $1 >= $2 (semantic versioning, major.minor)
  local IFS=.
  local i ver1=($1) ver2=($2)
  for ((i=0; i<${#ver2[@]}; i++)); do
    if ((${ver1[i]:-0} < ${ver2[i]:-0})); then return 1; fi
    if ((${ver1[i]:-0} > ${ver2[i]:-0})); then return 0; fi
  done
  return 0
}

# ============================================================
# STEP 1: Detect Hardware
# ============================================================
detect_hardware() {
  log "Step 1/11: Detecting hardware..."

  # OS
  case "$(uname -s)" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    *)      fail "Unsupported OS: $(uname -s). BorgClaw supports macOS and Linux." ;;
  esac

  # Architecture
  ARCH="$(uname -m)"

  # RAM
  if [[ "$OS" == "macos" ]]; then
    RAM_GB=$(sysctl -n hw.memsize | awk '{printf "%.0f", $1/1073741824}')
  else
    RAM_GB=$(awk '/MemTotal/ {printf "%.0f", $2/1048576}' /proc/meminfo)
  fi

  # CPU / Chip
  if [[ "$OS" == "macos" ]]; then
    CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")
    if [[ "$CHIP" == *"Apple"* ]]; then
      GPU_TYPE="apple-silicon"
      ok "Apple Silicon detected: $CHIP"

      # Check macOS version for MLX
      local os_ver
      os_ver=$(sw_vers -productVersion)
      if [[ "$(printf '%s\n' "14.0" "$os_ver" | sort -V | head -n1)" != "14.0" ]]; then
        warn "macOS $os_ver — MLX requires 14.0+. LM Studio may fall back to non-MLX."
      fi
    else
      GPU_TYPE="none"
      ok "Intel Mac detected: $CHIP"
      warn "Intel Mac: LM Studio NOT available. Ollama will run CPU-only (slow)."
    fi
  else
    # Linux GPU detection
    if check_command nvidia-smi; then
      GPU_TYPE="nvidia"
      GPU_VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
      local driver_ver
      driver_ver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)
      ok "NVIDIA GPU detected: ${GPU_VRAM_MB}MB VRAM, driver $driver_ver"

      local driver_major
      driver_major=$(echo "$driver_ver" | cut -d. -f1)
      if (( driver_major < 531 )); then
        warn "NVIDIA driver $driver_ver is old. Ollama needs 531+. Please update."
      fi
    elif lspci 2>/dev/null | grep -qi "amd.*radeon\|amd.*rx"; then
      GPU_TYPE="amd"
      warn "AMD GPU detected. ROCm support is experimental. CPU fallback recommended."
    else
      GPU_TYPE="none"
      ok "No GPU detected. CPU-only mode."
    fi
  fi

  ok "OS: $OS | Arch: $ARCH | RAM: ${RAM_GB}GB | GPU: $GPU_TYPE"
}

# ============================================================
# STEP 2: Check Hard Floors
# ============================================================
check_floors() {
  log "Step 2/11: Checking minimum requirements..."

  # RAM
  if (( RAM_GB < MIN_RAM_GB )); then
    fail "${RAM_GB}GB RAM detected. Minimum ${MIN_RAM_GB}GB required. Cannot proceed."
  elif (( RAM_GB < 16 )); then
    warn "${RAM_GB}GB RAM. Only small models (3-4B) recommended."
  else
    ok "RAM: ${RAM_GB}GB"
  fi

  # Disk
  local free_gb
  if [[ "$OS" == "macos" ]]; then
    free_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
  else
    free_gb=$(df -BG "$HOME" | awk 'NR==2 {print $4}' | tr -d 'G')
  fi
  if (( free_gb < MIN_DISK_GB )); then
    fail "${free_gb}GB disk free. Minimum ${MIN_DISK_GB}GB required."
  else
    ok "Disk: ${free_gb}GB free"
  fi
}

# ============================================================
# STEP 3: Map Hardware Profile
# ============================================================
map_profile() {
  log "Step 3/11: Mapping hardware profile..."

  if [[ "$GPU_TYPE" == "apple-silicon" ]]; then
    if (( RAM_GB >= 24 )); then
      PROFILE="mac-apple-silicon-24gb"
    elif (( RAM_GB >= 16 )); then
      PROFILE="mac-apple-silicon-16gb"
    else
      PROFILE="mac-apple-silicon-8gb"
    fi
  elif [[ "$GPU_TYPE" == "nvidia" ]]; then
    if (( GPU_VRAM_MB >= 8192 )); then
      PROFILE="nvidia-8gb-32gb-ram"
    elif (( GPU_VRAM_MB >= 4096 )); then
      PROFILE="nvidia-4gb-legacy"
    else
      PROFILE="cpu-only-${RAM_GB}gb"
    fi
  elif [[ "$OS" == "macos" && "$GPU_TYPE" == "none" ]]; then
    PROFILE="mac-intel"
  else
    if (( RAM_GB >= 16 )); then
      PROFILE="cpu-only-16gb"
    elif (( RAM_GB >= 8 )); then
      PROFILE="cpu-only-8gb"
    else
      PROFILE="satellite-search-only"
    fi
  fi

  ok "Profile: $PROFILE"
}

# ============================================================
# STEP 4: Recommend Role
# ============================================================
recommend_role() {
  log "Step 4/11: Recommending node role..."

  if [[ -n "$ROLE" ]]; then
    ok "Role override: $ROLE (user-specified)"
    return
  fi

  case "$PROFILE" in
    mac-apple-silicon-24gb)
      ROLE="queen"
      ok "Recommended: QUEEN — MLX acceleration, 24GB+ RAM, full services" ;;
    nvidia-8gb-32gb-ram)
      ROLE="worker"
      ok "Recommended: WORKER — CUDA acceleration, 8GB+ VRAM" ;;
    mac-apple-silicon-16gb|nvidia-4gb-legacy|cpu-only-16gb)
      ROLE="worker"
      ok "Recommended: WORKER — capable but limited. Can run smaller models." ;;
    mac-intel|mac-apple-silicon-8gb|cpu-only-8gb)
      ROLE="satellite"
      ok "Recommended: SATELLITE — search node only. LLM inference will be very slow." ;;
    *)
      ROLE="satellite"
      ok "Recommended: SATELLITE — safe default for unknown hardware." ;;
  esac

  echo ""
  echo -e "  ${CYAN}Role: ${ROLE^^}${NC}"
  echo -e "  ${CYAN}Profile: $PROFILE${NC}"
  echo ""
  read -rp "  Accept this role? [Y/n/change]: " confirm
  case "$confirm" in
    n|N) fail "Aborted. Re-run with --role <queen|worker|satellite> to override." ;;
    change|c|C)
      read -rp "  Enter role (queen/worker/satellite): " ROLE
      ok "Role changed to: $ROLE" ;;
    *) ok "Role accepted: $ROLE" ;;
  esac
}

# ============================================================
# STEP 5: Install Dependencies
# ============================================================
install_deps() {
  log "Step 5/11: Installing dependencies..."

  # --- Package manager ---
  if [[ "$OS" == "macos" ]]; then
    if ! check_command brew; then
      log "Installing Homebrew..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    PKG_INSTALL="brew install"
  else
    PKG_INSTALL="sudo apt-get install -y"
    sudo apt-get update -qq
  fi

  # --- Node.js ---
  if check_command node; then
    local node_ver
    node_ver=$(node -v | sed 's/v//')
    local node_major
    node_major=$(echo "$node_ver" | cut -d. -f1)
    if (( node_major < MIN_NODE_MAJOR )); then
      warn "Node.js $node_ver found but need $MIN_NODE_MAJOR+. Installing..."
      install_node
    else
      ok "Node.js $node_ver"
    fi
  else
    install_node
  fi

  # --- Python ---
  local py_cmd="python3"
  if check_command python3; then
    local py_ver
    py_ver=$($py_cmd --version | awk '{print $2}')
    local py_minor
    py_minor=$(echo "$py_ver" | cut -d. -f2)
    if (( py_minor < MIN_PYTHON_MINOR )); then
      warn "Python $py_ver found but need 3.$MIN_PYTHON_MINOR+. Installing..."
      install_python
    else
      ok "Python $py_ver"
    fi
  else
    install_python
  fi

  # --- Git ---
  if check_command git; then
    ok "Git $(git --version | awk '{print $3}')"
  else
    log "Installing Git..."
    $PKG_INSTALL git
    ok "Git installed"
  fi

  # --- SQLite (Intel Mac only, for QMD) ---
  if [[ "$PROFILE" == "mac-intel" ]]; then
    if ! brew list sqlite &>/dev/null; then
      log "Installing SQLite (required for QMD on Intel Mac)..."
      brew install sqlite
    fi
    ok "SQLite (Intel Mac)"
  fi
}

install_node() {
  if [[ "$OS" == "macos" ]]; then
    brew install node@22
    brew link --overwrite node@22
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  ok "Node.js $(node -v) installed"
}

install_python() {
  if [[ "$OS" == "macos" ]]; then
    brew install python@3.12
  else
    sudo apt-get install -y python3.12 python3.12-venv python3-pip
  fi
  ok "Python $(python3 --version | awk '{print $2}') installed"
}

# ============================================================
# STEP 6: Install Ollama
# ============================================================
install_ollama() {
  log "Step 6/11: Setting up Ollama..."

  if check_command ollama; then
    ok "Ollama already installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
    return
  fi

  if [[ "$OS" == "macos" ]]; then
    brew install ollama
  else
    curl -fsSL "$OLLAMA_INSTALL_URL" | sh
  fi

  ok "Ollama installed"
}

# ============================================================
# STEP 7: Install QMD
# ============================================================
install_qmd() {
  log "Step 7/11: Installing QMD..."

  if check_command qmd; then
    ok "QMD already installed"
    return
  fi

  # Try global install first
  log "Attempting global install..."
  if npm install -g "$QMD_PACKAGE" 2>/dev/null && check_command qmd; then
    ok "QMD installed globally"
    return
  fi

  # Fall back to local install (symlink issues with global)
  warn "Global install failed. Installing locally in $AKOS_DIR..."
  mkdir -p "$AKOS_DIR"
  cd "$AKOS_DIR"
  npm install "$QMD_PACKAGE"

  # Add to PATH
  local bin_path="$AKOS_DIR/node_modules/.bin"
  if ! echo "$PATH" | grep -q "$bin_path"; then
    export PATH="$bin_path:$PATH"
    # Persist in shell config
    local shell_rc="$HOME/.bashrc"
    [[ "$SHELL" == *"zsh"* ]] && shell_rc="$HOME/.zshrc"
    echo "export PATH=\"$bin_path:\$PATH\"" >> "$shell_rc"
  fi

  if check_command qmd; then
    ok "QMD installed locally at $AKOS_DIR"
  else
    err "QMD installation failed. You may need build tools."
    err "Run: xcode-select --install (Mac) or: sudo apt install build-essential cmake (Linux)"
    err "Then re-run this script."
  fi
}

# ============================================================
# STEP 8: Pull Models
# ============================================================
pull_models() {
  log "Step 8/11: Pulling models for profile: $PROFILE..."

  # Determine which models to pull based on profile
  case "$PROFILE" in
    mac-apple-silicon-24gb)
      pull_ollama_model "qwen3:8b" "general"
      pull_ollama_model "qwen3:14b" "reasoning"
      pull_ollama_model "qwen2.5-coder:7b" "code"
      ;;
    mac-apple-silicon-16gb)
      pull_ollama_model "qwen3:8b" "general"
      pull_ollama_model "qwen2.5-coder:7b" "code"
      ;;
    nvidia-8gb-32gb-ram)
      pull_ollama_model "qwen3:8b" "general"
      pull_ollama_model "qwen3:14b" "reasoning"
      pull_ollama_model "qwen2.5-coder:7b" "code"
      ;;
    nvidia-4gb-legacy|mac-apple-silicon-8gb)
      pull_ollama_model "qwen3:4b" "general"
      ;;
    mac-intel|cpu-only-16gb)
      pull_ollama_model "qwen3:4b" "general"
      ;;
    cpu-only-8gb)
      pull_ollama_model "qwen3:1.7b" "general"
      ;;
    satellite-search-only)
      log "Satellite role: skipping LLM model pulls (QMD embedding models only)"
      ;;
    *)
      pull_ollama_model "qwen3:4b" "general (fallback)"
      ;;
  esac

  ok "Model pulls complete"
}

pull_ollama_model() {
  local model="$1"
  local purpose="$2"
  log "  Pulling $model ($purpose)..."
  if ollama pull "$model"; then
    ok "  $model ready"
  else
    err "  Failed to pull $model. You can retry manually: ollama pull $model"
  fi
}

# ============================================================
# STEP 9: Configure Node
# ============================================================
configure_node() {
  log "Step 9/11: Configuring node..."

  mkdir -p "$AKOS_DIR/db/ak-os/projects/borgclaw/config/nodes"

  local hostname
  if [[ "$OS" == "macos" ]]; then
    hostname=$(ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1")
  else
    hostname=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "127.0.0.1")
  fi

  local node_id
  node_id=$(hostname | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
  local display_name
  display_name="$(hostname) (${PROFILE})"

  local config_file="$AKOS_DIR/db/ak-os/projects/borgclaw/config/nodes/${node_id}.yaml"

  cat > "$config_file" << YAML
# Node Configuration — Auto-generated by bootstrap.sh
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

node_id: ${node_id}
role: ${ROLE}
hostname: ${hostname}
$([ "$ROLE" != "queen" ] && echo "queen_address: ${QUEEN_IP:-192.168.1.100}:9090")
display_name: "${display_name}"

hardware:
  cpu: "$(sysctl -n machdep.cpu.brand_string 2>/dev/null || grep 'model name' /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo 'unknown')"
  ram_gb: ${RAM_GB}
  gpu: "${GPU_TYPE}$([ "$GPU_VRAM_MB" -gt 0 ] 2>/dev/null && echo " ${GPU_VRAM_MB}MB VRAM" || true)"
  os: "$(uname -s) $(uname -r)"

profile: ${PROFILE}

capabilities:
$(case "$ROLE" in
  queen)
    echo "  - mlx_inference"
    echo "  - qmd_search"
    echo "  - mcp_host"
    echo "  - nats_server"
    echo "  - queen_api"
    echo "  - scheduled_tasks"
    ;;
  worker)
    if [[ "$GPU_TYPE" == "nvidia" ]]; then echo "  - cuda_inference"; fi
    if [[ "$GPU_TYPE" == "apple-silicon" ]]; then echo "  - mlx_inference"; fi
    echo "  - scheduled_tasks"
    echo "  - docker_host"
    ;;
  satellite)
    echo "  - qmd_search"
    ;;
esac)

heartbeat:
  interval_seconds: 30
$([ "$ROLE" != "queen" ] && echo "  queen_url: \"http://${QUEEN_IP:-192.168.1.100}:9090/api/nodes/${node_id}/heartbeat\"")
YAML

  ok "Node config written: $config_file"
}

# ============================================================
# STEP 10: Index QMD
# ============================================================
index_qmd() {
  log "Step 10/11: Indexing QMD collections..."

  if ! check_command qmd; then
    warn "QMD not found. Skipping indexing."
    return
  fi

  local db_dir="$AKOS_DIR/db"
  if [[ ! -d "$db_dir" ]]; then
    warn "No db/ directory found at $db_dir. Skipping QMD indexing."
    warn "Clone or copy the AK-OS knowledge base to $db_dir first, then run: qmd index"
    return
  fi

  # Index collections based on role
  case "$ROLE" in
    queen)
      log "  Indexing ak-os-core..."
      qmd index "$AKOS_DIR/db/ak-os" --name ak-os-core 2>/dev/null && ok "  ak-os-core indexed" || warn "  ak-os-core indexing failed"

      log "  Indexing entities..."
      qmd index "$AKOS_DIR/db/ak-os/entities" --name entities 2>/dev/null && ok "  entities indexed" || warn "  entities indexing failed"

      log "  Indexing borgclaw..."
      qmd index "$AKOS_DIR/db/ak-os/projects/borgclaw" --name borgclaw 2>/dev/null && ok "  borgclaw indexed" || warn "  borgclaw indexing failed"

      log "  Indexing master-context..."
      qmd index "$AKOS_DIR/db" --name master-context 2>/dev/null && ok "  master-context indexed" || warn "  master-context indexing failed"
      ;;
    worker|satellite)
      log "  Indexing local collections..."
      qmd index "$AKOS_DIR/db/ak-os" --name ak-os-core 2>/dev/null && ok "  ak-os-core indexed" || warn "  ak-os-core indexing failed"
      ;;
  esac

  # Check for Metal crash (Apple Silicon QMD bug)
  if [[ "$GPU_TYPE" == "apple-silicon" ]] && [[ ${#WARNINGS[@]} -gt 0 ]]; then
    if printf '%s\n' "${WARNINGS[@]}" | grep -qi "indexing failed"; then
      warn "QMD indexing may have hit Apple Silicon Metal bug."
      warn "Retrying with CPU-only mode..."
      export NODE_LLAMA_CPP_METAL=false
      qmd index "$AKOS_DIR/db/ak-os" --name ak-os-core 2>/dev/null && ok "  Reindex succeeded (CPU mode)" || err "  Reindex also failed. Check QMD logs."
    fi
  fi
}

# ============================================================
# STEP 11: Health Check & Summary
# ============================================================
health_check() {
  log "Step 11/11: Running health check..."

  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║           BorgClaw Bootstrap — Summary                     ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BLUE}Node ID:${NC}     $(hostname | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
  echo -e "  ${BLUE}Role:${NC}        ${ROLE^^}"
  echo -e "  ${BLUE}Profile:${NC}     $PROFILE"
  echo -e "  ${BLUE}OS:${NC}          $OS ($ARCH)"
  echo -e "  ${BLUE}RAM:${NC}         ${RAM_GB}GB"
  echo -e "  ${BLUE}GPU:${NC}         $GPU_TYPE"
  echo ""

  # Component status
  echo -e "  ${BLUE}Components:${NC}"
  check_command node   && ok "Node.js $(node -v)"           || err "Node.js NOT FOUND"
  check_command python3 && ok "Python $(python3 --version 2>&1 | awk '{print $2}')" || err "Python NOT FOUND"
  check_command git    && ok "Git $(git --version | awk '{print $3}')"              || err "Git NOT FOUND"
  check_command ollama && ok "Ollama installed"             || warn "Ollama NOT FOUND"
  check_command qmd    && ok "QMD installed"                || warn "QMD NOT FOUND"
  check_command docker && ok "Docker installed"             || warn "Docker NOT FOUND (optional for $ROLE)"
  echo ""

  # Warnings
  if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo -e "  ${YELLOW}Warnings (${#WARNINGS[@]}):${NC}"
    for w in "${WARNINGS[@]}"; do
      echo -e "  ${YELLOW}  ⚠ $w${NC}"
    done
    echo ""
  fi

  # Errors
  if [[ ${#ERRORS[@]} -gt 0 ]]; then
    echo -e "  ${RED}Errors (${#ERRORS[@]}):${NC}"
    for e in "${ERRORS[@]}"; do
      echo -e "  ${RED}  ✗ $e${NC}"
    done
    echo ""
  fi

  # Next steps
  echo -e "  ${CYAN}Next Steps:${NC}"
  case "$ROLE" in
    queen)
      echo "    1. Start Ollama:  ollama serve"
      echo "    2. Start QMD MCP: qmd mcp-server"
      echo "    3. Start NATS:    docker compose -f $AKOS_DIR/db/ak-os/projects/borgclaw/docker-compose.yml up -d nats"
      echo "    4. Start Queen:   node $AKOS_DIR/db/ak-os/projects/borgclaw/services/queen/server.js"
      ;;
    worker)
      echo "    1. Start Ollama:  ollama serve"
      echo "    2. Ensure Queen is running at ${QUEEN_IP:-192.168.1.100}:9090"
      echo "    3. Start Docker:  docker compose -f $AKOS_DIR/db/ak-os/projects/borgclaw/docker-compose.yml up -d"
      ;;
    satellite)
      echo "    1. Start QMD:     qmd mcp-server"
      echo "    2. Ensure Queen is reachable at ${QUEEN_IP:-192.168.1.100}:9090"
      ;;
  esac

  echo ""
  echo -e "  ${GREEN}Config file:${NC} $AKOS_DIR/db/ak-os/projects/borgclaw/config/nodes/$(hostname | tr '[:upper:]' '[:lower:]' | tr ' ' '-').yaml"
  echo -e "  ${GREEN}AKOS dir:${NC}    $AKOS_DIR"
  echo ""
  echo -e "${GREEN}Bootstrap complete. Welcome to the Collective.${NC}"
}

# ============================================================
# MAIN
# ============================================================
main() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║           BorgClaw Bootstrap — The Assimilator             ║${NC}"
  echo -e "${CYAN}║           Resistance is futile.                            ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  detect_hardware       # Step 1
  check_floors          # Step 2
  map_profile           # Step 3
  recommend_role        # Step 4
  install_deps          # Step 5
  install_ollama        # Step 6
  install_qmd           # Step 7
  pull_models           # Step 8
  configure_node        # Step 9
  index_qmd             # Step 10
  health_check          # Step 11
}

main "$@"
