# ============================================================
# BorgClaw Bootstrap — The Assimilator (Windows PowerShell)
# ============================================================
# Detects hardware, installs dependencies, configures node,
# pulls models, indexes QMD, and gets this machine running.
#
# Usage: powershell -ExecutionPolicy Bypass -File bootstrap.ps1
#   or:  .\bootstrap.ps1 [-Role queen|worker|satellite] [-QueenIP 192.168.1.100]
#
# Spec: BOOTSTRAP-COMPATIBILITY.md
# ============================================================

param(
    [ValidateSet("queen", "worker", "satellite")]
    [string]$Role = "",
    [string]$QueenIP = ""
)

$ErrorActionPreference = "Continue"

# --- Config ---
$BORGCLAW_HOME = if ($env:BORGCLAW_HOME) { $env:BORGCLAW_HOME } else { "$env:USERPROFILE\borgclaw" }
$KNOWLEDGE_BASE_PATH = if ($env:KNOWLEDGE_BASE_PATH) { $env:KNOWLEDGE_BASE_PATH } else { "$BORGCLAW_HOME\knowledge" }
$MIN_RAM_GB = 8
$MIN_DISK_GB = 10
$MIN_NODE_MAJOR = 22
$QMD_PACKAGE = "@tobilu/qmd"

# --- State ---
$Script:Profile = ""
$Script:GpuType = "none"
$Script:GpuVramMB = 0
$Script:RamGB = 0
$Script:Warnings = @()
$Script:Errors = @()

# ============================================================
# Helpers
# ============================================================
function Log($msg) { Write-Host "[BORGCLAW] $msg" -ForegroundColor Blue }
function Ok($msg)  { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow; $Script:Warnings += $msg }
function Err($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; $Script:Errors += $msg }
function Fail($msg) { Write-Host "[FATAL] $msg" -ForegroundColor Red; exit 1 }

function Test-Command($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }

# ============================================================
# STEP 1: Detect Hardware
# ============================================================
function Detect-Hardware {
    Log "Step 1/11: Detecting hardware..."

    # RAM
    $cs = Get-CimInstance Win32_ComputerSystem
    $Script:RamGB = [math]::Round($cs.TotalPhysicalMemory / 1GB)
    Ok "RAM: $($Script:RamGB)GB"

    # GPU
    $gpus = Get-CimInstance Win32_VideoController
    $nvidia = $gpus | Where-Object { $_.Name -match "NVIDIA" }

    if ($nvidia) {
        $Script:GpuType = "nvidia"
        # Get VRAM from nvidia-smi (more accurate than WMI)
        if (Test-Command "nvidia-smi") {
            $vram = nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1
            if ($vram) { $Script:GpuVramMB = [int]$vram.Trim() }

            $driver = nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null | Select-Object -First 1
            Ok "NVIDIA GPU: $($nvidia.Name) | $($Script:GpuVramMB)MB VRAM | Driver $driver"

            $driverMajor = [int]($driver.Split('.')[0])
            if ($driverMajor -lt 531) {
                Warn "NVIDIA driver $driver is old. Ollama needs 531+. Please update: https://www.nvidia.com/download/"
            }
        } else {
            # Fallback to WMI (less accurate for VRAM)
            $Script:GpuVramMB = [math]::Round($nvidia.AdapterRAM / 1MB)
            Ok "NVIDIA GPU: $($nvidia.Name) | ~$($Script:GpuVramMB)MB VRAM (nvidia-smi not found)"
            Warn "Install NVIDIA drivers with nvidia-smi for accurate VRAM detection."
        }
    }
    elseif ($gpus | Where-Object { $_.Name -match "AMD|Radeon" }) {
        $Script:GpuType = "amd"
        $amd = $gpus | Where-Object { $_.Name -match "AMD|Radeon" } | Select-Object -First 1
        Ok "AMD GPU: $($amd.Name)"
        Warn "AMD GPU: ROCm support is experimental. CPU fallback recommended."
    }
    else {
        $Script:GpuType = "none"
        Ok "No dedicated GPU. CPU-only mode."
    }

    # Architecture
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq "ARM64") {
        Warn "ARM Windows (Snapdragon) detected. Support is experimental."
    }
}

# ============================================================
# STEP 2: Check Hard Floors
# ============================================================
function Check-Floors {
    Log "Step 2/11: Checking minimum requirements..."

    # RAM
    if ($Script:RamGB -lt $MIN_RAM_GB) {
        Fail "$($Script:RamGB)GB RAM detected. Minimum ${MIN_RAM_GB}GB required."
    }
    elseif ($Script:RamGB -lt 16) {
        Warn "$($Script:RamGB)GB RAM. Only small models (3-4B) recommended."
    }

    # Windows version
    $build = [System.Environment]::OSVersion.Version.Build
    if ($build -lt 19044) {
        Fail "Windows build $build is too old. Need 19044+ (Windows 10 22H2). Please update Windows."
    }
    Ok "Windows build: $build"

    # Disk
    $drive = (Get-PSDrive -Name ($BORGCLAW_HOME.Substring(0,1)))
    $freeGB = [math]::Round($drive.Free / 1GB)
    if ($freeGB -lt $MIN_DISK_GB) {
        Fail "${freeGB}GB disk free. Minimum ${MIN_DISK_GB}GB required."
    }
    Ok "Disk: ${freeGB}GB free"
}

# ============================================================
# STEP 3: Map Hardware Profile
# ============================================================
function Map-Profile {
    Log "Step 3/11: Mapping hardware profile..."

    if ($Script:GpuType -eq "nvidia") {
        if ($Script:GpuVramMB -ge 8192) {
            $Script:Profile = "nvidia-8gb-32gb-ram"
        }
        elseif ($Script:GpuVramMB -ge 4096) {
            $Script:Profile = "nvidia-4gb-legacy"
        }
        else {
            $Script:Profile = "cpu-only-$($Script:RamGB)gb"
        }
    }
    else {
        if ($Script:RamGB -ge 16) {
            $Script:Profile = "cpu-only-16gb"
        }
        elseif ($Script:RamGB -ge 8) {
            $Script:Profile = "cpu-only-8gb"
        }
        else {
            $Script:Profile = "satellite-search-only"
        }
    }

    Ok "Profile: $($Script:Profile)"
}

# ============================================================
# STEP 4: Recommend Role
# ============================================================
function Recommend-Role {
    Log "Step 4/11: Recommending node role..."

    if ($Role) {
        Ok "Role override: $Role (user-specified)"
        return
    }

    switch ($Script:Profile) {
        "nvidia-8gb-32gb-ram" {
            $Script:Role = "worker"
            Ok "Recommended: WORKER — CUDA acceleration, 8GB+ VRAM"
        }
        { $_ -in "nvidia-4gb-legacy", "cpu-only-16gb" } {
            $Script:Role = "worker"
            Ok "Recommended: WORKER — capable but limited"
        }
        default {
            $Script:Role = "satellite"
            Ok "Recommended: SATELLITE — search node, limited LLM inference"
        }
    }

    if (-not $Role) { $Role = $Script:Role }

    Write-Host ""
    Write-Host "  Role: $($Role.ToUpper())" -ForegroundColor Cyan
    Write-Host "  Profile: $($Script:Profile)" -ForegroundColor Cyan
    Write-Host ""
    $confirm = Read-Host "  Accept this role? [Y/n]"
    if ($confirm -eq "n") {
        Fail "Aborted. Re-run with -Role <queen|worker|satellite>"
    }
}

# ============================================================
# STEP 5: Install Dependencies
# ============================================================
function Install-Deps {
    Log "Step 5/11: Installing dependencies..."

    # --- winget check ---
    if (-not (Test-Command "winget")) {
        Warn "winget not found. Please install App Installer from Microsoft Store."
        Warn "Falling back to manual install prompts."
    }

    # --- Node.js ---
    if (Test-Command "node") {
        $nodeVer = (node -v).TrimStart('v')
        $nodeMajor = [int]($nodeVer.Split('.')[0])
        if ($nodeMajor -lt $MIN_NODE_MAJOR) {
            Warn "Node.js $nodeVer found but need $MIN_NODE_MAJOR+. Installing..."
            Install-Node
        }
        else { Ok "Node.js $nodeVer" }
    }
    else { Install-Node }

    # --- Python ---
    if (Test-Command "python") {
        $pyVer = (python --version 2>&1).Split(' ')[1]
        Ok "Python $pyVer"
    }
    elseif (Test-Command "python3") {
        $pyVer = (python3 --version 2>&1).Split(' ')[1]
        Ok "Python $pyVer"
    }
    else {
        Log "Installing Python 3.12..."
        if (Test-Command "winget") {
            winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
        }
        else {
            Warn "Please install Python 3.12+ from https://python.org"
        }
    }

    # --- Git ---
    if (Test-Command "git") {
        Ok "Git $(git --version)"
    }
    else {
        Log "Installing Git..."
        if (Test-Command "winget") {
            winget install Git.Git --accept-package-agreements --accept-source-agreements
        }
        else {
            Warn "Please install Git from https://git-scm.com"
        }
    }
}

function Install-Node {
    if (Test-Command "winget") {
        Log "Installing Node.js 22 via winget..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        Ok "Node.js installed (restart terminal if 'node' not found)"
    }
    else {
        Warn "Please install Node.js 22+ from https://nodejs.org"
    }
}

# ============================================================
# STEP 6: Install Ollama
# ============================================================
function Install-Ollama {
    Log "Step 6/11: Setting up Ollama..."

    if (Test-Command "ollama") {
        Ok "Ollama already installed"
        return
    }

    if (Test-Command "winget") {
        winget install Ollama.Ollama --accept-package-agreements --accept-source-agreements
        Ok "Ollama installed (restart terminal to use)"
    }
    else {
        Warn "Please install Ollama from https://ollama.com/download/windows"
    }
}

# ============================================================
# STEP 7: Install QMD
# ============================================================
function Install-QMD {
    Log "Step 7/11: Installing QMD..."

    if (Test-Command "qmd") {
        Ok "QMD already installed"
        return
    }

    if (-not (Test-Command "npm")) {
        Err "npm not found. Install Node.js first, then re-run."
        return
    }

    Log "Attempting global install..."
    npm install -g $QMD_PACKAGE 2>$null

    if (Test-Command "qmd") {
        Ok "QMD installed globally"
    }
    else {
        Warn "Global install failed. Installing locally..."
        New-Item -ItemType Directory -Force -Path $BORGCLAW_HOME | Out-Null
        Push-Location $BORGCLAW_HOME
        npm install $QMD_PACKAGE
        Pop-Location

        $binPath = "$BORGCLAW_HOME\node_modules\.bin"
        if ($env:PATH -notmatch [regex]::Escape($binPath)) {
            $env:PATH = "$binPath;$env:PATH"
            [Environment]::SetEnvironmentVariable("PATH", "$binPath;$([Environment]::GetEnvironmentVariable('PATH', 'User'))", "User")
        }

        if (Test-Command "qmd") {
            Ok "QMD installed locally at $BORGCLAW_HOME"
        }
        else {
            Err "QMD installation failed. You may need Visual Studio Build Tools + CMake."
            Err "Install from: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
        }
    }
}

# ============================================================
# STEP 8: Pull Models
# ============================================================
function Pull-Models {
    Log "Step 8/11: Pulling models for profile: $($Script:Profile)..."

    if (-not (Test-Command "ollama")) {
        Warn "Ollama not found. Skipping model pulls. Install Ollama first."
        return
    }

    switch ($Script:Profile) {
        "nvidia-8gb-32gb-ram" {
            Pull-OllamaModel "qwen3:8b" "general"
            Pull-OllamaModel "qwen3:14b" "reasoning"
            Pull-OllamaModel "qwen2.5-coder:7b" "code"
        }
        "nvidia-4gb-legacy" {
            Pull-OllamaModel "qwen3:4b" "general"
        }
        "cpu-only-16gb" {
            Pull-OllamaModel "qwen3:4b" "general"
        }
        "cpu-only-8gb" {
            Pull-OllamaModel "qwen3:1.7b" "general"
        }
        "satellite-search-only" {
            Log "Satellite role: skipping LLM model pulls"
        }
        default {
            Pull-OllamaModel "qwen3:4b" "general (fallback)"
        }
    }

    Ok "Model pulls complete"
}

function Pull-OllamaModel($model, $purpose) {
    Log "  Pulling $model ($purpose)..."
    ollama pull $model
    if ($LASTEXITCODE -eq 0) { Ok "  $model ready" }
    else { Err "  Failed to pull $model. Retry: ollama pull $model" }
}

# ============================================================
# STEP 9: Configure Node
# ============================================================
function Configure-Node {
    Log "Step 9/11: Configuring node..."

    $configDir = "$BORGCLAW_HOME\config\nodes"
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    $hostIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch "Loopback" } | Select-Object -First 1).IPAddress
    if (-not $hostIP) { $hostIP = "127.0.0.1" }

    $nodeId = $env:COMPUTERNAME.ToLower()
    $configFile = "$configDir\$nodeId.yaml"

    $queenLine = if ($Role -ne "queen") { "queen_address: $($QueenIP):9090`nqueen_ip: $QueenIP" } else { "" }

    $yaml = @"
# Node Configuration — Auto-generated by bootstrap.ps1
# Generated: $(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

node_id: $nodeId
role: $Role
hostname: $hostIP
$queenLine
display_name: "$env:COMPUTERNAME ($($Script:Profile))"

hardware:
  cpu: "$((Get-CimInstance Win32_Processor).Name)"
  ram_gb: $($Script:RamGB)
  gpu: "$Script:GpuType $($Script:GpuVramMB)MB"
  os: "Windows $([System.Environment]::OSVersion.Version)"

profile: $($Script:Profile)
"@

    Set-Content -Path $configFile -Value $yaml
    Ok "Node config written: $configFile"
}

# ============================================================
# STEP 10: Index QMD
# ============================================================
function Index-QMD {
    Log "Step 10/11: Indexing QMD collections..."

    if (-not (Test-Command "qmd")) {
        Warn "QMD not found. Skipping indexing."
        return
    }

    if (-not (Test-Path $KNOWLEDGE_BASE_PATH)) {
        Warn "No knowledge base directory at $KNOWLEDGE_BASE_PATH. Skipping QMD indexing."
        Warn "Set KNOWLEDGE_BASE_PATH env var to your knowledge base path, then run: qmd index"
        Warn "Example: `$env:KNOWLEDGE_BASE_PATH = 'C:\path\to\your\knowledge'; .\bootstrap.ps1"
        return
    }

    Log "  Indexing knowledge base..."
    qmd index $KNOWLEDGE_BASE_PATH --name knowledge-base 2>$null
    if ($LASTEXITCODE -eq 0) { Ok "  knowledge-base indexed" } else { Warn "  knowledge-base indexing failed" }
}

# ============================================================
# STEP 11: Health Check & Summary
# ============================================================
function Show-Summary {
    Log "Step 11/11: Health check..."

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║           BorgClaw Bootstrap — Summary                     ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Node ID:     $($env:COMPUTERNAME.ToLower())" -ForegroundColor Blue
    Write-Host "  Role:        $($Role.ToUpper())" -ForegroundColor Blue
    Write-Host "  Profile:     $($Script:Profile)" -ForegroundColor Blue
    Write-Host "  RAM:         $($Script:RamGB)GB" -ForegroundColor Blue
    Write-Host "  GPU:         $($Script:GpuType)" -ForegroundColor Blue
    Write-Host ""

    Write-Host "  Components:" -ForegroundColor Blue
    if (Test-Command "node")    { Ok "Node.js $(node -v)" }    else { Err "Node.js NOT FOUND" }
    if (Test-Command "python")  { Ok "Python $(python --version 2>&1)" } else { Warn "Python NOT FOUND" }
    if (Test-Command "git")     { Ok "Git installed" }          else { Err "Git NOT FOUND" }
    if (Test-Command "ollama")  { Ok "Ollama installed" }       else { Warn "Ollama NOT FOUND" }
    if (Test-Command "qmd")     { Ok "QMD installed" }          else { Warn "QMD NOT FOUND" }
    if (Test-Command "docker")  { Ok "Docker installed" }       else { Warn "Docker NOT FOUND" }
    Write-Host ""

    if ($Script:Warnings.Count -gt 0) {
        Write-Host "  Warnings ($($Script:Warnings.Count)):" -ForegroundColor Yellow
        foreach ($w in $Script:Warnings) { Write-Host "    ⚠ $w" -ForegroundColor Yellow }
        Write-Host ""
    }

    if ($Script:Errors.Count -gt 0) {
        Write-Host "  Errors ($($Script:Errors.Count)):" -ForegroundColor Red
        foreach ($e in $Script:Errors) { Write-Host "    ✗ $e" -ForegroundColor Red }
        Write-Host ""
    }

    Write-Host "  Config: $BORGCLAW_HOME\config\nodes\$($env:COMPUTERNAME.ToLower()).yaml" -ForegroundColor Green
    Write-Host ""
    Write-Host "Bootstrap complete. Welcome to the Collective." -ForegroundColor Green
}

# ============================================================
# MAIN
# ============================================================
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║           BorgClaw Bootstrap — The Assimilator             ║" -ForegroundColor Cyan
Write-Host "║           Resistance is futile.                            ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Detect-Hardware       # Step 1
Check-Floors          # Step 2
Map-Profile           # Step 3
Recommend-Role        # Step 4
Install-Deps          # Step 5
Install-Ollama        # Step 6
Install-QMD           # Step 7
Pull-Models           # Step 8
Configure-Node        # Step 9
Index-QMD             # Step 10
Show-Summary          # Step 11
