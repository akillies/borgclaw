// ============================================================
// BorgClaw Queen Service
// ============================================================
// HTTP server running on the Queen node (Mac Mini M4 Pro).
// Responsibilities:
//   1. Node registry — workers register, heartbeat, report status
//   2. Health dashboard — quick view of cluster state
//   3. Config API — serve models.json, registry.yaml, etc.
//   4. Routing hints — tell workers which models to load (Phase 2)
//
// MODULARITY: This is a minimal coordinator. It does NOT run
// agents or workflows. It just knows which nodes are alive
// and serves config. Agents run on Cowork / Claude Code.
// ============================================================

import express from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PORT = parseInt(process.env.QUEEN_PORT || '9090', 10);
const AKOS_DIR = process.env.AKOS_DIR || path.join(process.env.HOME || '', 'akos');
const CONFIG_DIR = path.join(AKOS_DIR, 'db/ak-os/projects/borgclaw/config');
const HEARTBEAT_TIMEOUT_MS = 150_000; // 2.5 minutes (5 missed × 30s)

// --- State ---
const nodes = new Map(); // node_id -> { config, lastHeartbeat, status, metrics }
const startedAt = new Date();

const app = express();
app.use(express.json());

// ============================================================
// ROUTES: Health & Dashboard
// ============================================================

// Root — quick health check
app.get('/', (_req, res) => {
  res.json({
    service: 'borgclaw-queen',
    version: '0.1.0',
    uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    nodes_registered: nodes.size,
    nodes_online: [...nodes.values()].filter(n => n.status === 'online').length,
    timestamp: new Date().toISOString(),
  });
});

// Dashboard — HTML status page
app.get('/dashboard', async (_req, res) => {
  const nodeList = [...nodes.values()].map(n => ({
    ...n,
    age: timeSince(n.lastHeartbeat),
  }));

  // Load models.json for reference
  let models = {};
  try {
    const raw = await fs.readFile(path.join(CONFIG_DIR, 'models.json'), 'utf-8');
    models = JSON.parse(raw);
  } catch { /* ignore */ }

  res.send(renderDashboard(nodeList, models));
});

// JSON dashboard data (for programmatic access)
app.get('/api/status', (_req, res) => {
  const nodeList = [...nodes.entries()].map(([id, n]) => ({
    node_id: id,
    role: n.config?.role || 'unknown',
    profile: n.config?.profile || 'unknown',
    status: n.status,
    last_heartbeat: n.lastHeartbeat?.toISOString(),
    seconds_since_heartbeat: n.lastHeartbeat
      ? Math.floor((Date.now() - n.lastHeartbeat.getTime()) / 1000)
      : null,
    capabilities: n.config?.capabilities || [],
    metrics: n.metrics || {},
  }));

  res.json({
    queen: {
      uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      started_at: startedAt.toISOString(),
    },
    nodes: nodeList,
  });
});

// ============================================================
// ROUTES: Node Registry
// ============================================================

// Register a node (called once during bootstrap)
app.post('/api/nodes/register', (req, res) => {
  const { node_id, config } = req.body;

  if (!node_id) {
    return res.status(400).json({ error: 'node_id is required' });
  }

  nodes.set(node_id, {
    config: config || {},
    lastHeartbeat: new Date(),
    status: 'online',
    registeredAt: new Date(),
    metrics: {},
  });

  console.log(`[QUEEN] Node registered: ${node_id} (${config?.role || 'unknown'})`);
  res.json({ ok: true, message: `Node ${node_id} registered.` });
});

// Heartbeat — workers call this every 30 seconds
app.post('/api/nodes/:nodeId/heartbeat', (req, res) => {
  const { nodeId } = req.params;
  const node = nodes.get(nodeId);

  if (!node) {
    // Auto-register on first heartbeat
    nodes.set(nodeId, {
      config: req.body.config || {},
      lastHeartbeat: new Date(),
      status: 'online',
      registeredAt: new Date(),
      metrics: req.body.metrics || {},
    });
    console.log(`[QUEEN] Node auto-registered via heartbeat: ${nodeId}`);
    return res.json({ ok: true, registered: true });
  }

  node.lastHeartbeat = new Date();
  node.status = 'online';
  if (req.body.metrics) node.metrics = req.body.metrics;

  res.json({ ok: true });
});

// Get a specific node's status
app.get('/api/nodes/:nodeId', (req, res) => {
  const { nodeId } = req.params;
  const node = nodes.get(nodeId);

  if (!node) {
    return res.status(404).json({ error: `Node ${nodeId} not found` });
  }

  res.json({
    node_id: nodeId,
    ...node,
    seconds_since_heartbeat: node.lastHeartbeat
      ? Math.floor((Date.now() - node.lastHeartbeat.getTime()) / 1000)
      : null,
  });
});

// List all nodes
app.get('/api/nodes', (_req, res) => {
  const list = [...nodes.entries()].map(([id, n]) => ({
    node_id: id,
    role: n.config?.role || 'unknown',
    status: n.status,
    last_heartbeat: n.lastHeartbeat?.toISOString(),
  }));
  res.json(list);
});

// Remove a node
app.delete('/api/nodes/:nodeId', (req, res) => {
  const { nodeId } = req.params;
  if (nodes.delete(nodeId)) {
    console.log(`[QUEEN] Node removed: ${nodeId}`);
    res.json({ ok: true, message: `Node ${nodeId} removed.` });
  } else {
    res.status(404).json({ error: `Node ${nodeId} not found` });
  }
});

// ============================================================
// ROUTES: Config API
// ============================================================

// Serve models.json
app.get('/api/config/models', async (_req, res) => {
  try {
    const raw = await fs.readFile(path.join(CONFIG_DIR, 'models.json'), 'utf-8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read models.json', detail: err.message });
  }
});

// Serve MCP registry
app.get('/api/config/registry', async (_req, res) => {
  try {
    const raw = await fs.readFile(path.join(CONFIG_DIR, 'mcps/registry.yaml'), 'utf-8');
    res.json(yaml.load(raw));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read registry.yaml', detail: err.message });
  }
});

// Get profile recommendation for hardware specs
app.post('/api/config/recommend-profile', (req, res) => {
  const { gpu_type, gpu_vram_mb, ram_gb, os } = req.body;

  let profile = 'cpu-only-16gb';

  if (gpu_type === 'apple-silicon') {
    if (ram_gb >= 24) profile = 'mac-apple-silicon-24gb';
    else if (ram_gb >= 16) profile = 'mac-apple-silicon-16gb';
    else profile = 'mac-apple-silicon-8gb';
  } else if (gpu_type === 'nvidia') {
    if (gpu_vram_mb >= 8192) profile = 'nvidia-8gb-32gb-ram';
    else if (gpu_vram_mb >= 4096) profile = 'nvidia-4gb-legacy';
    else profile = ram_gb >= 16 ? 'cpu-only-16gb' : 'cpu-only-8gb';
  } else if (os === 'macos' && gpu_type === 'none') {
    profile = 'mac-intel';
  } else {
    profile = ram_gb >= 16 ? 'cpu-only-16gb' : ram_gb >= 8 ? 'cpu-only-8gb' : 'satellite-search-only';
  }

  res.json({ profile, ram_gb, gpu_type, gpu_vram_mb });
});

// ============================================================
// ROUTES: Capability Lookup (agents query this)
// ============================================================

// Look up which tool currently provides a capability
app.get('/api/capabilities/:capability', async (req, res) => {
  try {
    const raw = await fs.readFile(path.join(CONFIG_DIR, 'mcps/registry.yaml'), 'utf-8');
    const registry = yaml.load(raw);
    const cap = req.params.capability;

    // Check capability index
    const toolId = registry.capability_index?.[cap];
    if (!toolId) {
      return res.json({ capability: cap, status: 'not_available', tool: null });
    }

    // Find the tool details
    const tool = [...(registry.connected || []), ...(registry.pending || [])]
      .find(t => t.id === toolId);

    res.json({
      capability: cap,
      status: tool?.status || 'unknown',
      tool_id: toolId,
      tool_name: tool?.tool || 'unknown',
      node: tool?.node || 'unknown',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to look up capability', detail: err.message });
  }
});

// ============================================================
// Background: Heartbeat Checker
// ============================================================

setInterval(() => {
  const now = Date.now();
  for (const [id, node] of nodes) {
    if (node.lastHeartbeat && (now - node.lastHeartbeat.getTime()) > HEARTBEAT_TIMEOUT_MS) {
      if (node.status !== 'offline') {
        node.status = 'offline';
        console.log(`[QUEEN] Node ${id} marked OFFLINE (no heartbeat for ${Math.floor((now - node.lastHeartbeat.getTime()) / 1000)}s)`);
      }
    }
  }
}, 30_000);

// ============================================================
// Dashboard HTML Renderer
// ============================================================

function timeSince(date) {
  if (!date) return 'never';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function renderDashboard(nodeList, models) {
  const nodeRows = nodeList.map(n => {
    const statusColor = n.status === 'online' ? '#22c55e' : n.status === 'offline' ? '#ef4444' : '#eab308';
    const statusDot = `<span style="color:${statusColor}">●</span>`;
    return `<tr>
      <td>${statusDot} ${n.config?.node_id || 'unknown'}</td>
      <td>${n.config?.role || '—'}</td>
      <td>${n.config?.profile || '—'}</td>
      <td>${n.status}</td>
      <td>${n.age}</td>
      <td>${(n.config?.capabilities || []).join(', ')}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <title>BorgClaw Queen Dashboard</title>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="30" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }
    h1 { color: #00ff88; margin-bottom: 0.5rem; }
    .subtitle { color: #666; margin-bottom: 2rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th { text-align: left; padding: 0.75rem; background: #1a1a1a; color: #00ff88; border-bottom: 2px solid #333; }
    td { padding: 0.75rem; border-bottom: 1px solid #222; }
    tr:hover td { background: #1a1a2a; }
    .stats { display: flex; gap: 2rem; margin-bottom: 2rem; }
    .stat { background: #1a1a1a; padding: 1rem 1.5rem; border-radius: 8px; border: 1px solid #333; }
    .stat-value { font-size: 2rem; font-weight: bold; color: #00ff88; }
    .stat-label { color: #888; font-size: 0.85rem; }
    .footer { margin-top: 2rem; color: #444; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>BorgClaw Queen</h1>
  <p class="subtitle">Node Registry & Health Dashboard (auto-refreshes every 30s)</p>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${nodeList.length}</div>
      <div class="stat-label">Registered Nodes</div>
    </div>
    <div class="stat">
      <div class="stat-value">${nodeList.filter(n => n.status === 'online').length}</div>
      <div class="stat-label">Online</div>
    </div>
    <div class="stat">
      <div class="stat-value">${nodeList.filter(n => n.status === 'offline').length}</div>
      <div class="stat-label">Offline</div>
    </div>
    <div class="stat">
      <div class="stat-value">${Object.keys(models.profiles || {}).length}</div>
      <div class="stat-label">Hardware Profiles</div>
    </div>
  </div>

  <h2 style="color: #00ff88; margin-bottom: 0.5rem;">Nodes</h2>
  <table>
    <thead>
      <tr><th>Node</th><th>Role</th><th>Profile</th><th>Status</th><th>Last Heartbeat</th><th>Capabilities</th></tr>
    </thead>
    <tbody>
      ${nodeRows || '<tr><td colspan="6" style="color:#666">No nodes registered yet. Run bootstrap.sh on a machine to register it.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <p>Queen uptime: ${Math.floor((Date.now() - startedAt.getTime()) / 1000)}s | Profiles loaded: ${Object.keys(models.profiles || {}).length} | Page auto-refreshes every 30 seconds.</p>
    <p>API: <a href="/api/status" style="color:#00ff88">/api/status</a> | <a href="/api/nodes" style="color:#00ff88">/api/nodes</a> | <a href="/api/config/models" style="color:#00ff88">/api/config/models</a> | <a href="/api/config/registry" style="color:#00ff88">/api/config/registry</a></p>
  </div>
</body>
</html>`;
}

// ============================================================
// Start
// ============================================================

// Auto-register queen itself
nodes.set('queen', {
  config: {
    node_id: 'queen',
    role: 'queen',
    profile: 'mac-apple-silicon-24gb',
    capabilities: ['mlx_inference', 'qmd_search', 'mcp_host', 'nats_server', 'queen_api', 'scheduled_tasks'],
  },
  lastHeartbeat: new Date(),
  status: 'online',
  registeredAt: new Date(),
  metrics: {},
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[QUEEN] BorgClaw Queen listening on http://0.0.0.0:${PORT}`);
  console.log(`[QUEEN] Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`[QUEEN] API:       http://localhost:${PORT}/api/status`);
});
