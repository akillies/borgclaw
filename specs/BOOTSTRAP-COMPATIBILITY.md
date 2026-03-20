# BorgClaw Bootstrap — Compatibility & Dependency Spec
## What every machine needs, what every edge case looks like.
**Date:** 2026-03-16 | **For:** bootstrap.sh and bootstrap.ps1 authors

---

## THE HARD FLOORS

These are non-negotiable. If a machine doesn't meet these, bootstrap.sh exits with a clear message.

| Requirement | Floor | Why |
|------------|-------|-----|
| RAM | 8 GB | QMD models alone need ~2GB in memory. Ollama needs headroom. Below 8GB, nothing runs usefully. |
| Disk | 10 GB free | QMD models (~2GB) + Ollama models (~4-8GB) + AK-OS files (~500MB) + Docker images (~2-3GB) |
| Node.js | 22.0.0+ | QMD requires Node.js ≥22. Non-negotiable — it uses modern ESM features and node-llama-cpp bindings. |
| Python | 3.10+ | LangGraph, mem0 (Phase 2), various scripts. 3.10 is the floor for current package compatibility. |
| Git | 2.x | Knowledge base sync. Any modern git works. |

---

## PLATFORM COMPATIBILITY MATRIX

### macOS

| Machine Type | LLM Server | QMD | Docker | LM Studio | Notes |
|-------------|-----------|-----|--------|-----------|-------|
| **Apple Silicon (M1/M2/M3/M4)** | Ollama ✅ (Metal GPU) | ✅ (Metal acceleration) | ✅ | ✅ (MLX, 2-3x fast) | Best experience. macOS 13.4+ required. MLX needs macOS 14.0+. |
| **Intel Mac (2018+, 16GB+)** | Ollama ✅ (CPU only) | ✅ (CPU, needs `brew install sqlite`) | ✅ (VT-x required) | ❌ NOT SUPPORTED | LM Studio is Apple Silicon only. Ollama runs CPU-only. Usable for small models (3-7B). Slow but functional. |
| **Intel Mac (<16GB)** | Ollama ⚠️ (barely) | ✅ (CPU) | ⚠️ (tight RAM) | ❌ | 8GB Intel Mac can run 3-4B models. Docker will compete for RAM. Consider Satellite role only (QMD search, no LLM inference). |
| **macOS version** | 11.0+ (Big Sur) | 13.4+ | 11.0+ | 13.4+ (MLX: 14.0+) | If on macOS <13.4, QMD and LM Studio won't work. Ollama and Docker still fine. |

**Bootstrap detection logic (Mac):**
```bash
# 1. Check chip type
chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")
if [[ "$chip" == *"Apple"* ]]; then
  PROFILE="mac-apple-silicon"
  # Check macOS version for MLX
  os_ver=$(sw_vers -productVersion)
  if [[ "$os_ver" < "14.0" ]]; then
    echo "WARN: macOS 14.0+ recommended for MLX. LM Studio may not use MLX backend."
  fi
else
  PROFILE="mac-intel-cpu"
  echo "INFO: Intel Mac detected. LM Studio NOT available. Using Ollama (CPU-only)."
  echo "      Performance will be limited. Consider Satellite role for this node."
fi

# 2. Check RAM
ram_gb=$(sysctl -n hw.memsize | awk '{printf "%.0f", $1/1073741824}')
if (( ram_gb < 8 )); then
  echo "ERROR: ${ram_gb}GB RAM detected. Minimum 8GB required."
  exit 1
elif (( ram_gb < 16 )); then
  echo "WARN: ${ram_gb}GB RAM. Only small models (3-4B) recommended."
fi

# 3. Check if Homebrew SQLite is needed (Intel Mac + QMD)
if [[ "$PROFILE" == "mac-intel-cpu" ]]; then
  if ! brew list sqlite &>/dev/null; then
    echo "Installing SQLite via Homebrew (required for QMD on Intel Mac)..."
    brew install sqlite
  fi
fi
```

### Windows

| Machine Type | LLM Server | QMD | Docker | LM Studio | Notes |
|-------------|-----------|-----|--------|-----------|-------|
| **Windows 11 + NVIDIA GPU** | Ollama ✅ (CUDA) | ✅ (CUDA optional) | ✅ (WSL2) | ✅ | Best Windows experience. Driver 531+. |
| **Windows 10 22H2+ + NVIDIA GPU** | Ollama ✅ (CUDA) | ✅ | ✅ (WSL2) | ✅ | Same as Win11. Build 19044+ required. |
| **Windows 10 < 22H2** | ❌ | ❌ | ❌ | ❌ | Too old. Docker needs 22H2+. Must update Windows. |
| **Windows + AMD GPU** | Ollama ⚠️ (ROCm, limited) | ✅ (CPU) | ✅ | ✅ | ROCm support exists but is less reliable. CPU fallback recommended. |
| **Windows + Intel Arc** | Ollama ❌ (no official) | ✅ (CPU) | ✅ | ✅ | No official Ollama Intel Arc support. Experimental Vulkan exists. CPU fallback. |
| **Windows + No GPU** | Ollama ✅ (CPU) | ✅ (CPU) | ✅ | ✅ | Slow (3-6 tokens/sec). Satellite role recommended. |
| **Windows ARM (Snapdragon)** | Ollama ⚠️ | ✅ | ⚠️ | ✅ | Experimental. ARM Windows is young territory. |

**NVIDIA GPU floor:** Compute Capability 5.0+ (covers everything from GTX 750 Ti onward):

| GPU Generation | Examples | Compute Cap | Supported | VRAM | Can Run |
|---------------|---------|-------------|-----------|------|---------|
| Maxwell (2014) | GTX 750 Ti, 960, 970, 980 | 5.0-5.2 | ✅ | 2-4 GB | 3-4B models only |
| Pascal (2016) | GTX 1060, 1070, 1080 | 6.1 | ✅ | 6-8 GB | 7-8B models |
| Turing (2018) | RTX 2060, 2070, 2080 | 7.5 | ✅ | 6-11 GB | 7-14B models |
| Ampere (2020) | RTX 3060, 3070, 3080 | 8.6 | ✅ | 8-12 GB | 8-14B models |
| Lovelace (2022) | RTX 4060, 4070, 4080, 4090 | 8.9 | ✅ | 8-24 GB | 14-70B models |
| Blackwell (2025) | RTX 5070, 5080, 5090 | 10.0 | ✅ | 12-32 GB | Up to 70B+ |

**Bootstrap detection logic (Windows / PowerShell):**
```powershell
# 1. Check NVIDIA GPU
$gpu = Get-WmiObject Win32_VideoController | Where-Object { $_.Name -match "NVIDIA" }
if ($gpu) {
    $vram_mb = [math]::Round($gpu.AdapterRAM / 1MB)
    Write-Host "NVIDIA GPU detected: $($gpu.Name) ($vram_mb MB VRAM)"

    # Check driver version
    $driver = (nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null)
    if ($driver -and [int]$driver.Split('.')[0] -lt 531) {
        Write-Host "WARN: Driver $driver is old. Update to 531+ for best Ollama support."
    }

    $PROFILE = if ($vram_mb -ge 8192) { "nvidia-8gb-32gb-ram" }
               elseif ($vram_mb -ge 4096) { "nvidia-4gb-legacy" }
               else { "cpu-only" }
} else {
    Write-Host "No NVIDIA GPU detected. CPU-only mode."
    $PROFILE = "cpu-only"
}

# 2. Check Windows version
$build = [System.Environment]::OSVersion.Version.Build
if ($build -lt 19044) {
    Write-Host "ERROR: Windows build $build is too old. Need 19044+ (22H2). Please update Windows."
    exit 1
}

# 3. Check RAM
$ram_gb = [math]::Round((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
if ($ram_gb -lt 8) {
    Write-Host "ERROR: ${ram_gb}GB RAM detected. Minimum 8GB required."
    exit 1
}
```

### Linux

| Distro | LLM Server | QMD | Docker | Notes |
|--------|-----------|-----|--------|-------|
| **Ubuntu 22.04+** | Ollama ✅ | ✅ | ✅ | Primary target. Everything works. |
| **Ubuntu 20.04** | Ollama ✅ | ✅ | ✅ | Should work but not actively tested. |
| **Ubuntu 18.04** | Ollama ⚠️ | ⚠️ (Node 22 may need nvm) | ✅ | Old. Packages may be stale. Proceed with caution. |
| **Debian 12** | Ollama ✅ | ✅ | ✅ | Works fine. |
| **Fedora 38+** | Ollama ✅ | ✅ | ✅ (Podman alternative) | Works. Podman can substitute Docker. |
| **Arch** | Ollama ✅ | ✅ | ✅ | Rolling release, always current. |
| **Linux + NVIDIA** | CUDA via driver | CUDA optional | nvidia-container-toolkit | Need proprietary NVIDIA driver, not nouveau. |
| **Linux + AMD** | ROCm ⚠️ | CPU | — | ROCm support varies by kernel and GPU. Experimental. |

---

## DEPENDENCY INSTALLATION MATRIX

What bootstrap.sh needs to install, by platform:

| Dependency | Mac (Homebrew) | Windows (winget/choco) | Linux (apt) | Version | Size |
|-----------|---------------|----------------------|-------------|---------|------|
| Node.js 22 | `brew install node@22` | `winget install OpenJS.NodeJS.LTS` | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo bash && apt install nodejs` | ≥22.0.0 | ~50MB |
| Python 3.12 | `brew install python@3.12` | `winget install Python.Python.3.12` | `apt install python3.12 python3.12-venv` | ≥3.10 | ~100MB |
| Git | `brew install git` (or Xcode CLT) | `winget install Git.Git` | `apt install git` | ≥2.x | ~50MB |
| QMD | `npm install -g @tobilu/qmd` | same | same | latest | ~50MB + ~2GB models |
| Ollama | `brew install ollama` or curl script | Download from ollama.com | `curl -fsSL https://ollama.com/install.sh \| sh` | latest | ~100MB + models |
| LM Studio | Download .dmg from lmstudio.ai | Download .exe from lmstudio.ai | AppImage from lmstudio.ai | latest | ~200MB |
| Docker | `brew install --cask docker` | Docker Desktop installer | `apt install docker.io docker-compose-v2` | latest | ~500MB |
| SQLite (Intel Mac only) | `brew install sqlite` | built-in | built-in | — | ~5MB |
| Build tools (if QMD compiles from source) | `xcode-select --install` | Visual Studio Build Tools + CMake | `apt install build-essential cmake` | — | ~1-5GB |

### Build Tools: When Are They Needed?

QMD uses node-llama-cpp which ships **pre-built binaries** for most platforms. Build tools are only needed if:
- Your OS/arch doesn't have pre-built binaries (rare)
- You want to compile with specific optimizations (CUDA, Metal)
- The pre-built binary fails to load (corrupted download, ABI mismatch)

**Bootstrap should:** Try `npm install -g @tobilu/qmd` first. If it fails with a native module error, THEN install build tools and retry.

---

## ROLE ASSIGNMENT LOGIC

Based on hardware detection, bootstrap.sh should recommend a role:

```
IF apple_silicon AND ram >= 24GB:
    recommend: QUEEN
    rationale: "MLX acceleration, enough RAM for 14B models + QMD + services"

ELIF nvidia_gpu AND vram >= 8GB AND ram >= 16GB:
    recommend: WORKER (or QUEEN if no Apple Silicon node exists)
    rationale: "CUDA acceleration, enough VRAM for 8B models"

ELIF nvidia_gpu AND vram >= 4GB AND ram >= 16GB:
    recommend: WORKER (with smaller models)
    rationale: "Limited VRAM. Can run 3-4B models. Good for batch tasks."

ELIF cpu_only AND ram >= 16GB:
    recommend: SATELLITE
    rationale: "CPU-only. Can run QMD search and 3-4B models slowly. Good for search node."

ELIF ram < 16GB:
    recommend: SATELLITE (search only)
    rationale: "Limited RAM. Run QMD for search. Skip LLM inference."

ELSE:
    recommend: SATELLITE
    rationale: "Unknown hardware profile. Safe default."
```

Roles and what they run:

| Role | QMD | LLM Server | NATS | Docker | Scheduled Tasks | Queen API |
|------|-----|-----------|------|--------|----------------|-----------|
| **Queen** | ✅ (index + MCP) | ✅ (primary) | ✅ (server) | ✅ | ✅ | ✅ |
| **Worker** | ✅ (local index) | ✅ (secondary) | ✅ (client) | ✅ | ✅ (subset) | ❌ |
| **Satellite** | ✅ (search only) | ⚠️ (small models or none) | ❌ | ❌ | ❌ | ❌ |

---

## KNOWN ISSUES & EDGE CASES

### QMD on Apple Silicon
Three open bugs as of March 2026:
1. **Grammar Stack Crash** — Query expansion can fail with "empty grammar stack" error
2. **Metal GPU Assertion** — SIGABRT on process exit during Metal cleanup
3. **Reranking Crash** — GGML_ASSERT failure in Metal reranking

**Workaround:** Set `NODE_LLAMA_CPP_METAL=false` to force CPU mode if crashes occur. Performance hit but stable.

**Bootstrap should:** Try Metal first. If QMD indexing fails, retry with CPU-only flag and warn the user.

### QMD Global Install
npm global installs (`npm install -g`) can break QMD's bin wrapper due to symlink resolution.

**Workaround:** Install locally in the akos directory: `cd ~/akos && npm install @tobilu/qmd` and add `./node_modules/.bin` to PATH.

**Bootstrap should:** Try global first. If `qmd --version` fails, fall back to local install.

### Ollama on Intel Macs
CPU-only. 3-6 tokens/sec for 7B models. Functional for batch processing (morning briefing, signal scan), painful for interactive use.

**Bootstrap should:** Warn Intel Mac users that LLM inference will be slow. Suggest Satellite role if another machine has a GPU.

### Docker on Windows Home
WSL2 is required (no Hyper-V on Home edition). WSL2 needs Windows 10 22H2+ or Windows 11.

**Bootstrap should:** Check Windows edition. If Home, verify WSL2 is installed. If not, offer to install it.

### Older NVIDIA Drivers
Ollama needs driver 531+. Users with older drivers will get cryptic CUDA errors.

**Bootstrap should:** Check `nvidia-smi` output for driver version. If <531, print clear upgrade instructions before proceeding.

### ARM Windows (Snapdragon)
Experimental territory. Ollama has ARM Windows builds but they're not as tested. Docker Desktop works but with x86 emulation overhead.

**Bootstrap should:** Detect ARM architecture, warn that support is experimental, and proceed with reduced expectations.

---

## MODELS.JSON ADDITIONS NEEDED

The current models.json has 4 profiles. Based on this research, we need:

| New Profile | When | Models |
|------------|------|--------|
| `nvidia-4gb-legacy` | GTX 960, 1060 3GB, etc. with 4GB or less VRAM | general: qwen3:4b, code: none, embedding: QMD |
| `mac-intel-cpu` | Intel Macs (no Apple Silicon) | general: qwen3:4b (CPU), embedding: QMD. No LM Studio. |
| `satellite-search-only` | <16GB RAM, no GPU, or dedicated search node | No LLM models. QMD only. |

---

## BOOTSTRAP.SH PSEUDOCODE (FULL FLOW)

```
1. DETECT HARDWARE
   - OS type (macOS / Windows / Linux)
   - CPU (Intel x86, AMD x86, Apple Silicon ARM, Snapdragon ARM)
   - GPU (nvidia-smi, system_profiler SPDisplaysDataType, lspci)
   - RAM (total GB)
   - Disk space (free GB)

2. CHECK HARD FLOORS
   - RAM ≥ 8GB or EXIT
   - Disk ≥ 10GB free or EXIT
   - OS version meets minimum or EXIT (macOS 13.4+, Win 22H2+, Ubuntu 20.04+)

3. MAP TO HARDWARE PROFILE (from models.json)

4. RECOMMEND ROLE (Queen / Worker / Satellite)
   - User confirms or overrides

5. INSTALL DEPENDENCIES (idempotent — skip if already present)
   a. Node.js 22 (check: node --version)
   b. Python 3.10+ (check: python3 --version)
   c. Git (check: git --version)
   d. QMD (check: qmd --version)
      - Try global install first
      - If fails → install build tools → retry
      - If still fails → try local install
      - If Apple Silicon crashes → retry with METAL=false
   e. Ollama (check: ollama --version)
      - Skip if Satellite with no LLM role
   f. LM Studio (check: if Apple Silicon Mac → prompt to download)
      - Skip if not Apple Silicon
   g. Docker (check: docker --version)
      - Skip if Satellite
      - Windows: check WSL2 if Home edition

6. PULL MODELS (from models.json for this profile)
   - QMD models: auto-downloaded on first use (~2GB)
   - Ollama models: ollama pull {model} for profile
   - USB cache: if /Volumes/BORGCLAW/models/ exists, copy from there (offline install)

7. CONFIGURE NODE
   - Write config/nodes/{node-id}.yaml
   - Set hostname, capabilities, services
   - If Queen: start NATS server, QMD MCP, Queen API
   - If Worker: connect to Queen, start heartbeat

8. INDEX KNOWLEDGE BASE (QMD)
   - qmd collection add ~/akos/db/ak-os --name ak-os-core
   - qmd collection add ~/akos/db --name master-context
   - qmd collection add ~/akos/memory --name memory
   - Add context annotations

9. SET UP SCHEDULED TASKS
   - If Queen or Worker: install cron jobs from config/scheduled/
   - Verify cron or Task Scheduler works

10. HEALTH CHECK
    - QMD: qmd search "test query" → verify results
    - Ollama: ollama run {model} "hello" → verify response (skip if Satellite)
    - Docker: docker ps → verify containers (skip if Satellite)
    - Queen API: curl http://localhost:9090/api/health (if Queen)

11. PRINT SUMMARY
    - Role assigned
    - Services running
    - Models loaded
    - Dashboard URL (if Queen)
    - Any warnings or issues detected
```

---

*This spec covers every machine Alexander might plug the flash drive into — from a 2018 Intel MacBook to a fresh RTX 5090 tower. The bootstrap should be maximally permissive (try everything) and minimally surprising (clear messages about what works and what doesn't).*
