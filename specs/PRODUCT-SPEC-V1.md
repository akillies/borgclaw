# BorgClaw v1.0 — Full Product Specification
## Every Wire Live. No Dead Ends.

**Date:** 2026-03-19 | **Status:** Spec
**Aesthetic:** Giger/Borg/Arcticpunk — biomechanical terminal UI, BBS-era, demoscene installer energy
**Rule:** If a touchpoint exists, it works end-to-end. If it can't work yet, it doesn't exist.

---

## THE AESTHETIC

```
┌─────────────────────────────────────────────────────────────────┐
│ VISUAL LANGUAGE                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Colors:  #00FF88 (borg green)  on  #0A0A0A (void black)      │
│           #00CCFF (arctic cyan)  for accents                    │
│           #FF4444 (alert red)    for warnings/critical          │
│           #EAAB00 (amber)       for caution                    │
│           #333333 (dark grey)   for borders/inactive            │
│                                                                 │
│  Typography: Monospace only. JetBrains Mono, IBM Plex Mono,    │
│              or system monospace. Nothing proportional. Ever.   │
│                                                                 │
│  Borders: Box-drawing characters (╔═╗║╚╝╠╣╬─│┌┐└┘├┤)          │
│           Double-line for primary frames                        │
│           Single-line for secondary/nested                      │
│                                                                 │
│  Progress: ████████░░░░░░ 58%  (block characters)              │
│                                                                 │
│  Status:  ● ONLINE   ● OFFLINE   ● DEGRADED   ● ASSIMILATING  │
│                                                                 │
│  Vibe:    BIOS setup screen meets HR Giger meets Arctic ice.   │
│           Clean. Cold. Mechanical. Alive underneath.            │
│           Like a keygen installer that actually runs a          │
│           distributed AI cluster.                               │
│                                                                 │
│  NO:      Gradients. Rounded corners. Sans-serif. Shadows.     │
│           Emojis. Material Design. Tailwind. Any framework      │
│           that makes it look like a SaaS dashboard.             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## END-TO-END FLOW MAP

Every numbered step below is a touchpoint. Every touchpoint must work.

```
USER INSTALLS BORGCLAW
  │
  ├── 1. git clone + ./borgclaw start
  │     └── Queen boots, serves dashboard + setup wizard
  │
  ├── 2. Browser: localhost:9090/setup (first-run wizard)
  │     ├── 2a. Hardware detection (auto)
  │     ├── 2b. Role selection (Queen/Worker/Satellite)
  │     ├── 2c. Dependency check + install
  │     ├── 2d. Model selection + pull (with progress bars)
  │     ├── 2e. Queen connection test (if Worker)
  │     ├── 2f. Health check summary
  │     └── 2g. "ASSIMILATION COMPLETE" confirmation
  │
  ├── 3. Dashboard: localhost:9090/dashboard
  │     ├── 3a. Node registry (live heartbeat status)
  │     ├── 3b. Service health (NATS, LiteLLM, Ollama, QMD)
  │     ├── 3c. Workflow execution monitor
  │     ├── 3d. Approval queue (pending drafts)
  │     └── 3e. Agent activity log
  │
  ├── 4. Worker joins from another machine
  │     ├── 4a. git clone + bash scripts/bootstrap.sh --queen-ip X
  │     │     OR
  │     ├── 4b. Browser: <queen-ip>:9090/setup (remote setup wizard)
  │     └── 4c. Node appears on Queen dashboard within 30s
  │
  ├── 5. Task execution (the actual product)
  │     ├── 5a. Task ingestion (API, CLI, or scheduled)
  │     ├── 5b. Jarvis classifies + routes
  │     ├── 5c. Agent executes (local model or cloud API)
  │     ├── 5d. Result → approval queue (if required)
  │     ├── 5e. Owner approves/rejects (dashboard or ntfy push)
  │     └── 5f. Delivery (email draft, file write, notification)
  │
  └── 6. ./borgclaw stop (clean shutdown)
```

---

## COMPONENT SPEC: THE SETUP WIZARD

### Route: `GET /setup`

Single-page HTML. No framework. Vanilla JS. Looks like a BIOS setup utility crossed with a demoscene installer.

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║    ╭━━╮  ╭━━╮                                                   ║
║   ╭╯● ╰╮╭╯ ●╰╮   B O R G C L A W                              ║
║   ┃  ╭━╯╰━╮  ┃   ASSIMILATION PROTOCOL v1.0                    ║
║   ╰━━╯    ╰━━╯                                                  ║
║     ╰══════╯     Resistance is optional. Adaptation is          ║
║                  inevitable.                                     ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  STEP 1 OF 7 ─── HARDWARE SCAN                                  ║
║  ═══════════════════════════════                                 ║
║                                                                  ║
║  Scanning biological and technological distinctiveness...        ║
║                                                                  ║
║  ┌────────────────────┬──────────────────────────────────┐      ║
║  │ OS                 │ macOS 15.3 (Darwin arm64)        │      ║
║  │ CPU                │ Apple M4 Pro                      │      ║
║  │ RAM                │ 24 GB unified                     │      ║
║  │ GPU                │ Apple Silicon (Metal/MLX ready)   │      ║
║  │ Disk Free          │ 487 GB                            │      ║
║  │ Node.js            │ v22.18.0 ✓                        │      ║
║  │ Python             │ 3.12.4 ✓                          │      ║
║  │ Git                │ 2.43.0 ✓                          │      ║
║  └────────────────────┴──────────────────────────────────┘      ║
║                                                                  ║
║  PROFILE ASSIGNED: mac-apple-silicon-24gb                        ║
║                                                                  ║
║  [ CONTINUE ]                          [ OVERRIDE PROFILE ]      ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  STEP 1/7       ║
╚══════════════════════════════════════════════════════════════════╝
```

### Setup Steps (all rendered in the same BBS frame):

**Step 1: Hardware Scan**
- Auto-runs detection on page load (calls `POST /api/setup/detect`)
- Displays specs in a table with ✓/✗ for each dependency
- Assigns hardware profile from models.json
- User confirms or overrides

**Step 2: Role Selection**
```
║  SELECT YOUR FUNCTION IN THE COLLECTIVE                          ║
║                                                                  ║
║  > [■] QUEEN ─── Primary orchestrator. Runs all services.       ║
║        Always-on. The hive mind.                                 ║
║                                                                  ║
║    [ ] WORKER ── Compute node. Local inference + tasks.          ║
║        Reports to Queen. Wakes on demand.                        ║
║                                                                  ║
║    [ ] SATELLITE ─ Search only. QMD indexing, no LLM.           ║
║        Minimal resources. Extends the hive's reach.              ║
```

**Step 3: Dependencies**
```
║  ASSIMILATING DEPENDENCIES                                       ║
║                                                                  ║
║  Ollama          ████████████████████████████████ INSTALLED       ║
║  QMD             ████████████████████████████████ INSTALLED       ║
║  Docker          ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ NOT FOUND       ║
║                  [Install] [Skip — Queen-only mode]              ║
║  NATS JetStream  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ REQUIRES DOCKER ║
║  LiteLLM         ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ REQUIRES DOCKER ║
║  ntfy            ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ REQUIRES DOCKER ║
```

**Step 4: Model Selection**
```
║  SELECT MODELS FOR PROFILE: mac-apple-silicon-24gb               ║
║                                                                  ║
║  [✓] phi4-mini         3.5 GB  Router — fast triage              ║
║  [✓] qwen3:8b          5.5 GB  General assistant                 ║
║  [✓] qwen2.5-coder:14b 9.5 GB  Code generation                  ║
║  [ ] gemma3:27b        18.0 GB  Deep synthesis (tight fit)       ║
║  [✓] nomic-embed-text   0.3 GB  Embeddings                       ║
║                                                                  ║
║  TOTAL: 18.8 GB / 24.0 GB available                             ║
║  ████████████████████████████████████░░░░░░░░░░ 78%              ║
║                                                                  ║
║  [ PULL SELECTED MODELS ]                                        ║
```

Model pull shows live progress:
```
║  PULLING: qwen3:8b                                               ║
║  ████████████████████░░░░░░░░░░░░░░░ 3.2 GB / 5.5 GB  58%      ║
║  Speed: 42 MB/s  ETA: 55s                                       ║
```

**Step 5: Queen Connection** (Workers only)
```
║  LOCATE THE QUEEN                                                ║
║                                                                  ║
║  Queen IP: [192.168.1.100    ]  Port: [9090]                    ║
║                                                                  ║
║  [ TEST CONNECTION ]                                             ║
║                                                                  ║
║  ● QUEEN FOUND — borgclaw-queen v0.1.0                          ║
║    Uptime: 4h 23m | Nodes: 2 online | Profile: mac-apple-24gb   ║
```

**Step 6: Knowledge Base**
```
║  KNOWLEDGE BASE INDEXING                                         ║
║                                                                  ║
║  QMD collections found:                                          ║
║  ┌─────────────────┬────────┬──────────────────────────┐        ║
║  │ Collection      │ Files  │ Status                   │        ║
║  │ knowledge-base  │ 138    │ ████████████████ INDEXED  │        ║
║  │ borgclaw-config │ 24     │ ████████████████ INDEXED  │        ║
║  └─────────────────┴────────┴──────────────────────────┘        ║
║                                                                  ║
║  Search test: "how does routing work"                            ║
║  ✓ 5 results returned in 42ms                                    ║
```

**Step 7: Assimilation Complete**
```
║                                                                  ║
║     ╭━━╮  ╭━━╮                                                  ║
║    ╭╯● ╰╮╭╯ ●╰╮                                                ║
║    ┃  ╭━╯╰━╮  ┃   A S S I M I L A T I O N                      ║
║    ╰━━╯    ╰━━╯                                                  ║
║      ╰══════╯     C O M P L E T E                               ║
║                                                                  ║
║  Node: my-mac-mini                                            ║
║  Role: QUEEN                                                     ║
║  Profile: mac-apple-silicon-24gb                                 ║
║  Models: phi4-mini, qwen3:8b, qwen2.5-coder:14b, nomic-embed   ║
║  Services: Queen ● NATS ● QMD ●                                ║
║                                                                  ║
║  Dashboard: http://localhost:9090/dashboard                      ║
║                                                                  ║
║  Welcome to the Collective.                                      ║
║                                                                  ║
║  [ OPEN DASHBOARD ]              [ VIEW LOGS ]                   ║
```

---

## COMPONENT SPEC: THE DASHBOARD

### Route: `GET /dashboard`

Single-page HTML. Same aesthetic. Auto-refreshes via SSE (Server-Sent Events) when NATS is available, falls back to 30s polling.

```
╔══════════════════════════════════════════════════════════════════╗
║  BORGCLAW QUEEN ─── HIVE STATUS                    v0.1.0      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  NODES ──────────────────────────────────────────────────────    ║
║  ┌──────────────────┬──────────┬────────────┬────────────────┐  ║
║  │ Node             │ Role     │ Status     │ Last Heartbeat │  ║
║  ├──────────────────┼──────────┼────────────┼────────────────┤  ║
║  │ ● my-mac-mini │ QUEEN    │ ONLINE     │ 4s ago         │  ║
║  │ ● ryzen-tower    │ WORKER   │ ONLINE     │ 12s ago        │  ║
║  │ ● old-macbook    │ SATELLITE│ OFFLINE    │ 4m ago         │  ║
║  └──────────────────┴──────────┴────────────┴────────────────┘  ║
║                                                                  ║
║  SERVICES ───────────────────────────────────────────────────    ║
║  Queen    ● ONLINE    Ollama  ● ONLINE    NATS   ○ NOT RUNNING  ║
║  QMD     ● ONLINE    LiteLLM ○ NOT RUNNING ntfy  ○ NOT RUNNING  ║
║                                                                  ║
║  APPROVALS ──────────────────────────────────────────────────    ║
║  ┌───┬──────────────────────────┬──────────┬─────────────────┐  ║
║  │ # │ Item                     │ Type     │ Action          │  ║
║  ├───┼──────────────────────────┼──────────┼─────────────────┤  ║
║  │ 1 │ Email draft: Key Contact  │ email    │ [✓] [✗] [VIEW] │  ║
║  │ 2 │ LinkedIn: AI Job Expo... │ post     │ [✓] [✗] [VIEW] │  ║
║  └───┴──────────────────────────┴──────────┴─────────────────┘  ║
║                                                                  ║
║  RECENT ACTIVITY ────────────────────────────────────────────    ║
║  04:32 ░ morning-briefing ── Cerebro scanned 3 feeds             ║
║  04:31 ░ morning-briefing ── Sentinel: no patterns triggered     ║
║  04:30 ░ morning-briefing ── Jarvis dispatched workflow          ║
║  04:15 ░ heartbeat ── ryzen-tower checked in                     ║
║  04:00 ░ signal-scan ── 2 new signals above threshold            ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  ░ Auto-refresh: 30s │ Nodes: 2/3 │ Approvals: 2 pending       ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## COMPONENT SPEC: QUEEN API (Complete)

### Existing endpoints (LIVE — keep as-is):

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | Health check JSON |
| GET | `/dashboard` | HTML dashboard |
| GET | `/api/status` | Full cluster status |
| POST | `/api/nodes/register` | Register a node |
| POST | `/api/nodes/:id/heartbeat` | Node heartbeat |
| GET | `/api/nodes` | List all nodes |
| GET | `/api/nodes/:id` | Single node detail |
| DELETE | `/api/nodes/:id` | Remove a node |
| GET | `/api/config/models` | Serve models.json |
| GET | `/api/config/registry` | Serve MCP registry |
| POST | `/api/config/recommend-profile` | Hardware → profile |
| GET | `/api/capabilities/:cap` | Capability lookup |

### New endpoints (TO BUILD):

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/setup` | Setup wizard HTML |
| POST | `/api/setup/detect` | Run hardware detection, return specs |
| POST | `/api/setup/configure` | Apply role + profile + models |
| POST | `/api/setup/install-deps` | Trigger dependency installation |
| POST | `/api/setup/pull-model` | Pull a specific model (SSE progress) |
| GET | `/api/setup/status` | Current setup state |
| POST | `/api/setup/complete` | Mark setup done, start services |
| GET | `/api/approvals` | List pending approvals |
| POST | `/api/approvals/:id/approve` | Approve + execute |
| POST | `/api/approvals/:id/reject` | Reject + cancel |
| GET | `/api/approvals/:id` | View approval detail |
| POST | `/api/workflows/:name/execute` | Trigger a workflow |
| GET | `/api/workflows/:name/status` | Workflow execution status |
| GET | `/api/activity` | Recent activity log (last 50 events) |
| GET | `/api/health/deep` | Deep health check (probe all services) |
| GET | `/api/events` | SSE stream for real-time updates |

---

## COMPONENT SPEC: APPROVAL QUEUE

Law Two enforced in code, not just instructions.

### Storage
In-memory Map + file-backed JSON (`data/approvals.json`). No database.

### Schema
```json
{
  "id": "appr-1710900000-abc123",
  "type": "email_draft",
  "source_agent": "comms-drafter",
  "source_workflow": "morning-briefing",
  "created_at": "2026-03-20T04:32:00Z",
  "status": "pending",
  "summary": "Email draft: Follow up with key contact re: expert network",
  "content": { "to": "contact@example.com", "subject": "...", "body": "..." },
  "requires_approval": true,
  "approved_at": null,
  "approved_by": null
}
```

### ntfy Integration
When an approval is created:
```
POST ntfy notification:
  Title: "BorgClaw: Approval Needed"
  Body: "Email draft: Follow up with key contact"
  Actions:
    - label: "Approve", url: "http://queen:9090/api/approvals/appr-xxx/approve", method: POST
    - label: "View", url: "http://queen:9090/api/approvals/appr-xxx"
    - label: "Reject", url: "http://queen:9090/api/approvals/appr-xxx/reject", method: POST
```

Owner taps button on phone → Queen processes → action executes or cancels.

---

## COMPONENT SPEC: WORKFLOW EXECUTOR

### Language: Node.js (keep everything in one runtime)

Not Python + LangGraph. Keep it simple. The Queen is already Node.js. The workflow executor lives inside the Queen as a module.

### How it works:

1. Load workflow YAML from `config/workflows/`
2. Parse steps, dependencies, agent assignments
3. Execute steps in topological order (respect `depends_on`)
4. For each step:
   - Resolve agent from `config/agents/`
   - Load agent's `instructions.md` as system prompt
   - Determine compute target (local Ollama, cloud API via LiteLLM, or Claude Code)
   - Execute with context from QMD search
   - Collect result
   - If `requires_approval: true` → queue in approval system, pause
   - Otherwise → pass result to next step
5. On completion, log to activity feed

### Workflow YAML contract:

```yaml
name: morning-briefing
description: Daily intelligence brief
schedule: "30 8 * * 1-5"  # 8:30 AM weekdays
steps:
  - id: scan_calendar
    agent: jarvis-router
    action: "Check today's calendar events"
    tools: [google-calendar]

  - id: scan_inbox
    agent: jarvis-router
    action: "Scan inbox for priority senders"
    tools: [gmail]

  - id: pattern_scan
    agent: sentinel
    action: "Run blind-spot pattern detection"
    context: [patterns.md, projects.md, people.md]

  - id: signal_check
    agent: cerebro-analyst
    action: "Check for new signals above threshold"
    context: [signals.md, interests.md]
    depends_on: [scan_inbox]

  - id: format_brief
    agent: comms-drafter
    action: "Compile results into morning briefing"
    depends_on: [scan_calendar, scan_inbox, pattern_scan, signal_check]

  - id: deliver
    agent: ops-handler
    action: "Create Gmail draft with briefing"
    tools: [gmail]
    depends_on: [format_brief]
    requires_approval: false  # internal draft to self
```

---

## COMPONENT SPEC: DEEP HEALTH CHECK

### Route: `GET /api/health/deep`

Probes every service and returns structured status:

```json
{
  "queen": { "status": "online", "uptime_seconds": 15432 },
  "ollama": { "status": "online", "models_loaded": ["phi4-mini"], "url": "http://localhost:11434" },
  "nats": { "status": "offline", "error": "connection refused" },
  "litellm": { "status": "offline", "error": "not running" },
  "ntfy": { "status": "offline", "error": "not running" },
  "qmd": { "status": "online", "collections": 2, "documents": 162 },
  "nodes": { "online": 2, "offline": 1, "total": 3 }
}
```

Dashboard uses this to populate the services panel.

---

## COMPONENT SPEC: CLI (`./borgclaw`)

### Existing commands (LIVE):
- `start` — Boot Queen + detect hardware + start middleware
- `stop` — Clean shutdown
- `status` — Cluster health
- `dashboard` — Open browser
- `nodes` — List nodes
- `logs` — Tail Queen logs
- `bootstrap` — Full hardware setup

### New commands (TO BUILD):
- `borgclaw run <workflow>` — Execute a workflow manually
- `borgclaw approvals` — List pending approvals
- `borgclaw approve <id>` — Approve from CLI
- `borgclaw reject <id>` — Reject from CLI
- `borgclaw search <query>` — QMD search from CLI
- `borgclaw health` — Deep health check (all services)

All CLI output uses the same aesthetic — box-drawing, green/cyan, monospace.

```
$ borgclaw health

╔══════════════════════════════════════════╗
║  BORGCLAW HEALTH CHECK                   ║
╠══════════════════════════════════════════╣
║  Queen       ● ONLINE     15432s uptime  ║
║  Ollama      ● ONLINE     phi4-mini      ║
║  QMD         ● ONLINE     162 docs       ║
║  NATS        ○ OFFLINE    not running    ║
║  LiteLLM     ○ OFFLINE    not running    ║
║  ntfy        ○ OFFLINE    not running    ║
║  Nodes       2/3 online                  ║
╚══════════════════════════════════════════╝
```

---

## BUILD ORDER

Everything below is sequenced so that each step produces a working product. No step leaves dead wires.

### Phase 1: Queen Core (what exists + gaps filled)
**Deliverable:** `./borgclaw start` boots a fully functional Queen with dashboard + setup wizard

| # | Task | Lines | Depends On |
|---|------|-------|------------|
| 1.1 | Setup wizard HTML (`/setup`) — all 7 steps | ~400 | Existing Queen |
| 1.2 | Setup API endpoints (`/api/setup/*`) | ~200 | 1.1 |
| 1.3 | Deep health check (`/api/health/deep`) | ~80 | Existing Queen |
| 1.4 | Enhanced dashboard HTML (services + activity) | ~200 | 1.3 |
| 1.5 | CLI new commands (`health`, `search`) | ~100 | 1.3 |

**After Phase 1:** You can install BorgClaw, run the setup wizard, see your hardware, pull models, and monitor everything from the dashboard. No agents running yet, but the infrastructure is 100% live.

### Phase 2: Approval System
**Deliverable:** Law Two enforced in code. Approvals visible on dashboard and pushable via ntfy.

| # | Task | Lines | Depends On |
|---|------|-------|------------|
| 2.1 | Approval queue (in-memory + file-backed) | ~150 | Phase 1 |
| 2.2 | Approval API endpoints | ~100 | 2.1 |
| 2.3 | Dashboard approval panel | ~100 | 2.2 |
| 2.4 | ntfy integration (push + action buttons) | ~80 | 2.2 |
| 2.5 | CLI approval commands | ~60 | 2.2 |

**After Phase 2:** Owner gets push notifications on phone with approve/reject buttons. Dashboard shows pending queue. CLI can approve/reject. Everything that needs approval waits for it.

### Phase 3: Workflow Executor
**Deliverable:** `borgclaw run morning-briefing` executes a full workflow end-to-end.

| # | Task | Lines | Depends On |
|---|------|-------|------------|
| 3.1 | Workflow YAML parser + DAG builder | ~200 | Phase 2 |
| 3.2 | Step executor (agent invocation) | ~300 | 3.1 |
| 3.3 | Workflow API endpoints | ~100 | 3.2 |
| 3.4 | Activity feed (in-memory log) | ~80 | 3.2 |
| 3.5 | Dashboard workflow monitor panel | ~100 | 3.4 |
| 3.6 | CLI `run` command | ~40 | 3.3 |

**After Phase 3:** Full end-to-end workflow execution. Morning briefing runs, dispatches to agents, collects results, formats output, creates Gmail draft, logs activity. The product works.

### Phase 4: NATS Event Bus
**Deliverable:** Real-time coordination between agents. Dashboard updates via SSE.

| # | Task | Lines | Depends On |
|---|------|-------|------------|
| 4.1 | NATS client in Queen (connect, publish, subscribe) | ~150 | Phase 3 |
| 4.2 | SSE endpoint (`/api/events`) | ~80 | 4.1 |
| 4.3 | Dashboard SSE integration (live updates) | ~60 | 4.2 |
| 4.4 | Workflow events → NATS | ~40 | 4.1, 3.2 |

**After Phase 4:** Dashboard updates in real-time. No polling. Events flow through NATS. Foundation for multi-node agent coordination.

### Phase 5: Multi-Node Intelligence
**Deliverable:** Worker nodes execute tasks dispatched by Queen.

| # | Task | Lines | Depends On |
|---|------|-------|------------|
| 5.1 | Task dispatch to worker nodes via NATS | ~150 | Phase 4 |
| 5.2 | Worker-side task listener + executor | ~200 | 5.1 |
| 5.3 | Result collection + workflow advancement | ~100 | 5.2 |
| 5.4 | QMD search proxy in Queen | ~60 | Existing QMD |

**After Phase 5:** Queen dispatches tasks to the best available node. Worker nodes with GPUs handle heavy inference. Results flow back. The cluster is real.

---

## TOTAL BUILD ESTIMATE

| Phase | Lines | What You Get |
|-------|-------|-------------|
| 1 | ~980 | Setup wizard + enhanced dashboard + health checks |
| 2 | ~490 | Approval system (Law Two enforced) |
| 3 | ~820 | Workflow execution end-to-end |
| 4 | ~330 | Real-time events + SSE |
| 5 | ~510 | Multi-node task dispatch |
| **Total** | **~3,130** | **Full working product** |

Plus the existing ~1,200 lines already written = ~4,330 total codebase.

---

## FILE STRUCTURE (Post-Build)

```
borgclaw/
├── borgclaw                   ← CLI entry point (bash)
├── README.md
├── LICENSE
├── docker-compose.yml
│
├── services/
│   └── queen/
│       ├── package.json
│       ├── server.js          ← Express server (routes, middleware)
│       ├── lib/
│       │   ├── approval.js    ← Approval queue + persistence
│       │   ├── workflow.js    ← YAML parser + DAG executor
│       │   ├── activity.js    ← Activity feed (in-memory ring buffer)
│       │   ├── health.js      ← Deep health check (probe all services)
│       │   ├── nats.js        ← NATS client wrapper
│       │   ├── events.js      ← SSE endpoint for real-time updates
│       │   └── setup.js       ← Setup wizard API handlers
│       └── views/
│           ├── dashboard.html ← Main dashboard (single file, retro UI)
│           └── setup.html     ← Setup wizard (single file, retro UI)
│
├── scripts/
│   ├── bootstrap.sh
│   └── bootstrap.ps1
│
├── agents/
│   ├── jarvis-router/
│   ├── cerebro-analyst/
│   ├── comms-drafter/
│   ├── ops-handler/
│   └── sentinel/
│
├── config/
│   ├── models.json
│   ├── litellm.yaml
│   ├── agents/
│   ├── workflows/
│   ├── scheduled/
│   ├── nodes/
│   └── mcps/
│
├── data/                      ← Runtime state (gitignored)
│   ├── approvals.json
│   ├── activity.json
│   └── nodes.json
│
├── docs/
│   ├── QUICKSTART.md
│   ├── INTEGRATION.md         ← How to wire in your personal AI OS
│   └── SANITIZATION-CHECKLIST.md
│
├── specs/
│   ├── CONCEPT.md
│   ├── MIDDLEWARE-SPEC.md
│   └── PRODUCT-SPEC-V1.md    ← This file
│
└── research/
```

---

## GOVERNANCE: OPERATING LAWS IN THE KERNEL

Not just documentation. Structural enforcement.

| Law | How It's Enforced |
|-----|-------------------|
| **Zero (never delete)** | Ops-handler routes through Queen. Queen has no DELETE for files/content. Archive only. |
| **Two (draft-then-approve)** | Approval queue intercepts all external actions. No bypass path exists in code. |
| **Three (self-improve)** | Signal Radar runs weekly. Logs component evaluations. Proposes swaps. |
| **Four (mutual respect)** | Agent instructions include respect constraints. Rate limiting prevents abuse. Budget caps per agent. |
| **Five (direct tooling)** | Capability registry resolves MCP/API first. Browser fallback is last resort, logged as degraded. |

---

*"Resistance is optional. Adaptation is inevitable."*

*This spec defines the complete v1.0 product. Every touchpoint works. No dead wires. Build in phase order — each phase delivers a working product, not a partial one.*
