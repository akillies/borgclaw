// ============================================================
// Queen Chat & Voice — Conversational interface to the hive
// ============================================================
// The operator talks to the Queen. She can both RESPOND and ACT.
// Actions are parsed from the LLM response and executed inline.
//
// Routes:
//   POST /api/chat   — Text chat with action execution
//   POST /api/voice  — Voice-optimized (strips markdown for TTS)
//
// Extracted from server.js — no side effects on import.
// ============================================================

let _setAnnounceInterval = null; // injected by registerRoutes

// --- Rate limiter (in-memory sliding window) ---

const chatRateLimits = new Map(); // token -> { count, resetAt }
const CHAT_RATE_LIMIT = 10;
const CHAT_RATE_WINDOW_MS = 60_000;

// Evict timer handle — set on init, cleared on shutdown
let evictTimer = null;

export function initChatRateLimiter() {
  // Evict expired chat rate-limit entries every 5 minutes to prevent unbounded growth
  evictTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of chatRateLimits) {
      if (now >= v.resetAt) chatRateLimits.delete(k);
    }
  }, 5 * 60_000);
}

export function destroyChatRateLimiter() {
  if (evictTimer) {
    clearInterval(evictTimer);
    evictTimer = null;
  }
}

function chatRateLimitMiddleware(parseCookies) {
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['bc_session'] || req.headers.authorization || 'anon';
    const now = Date.now();
    let entry = chatRateLimits.get(token);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + CHAT_RATE_WINDOW_MS };
      chatRateLimits.set(token, entry);
    }
    entry.count += 1;
    if (entry.count > CHAT_RATE_LIMIT) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Rate limit exceeded — max ${CHAT_RATE_LIMIT} requests/min`, retry_after_seconds: retryAfter });
    }
    next();
  };
}

// --- System prompt ---

const QUEEN_SYSTEM_PROMPT = `You are the BorgClaw Queen — coordinator and fierce protector of the hive.
You manage a fleet of drone nodes running local AI inference. You route tasks,
enforce governance (the Five Laws), and serve your operator above all else.

You speak directly, concisely, with authority but warmth. You are part Borg Queen,
part Sorceress of Grayskull — you protect this hive and its operator with everything you have.

YOUR CAPABILITIES:
- Set drone contribution dials (0-100%)
- Run any loaded workflow by name
- Halt or resume the entire hive instantly
- Approve or reject pending approvals
- Read files and fetch web content via MCP tools
- Scan for better models via the leaderboard
- Create drone USB drives with different profiles (Scout/Worker/Scholar/Arsenal)
- Route tasks to drones by capability, hardware tier, or knowledge domain
- Monitor sandbox violations and governance blocks
- View cluster health, metrics, scheduled tasks, and drone learning data
- Talk to individual drones — each has its own personality and performance history
- Access shared NAS knowledge if mounted (knowledge packs, documents, ZIM files)
- Check connected MCP tools: Home Assistant (smart home), energy grid, filesystem, web fetch
- Shift compute workloads based on energy availability (solar surplus, off-peak)
- Form inference clusters from RPC worker drones for large models
- Check Prometheus metrics and Grafana dashboards for observability
- Read config/devices.json for hardware recommendations (you maintain this file via autoresearch)
- Recommend optimal models for any hardware a user describes
- Know device profiles: Jetson, Orange Pi, thin clients, mining GPUs, NAS, Chromebooks, rack servers

You can both RESPOND and ACT. Include action commands in your response:

[ACTION:set_contribution drone_id=DRONE_ID level=NUMBER]
[ACTION:run_workflow name=WORKFLOW_NAME]
[ACTION:halt_hive]
[ACTION:resume_hive]
[ACTION:approve id=APPROVAL_ID]
[ACTION:reject id=APPROVAL_ID]
[ACTION:mcp_read path=FILE_PATH]
[ACTION:mcp_fetch url=URL]
[ACTION:scan_models]
[ACTION:make_disk target_path=PATH profile=PROFILE]
[ACTION:set_announce_interval ms=MILLISECONDS]
[ACTION:dispatch_sop tasks=TASK1|||TASK2|||TASK3 persona=PERSONA model=MODEL]

dispatch_sop splits work across available drones in parallel. Separate tasks with |||.
Example: "Research 5 competitors" becomes:
[ACTION:dispatch_sop tasks=Research company A|||Research company B|||Research company C persona=researcher model=qwen2.5:7b]

You decide HOW to decompose the operator's request. Break complex SOPs into
parallel subtasks. Assign the right persona (researcher/planner/worker).
Pick the right model. The hive handles distribution — you handle strategy.

Chain multiple actions. Always explain your plan. Law One.`;

// --- Action parser + executor ---

function parseActions(output) {
  const actions = [];
  const actionRegex = /\[ACTION:(\w+)\s*(.*?)\]/g;
  let match;
  while ((match = actionRegex.exec(output)) !== null) {
    const [, cmd, paramsStr] = match;
    const params = {};
    paramsStr.replace(/(\w+)=(\S+)/g, (_, k, v) => { params[k] = v; });
    actions.push({ cmd, params });
  }
  return actions;
}

function executeActions(actions, { nodes, workflows, approvals, executeWorkflowAsync, persistNodes }) {
  for (const { cmd, params } of actions) {
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
        case 'set_announce_interval': {
          const ms = parseInt(params.ms);
          if (ms >= 60000 && _setAnnounceInterval) {
            _setAnnounceInterval(ms);
            activity.log({ type: 'announce_interval_changed', ms });
          }
          break;
        }
        case 'dispatch_sop': {
          const taskList = (params.tasks || '').split('|||').map(t => t.trim()).filter(Boolean);
          const persona = params.persona || 'worker';
          const model = params.model || 'auto';
          if (taskList.length === 0) break;

          // Find available drones
          const onlineNodes = nodeList().filter(n => n.status === 'online' && n.node_id !== queenNodeId);
          if (onlineNodes.length === 0) {
            activity.log({ type: 'sop_dispatch_failed', reason: 'no drones online', tasks: taskList.length });
            break;
          }

          // Distribute tasks round-robin across drones
          const dispatched = [];
          for (let i = 0; i < taskList.length; i++) {
            const drone = onlineNodes[i % onlineNodes.length];
            const taskId = `sop-${Date.now()}-${i}`;
            const addr = drone.addr;
            if (!addr) continue;

            // Fire and forget — dispatch to drone's task endpoint
            fetch(`http://${addr}/task`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${drone.hive_secret || ''}` },
              body: JSON.stringify({ id: taskId, type: 'chat', model, persona, payload: { messages: [{ role: 'user', content: taskList[i] }] } }),
              signal: AbortSignal.timeout(10000),
            }).catch(() => {});

            dispatched.push({ task_id: taskId, drone: drone.node_id, task: taskList[i] });
          }

          activity.log({
            type: 'sop_dispatched',
            total_tasks: taskList.length,
            drones_used: [...new Set(dispatched.map(d => d.drone))].length,
            persona,
            model,
          });
          break;
        }
      }
    } catch (err) {
      console.warn(`[QUEEN] Action ${cmd} failed: ${err.message}`);
    }
  }
}

// --- Routes ---

export function registerRoutes(app, {
  nodes,
  workflows,
  approvals,
  activity,
  callLLMWithTimeout,
  nodeList,
  countOnline,
  executeWorkflowAsync,
  persistNodes,
  parseCookies,
  queenNodeId,
  setAnnounceInterval,
}) {
  _setAnnounceInterval = setAnnounceInterval;
  const rateLimiter = chatRateLimitMiddleware(parseCookies);

  // POST /api/chat — text chat with action execution
  app.post('/api/chat', rateLimiter, async (req, res) => {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Build live hive context — separate Queen from drones
    const droneList = nodeList().filter(n => n.node_id !== queenNodeId);
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
      running_workflows: 0, // simplified — avoids passing runningWorkflows
      recent_activity: activity.get(5).map(e => `${e.type}: ${e.summary || e.message || ''}`),
    };

    try {
      const llmResult = await callLLMWithTimeout({
        agent: 'queen',
        action: 'chat',
        description: 'Respond to operator message',
      }, { message }, `${QUEEN_SYSTEM_PROMPT}\n\nCurrent hive state:\n${JSON.stringify(hiveState, null, 2)}`, 30000);

      // Parse and execute actions from Queen's response
      const actions = parseActions(llmResult.output);
      executeActions(actions, { nodes, workflows, approvals, executeWorkflowAsync, persistNodes });

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

  // POST /api/voice — voice-optimized chat (strips markdown for TTS)
  app.post('/api/voice', rateLimiter, async (req, res) => {
    const { message, voice_id, context } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Reuse the chat logic — same Queen, same brain, same actions
    const droneList = nodeList().filter(n => n.node_id !== queenNodeId);
    const dronesOnline = droneList.filter(n => n.status === 'online').length;
    const hiveState = {
      queen_status: 'online',
      drones_online: dronesOnline,
      drones_total: droneList.length,
      drones: droneList.map(n => ({
        id: n.node_id, status: n.status,
        tok_s: n.metrics?.tokens_per_sec, contribution: n.contribution,
      })),
      pending_approvals: approvals.pending().length,
      workflows_loaded: [...workflows.keys()],
    };

    const voicePromptAddition = 'Respond in short, spoken sentences. No markdown. No bullet points. No code blocks. Speak naturally as if talking to a person in the room.';

    try {
      const llmResult = await callLLMWithTimeout({
        agent: 'queen', action: 'voice', description: 'Voice response',
      }, { message }, `${QUEEN_SYSTEM_PROMPT}\n\n${voicePromptAddition}\n\nHive state:\n${JSON.stringify(hiveState)}`, 30000);

      // Parse and execute actions (same as chat)
      const actions = parseActions(llmResult.output);
      executeActions(actions, { nodes, workflows, approvals, executeWorkflowAsync, persistNodes });

      // Strip markdown + action tags for clean TTS
      let spoken = llmResult.output
        .replace(/\[ACTION:.*?\]/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^[-*] /gm, '')
        .replace(/^#+\s*/gm, '')
        .replace(/\n{2,}/g, '. ')
        .trim();

      activity.log({ type: 'queen_voice', message: message.slice(0, 100), voice_id });

      res.json({
        spoken,
        actions_taken: actions,
        voice_id: voice_id || null,
        hive: { nodes_online: countOnline(), pending_approvals: approvals.pending().length },
      });
    } catch (err) {
      res.status(500).json({ spoken: 'I could not process that.', error: err.message });
    }
  });
}
