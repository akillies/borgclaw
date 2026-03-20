// ============================================================
// Setup Wizard — Hardware detection + guided configuration
// ============================================================
// Runs on the server side. The /setup HTML page calls these
// endpoints to walk the user through assimilation.
// ============================================================

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import * as activity from './activity.js';

let setupComplete = false;
let setupState = { step: 0, hardware: null, profile: null, role: null };

export function isSetupComplete() { return setupComplete; }
export function getSetupState() { return { ...setupState, complete: setupComplete }; }

export function markComplete() {
  setupComplete = true;
  setupState.step = 7;
  activity.log({ type: 'setup_complete', role: setupState.role, profile: setupState.profile });
}

// Detect hardware on this machine
export function detectHardware() {
  const hw = {
    os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    arch: process.arch,
    cpu: 'unknown',
    ram_gb: 0,
    gpu_type: 'none',
    gpu_vram_mb: 0,
    disk_free_gb: 0,
    node_version: process.version,
    python: null,
    git: null,
    ollama: null,
    docker: null,
    qmd: null,
  };

  try {
    if (hw.os === 'macos') {
      hw.cpu = execSync('sysctl -n machdep.cpu.brand_string 2>/dev/null', { encoding: 'utf-8' }).trim();
      hw.ram_gb = Math.round(parseInt(execSync('sysctl -n hw.memsize', { encoding: 'utf-8' }).trim()) / 1073741824);
      if (hw.cpu.includes('Apple')) {
        hw.gpu_type = 'apple-silicon';
      }
      try {
        hw.disk_free_gb = parseInt(execSync("df -g $HOME | awk 'NR==2 {print $4}'", { encoding: 'utf-8' }).trim());
      } catch {}
    } else if (hw.os === 'linux') {
      try {
        hw.cpu = execSync("grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2", { encoding: 'utf-8' }).trim();
      } catch {}
      try {
        hw.ram_gb = Math.round(parseInt(execSync("awk '/MemTotal/ {print $2}' /proc/meminfo", { encoding: 'utf-8' }).trim()) / 1048576);
      } catch {}
      // NVIDIA detection
      try {
        const vram = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf-8' }).trim();
        if (vram) { hw.gpu_type = 'nvidia'; hw.gpu_vram_mb = parseInt(vram); }
      } catch {}
      // AMD detection
      if (hw.gpu_type === 'none') {
        try {
          const lspci = execSync('lspci 2>/dev/null', { encoding: 'utf-8' });
          if (/amd.*radeon|amd.*rx/i.test(lspci)) hw.gpu_type = 'amd';
        } catch {}
      }
    }

    // Check tools
    const check = (cmd, flag = '--version') => {
      try { return execSync(`${cmd} ${flag} 2>&1`, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0]; }
      catch { return null; }
    };
    hw.python = check('python3');
    hw.git = check('git');
    hw.ollama = check('ollama');
    hw.docker = check('docker');
    hw.qmd = check('qmd');
  } catch (err) {
    hw._error = err.message;
  }

  setupState.hardware = hw;
  setupState.step = Math.max(setupState.step, 1);
  return hw;
}

// Map hardware to profile
export function mapProfile(hw) {
  let profile = 'cpu-only-8gb';

  if (hw.gpu_type === 'apple-silicon') {
    if (hw.ram_gb >= 24) profile = 'mac-apple-silicon-24gb';
    else if (hw.ram_gb >= 16) profile = 'mac-apple-silicon-16gb';
    else profile = 'mac-apple-silicon-8gb';
  } else if (hw.gpu_type === 'nvidia') {
    if (hw.gpu_vram_mb >= 8192) profile = 'nvidia-8gb-32gb-ram';
    else if (hw.gpu_vram_mb >= 4096) profile = 'nvidia-4gb-legacy';
    else profile = hw.ram_gb >= 16 ? 'cpu-only-16gb' : 'cpu-only-8gb';
  } else if (hw.gpu_type === 'amd') {
    profile = hw.ram_gb >= 16 ? 'amd-rocm' : 'cpu-only-8gb';
  } else if (hw.os === 'macos' && hw.gpu_type === 'none') {
    profile = 'mac-intel';
  } else {
    if (hw.ram_gb >= 16) profile = 'cpu-only-16gb';
    else if (hw.ram_gb >= 8) profile = 'cpu-only-8gb';
    else profile = 'satellite-search-only';
  }

  setupState.profile = profile;
  setupState.step = Math.max(setupState.step, 3);
  return { profile, hw };
}

// Recommend role based on profile
export function recommendRole(profile) {
  const roleMap = {
    'mac-apple-silicon-24gb': 'queen',
    'mac-apple-silicon-16gb': 'worker',
    'mac-apple-silicon-8gb': 'satellite',
    'nvidia-8gb-32gb-ram': 'worker',
    'nvidia-4gb-legacy': 'worker',
    'amd-rocm': 'worker',
    'mac-intel': 'satellite',
    'cpu-only-16gb': 'worker',
    'cpu-only-8gb': 'satellite',
    'satellite-search-only': 'satellite',
  };
  return roleMap[profile] || 'satellite';
}

// Get models for a profile from models.json
export async function getModelsForProfile(configDir, profile) {
  try {
    const raw = await fs.readFile(path.join(configDir, 'models.json'), 'utf-8');
    const models = JSON.parse(raw);
    const profileConfig = models.profiles?.[profile];
    if (!profileConfig) return { profile, models: [], error: `Profile '${profile}' not found in models.json` };

    const modelList = Object.entries(profileConfig.models || {}).map(([role, m]) => ({
      role,
      name: m.name,
      params: m.params,
      vram_gb: m.vram_gb,
      use_for: m.use_for,
    }));

    return { profile, models: modelList, runtime: profileConfig.runtime };
  } catch (err) {
    return { profile, models: [], error: err.message };
  }
}

// Configure node — write node YAML
export async function configureNode(configDir, nodeId, role, profile, hw) {
  const nodesDir = path.join(configDir, 'nodes');
  await fs.mkdir(nodesDir, { recursive: true });

  const capabilities = [];
  if (role === 'queen') capabilities.push('queen_api', 'scheduled_tasks', 'mcp_host');
  if (hw.gpu_type === 'apple-silicon') capabilities.push('mlx_inference');
  if (hw.gpu_type === 'nvidia') capabilities.push('cuda_inference');
  if (hw.gpu_type === 'amd') capabilities.push('rocm_inference');
  if (hw.qmd) capabilities.push('qmd_search');
  if (hw.docker) capabilities.push('docker_host');

  const config = {
    node_id: nodeId,
    role,
    profile,
    hardware: { cpu: hw.cpu, ram_gb: hw.ram_gb, gpu: hw.gpu_type, os: `${hw.os} ${hw.arch}` },
    capabilities,
    heartbeat: { interval_seconds: 30 },
  };

  const configPath = path.join(nodesDir, `${nodeId}.yaml`);
  const yaml = Object.entries(config).map(([k, v]) =>
    typeof v === 'object' ? `${k}:\n${Object.entries(v).map(([k2, v2]) => `  ${k2}: ${JSON.stringify(v2)}`).join('\n')}` : `${k}: ${JSON.stringify(v)}`
  ).join('\n');

  await fs.writeFile(configPath, `# Node Configuration — Auto-generated by setup wizard\n# Generated: ${new Date().toISOString()}\n\n${yaml}\n`);

  setupState.role = role;
  setupState.step = Math.max(setupState.step, 6);

  activity.log({ type: 'node_configured', node_id: nodeId, role, profile });

  return { config, path: configPath };
}
