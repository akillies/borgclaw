// ============================================================
// Deep Health Check — Probe every service in the hive
// ============================================================
// Doesn't just check if Queen is alive (that's the / endpoint).
// Probes Ollama, NATS, LiteLLM, ntfy, QMD — whatever's in the
// stack. Returns structured status for dashboard rendering.
// ============================================================

import { execSync } from 'child_process';

// Probe a URL with timeout
async function probe(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { status: 'online', code: res.status };
  } catch (err) {
    clearTimeout(timer);
    return { status: 'offline', error: err.code || err.message };
  }
}

// Check if a command exists and capture version
function checkCommand(cmd, versionFlag = '--version') {
  try {
    const out = execSync(`${cmd} ${versionFlag} 2>&1`, { timeout: 5000, encoding: 'utf-8' });
    return { installed: true, version: out.trim().split('\n')[0] };
  } catch {
    return { installed: false };
  }
}

export async function deepHealthCheck(nodes, startedAt) {
  const results = {
    timestamp: new Date().toISOString(),
    queen: {
      status: 'online',
      uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    },
    nodes: {
      total: nodes.size,
      online: [...nodes.values()].filter(n => n.status === 'online').length,
      offline: [...nodes.values()].filter(n => n.status === 'offline').length,
    },
  };

  // Probe services in parallel
  const [ollama, nats, litellm, ntfy] = await Promise.all([
    probe('http://localhost:11434/'),          // Ollama
    probe('http://localhost:8222/healthz'),     // NATS monitoring
    probe('http://localhost:4000/health'),      // LiteLLM
    probe('http://localhost:2586/v1/health'),   // ntfy
  ]);

  results.ollama = ollama;
  if (ollama.status === 'online') {
    // Get loaded models
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      const data = await res.json();
      results.ollama.models = (data.models || []).map(m => m.name);
    } catch { results.ollama.models = []; }
  }

  results.nats = nats;
  results.litellm = litellm;
  results.ntfy = ntfy;

  // Check CLI tools
  results.qmd = checkCommand('qmd');
  results.docker = checkCommand('docker');
  results.git = checkCommand('git');

  // Overall status
  const critical = [results.queen.status];
  const optional = [ollama.status, nats.status, litellm.status, ntfy.status];
  const criticalOk = critical.every(s => s === 'online');
  const optionalOnline = optional.filter(s => s === 'online').length;

  results.overall = criticalOk
    ? optionalOnline >= 2 ? 'healthy' : 'degraded'
    : 'critical';

  return results;
}
