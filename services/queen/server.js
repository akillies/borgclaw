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
import fs from 'fs/promises';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

// --- Lib modules ---
import * as activity from './lib/activity.js';
import * as approvals from './lib/approvals.js';
import { deepHealthCheck } from './lib/health.js';
import * as setup from './lib/setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PORT = parseInt(process.env.QUEEN_PORT || '9090', 10);
const BORGCLAW_HOME = process.env.BORGCLAW_HOME || path.join(process.env.HOME || '', 'borgclaw');
const CONFIG_DIR = path.join(BORGCLAW_HOME, 'config');
const DATA_DIR = path.join(BORGCLAW_HOME, 'data');
const HEARTBEAT_TIMEOUT_MS = 150_000; // 2.5 min

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

// --- Initialize modules ---
activity.initActivity(DATA_DIR);
approvals.initApprovals(DATA_DIR);

// --- State ---
const nodes = new Map();
const startedAt = new Date();
const VERSION = '0.2.0';

// --- Workflow state ---
let workflows = new Map();
const runningWorkflows = new Map(); // workflow runs in progress

// Load workflows on startup
try {
  const wfDir = path.join(CONFIG_DIR, 'workflows');
  if (existsSync(wfDir)) {
    const files = require('fs').readdirSync(wfDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
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

// --- Express App ---
const app = express();
app.use(express.json());

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
  console.log(`[QUEEN] Node registered: ${node_id} (${config?.role || 'unknown'})`);
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

  // If this approval is blocking a workflow, resume it
  const workflowId = item.source_workflow;
  if (workflowId && runningWorkflows.has(workflowId)) {
    const run = runningWorkflows.get(workflowId);
    if (run.pausedApprovalId === req.params.id) {
      activity.log({ type: 'workflow_resumed', workflow: workflowId, approval_id: req.params.id });
      // Resume will be handled by the workflow executor polling for approval status
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

  // Track the run
  runningWorkflows.set(runId, { name, status: 'running', started_at: new Date().toISOString(), results: {} });

  // Execute asynchronously — don't block the response
  executeWorkflowAsync(runId, spec, context).catch(err => {
    activity.log({ type: 'workflow_error', workflow: name, run_id: runId, error: err.message });
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
// Workflow Execution Engine
// ============================================================

async function executeWorkflowAsync(runId, spec, context) {
  const run = runningWorkflows.get(runId);
  const results = {};
  const completed = new Set();

  // Build dependency graph
  const steps = spec.steps || [];
  const stepMap = new Map(steps.map(s => [s.id, s]));

  // Topological execution
  let iterations = 0;
  const MAX_ITERATIONS = steps.length * 2; // safety valve

  while (completed.size < steps.length && iterations < MAX_ITERATIONS) {
    iterations++;

    // Find steps whose dependencies are all met
    const ready = steps.filter(s =>
      !completed.has(s.id) &&
      (s.depends_on || []).every(dep => completed.has(dep))
    );

    if (ready.length === 0 && completed.size < steps.length) {
      // Check if we're paused on approval
      const paused = steps.find(s => !completed.has(s.id) && results[s.id]?.approval_id);
      if (paused) {
        const approvalId = results[paused.id].approval_id;
        const approval = approvals.get(approvalId);
        if (approval?.status === 'approved') {
          completed.add(paused.id);
          activity.log({ type: 'workflow_step_approved', workflow: spec.name, step: paused.id });
          continue;
        } else if (approval?.status === 'rejected') {
          run.status = 'rejected';
          activity.log({ type: 'workflow_rejected', workflow: spec.name, step: paused.id });
          return;
        }
        // Still pending — wait and check again
        await sleep(2000);
        continue;
      }
      // Deadlock — circular dependency or unresolvable
      run.status = 'failed';
      activity.log({ type: 'workflow_deadlock', workflow: spec.name, completed: [...completed] });
      return;
    }

    // Execute ready steps (in parallel)
    const executions = ready.map(async (step) => {
      activity.log({ type: 'workflow_step_start', workflow: spec.name, step: step.id, agent: step.agent });

      try {
        // Resolve template variables in inputs
        const inputs = resolveTemplates(step.inputs || {}, results, context);

        // Load agent instructions
        let systemPrompt = '';
        try {
          const agentDir = path.join(BORGCLAW_HOME, 'agents', step.agent);
          systemPrompt = await fs.readFile(path.join(agentDir, 'instructions.md'), 'utf-8');
        } catch { /* agent instructions not found — proceed without */ }

        // Execute via LLM
        const timeout = parseTimeout(step.timeout);
        const result = await callLLMWithTimeout(step, inputs, systemPrompt, timeout);

        results[step.id] = result;

        // Check if approval is required
        if (step.requires_approval) {
          const approval = approvals.create({
            type: 'workflow_step',
            source_agent: step.agent,
            source_workflow: `${spec.name}/${runId}`,
            summary: `${spec.name} → ${step.id}: ${step.description || step.action}`,
            content: result,
          });
          results[step.id] = { ...result, approval_id: approval.id };
          run.pausedApprovalId = approval.id;
          run.status = 'paused';
          activity.log({ type: 'workflow_step_paused', workflow: spec.name, step: step.id, approval_id: approval.id });
          return; // Don't mark as completed yet
        }

        completed.add(step.id);
        activity.log({ type: 'workflow_step_complete', workflow: spec.name, step: step.id, agent: step.agent });
      } catch (err) {
        results[step.id] = { error: err.message };
        activity.log({ type: 'workflow_step_error', workflow: spec.name, step: step.id, error: err.message });
        // Don't fail the whole workflow — mark step as completed with error
        completed.add(step.id);
      }
    });

    await Promise.all(executions);
  }

  run.status = 'completed';
  run.results = results;
  run.completed_at = new Date().toISOString();
  activity.log({ type: 'workflow_completed', workflow: spec.name, run_id: runId, steps_completed: completed.size });
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
// Template Resolution
// ============================================================

function resolveTemplates(obj, results, context) {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
      const trimmed = expr.trim();
      // Check context first (today, today_formatted, etc.)
      if (context[trimmed] !== undefined) return context[trimmed];
      // Check step results (step_id.output_field)
      const parts = trimmed.split('.');
      if (parts.length >= 2) {
        const stepResult = results[parts[0]];
        if (stepResult) {
          const val = parts.slice(1).reduce((o, k) => o?.[k], stepResult);
          return typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
        }
      }
      return `{{${trimmed}}}`; // unresolve — leave as-is
    });
  }
  if (Array.isArray(obj)) return obj.map(item => resolveTemplates(item, results, context));
  if (obj && typeof obj === 'object') {
    const resolved = {};
    for (const [k, v] of Object.entries(obj)) resolved[k] = resolveTemplates(v, results, context);
    return resolved;
  }
  return obj;
}

// ============================================================
// Background: Heartbeat Checker
// ============================================================

const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, node] of nodes) {
    if (node.lastHeartbeat && (now - node.lastHeartbeat.getTime()) > HEARTBEAT_TIMEOUT_MS) {
      if (node.status !== 'offline') {
        node.status = 'offline';
        activity.log({ type: 'node_offline', node_id: id });
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseTimeout(str) {
  if (!str) return 120_000; // 2 min default
  const match = String(str).match(/^(\d+)\s*(m|min|s|sec|h|hr)?$/i);
  if (!match) return 120_000;
  const num = parseInt(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  if (unit.startsWith('s')) return num * 1000;
  if (unit.startsWith('h')) return num * 3600_000;
  return num * 60_000; // minutes
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
// Graceful Shutdown
// ============================================================

function shutdown() {
  console.log('\n[QUEEN] Shutting down...');
  clearInterval(heartbeatInterval);
  activity.log({ type: 'queen_shutdown' });
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

app.listen(PORT, '0.0.0.0', () => {
  activity.log({ type: 'queen_started', version: VERSION, node_id: QUEEN_NODE_ID, profile: QUEEN_PROFILE });
  console.log(`[QUEEN] BorgClaw Queen v${VERSION} listening on http://0.0.0.0:${PORT}`);
  console.log(`[QUEEN] Dashboard:  http://localhost:${PORT}/dashboard`);
  console.log(`[QUEEN] Setup:      http://localhost:${PORT}/setup`);
  console.log(`[QUEEN] API:        http://localhost:${PORT}/api/status`);
  console.log(`[QUEEN] Workflows:  ${workflows.size} loaded`);
  console.log(`[QUEEN] Data dir:   ${DATA_DIR}`);
});
