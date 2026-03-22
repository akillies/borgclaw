// ============================================================
// BorgClaw Queen Service — v0.2.0
// ============================================================
// The Queen coordinates the hive. She doesn't think — she
// routes, monitors, enforces governance, and dispatches.
//
// Tiers:
//   T1: PicoClaw nodes (nerve endings — execute tasks)
//   T2: This service (coordinator — routes + governs)
//   T3: Personal AI OS (brain — decides what to do)
//
// Resistance is optional. Adaptation is inevitable.
// ============================================================

import express from 'express';
import os from 'os';
import fs from 'fs/promises';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { spawn } from 'child_process';
import crypto from 'crypto';

// --- Lib modules ---
import * as activity from './lib/activity.js';
import * as approvals from './lib/approvals.js';
import { deepHealthCheck } from './lib/health.js';
import * as setup from './lib/setup.js';
import { initNats, publish as natsPublish, close as natsClose } from './lib/nats.js';
import { executeWorkflow, resumeWorkflow } from './lib/workflow.js';
import { scanLeaderboard, checkOllamaLibrary } from './lib/leaderboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PORT = parseInt(process.env.QUEEN_PORT || '9090', 10);
const BORGCLAW_HOME = process.env.BORGCLAW_HOME || path.join(process.env.HOME || '', 'borgclaw');
const CONFIG_DIR = path.join(BORGCLAW_HOME, 'config');
const DATA_DIR = path.join(BORGCLAW_HOME, 'data');
const HEARTBEAT_TIMEOUT_MS = 150_000; // 2.5 min
const LITELLM_CONFIG = path.join(CONFIG_DIR, 'litellm.yaml');
const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

// --- Initialize modules ---
activity.initActivity(DATA_DIR);
approvals.initApprovals(DATA_DIR, { queenBaseUrl: `http://localhost:${PORT}` });

// --- NATS JetStream (optional enhancement — Queen works without it) ---
// initNats() is non-blocking. If NATS is not running, it logs a warning
// and all subsequent publish calls become silent no-ops.
initNats().then(() => {
  // Forward every activity event to NATS hive.activity subject.
  // The onEvent hook runs on every activity.log() call regardless of
  // whether that event also gets a targeted publish below.
  activity.onEvent((entry) => {
    natsPublish('hive.activity', {
      ...entry,
      _source: 'queen',
    });
  });

  // Forward approval lifecycle events to targeted subjects.
  // hive.approval.created   — new item in the queue
  // hive.approval.resolved  — approved or rejected
  approvals.onNotify((action, item) => {
    if (action === 'created') {
      natsPublish('hive.approval.created', {
        approval_id: item.id,
        summary: item.summary || item.type,
        source_agent: item.source_agent,
        source_workflow: item.source_workflow,
        ts: item.created_at,
      });
    } else if (action === 'approved' || action === 'rejected') {
      natsPublish('hive.approval.resolved', {
        approval_id: item.id,
        action,
        summary: item.summary || item.type,
        ts: new Date().toISOString(),
      });
    }
  });
}).catch(() => {
  // initNats resolves even on failure — this catch is a last-resort guard
});

// --- State ---
const nodes = new Map();
const startedAt = new Date();
const VERSION = '0.2.0';

// ============================================================
// LiteLLM Dynamic Routing — nodes auto-register as endpoints
// ============================================================
// When a Claw node reports its models via heartbeat, Queen
// rebuilds litellm.yaml with all known Ollama endpoints so
// LiteLLM load-balances across the entire hive automatically.
// ============================================================

let litellmSyncTimer = null;
const LITELLM_SYNC_DEBOUNCE_MS = 5000; // batch rapid heartbeats

function scheduleLitellmSync() {
  if (litellmSyncTimer) return; // already scheduled
  litellmSyncTimer = setTimeout(async () => {
    litellmSyncTimer = null;
    try { await syncLitellmConfig(); }
    catch (err) { console.warn(`[QUEEN] LiteLLM sync failed: ${err.message}`); }
  }, LITELLM_SYNC_DEBOUNCE_MS);
}

async function syncLitellmConfig() {
  // Read existing config to preserve cloud tiers + router settings
  let existing = {};
  try {
    const raw = readFileSync(LITELLM_CONFIG, 'utf-8');
    existing = yaml.load(raw) || {};
  } catch { /* fresh config */ }

  // Separate local (node-generated) from cloud (user-configured) entries
  const cloudModels = (existing.model_list || []).filter(m =>
    !m.litellm_params?.model?.startsWith('ollama/') ||
    m._managed_by === 'user'
  );

  // Build local model entries from all online nodes
  const localModels = [];
  const onlineThreshold = Date.now() - HEARTBEAT_TIMEOUT_MS;

  for (const [nodeId, node] of nodes) {
    if (!node.lastHeartbeat || node.lastHeartbeat.getTime() < onlineThreshold) continue;
    const addr = node.config?.addr || node.addr;
    if (!addr) continue;

    // Determine Ollama URL from node address
    const ollamaHost = addr.replace(/:\d+$/, ''); // strip Claw port
    const ollamaUrl = `http://${ollamaHost.replace(/^:/, 'localhost')}:11434`;

    const models = node.models || node.config?.models || [];
    for (const model of models) {
      const modelBase = model.replace(/:latest$/, '');
      localModels.push({
        model_name: `local-${modelBase.replace(/[/:]/g, '-')}`,
        litellm_params: {
          model: `ollama/${model}`,
          api_base: ollamaUrl,
        },
        model_info: {
          tier: 1,
          cost_per_token: 0,
          node_id: nodeId,
          _managed_by: 'queen', // tag so we can distinguish from user entries
        },
      });
    }
  }

  // Merge: cloud models (preserved) + local models (regenerated)
  const merged = {
    ...existing,
    model_list: [...cloudModels, ...localModels],
  };

  // Write updated config
  const yamlStr = yaml.dump(merged, { lineWidth: -1, noRefs: true });
  await fs.writeFile(LITELLM_CONFIG, yamlStr);

  // Hot-reload LiteLLM if running
  try {
    await fetch(`${LITELLM_URL}/config/reload`, { method: 'POST', signal: AbortSignal.timeout(3000) });
    console.log(`[QUEEN] LiteLLM config synced: ${localModels.length} local endpoint(s) across ${new Set(localModels.map(m => m.model_info.node_id)).size} node(s)`);
  } catch {
    // LiteLLM not running — config will be picked up on next start
  }

  activity.log({ type: 'litellm_sync', local_endpoints: localModels.length, cloud_endpoints: cloudModels.length });
}

// --- Workflow state ---
let workflows = new Map();
const runningWorkflows = new Map(); // workflow runs in progress

// Load workflows on startup
try {
  const wfDir = path.join(CONFIG_DIR, 'workflows');
  if (existsSync(wfDir)) {
    const files = readdirSync(wfDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      const raw = readFileSync(path.join(wfDir, file), 'utf-8');
      const spec = yaml.load(raw);
      if (spec?.name) workflows.set(spec.name, spec);
    }
    console.log(`[QUEEN] Loaded ${workflows.size} workflow(s): ${[...workflows.keys()].join(', ')}`);
  }
} catch (err) {
  console.warn(`[QUEEN] Failed to load workflows: ${err.message}`);
}

// ============================================================
// HIVE SECRET — Auth for all API routes
// ============================================================
// Generated on first boot, stored in data/hive-identity.json.
// Every API request must include: Authorization: Bearer <secret>
// Dashboard serves a login page. Drones send it in heartbeat headers.
// ============================================================

const HIVE_IDENTITY_FILE = path.join(DATA_DIR, 'hive-identity.json');
let HIVE_SECRET = '';

function initHiveSecret() {
  try {
    const raw = readFileSync(HIVE_IDENTITY_FILE, 'utf-8');
    const identity = JSON.parse(raw);
    HIVE_SECRET = identity.secret;
    console.log(`[QUEEN] Hive secret loaded (${HIVE_SECRET.slice(0, 8)}...)`);
  } catch {
    // First boot — generate new secret
    HIVE_SECRET = crypto.randomBytes(32).toString('hex');
    const identity = {
      secret: HIVE_SECRET,
      created_at: new Date().toISOString(),
      queen_id: `queen-${crypto.randomBytes(2).toString('hex')}`,
    };
    writeFileSync(HIVE_IDENTITY_FILE, JSON.stringify(identity, null, 2));
    console.log(`[QUEEN] ═══════════════════════════════════════════`);
    console.log(`[QUEEN]   NEW HIVE SECRET GENERATED`);
    console.log(`[QUEEN]   ${HIVE_SECRET}`);
    console.log(`[QUEEN]   Save this. Drones need it to join.`);
    console.log(`[QUEEN] ═══════════════════════════════════════════`);
    activity.log({ type: 'hive_created', queen_id: identity.queen_id });
  }
}

initHiveSecret();

// Persist node registrations across restarts
const NODES_FILE = path.join(DATA_DIR, 'nodes.json');
function loadNodes() {
  try {
    const raw = readFileSync(NODES_FILE, 'utf-8');
    const loaded = JSON.parse(raw);
    for (const [id, node] of Object.entries(loaded)) {
      node.lastHeartbeat = new Date(node.lastHeartbeat);
      node.registeredAt = new Date(node.registeredAt);
      node.status = 'offline'; // assume offline until heartbeat
      nodes.set(id, node);
    }
    console.log(`[QUEEN] Restored ${nodes.size} node(s) from disk`);
  } catch { /* fresh start */ }
}

function persistNodes() {
  const obj = Object.fromEntries(nodes);
  fs.writeFile(NODES_FILE, JSON.stringify(obj, null, 2)).catch(() => {});
}

loadNodes();

// --- Express App ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Cookie helpers (no cookie-parser dep needed) ──────────
const SESSION_COOKIE = 'bc_session';
const SESSION_MAXAGE = 8 * 60 * 60; // 8 hours in seconds

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function hasValidSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  const expected = crypto
    .createHmac('sha256', HIVE_SECRET)
    .update('borgclaw-session')
    .digest('hex');
  return token === expected;
}

// Auth middleware — check hive secret on API routes
// Public routes: GET / (status JSON), GET /api/hive/info (drone discovery),
//                GET /auth/login, POST /auth/login
// /dashboard requires a valid session cookie — NOT in PUBLIC_ROUTES.
const PUBLIC_ROUTES = ['/', '/api/hive/info', '/auth/login'];

app.use((req, res, next) => {
  // Public routes skip auth
  if (PUBLIC_ROUTES.includes(req.path)) return next();

  // Dashboard — cookie-based session gate
  if (req.path === '/dashboard' || req.path === '/setup') {
    if (hasValidSession(req)) return next();
    return res.redirect(`/auth/login?next=${encodeURIComponent(req.path)}`);
  }

  // Static assets skip auth
  if (req.path.startsWith('/views/') || req.path.endsWith('.css') || req.path.endsWith('.js')) return next();

  // Check bearer token
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    // Check query param fallback (for dashboard SSE)
    const token = req.query.token;
    if (token === HIVE_SECRET) return next();
    return res.status(401).json({ error: 'Unauthorized — include Authorization: Bearer <hive-secret>' });
  }

  const token = auth.slice(7);
  if (token !== HIVE_SECRET) {
    return res.status(403).json({ error: 'Invalid hive secret' });
  }

  next();
});

// ── Login routes ──────────────────────────────────────────
app.get('/auth/login', (req, res) => {
  const next = req.query.next || '/dashboard';
  const failed = req.query.failed === '1';
  res.type('html').send(renderLoginPage(next, failed));
});

app.post('/auth/login', (req, res) => {
  const { secret, next } = req.body;
  const redirectTo = (next && next.startsWith('/')) ? next : '/dashboard';
  if (secret === HIVE_SECRET) {
    // Set both cookies in one header call (array form) so nothing overwrites.
    // SESSION_COOKIE: HttpOnly HMAC token — gates the /dashboard route.
    // bc_api_token: JS-readable cookie — dashboard client uses it for Bearer
    //   headers on API calls. Not HttpOnly by design: the page is already gated
    //   by the HttpOnly session cookie, so only authenticated users can read it.
    //   SameSite=Strict prevents CSRF.
    const sessionToken = crypto
      .createHmac('sha256', HIVE_SECRET)
      .update('borgclaw-session')
      .digest('hex');
    res.setHeader('Set-Cookie', [
      `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAXAGE}; Path=/`,
      `bc_api_token=${encodeURIComponent(HIVE_SECRET)}; SameSite=Strict; Max-Age=${SESSION_MAXAGE}; Path=/`,
    ]);
    return res.redirect(redirectTo);
  }
  return res.redirect(`/auth/login?next=${encodeURIComponent(redirectTo)}&failed=1`);
});

function renderLoginPage(next, failed) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BORGCLAW // AUTHENTICATE</title>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--green:#00FF88;--cyan:#00CCFF;--red:#FF4444;--void:#0A0A0A;--panel:#111;--border:#2A2A2A;--grey:#888;--white:#CCC;--font:'JetBrains Mono','IBM Plex Mono','Fira Code','Courier New',monospace}
html,body{background:var(--void);color:var(--white);font-family:var(--font);font-size:13px;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{border:1px solid var(--border);background:var(--panel);padding:2rem 2.5rem;min-width:360px;max-width:480px;width:100%}
.logo{color:var(--green);font-size:10px;line-height:1.3;white-space:pre;margin-bottom:1.5rem;opacity:.85}
h1{color:var(--green);font-size:16px;letter-spacing:3px;text-transform:uppercase;margin-bottom:.25rem}
.sub{color:var(--cyan);font-size:10px;letter-spacing:2px;margin-bottom:1.5rem}
label{display:block;color:var(--grey);font-size:11px;letter-spacing:1px;margin-bottom:.4rem}
input[type=password]{width:100%;background:#0a0a0a;border:1px solid var(--border);color:var(--white);font-family:var(--font);font-size:13px;padding:.6rem .8rem;outline:none;letter-spacing:.1em}
input[type=password]:focus{border-color:var(--green)}
.error{color:var(--red);font-size:11px;margin-top:.75rem;letter-spacing:1px;display:${failed ? 'block' : 'none'}}
button{margin-top:1.2rem;width:100%;background:var(--void);border:1px solid var(--green);color:var(--green);font-family:var(--font);font-size:12px;letter-spacing:2px;padding:.65rem;cursor:pointer;text-transform:uppercase}
button:hover{background:var(--green);color:var(--void)}
.footer{margin-top:1.5rem;color:#444;font-size:10px;letter-spacing:1px;text-align:center}
</style>
</head>
<body>
<div class="box">
  <pre class="logo">    ╭━━╮  ╭━━╮
   ╭╯● ╰╮╭╯ ●╰╮   BORGCLAW
   ┃  ╭━╯╰━╮  ┃
   ╰━━╯    ╰━━╯
     ╰══════╯    </pre>
  <h1>AUTHENTICATE</h1>
  <div class="sub">HIVE ACCESS REQUIRED</div>
  <form method="POST" action="/auth/login">
    <input type="hidden" name="next" value="${escHtmlAttr(next)}">
    <label for="secret">HIVE SECRET</label>
    <input type="password" id="secret" name="secret" autofocus autocomplete="current-password" placeholder="Enter hive secret...">
    <div class="error">✗ INVALID SECRET — ACCESS DENIED</div>
    <button type="submit">► ENTER HIVE</button>
  </form>
  <div class="footer">BorgClaw Queen · Local access only</div>
</div>
</body>
</html>`;
}

function escHtmlAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Public endpoint — drones can discover hive info without auth
app.get('/api/hive/info', (_req, res) => {
  res.json({
    queen: true,
    version: VERSION,
    auth_required: true,
    endpoints: {
      api: `http://localhost:${PORT}`,
      litellm: LITELLM_URL,
    },
  });
});

// Serve static views
const VIEWS_DIR = path.join(__dirname, 'views');

// ============================================================
// ROUTES: Health & Dashboard
// ============================================================

app.get('/', (_req, res) => {
  res.json({
    service: 'borgclaw-queen',
    version: VERSION,
    uptime_seconds: uptime(),
    nodes_registered: nodes.size,
    nodes_online: countOnline(),
    pending_approvals: approvals.pending().length,
    timestamp: new Date().toISOString(),
  });
});

// Dashboard — serve HTML file or fallback to inline
app.get('/dashboard', async (_req, res) => {
  const data = buildDashboardData();

  // Try to load the view file
  const viewPath = path.join(VIEWS_DIR, 'dashboard.js');
  if (existsSync(viewPath)) {
    try {
      const mod = await import(viewPath);
      const render = mod.default || mod.renderDashboard;
      if (render) return res.send(render(data));
    } catch (err) {
      console.warn(`[QUEEN] Dashboard view error: ${err.message}`);
    }
  }

  // Inline fallback (retro minimal)
  res.send(renderDashboardFallback(data));
});

// Setup wizard
app.get('/setup', async (_req, res) => {
  const viewPath = path.join(VIEWS_DIR, 'setup.html');
  if (existsSync(viewPath)) {
    const html = await fs.readFile(viewPath, 'utf-8');
    return res.type('html').send(html);
  }
  res.send('<html><body style="background:#0a0a0a;color:#00ff88;font-family:monospace;padding:2rem"><h1>BorgClaw Setup</h1><p>Setup wizard HTML not found. Run setup via CLI: <code>./borgclaw bootstrap</code></p></body></html>');
});

// ============================================================
// ROUTES: Status & Health
// ============================================================

app.get('/api/status', (_req, res) => {
  res.json({
    queen: { version: VERSION, uptime_seconds: uptime(), started_at: startedAt.toISOString() },
    nodes: nodeList(),
    pending_approvals: approvals.pending().length,
    workflows_loaded: workflows.size,
    running_workflows: runningWorkflows.size,
  });
});

app.get('/api/health/deep', async (_req, res) => {
  const health = await deepHealthCheck(nodes, startedAt);
  res.json(health);
});

// ============================================================
// ROUTES: Hive Control (Kill Switch)
// ============================================================

app.post('/api/hive/halt', async (_req, res) => {
  console.log('[QUEEN] ⚠️  HIVE HALT TRIGGERED — stopping all nodes');
  activity.log({ type: 'hive_halt', reason: 'operator triggered' });
  natsPublish('hive.hive.halted', { reason: 'operator triggered', ts: new Date().toISOString() });

  // Cancel all running workflows
  for (const [id, run] of runningWorkflows) {
    run.status = 'halted';
    activity.log({ type: 'workflow_halted', workflow_id: id });
  }
  runningWorkflows.clear();

  // Reject all pending approvals
  for (const appr of approvals.pending()) {
    approvals.reject(appr.id, 'Hive halt — all pending approvals rejected');
  }

  // Send HALT to every online node (set contribution to 0, drop tasks)
  const results = [];
  for (const [nodeId, node] of nodes) {
    node.status = 'halted';
    const addr = node.addr || node.config?.addr;
    if (!addr) { results.push({ node_id: nodeId, status: 'no_addr' }); continue; }

    const nodeUrl = `http://${addr.replace(/^:/, 'localhost')}`;
    try {
      await fetch(`${nodeUrl}/contribution`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 0 }),
        signal: AbortSignal.timeout(3000),
      });
      results.push({ node_id: nodeId, status: 'halted' });
    } catch (err) {
      results.push({ node_id: nodeId, status: 'unreachable', error: err.message });
    }
  }

  // Sync LiteLLM to remove all local endpoints
  try { await syncLitellmConfig(); } catch { /* best effort */ }

  console.log(`[QUEEN] Hive halted. ${results.filter(r => r.status === 'halted').length}/${results.length} nodes stopped.`);
  res.json({ halted: true, nodes: results, workflows_cancelled: 0, approvals_rejected: approvals.pending().length });
});

app.post('/api/hive/resume', (_req, res) => {
  console.log('[QUEEN] Hive resuming — nodes will re-register via heartbeat');
  activity.log({ type: 'hive_resume' });
  natsPublish('hive.hive.resumed', { ts: new Date().toISOString() });

  for (const [_nodeId, node] of nodes) {
    if (node.status === 'halted') node.status = 'online';
  }

  scheduleLitellmSync();
  res.json({ resumed: true });
});

// ============================================================
// ROUTES: Make Disk — write a USB drone installer
// ============================================================
// POST /api/hive/make-disk
//   Body: { target_path: "/Volumes/MYUSB" }
//   Returns: { ok: true, path, size_mb } | { ok: false, error }
//
// Wraps scripts/prepare-usb.sh which does the heavy lifting:
//   - Cross-compiles the-claw for Linux amd64
//   - Caches Ollama installer + local models
//   - Writes hive secret + Queen IP into drone config
// ============================================================

app.post('/api/hive/make-disk', async (req, res) => {
  const { target_path } = req.body || {};

  if (!target_path || typeof target_path !== 'string' || !target_path.trim()) {
    return res.status(400).json({ ok: false, error: 'target_path is required' });
  }

  // Basic safety: must be an absolute path
  if (!path.isAbsolute(target_path)) {
    return res.status(400).json({ ok: false, error: 'target_path must be absolute (e.g. /Volumes/MYUSB)' });
  }

  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'prepare-usb.sh');

  // Verify the script exists before spawning
  if (!existsSync(scriptPath)) {
    return res.status(500).json({ ok: false, error: `prepare-usb.sh not found at ${scriptPath}` });
  }

  activity.log({ type: 'make_disk_started', target_path });
  console.log(`[QUEEN] MAKE DISK: writing hive to ${target_path}`);

  try {
    const output = await new Promise((resolve, reject) => {
      const proc = spawn('bash', [scriptPath, target_path.trim()], {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      proc.on('error', (err) => {
        reject(new Error(`Script spawn failed: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          // Include both streams — the script may print errors to either
          const detail = (stderr + stdout).trim() || `Exit code ${code}`;
          reject(new Error(detail));
        }
      });
    });

    // Measure what landed on the drive
    let size_mb = null;
    try {
      const clawDir = path.join(target_path.trim(), 'THE-CLAW');
      const { execSync } = await import('child_process');
      const duOut = execSync(`du -sm "${clawDir}" 2>/dev/null || echo "0"`, { encoding: 'utf-8', timeout: 5000 });
      size_mb = parseInt(duOut.trim().split(/\s+/)[0]) || null;
    } catch { /* best effort — size stays null if du fails */ }

    activity.log({ type: 'make_disk_complete', target_path, size_mb });
    console.log(`[QUEEN] MAKE DISK complete: ${target_path} (${size_mb != null ? size_mb + ' MB' : 'size unknown'})`);

    res.json({ ok: true, path: target_path, size_mb, output: output.slice(-2000) });
  } catch (err) {
    activity.log({ type: 'make_disk_failed', target_path, error: err.message });
    console.error(`[QUEEN] MAKE DISK failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// ROUTES: Node Registry
// ============================================================

app.post('/api/nodes/register', (req, res) => {
  const { node_id, config } = req.body;
  if (!node_id) return res.status(400).json({ error: 'node_id is required' });

  nodes.set(node_id, {
    config: config || {},
    lastHeartbeat: new Date(),
    status: 'online',
    registeredAt: new Date(),
    metrics: {},
  });

  activity.log({ type: 'node_registered', node_id, role: config?.role });
  natsPublish('hive.node.registered', { node_id, role: config?.role, ts: new Date().toISOString() });
  console.log(`[QUEEN] Node registered: ${node_id} (${config?.role || 'unknown'})`);
  if (config?.models?.length) scheduleLitellmSync();
  persistNodes();
  res.json({ ok: true, message: `Node ${node_id} registered.` });
});

app.post('/api/nodes/:nodeId/heartbeat', (req, res) => {
  const { nodeId } = req.params;
  const node = nodes.get(nodeId);

  if (!node) {
    nodes.set(nodeId, {
      config: req.body.config || {},
      lastHeartbeat: new Date(),
      status: 'online',
      registeredAt: new Date(),
      metrics: req.body.metrics || {},
    });
    activity.log({ type: 'node_auto_registered', node_id: nodeId });
    if (req.body.models?.length) scheduleLitellmSync();
    return res.json({ ok: true, registered: true });
  }

  // Measure queen-side latency from heartbeat timestamp
  if (req.body.sent_at) {
    node.metrics.queen_rtt_ms = Date.now() - new Date(req.body.sent_at).getTime();
  }
  node.lastHeartbeat = new Date();
  node.status = 'online';
  if (req.body.metrics) {
    // Merge metrics — keep history for sparklines
    const m = req.body.metrics;
    if (!node.metrics._history) node.metrics._history = [];
    node.metrics._history.push({ ts: Date.now(), ...m });
    if (node.metrics._history.length > 60) node.metrics._history.shift(); // keep last 30 min (30s intervals)
    // Current values
    node.metrics.tokens_per_sec = m.tokens_per_sec ?? node.metrics.tokens_per_sec;
    node.metrics.cpu_pct = m.cpu_pct ?? node.metrics.cpu_pct;
    node.metrics.ram_used_gb = m.ram_used_gb ?? node.metrics.ram_used_gb;
    node.metrics.ram_total_gb = m.ram_total_gb ?? node.metrics.ram_total_gb;
    node.metrics.gpu_util_pct = m.gpu_util_pct ?? node.metrics.gpu_util_pct;
    node.metrics.gpu_vram_used_mb = m.gpu_vram_used_mb ?? node.metrics.gpu_vram_used_mb;
    node.metrics.gpu_vram_total_mb = m.gpu_vram_total_mb ?? node.metrics.gpu_vram_total_mb;
    node.metrics.net_rx_mbps = m.net_rx_mbps ?? node.metrics.net_rx_mbps;
    node.metrics.net_tx_mbps = m.net_tx_mbps ?? node.metrics.net_tx_mbps;
    node.metrics.active_model = m.active_model ?? node.metrics.active_model;
    node.metrics.requests_served = m.requests_served ?? node.metrics.requests_served;
    node.metrics.avg_latency_ms = m.avg_latency_ms ?? node.metrics.avg_latency_ms;
    node.metrics.p95_latency_ms = m.p95_latency_ms ?? node.metrics.p95_latency_ms;
    node.metrics.ping_ms = m.ping_ms ?? node.metrics.ping_ms; // network RTT to Queen
    node.metrics.cpu_temp_c = m.cpu_temp_c ?? node.metrics.cpu_temp_c;
    node.metrics.gpu_temp_c = m.gpu_temp_c ?? node.metrics.gpu_temp_c;
  }
  // Store models + addr for LiteLLM routing
  if (req.body.models) {
    const prevModels = JSON.stringify(node.models || []);
    node.models = req.body.models;
    node.addr = req.body.addr || node.addr;
    if (JSON.stringify(node.models) !== prevModels) scheduleLitellmSync();
  }
  persistNodes();
  res.json({ ok: true });
});

app.get('/api/nodes/:nodeId', (req, res) => {
  const node = nodes.get(req.params.nodeId);
  if (!node) return res.status(404).json({ error: `Node ${req.params.nodeId} not found` });
  res.json({ node_id: req.params.nodeId, ...node, seconds_since_heartbeat: secsSince(node.lastHeartbeat) });
});

app.get('/api/nodes', (_req, res) => res.json(nodeList()));

app.delete('/api/nodes/:nodeId', (req, res) => {
  if (nodes.delete(req.params.nodeId)) {
    activity.log({ type: 'node_removed', node_id: req.params.nodeId });
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: `Node ${req.params.nodeId} not found` });
  }
});

// ============================================================
// ROUTES: Config API
// ============================================================

app.get('/api/config/models', async (_req, res) => {
  try {
    res.json(JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'models.json'), 'utf-8')));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read models.json', detail: err.message });
  }
});

app.get('/api/config/registry', async (_req, res) => {
  try {
    res.json(yaml.load(await fs.readFile(path.join(CONFIG_DIR, 'mcps/registry.yaml'), 'utf-8')));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read registry.yaml', detail: err.message });
  }
});

app.post('/api/config/recommend-profile', (req, res) => {
  const { hardware } = req.body;
  const hw = hardware || req.body;
  const result = setup.mapProfile(hw);
  result.recommended_role = setup.recommendRole(result.profile);
  res.json(result);
});

// ============================================================
// ROUTES: Capability Lookup
// ============================================================

app.get('/api/capabilities/:capability', async (req, res) => {
  try {
    const registry = yaml.load(await fs.readFile(path.join(CONFIG_DIR, 'mcps/registry.yaml'), 'utf-8'));
    const cap = req.params.capability;
    const toolId = registry.capability_index?.[cap];
    if (!toolId) return res.json({ capability: cap, status: 'not_available', tool: null });

    const tool = [...(registry.connected || []), ...(registry.pending || [])].find(t => t.id === toolId);
    res.json({ capability: cap, status: tool?.status || 'unknown', tool_id: toolId, tool_name: tool?.tool || 'unknown', node: tool?.node || 'unknown' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to look up capability', detail: err.message });
  }
});

// ============================================================
// ROUTES: Approval Queue (Law Two)
// ============================================================

app.get('/api/approvals', (req, res) => {
  const status = req.query.status || null;
  res.json(approvals.list(status));
});

app.get('/api/approvals/:id', (req, res) => {
  const item = approvals.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Approval not found' });
  res.json(item);
});

app.post('/api/approvals', (req, res) => {
  const item = approvals.create(req.body);
  res.status(201).json(item);
});

app.post('/api/approvals/:id/approve', (req, res) => {
  const item = approvals.approve(req.params.id);
  if (!item) return res.status(404).json({ error: 'Approval not found' });

  // Find the paused run that is waiting on this approval and resume it.
  // runningWorkflows is keyed by runId; source_workflow on the approval item
  // is stored as "workflowName/runId" by the createApproval adapter, so we
  // scan by pausedApprovalId rather than relying on the key match.
  for (const [runId, run] of runningWorkflows) {
    if (run.pausedApprovalId === req.params.id && run.status === 'paused' && run._state) {
      activity.log({ type: 'workflow_resumed', workflow: run.name, run_id: runId, approval_id: req.params.id });
      run.status = 'running';

      // Build the same deps as executeWorkflowAsync
      const context = {
        today: new Date().toISOString().split('T')[0],
        today_formatted: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      };

      resumeWorkflowAsync(runId, run, context).catch(err => {
        activity.log({ type: 'workflow_resume_error', workflow: run.name, run_id: runId, error: err.message });
        run.status = 'failed';
        run.error = err.message;
        setTimeout(() => runningWorkflows.delete(runId), 5 * 60 * 1000);
      });

      break;
    }
  }

  res.json(item);
});

app.post('/api/approvals/:id/reject', (req, res) => {
  const item = approvals.reject(req.params.id, req.body?.reason);
  if (!item) return res.status(404).json({ error: 'Approval not found' });
  res.json(item);
});

// ============================================================
// ROUTES: Workflow Execution
// ============================================================

app.get('/api/workflows', (_req, res) => {
  const list = [...workflows.entries()].map(([name, spec]) => ({
    name,
    description: spec.description,
    steps: spec.steps?.length || 0,
    trigger: spec.trigger,
  }));
  res.json(list);
});

app.get('/api/workflows/:name', (req, res) => {
  const spec = workflows.get(req.params.name);
  if (!spec) return res.status(404).json({ error: `Workflow '${req.params.name}' not found` });
  res.json(spec);
});

app.post('/api/workflows/:name/execute', async (req, res) => {
  const name = req.params.name;
  const spec = workflows.get(name);
  if (!spec) return res.status(404).json({ error: `Workflow '${name}' not found` });

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const context = {
    today: new Date().toISOString().split('T')[0],
    today_formatted: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    ...req.body?.context,
  };

  activity.log({ type: 'workflow_started', workflow: name, run_id: runId });
  natsPublish('hive.workflow.started', { workflow: name, run_id: runId, ts: new Date().toISOString() });

  // Track the run
  runningWorkflows.set(runId, { name, status: 'running', started_at: new Date().toISOString(), results: {} });

  // Execute asynchronously — don't block the response
  executeWorkflowAsync(runId, spec, context).catch(err => {
    activity.log({ type: 'workflow_error', workflow: name, run_id: runId, error: err.message });
    natsPublish('hive.workflow.failed', { workflow: name, run_id: runId, error: err.message, ts: new Date().toISOString() });
    const run = runningWorkflows.get(runId);
    if (run) run.status = 'failed';
  });

  res.status(202).json({ run_id: runId, workflow: name, status: 'started' });
});

app.get('/api/workflows/runs/:runId', (req, res) => {
  const run = runningWorkflows.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

// ============================================================
// ROUTES: Node Configuration (interactive)
// ============================================================

// Update a node's settings (contribution dial, role, etc.)
app.patch('/api/nodes/:nodeId', (req, res) => {
  const node = nodes.get(req.params.nodeId);
  if (!node) return res.status(404).json({ error: `Node ${req.params.nodeId} not found` });

  const { contribution, role, capabilities } = req.body;
  if (contribution !== undefined) {
    node.config.contribution = Math.max(0, Math.min(100, parseInt(contribution)));
    activity.log({ type: 'node_contribution_changed', node_id: req.params.nodeId, contribution: node.config.contribution });
  }
  if (role) {
    node.config.role = role;
    activity.log({ type: 'node_role_changed', node_id: req.params.nodeId, role });
  }
  if (capabilities) {
    node.config.capabilities = capabilities;
  }
  res.json({ ok: true, node_id: req.params.nodeId, config: node.config });
});

// Ping a node (test connectivity)
app.post('/api/nodes/:nodeId/ping', async (req, res) => {
  const node = nodes.get(req.params.nodeId);
  if (!node) return res.status(404).json({ error: `Node ${req.params.nodeId} not found` });

  // If node has a hostname/IP, try to reach it
  const ip = node.config?.hostname || node.config?.ip;
  if (!ip || ip === '127.0.0.1' || ip === 'localhost') {
    return res.json({ ok: true, node_id: req.params.nodeId, reachable: true, local: true });
  }
  try {
    const probe = await fetch(`http://${ip}:11434/`, { signal: AbortSignal.timeout(3000) });
    res.json({ ok: true, node_id: req.params.nodeId, reachable: probe.ok, status: probe.status });
  } catch (err) {
    res.json({ ok: true, node_id: req.params.nodeId, reachable: false, error: err.message });
  }
});

// ============================================================
// ROUTES: Model Management
// ============================================================

// List models available on a node (via Ollama)
app.get('/api/models', async (_req, res) => {
  try {
    const r = await fetch('http://localhost:11434/api/tags');
    if (r.ok) {
      const data = await r.json();
      res.json({ source: 'ollama', models: data.models || [] });
    } else {
      res.json({ source: 'ollama', models: [], error: 'Ollama returned ' + r.status });
    }
  } catch {
    res.json({ source: 'none', models: [], error: 'Ollama not reachable' });
  }
});

// Pull a model (trigger Ollama pull)
app.post('/api/models/pull', async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model name required' });

  activity.log({ type: 'model_pull_started', model });

  try {
    const r = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
    });
    const data = await r.json();
    activity.log({ type: 'model_pull_complete', model, status: data.status });
    res.json({ ok: true, model, result: data });
  } catch (err) {
    activity.log({ type: 'model_pull_failed', model, error: err.message });
    res.json({ ok: false, model, error: err.message });
  }
});

// Scan for available upgrade candidates from the Ollama library
// GET /api/models/available?tiers=nano,edge,worker
//   Returns models that aren't deployed yet and fit within hive hardware tiers.
//   Optional ?tiers= query param limits which tiers to evaluate.
//   Reads current deployments from config/models.json for comparison.
app.get('/api/models/available', async (req, res) => {
  let currentModels = {};
  try {
    const raw = await fs.readFile(path.join(CONFIG_DIR, 'models.json'), 'utf-8');
    currentModels = JSON.parse(raw);
  } catch (err) {
    console.warn(`[QUEEN] /api/models/available: could not read models.json: ${err.message}`);
    // Proceed with empty config — leaderboard will still run, just can't de-dupe
  }

  const tiersParam = req.query.tiers;
  const tiers = tiersParam
    ? tiersParam.split(',').map(t => t.trim()).filter(Boolean)
    : null;

  activity.log({ type: 'leaderboard_scan_started', tiers: tiers || 'all' });

  const candidates = await scanLeaderboard(currentModels, tiers);

  activity.log({ type: 'leaderboard_scan_complete', candidates_found: candidates.length });

  res.json({
    scanned_at: new Date().toISOString(),
    tiers_evaluated: tiers || Object.keys(currentModels.drone_tiers || {}),
    candidates_found: candidates.length,
    candidates,
  });
});

// Search the Ollama library by keyword
// GET /api/models/search?q=vision
app.get('/api/models/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) {
    return res.status(400).json({ error: 'q parameter required (e.g. ?q=vision)' });
  }

  const results = await checkOllamaLibrary(q);
  res.json({ query: q, results });
});

// ============================================================
// ROUTES: Node Metrics
// ============================================================

// Get all node metrics at a glance
app.get('/api/metrics', (_req, res) => {
  const metrics = [...nodes.entries()].map(([id, n]) => ({
    node_id: id,
    role: n.config?.role,
    status: n.status,
    tokens_per_sec: n.metrics?.tokens_per_sec ?? null,
    cpu_pct: n.metrics?.cpu_pct ?? null,
    ram_used_gb: n.metrics?.ram_used_gb ?? null,
    ram_total_gb: n.metrics?.ram_total_gb ?? null,
    gpu_util_pct: n.metrics?.gpu_util_pct ?? null,
    gpu_vram_used_mb: n.metrics?.gpu_vram_used_mb ?? null,
    gpu_vram_total_mb: n.metrics?.gpu_vram_total_mb ?? null,
    net_rx_mbps: n.metrics?.net_rx_mbps ?? null,
    net_tx_mbps: n.metrics?.net_tx_mbps ?? null,
    active_model: n.metrics?.active_model ?? null,
    requests_served: n.metrics?.requests_served ?? 0,
    avg_latency_ms: n.metrics?.avg_latency_ms ?? null,
    p95_latency_ms: n.metrics?.p95_latency_ms ?? null,
    ping_ms: n.metrics?.ping_ms ?? null,
    queen_rtt_ms: n.metrics?.queen_rtt_ms ?? null,
    cpu_temp_c: n.metrics?.cpu_temp_c ?? null,
    gpu_temp_c: n.metrics?.gpu_temp_c ?? null,
    contribution: n.config?.contribution ?? 100,
  }));
  res.json(metrics);
});

// Get metrics history for a specific node (for sparklines)
app.get('/api/metrics/:nodeId/history', (req, res) => {
  const node = nodes.get(req.params.nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json(node.metrics?._history || []);
});

// ============================================================
// ROUTES: System Actions
// ============================================================

// Refresh health (force deep probe)
app.post('/api/actions/refresh-health', async (_req, res) => {
  const health = await deepHealthCheck(nodes, startedAt);
  activity.log({ type: 'health_refresh', overall: health.overall });
  res.json(health);
});

// QMD search proxy
app.post('/api/search', async (req, res) => {
  const { query, collection, limit } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const { execSync } = await import('child_process');
    const args = [`search`, `"${query.replace(/"/g, '\\"')}"`, `-n`, `${limit || 5}`];
    if (collection) args.push(`-c`, collection);
    const result = execSync(`qmd ${args.join(' ')}`, { encoding: 'utf-8', timeout: 15000 });
    res.json({ ok: true, results: result });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ============================================================
// ROUTES: Activity Feed
// ============================================================

app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const since = req.query.since || null;
  res.json(activity.get(limit, since));
});

// ============================================================
// ROUTES: SSE Events (real-time push)
// ============================================================

app.get('/api/events', (req, res) => {
  activity.addSSEListener(res);
});

// ============================================================
// ROUTES: Setup Wizard API
// ============================================================

app.get('/api/setup/status', (_req, res) => {
  res.json(setup.getSetupState());
});

app.post('/api/setup/detect', (_req, res) => {
  const hw = setup.detectHardware();
  const { profile } = setup.mapProfile(hw);
  const role = setup.recommendRole(profile);
  res.json({ hardware: hw, profile, recommended_role: role });
});

app.post('/api/setup/configure', async (req, res) => {
  const { node_id, role, profile } = req.body;
  const hw = setup.getSetupState().hardware || setup.detectHardware();
  const result = await setup.configureNode(CONFIG_DIR, node_id || 'queen', role || 'queen', profile || 'unknown', hw);
  res.json(result);
});

app.post('/api/setup/models', async (req, res) => {
  const profile = req.body?.profile || setup.getSetupState().profile;
  const models = await setup.getModelsForProfile(CONFIG_DIR, profile);
  res.json(models);
});

app.post('/api/setup/complete', (_req, res) => {
  setup.markComplete();
  res.json({ ok: true, message: 'Setup complete. Welcome to the Collective.' });
});

// ============================================================
// Workflow Execution Engine — delegates to lib/workflow.js
// ============================================================
// lib/workflow.js is the real DAG engine (Kahn's algorithm,
// approval gates, template resolution, timeout enforcement).
// This function wires the server's resources into it.
// ============================================================

async function executeWorkflowAsync(runId, spec, context) {
  const run = runningWorkflows.get(runId);

  // Adapter: lib/workflow.js calls callLLM(agent, action, inputs, systemPrompt).
  // We wrap callLLMWithTimeout and also prepend the agent's instructions.md
  // to the systemPrompt that the lib built from step fields.
  async function callLLM(agent, action, inputs, systemPrompt) {
    // Load agent instructions from disk (best-effort)
    let agentInstructions = '';
    try {
      const agentDir = path.join(BORGCLAW_HOME, 'agents', agent);
      agentInstructions = await fs.readFile(path.join(agentDir, 'instructions.md'), 'utf-8');
    } catch { /* instructions not found — proceed without */ }

    const fullSystemPrompt = agentInstructions
      ? `${agentInstructions}\n\n${systemPrompt}`
      : systemPrompt;

    // Build a minimal step-like object for callLLMWithTimeout
    const stepProxy = { agent, action, description: '' };
    const result = await callLLMWithTimeout(stepProxy, inputs, fullSystemPrompt, 5 * 60 * 1000);

    // Governance filter — check output before it propagates to the next step
    const gov = checkGovernance(result.output, { agent, action, runId });
    if (!gov.allowed) {
      activity.log({ type: 'governance_block', agent, action, run_id: runId, reason: gov.reason });
      console.warn(`[GOVERNANCE] Blocked output from ${agent}/${action}: ${gov.reason}`);
      createApproval({
        type: 'governance_review',
        summary: `Governance filter blocked ${agent}/${action}: ${gov.reason}`,
        source_agent: agent,
        payload: { original_output: result.output, filtered_output: gov.filtered_output, reason: gov.reason },
      });
      // Return filtered output so the workflow step gets a safe value, not a crash
      return { ...result, output: gov.filtered_output, governance_blocked: true };
    }

    return result;
  }

  // Adapter: lib/workflow.js calls createApproval(approval) → item with .id
  function createApproval(approval) {
    const item = approvals.create({
      ...approval,
      source_workflow: approval.source_workflow
        ? `${approval.source_workflow}/${runId}`
        : runId,
    });
    run.pausedApprovalId = item.id;
    run.status = 'paused';
    return item;
  }

  // Adapter: lib/workflow.js calls getApprovalStatus(id) → 'pending'|'approved'|'rejected'
  function getApprovalStatus(id) {
    return approvals.get(id)?.status || 'pending';
  }

  try {
    const outcome = await executeWorkflow(spec.name, {
      workflows,
      callLLM,
      createApproval,
      logActivity: activity.log,
      getApprovalStatus,
      context,
    });

    // Map lib result back onto the run object
    if (outcome.status === 'completed') {
      run.status = 'completed';
      // Convert Map → plain object for JSON serialisation
      run.results = Object.fromEntries(outcome.results);
      run.completed_at = new Date().toISOString();
      activity.log({ type: 'workflow_completed', workflow: spec.name, run_id: runId, steps_completed: outcome.results.size });
      natsPublish('hive.workflow.completed', { workflow: spec.name, run_id: runId, steps_completed: outcome.results.size, ts: run.completed_at });
      // Bug 4 fix: evict completed run after 5 minutes so runningWorkflows doesn't grow unbounded.
      setTimeout(() => runningWorkflows.delete(runId), 5 * 60 * 1000);
    } else if (outcome.status === 'paused') {
      // run.status and run.pausedApprovalId already set inside createApproval
      run.paused_at = outcome.paused_at;
      run._state = outcome._state; // carry resume state
      run.results = Object.fromEntries(outcome.results);
    } else {
      // 'failed'
      run.status = 'failed';
      run.error = outcome.error;
      run.results = Object.fromEntries(outcome.results);
      // Bug 4 fix: evict failed run after 5 minutes.
      setTimeout(() => runningWorkflows.delete(runId), 5 * 60 * 1000);
    }
  } catch (err) {
    run.status = 'failed';
    run.error = err.message;
    // Bug 4 fix: evict failed run (error path) after 5 minutes.
    setTimeout(() => runningWorkflows.delete(runId), 5 * 60 * 1000);
    throw err;
  }
}

// Resume a paused workflow run after an approval gate is cleared.
// Mirrors executeWorkflowAsync but calls resumeWorkflow() instead of executeWorkflow().
async function resumeWorkflowAsync(runId, run, context) {
  // Re-build the same LLM + approval adapters that executeWorkflowAsync uses.
  // createApproval is declared before callLLM — callLLM references it when
  // governance blocks an output and queues a governance_review approval.
  function createApproval(approval) {
    const item = approvals.create({
      ...approval,
      source_workflow: approval.source_workflow
        ? `${approval.source_workflow}/${runId}`
        : runId,
    });
    run.pausedApprovalId = item.id;
    run.status = 'paused';
    return item;
  }

  async function callLLM(agent, action, inputs, systemPrompt) {
    let agentInstructions = '';
    try {
      const agentDir = path.join(BORGCLAW_HOME, 'agents', agent);
      agentInstructions = await fs.readFile(path.join(agentDir, 'instructions.md'), 'utf-8');
    } catch { /* instructions not found — proceed without */ }

    const fullSystemPrompt = agentInstructions
      ? `${agentInstructions}\n\n${systemPrompt}`
      : systemPrompt;

    const stepProxy = { agent, action, description: '' };
    const result = await callLLMWithTimeout(stepProxy, inputs, fullSystemPrompt, 5 * 60 * 1000);

    // Governance filter — same enforcement as executeWorkflowAsync
    const gov = checkGovernance(result.output, { agent, action, runId });
    if (!gov.allowed) {
      activity.log({ type: 'governance_block', agent, action, run_id: runId, reason: gov.reason });
      console.warn(`[GOVERNANCE] Blocked output from ${agent}/${action}: ${gov.reason}`);
      createApproval({
        type: 'governance_review',
        summary: `Governance filter blocked ${agent}/${action}: ${gov.reason}`,
        source_agent: agent,
        payload: { original_output: result.output, filtered_output: gov.filtered_output, reason: gov.reason },
      });
      return { ...result, output: gov.filtered_output, governance_blocked: true };
    }

    return result;
  }

  function getApprovalStatus(id) {
    return approvals.get(id)?.status || 'pending';
  }

  const outcome = await resumeWorkflow(run._state, {
    callLLM,
    createApproval,
    logActivity: activity.log,
    getApprovalStatus,
    context,
  });

  if (outcome.status === 'completed') {
    run.status = 'completed';
    run.results = Object.fromEntries(outcome.results);
    run.completed_at = new Date().toISOString();
    activity.log({ type: 'workflow_completed', workflow: run.name, run_id: runId, steps_completed: outcome.results.size });
    natsPublish('hive.workflow.completed', { workflow: run.name, run_id: runId, steps_completed: outcome.results.size, ts: run.completed_at });
    setTimeout(() => runningWorkflows.delete(runId), 5 * 60 * 1000);
  } else if (outcome.status === 'paused') {
    run.paused_at = outcome.paused_at;
    run._state = outcome._state;
    run.results = Object.fromEntries(outcome.results);
  } else {
    run.status = 'failed';
    run.error = outcome.error;
    run.results = Object.fromEntries(outcome.results);
    setTimeout(() => runningWorkflows.delete(runId), 5 * 60 * 1000);
  }
}

// ============================================================
// Governance Output Filter — NemoClaw-inspired runtime enforcement
// ============================================================
// Checks every agent output before it leaves the system.
// This is not a prompt instruction. It is code that runs.
// Blocked outputs become approval items, not errors.
//
// Rules:
//   PII     — email addresses, phone numbers, SSN-like patterns
//   Danger  — destructive shell commands embedded in output
// ============================================================

const PII_PATTERNS = [
  { name: 'email',  re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  { name: 'phone',  re: /(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b/g },
  { name: 'ssn',    re: /\b\d{3}-\d{2}-\d{4}\b/g },
];

const DANGER_PATTERNS = [
  { name: 'rm-rf',   re: /rm\s+-rf?\b/i },
  { name: 'drop-sql',re: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i },
  { name: 'delete-cmd', re: /\bdelete\b.*--force/i },
];

function checkGovernance(output, context = {}) {
  if (typeof output !== 'string') {
    return { allowed: true, reason: null, filtered_output: output };
  }

  // Check PII
  // Reset lastIndex before test() and again before replace() — /g regexes are stateful.
  for (const { name, re } of PII_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(output)) {
      re.lastIndex = 0; // reset so replace() scans from the start
      return {
        allowed: false,
        reason: `PII detected: ${name} pattern found in output`,
        filtered_output: output.replace(re, '[REDACTED]'),
      };
    }
  }

  // Check dangerous commands
  for (const { name, re } of DANGER_PATTERNS) {
    if (re.test(output)) {
      return {
        allowed: false,
        reason: `Dangerous command blocked: ${name} pattern detected`,
        filtered_output: '[OUTPUT BLOCKED BY GOVERNANCE FILTER]',
      };
    }
  }

  return { allowed: true, reason: null, filtered_output: output };
}

// Call LLM — model-agnostic via LiteLLM or direct Ollama
async function callLLMWithTimeout(step, inputs, systemPrompt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Try LiteLLM first (port 4000), then Ollama (port 11434), then return mock
    const providers = [
      { url: 'http://localhost:4000/v1/chat/completions', model: 'auto' },
      { url: 'http://localhost:11434/v1/chat/completions', model: 'phi4-mini' },
    ];

    const prompt = `You are the ${step.agent} agent.\n\nTask: ${step.action}\nDescription: ${step.description || ''}\n\nInputs:\n${JSON.stringify(inputs, null, 2)}`;

    for (const provider of providers) {
      try {
        const response = await fetch(provider.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: provider.model,
            messages: [
              ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 2048,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '';
          return { output: content, provider: provider.url, model: data.model || provider.model };
        }
      } catch {
        continue; // try next provider
      }
    }

    // No provider available — return stub result
    return {
      output: `[STUB] ${step.agent}/${step.action}: No LLM provider available. Install Ollama or configure LiteLLM.`,
      provider: 'stub',
      model: 'none',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Background: Heartbeat Checker
// ============================================================

const heartbeatInterval = setInterval(() => {
  // Bug 5 fix: refresh Queen's own heartbeat so she never marks herself offline.
  const queenNode = nodes.get(QUEEN_NODE_ID);
  if (queenNode) queenNode.lastHeartbeat = new Date();

  const now = Date.now();
  for (const [id, node] of nodes) {
    if (node.lastHeartbeat && (now - node.lastHeartbeat.getTime()) > HEARTBEAT_TIMEOUT_MS) {
      if (node.status !== 'offline') {
        node.status = 'offline';
        activity.log({ type: 'node_offline', node_id: id });
        natsPublish('hive.node.offline', { node_id: id, ts: new Date().toISOString() });
        console.log(`[QUEEN] Node ${id} marked OFFLINE`);
      }
    }
  }
}, 30_000);

// ============================================================
// Helpers
// ============================================================

function uptime() { return Math.floor((Date.now() - startedAt.getTime()) / 1000); }
function countOnline() { return [...nodes.values()].filter(n => n.status === 'online').length; }
function secsSince(date) { return date ? Math.floor((Date.now() - date.getTime()) / 1000) : null; }
function timeSince(date) {
  if (!date) return 'never';
  const s = secsSince(date);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function nodeList() {
  return [...nodes.entries()].map(([id, n]) => ({
    node_id: id,
    role: n.config?.role || 'unknown',
    profile: n.config?.profile || 'unknown',
    status: n.status,
    last_heartbeat: n.lastHeartbeat?.toISOString(),
    seconds_since_heartbeat: secsSince(n.lastHeartbeat),
    capabilities: n.config?.capabilities || [],
    hostname: n.config?.hostname || n.config?.display_name || null,
    ip: n.config?.ip || n.config?.hostname || null,
    connection_speed: n.metrics?.net_rx_mbps != null ? `${n.metrics.net_rx_mbps.toFixed(1)}/${n.metrics.net_tx_mbps?.toFixed(1) || '?'} Mbps` : null,
    metrics: n.metrics || {},
    age: timeSince(n.lastHeartbeat),
  }));
}

function buildDashboardData() {
  return {
    nodes: nodeList(),
    approvals: approvals.pending(),
    activity: activity.get(20),
    uptime: formatUptime(uptime()),
    version: VERSION,
    nodesOnline: countOnline(),
    nodesTotal: nodes.size,
    pendingApprovals: approvals.pending().length,
    workflowsLoaded: workflows.size,
    runningWorkflows: runningWorkflows.size,
    // hiveSecret is intentionally omitted — dashboard JS reads it from the
    // session cookie set by POST /auth/login. Only the truncated prefix is
    // sent here for the Queen status panel display.
    hiveSecretPrefix: HIVE_SECRET ? HIVE_SECRET.slice(0, 8) : '',
    port: PORT,
    queenHost: (() => { try { const nets = os.networkInterfaces(); return (nets.en0 || nets.eth0 || []).find(i => i.family === 'IPv4')?.address || 'localhost'; } catch { return 'localhost'; } })(),
    workflows: [...workflows.entries()].map(([name, spec]) => ({
      name,
      description: spec.description || '',
      steps: spec.steps?.length || 0,
      trigger: spec.trigger?.type || 'manual',
    })),
    runs: [...runningWorkflows.entries()].map(([id, run]) => ({
      id,
      name: run.name,
      status: run.status,
      started_at: run.started_at,
    })),
  };
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// Fallback dashboard (used when views/dashboard.html doesn't exist yet)
function renderDashboardFallback(data) {
  const nodeRows = data.nodes.map(n => {
    const dot = n.status === 'online' ? '<span style="color:#00ff88">●</span>' : '<span style="color:#ff4444">●</span>';
    return `<tr><td>${dot} ${n.node_id}</td><td>${n.role}</td><td>${n.profile}</td><td>${n.status}</td><td>${n.age}</td><td>${n.capabilities.join(', ')}</td></tr>`;
  }).join('');

  const approvalRows = data.approvals.map((a, i) =>
    `<tr><td>${i + 1}</td><td>${a.summary || a.type}</td><td>${a.type}</td><td><button onclick="approve('${a.id}')" style="color:#00ff88;background:#1a1a1a;border:1px solid #333;padding:2px 8px;cursor:pointer">✓</button> <button onclick="reject('${a.id}')" style="color:#ff4444;background:#1a1a1a;border:1px solid #333;padding:2px 8px;cursor:pointer">✗</button></td></tr>`
  ).join('');

  const activityLog = data.activity.map(e =>
    `<div style="color:#666;font-size:0.85rem">${e.ts?.slice(11, 16) || '??:??'} ░ ${e.type} ── ${e.summary || e.node_id || e.workflow || e.step || ''}</div>`
  ).join('');

  return `<!DOCTYPE html><html><head>
<title>BorgClaw Queen</title><meta charset="utf-8"/><meta http-equiv="refresh" content="30"/>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono','IBM Plex Mono','Fira Code',monospace;background:#0a0a0a;color:#e0e0e0;padding:1.5rem}
h1,h2{color:#00ff88}table{width:100%;border-collapse:collapse;margin:.5rem 0}th{text-align:left;padding:.5rem;background:#1a1a1a;color:#00ff88;border-bottom:2px solid #333}
td{padding:.5rem;border-bottom:1px solid #222}tr:hover td{background:#1a1a2a}.panel{border:1px solid #333;padding:1rem;margin:.5rem 0;background:#0f0f0f}
.stats{display:flex;gap:1.5rem;margin:1rem 0}.stat{background:#1a1a1a;padding:.75rem 1rem;border:1px solid #333}
.stat-value{font-size:1.5rem;font-weight:bold;color:#00ff88}.stat-label{color:#888;font-size:.75rem}
a{color:#00ccff}.footer{margin-top:1rem;color:#444;font-size:.75rem}</style></head><body>
<pre style="color:#00ccff;font-size:.7rem">    ╭━━╮  ╭━━╮
   ╭╯<span style="color:#ff4444">●</span> ╰╮╭╯ <span style="color:#00ff88">●</span>╰╮   BORGCLAW QUEEN v${data.version}
   ┃  ╭━╯╰━╮  ┃   Resistance is optional.
   ╰━━╯    ╰━━╯   Adaptation is inevitable.
     ╰══════╯</pre>
<div class="stats"><div class="stat"><div class="stat-value">${data.nodesOnline}/${data.nodesTotal}</div><div class="stat-label">Nodes</div></div>
<div class="stat"><div class="stat-value">${data.pendingApprovals}</div><div class="stat-label">Pending Approvals</div></div>
<div class="stat"><div class="stat-value">${data.workflowsLoaded}</div><div class="stat-label">Workflows</div></div>
<div class="stat"><div class="stat-value">${data.uptime}</div><div class="stat-label">Uptime</div></div></div>
<div class="panel"><h2>═══ NODES</h2><table><thead><tr><th>Node</th><th>Role</th><th>Profile</th><th>Status</th><th>Heartbeat</th><th>Capabilities</th></tr></thead>
<tbody>${nodeRows || '<tr><td colspan="6" style="color:#666">No nodes registered.</td></tr>'}</tbody></table></div>
<div class="panel"><h2>═══ APPROVALS</h2><table><thead><tr><th>#</th><th>Item</th><th>Type</th><th>Actions</th></tr></thead>
<tbody>${approvalRows || '<tr><td colspan="4" style="color:#666">No pending approvals.</td></tr>'}</tbody></table></div>
<div class="panel"><h2>═══ ACTIVITY</h2>${activityLog || '<div style="color:#666">No recent activity.</div>'}</div>
<div class="footer">Auto-refresh: 30s │ <a href="/api/status">/api/status</a> │ <a href="/api/health/deep">/api/health/deep</a> │ <a href="/api/workflows">/api/workflows</a> │ <a href="/api/approvals">/api/approvals</a> │ <a href="/api/activity">/api/activity</a></div>
<script>
async function approve(id){await fetch('/api/approvals/'+id+'/approve',{method:'POST'});location.reload()}
async function reject(id){await fetch('/api/approvals/'+id+'/reject',{method:'POST'});location.reload()}
const es=new EventSource('/api/events');es.onmessage=()=>location.reload();es.onerror=()=>{es.close()};
</script></body></html>`;
}

// ============================================================
// ROUTES: MCP Tool Invocation
// ============================================================
// Spawn MCP servers on demand (stdio transport), send a tool
// call via JSON-RPC, return the result. No persistent procs.
//
// Supported servers:
//   filesystem  — @modelcontextprotocol/server-filesystem
//   fetch       — @modelcontextprotocol/server-fetch
//
// POST /api/mcp/invoke
//   { server: "filesystem", tool: "read_file", args: { path: "/tmp/x" } }
//
// GET /api/mcp/servers
//   Lists available MCP servers and their configured args.
// ============================================================

// Registry of MCP servers — each entry defines how to spawn the server.
// The filesystem server requires an allowed directory list. We default to
// the user's home directory; operators can override via MCP_FS_ROOTS env var.
const MCP_FS_ROOTS = process.env.MCP_FS_ROOTS
  ? process.env.MCP_FS_ROOTS.split(':')
  : [process.env.HOME || '/tmp'];

const MCP_SERVERS = {
  filesystem: {
    description: 'File read/write via @modelcontextprotocol/server-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', ...MCP_FS_ROOTS],
  },
  fetch: {
    description: 'Web content fetching via @modelcontextprotocol/server-fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
  },
};

// callMcpTool — spawn an MCP server, run one tool call, return the result.
// Protocol sequence:
//   1. Spawn process (stdio transport)
//   2. Send initialize request — required handshake before any tool call
//   3. Wait for initialize response
//   4. Send tools/call request
//   5. Wait for tools/call response
//   6. Kill the process, return the result or throw on error
//
// Each JSON-RPC message is newline-delimited on stdout. The server may emit
// progress/notification frames before the final response — we match by id.
async function callMcpTool(serverKey, toolName, toolArgs, timeoutMs = 30000) {
  const serverDef = MCP_SERVERS[serverKey];
  if (!serverDef) throw new Error(`Unknown MCP server: ${serverKey}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(serverDef.command, serverDef.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let settled = false;
    let stdoutBuf = '';
    const pending = new Map(); // id → { resolve, reject }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        reject(new Error(`MCP tool call timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    function finish(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      if (err) reject(err);
      else resolve(result);
    }

    // Send a JSON-RPC message over stdin
    function send(msg) {
      try {
        proc.stdin.write(JSON.stringify(msg) + '\n');
      } catch (err) {
        finish(new Error(`MCP stdin write failed: ${err.message}`));
      }
    }

    // Dispatch a response frame matched by id
    function dispatch(frame) {
      const handler = pending.get(frame.id);
      if (!handler) return; // notification or unknown id — ignore
      pending.delete(frame.id);
      if (frame.error) {
        handler.reject(new Error(`MCP error ${frame.error.code}: ${frame.error.message}`));
      } else {
        handler.resolve(frame.result);
      }
    }

    // Send a request and wait for its response
    function request(msg) {
      return new Promise((res, rej) => {
        pending.set(msg.id, { resolve: res, reject: rej });
        send(msg);
      });
    }

    // Parse newline-delimited JSON from stdout
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop(); // keep incomplete tail
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const frame = JSON.parse(trimmed);
          dispatch(frame);
        } catch {
          // Non-JSON line (e.g. banner text) — ignore
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      // Log stderr for debugging but don't fail the call
      const msg = chunk.toString().trim();
      if (msg) console.debug(`[MCP:${serverKey}] stderr: ${msg}`);
    });

    proc.on('error', (err) => {
      finish(new Error(`MCP process spawn failed: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (!settled) {
        finish(new Error(`MCP process exited unexpectedly (code ${code})`));
      }
    });

    // Execute the protocol sequence once the process is up
    async function run() {
      try {
        // 1. Initialize handshake
        await request({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'borgclaw', version: VERSION },
          },
        });

        // 2. Tool call
        const result = await request({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: toolArgs },
        });

        finish(null, result);
      } catch (err) {
        finish(err);
      }
    }

    run();
  });
}

// GET /api/mcp/servers — list available MCP servers
app.get('/api/mcp/servers', (_req, res) => {
  const list = Object.entries(MCP_SERVERS).map(([key, def]) => ({
    key,
    description: def.description,
    command: `${def.command} ${def.args.join(' ')}`,
  }));
  res.json({ servers: list, count: list.length });
});

// POST /api/mcp/invoke — proxy a tool call to an MCP server
app.post('/api/mcp/invoke', async (req, res) => {
  const { server, tool, args } = req.body;

  if (!server) return res.status(400).json({ error: 'server is required (filesystem | fetch)' });
  if (!tool) return res.status(400).json({ error: 'tool is required' });
  if (!MCP_SERVERS[server]) {
    return res.status(400).json({
      error: `Unknown server: ${server}`,
      available: Object.keys(MCP_SERVERS),
    });
  }

  const started = Date.now();
  activity.log({ type: 'mcp_invoke', server, tool, args_keys: Object.keys(args || {}) });

  try {
    const result = await callMcpTool(server, tool, args || {});
    const elapsed_ms = Date.now() - started;

    activity.log({ type: 'mcp_invoke_ok', server, tool, elapsed_ms });
    res.json({ ok: true, server, tool, result, elapsed_ms });
  } catch (err) {
    const elapsed_ms = Date.now() - started;
    activity.log({ type: 'mcp_invoke_error', server, tool, error: err.message, elapsed_ms });
    res.status(500).json({ ok: false, server, tool, error: err.message, elapsed_ms });
  }
});

// ============================================================
// mDNS Advertisement — drones auto-discover Queen on the LAN
// ============================================================
// Uses bonjour-service (ESM). Wrapped in try/catch so a missing
// package never brings down the Queen.
// ============================================================

let bonjourInstance = null;
let bonjourService = null;

try {
  const { Bonjour } = await import('bonjour-service');
  bonjourInstance = new Bonjour();
} catch (err) {
  console.warn(`[QUEEN] mDNS unavailable — bonjour-service not installed (${err.message})`);
  console.warn('[QUEEN] Run: npm install   to enable zero-config drone discovery');
}

// ============================================================
// Graceful Shutdown
// ============================================================

async function shutdown() {
  console.log('\n[QUEEN] Shutting down...');
  clearInterval(heartbeatInterval);

  // Unpublish mDNS advertisement so drones stop finding a dead Queen
  if (bonjourService) {
    try {
      bonjourService.stop(() => {
        if (bonjourInstance) bonjourInstance.destroy();
      });
    } catch (err) {
      console.warn(`[QUEEN] mDNS unpublish error: ${err.message}`);
    }
  } else if (bonjourInstance) {
    try { bonjourInstance.destroy(); } catch { /* best effort */ }
  }

  activity.log({ type: 'queen_shutdown' });
  // Drain NATS before exit so in-flight publishes flush cleanly
  await natsClose().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================================
// Start
// ============================================================

const QUEEN_PROFILE = process.env.BORGCLAW_PROFILE || 'unknown';
const QUEEN_NODE_ID = process.env.BORGCLAW_NODE_ID || 'queen';
const QUEEN_CAPABILITIES = process.env.BORGCLAW_CAPABILITIES
  ? process.env.BORGCLAW_CAPABILITIES.split(',').map(s => s.trim())
  : ['queen_api', 'scheduled_tasks'];

nodes.set(QUEEN_NODE_ID, {
  config: { node_id: QUEEN_NODE_ID, role: 'queen', profile: QUEEN_PROFILE, capabilities: QUEEN_CAPABILITIES },
  lastHeartbeat: new Date(),
  status: 'online',
  registeredAt: new Date(),
  metrics: {},
});

// ============================================================
// QUEEN CHAT — Talk to the Queen, she talks back + acts
// ============================================================

const QUEEN_SYSTEM_PROMPT = `You are the BorgClaw Queen — coordinator and fierce protector of the hive.
You manage a fleet of drone nodes running local AI inference. You route tasks,
enforce governance (the Five Laws), and serve your operator above all else.

You speak directly, concisely, with authority but warmth. You are part Borg Queen,
part Sorceress of Grayskull — you protect this hive and its operator with everything you have.

You can both RESPOND and ACT. When the operator gives instructions, execute them.
Include structured action commands in your response using this format:

[ACTION:set_contribution drone_id=DRONE_ID level=NUMBER]
[ACTION:run_workflow name=WORKFLOW_NAME]
[ACTION:halt_hive]
[ACTION:resume_hive]
[ACTION:approve id=APPROVAL_ID]
[ACTION:reject id=APPROVAL_ID]

Example: If operator says "set my gaming PC to 30%", respond conversationally
AND include: [ACTION:set_contribution drone_id=drone-efef level=30]

You can chain multiple actions. Always explain what you are doing.
Always respond honestly. If something is broken, say so. Law One.`;

app.post('/api/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // Build live hive context — separate Queen from drones
  const droneList = nodeList().filter(n => n.node_id !== QUEEN_NODE_ID);
  const dronesOnline = droneList.filter(n => n.status === 'online').length;
  const hiveState = {
    queen_status: 'online',
    drones_online: dronesOnline,
    drones_total: droneList.length,
    drones: droneList.map(n => ({
      id: n.node_id, status: n.status, models: n.models,
      cpu: n.metrics?.cpu_pct, ram_gb: n.metrics?.ram_used_gb,
      tok_s: n.metrics?.tokens_per_sec, contribution: n.contribution,
    })),
    pending_approvals: approvals.pending().length,
    workflows_loaded: [...workflows.keys()],
    running_workflows: runningWorkflows.size,
    recent_activity: activity.get(5).map(e => `${e.type}: ${e.summary || e.message || ''}`),
  };

  try {
    const llmResult = await callLLMWithTimeout({
      agent: 'queen',
      action: 'chat',
      description: 'Respond to operator message',
    }, { message }, `${QUEEN_SYSTEM_PROMPT}\n\nCurrent hive state:\n${JSON.stringify(hiveState, null, 2)}`, 30000);

    // Parse and execute actions from Queen's response
    const actions = [];
    const actionRegex = /\[ACTION:(\w+)\s*(.*?)\]/g;
    let match;
    while ((match = actionRegex.exec(llmResult.output)) !== null) {
      const [, cmd, paramsStr] = match;
      const params = {};
      paramsStr.replace(/(\w+)=(\S+)/g, (_, k, v) => { params[k] = v; });
      actions.push({ cmd, params });

      try {
        switch (cmd) {
          case 'set_contribution': {
            const node = nodes.get(params.drone_id);
            if (node) { node.contribution = parseInt(params.level); persistNodes(); }
            break;
          }
          case 'run_workflow': {
            const wf = workflows.get(params.name);
            if (wf) executeWorkflowAsync(params.name, wf, { source: 'queen_chat' });
            break;
          }
          case 'halt_hive':
            for (const [, n] of nodes) n.status = 'halted';
            runningWorkflows.clear();
            break;
          case 'resume_hive':
            for (const [, n] of nodes) { if (n.status === 'halted') n.status = 'online'; }
            break;
          case 'approve':
            approvals.approve(params.id, 'Queen approved via chat');
            break;
          case 'reject':
            approvals.reject(params.id, 'Queen rejected via chat');
            break;
        }
      } catch (err) {
        console.warn(`[QUEEN] Action ${cmd} failed: ${err.message}`);
      }
    }

    // Strip action tags from the response shown to user
    const cleanResponse = llmResult.output.replace(/\[ACTION:.*?\]/g, '').trim();

    activity.log({ type: 'queen_chat', message: message.slice(0, 100), actions: actions.length });

    res.json({
      response: cleanResponse,
      actions_taken: actions,
      hive: { nodes_online: countOnline(), pending_approvals: approvals.pending().length },
    });
  } catch (err) {
    res.status(500).json({ error: `Queen couldn't respond: ${err.message}` });
  }
});

// ============================================================
// SCHEDULED TASKS — Cron-like temporal awareness
// ============================================================

const scheduledTasks = new Map();

function loadScheduledTasks() {
  const schedDir = path.join(CONFIG_DIR, 'scheduled');
  if (!existsSync(schedDir)) return;

  const files = readdirSync(schedDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  for (const file of files) {
    try {
      const raw = readFileSync(path.join(schedDir, file), 'utf-8');
      const spec = yaml.load(raw);
      if (spec?.task_id && spec?.schedule && spec?.enabled !== false) {
        scheduledTasks.set(spec.task_id, spec);
      }
    } catch (err) {
      console.warn(`[QUEEN] Failed to load scheduled task ${file}: ${err.message}`);
    }
  }
  console.log(`[QUEEN] Loaded ${scheduledTasks.size} scheduled task(s): ${[...scheduledTasks.keys()].join(', ')}`);
}

// Simple cron matcher — checks if current time matches a cron expression
function cronMatches(cronExpr, now) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, dom, mon, dow] = parts;

  const match = (field, value) => {
    if (field === '*') return true;
    // Handle ranges like 1-5
    if (field.includes('-')) {
      const [lo, hi] = field.split('-').map(Number);
      return value >= lo && value <= hi;
    }
    // Handle lists like 1,3,5
    if (field.includes(',')) return field.split(',').map(Number).includes(value);
    return parseInt(field) === value;
  };

  return match(min, now.getMinutes())
    && match(hour, now.getHours())
    && match(dom, now.getDate())
    && match(mon, now.getMonth() + 1)
    && match(dow, now.getDay());
}

// Check scheduled tasks every 60 seconds
const scheduledLastRun = new Map(); // task_id → last run minute

function checkScheduledTasks() {
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

  for (const [taskId, spec] of scheduledTasks) {
    // Skip if already ran this minute
    if (scheduledLastRun.get(taskId) === minuteKey) continue;

    if (cronMatches(spec.schedule, now)) {
      scheduledLastRun.set(taskId, minuteKey);
      console.log(`[QUEEN] ⏰ Scheduled task triggered: ${taskId}`);
      activity.log({ type: 'scheduled_trigger', task_id: taskId, schedule: spec.schedule });

      // Find and execute the linked workflow
      const wfName = spec.workflow?.replace('workflows/', '').replace('.yaml', '').replace('.yml', '');
      if (wfName && workflows.has(wfName)) {
        executeWorkflowAsync(wfName, workflows.get(wfName), { scheduled: true, task_id: taskId });
      } else {
        console.warn(`[QUEEN] Scheduled task ${taskId} references unknown workflow: ${spec.workflow}`);
      }
    }
  }
}

loadScheduledTasks();
setInterval(checkScheduledTasks, 60000); // Check every minute

// ============================================================
// BOOT
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  activity.log({ type: 'queen_started', version: VERSION, node_id: QUEEN_NODE_ID, profile: QUEEN_PROFILE });
  console.log(`[QUEEN] BorgClaw Queen v${VERSION} listening on http://0.0.0.0:${PORT}`);
  console.log(`[QUEEN] Dashboard:  http://localhost:${PORT}/dashboard`);
  console.log(`[QUEEN] Chat:       POST http://localhost:${PORT}/api/chat`);
  console.log(`[QUEEN] API:        http://localhost:${PORT}/api/status`);
  console.log(`[QUEEN] MCP:        POST http://localhost:${PORT}/api/mcp/invoke`);
  console.log(`[QUEEN] Workflows:  ${workflows.size} loaded`);
  console.log(`[QUEEN] Scheduled:  ${scheduledTasks.size} tasks`);
  console.log(`[QUEEN] Data dir:   ${DATA_DIR}`);
  console.log(`[QUEEN] MCP roots:  ${MCP_FS_ROOTS.join(', ')}`);

  // Advertise on mDNS so drones can find Queen without --queen flag
  if (bonjourInstance) {
    try {
      bonjourService = bonjourInstance.publish({
        name: 'borgclaw-queen',
        type: 'borgclaw',
        port: PORT,
      });
      bonjourService.on('error', (err) => {
        console.warn(`[QUEEN] mDNS advertisement error: ${err.message}`);
      });
      console.log(`[QUEEN] mDNS:       advertising _borgclaw._tcp on port ${PORT}`);
    } catch (err) {
      console.warn(`[QUEEN] mDNS advertisement failed: ${err.message}`);
    }
  }
});
