```
    ╭━━╮  ╭━━╮
   ╭╯● ╰╮╭╯ ●╰╮
   ┃  ╭━╯╰━╮  ┃   ██████╗  ██████╗ ██████╗  ██████╗  ██████╗██╗      █████╗ ██╗    ██╗
   ╰━━╯    ╰━━╯   ██╔══██╗██╔═══██╗██╔══██╗██╔════╝ ██╔════╝██║     ██╔══██╗██║    ██║
     ╰══════╯      ██████╔╝██║   ██║██████╔╝██║  ███╗██║     ██║     ███████║██║ █╗ ██║
       ║██║        ██╔══██╗██║   ██║██╔══██╗██║   ██║██║     ██║     ██╔══██║██║███╗██║
       ║██║        ██████╔╝╚██████╔╝██║  ██╗╚██████╔╝╚██████╗███████╗██║  ██║╚███╔███╔╝
     ╔═╩══╩═╗      ╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
     ╚══════╝
          Resistance is optional. Adaptation is inevitable.
```

> Assimilate your hardware. Reclaim your intelligence. Adaptation is inevitable.

Plug in a USB drive, run one script, any device joins the hive. A Queen orchestrator routes tasks across all drones. Ghost workers control browsers on old laptops. Drones learn and evolve. Your machines. Your models. Your rules.

## Status: Alpha — First Drone Online

Queen boots. Drones join. Telemetry flows. The hive works.

**Working:**
- Queen + drone communication with live telemetry
- Natural language control — talk to the Queen, she responds and acts
- Drones auto-register as inference endpoints via LiteLLM
- Zero-config discovery — drones find Queen on the LAN automatically
- MCP tools — agents read files and fetch web content
- Drone personas — researcher, planner, worker modes
- Drone learning — each drone tracks its own performance over time
- Ghost worker — tested browser automation on old hardware (browsed example.com)
- Hardware auto-detection, cross-platform (Linux, macOS, Windows)
- Deploy to any machine: `./borgclaw deploy 10.0.0.21` or USB drive
- USB drives in 4 profiles: Scout (4GB), Worker (8GB), Scholar (16GB), Arsenal (32GB)
- Governance: approval queue, kill switch, budget caps, auth on every surface
- Workflow approval gates — approve from dashboard, workflow resumes automatically
- Scheduled workflows with cron and real LLM execution
- NATS event bus for real-time hive coordination
- Self-improvement scan — weekly check for better models and tools
- NAS shared knowledge — mount a drive, every drone in the hive sees it
- BBS dashboard with Queen status, chat, connect panel, security panel
- Each drone serves its own BBS terminal at its port
- Plug-in MCP slots for Home Assistant, energy grid, and more — zero bloat, add what you need

## Quick Start

### The Queen (your primary machine)

```bash
git clone https://github.com/akillies/borgclaw.git
cd borgclaw
./borgclaw start
```

Queen boots at `http://localhost:9090/dashboard`. Note your IP address.

```bash
./borgclaw status      # cluster health
./borgclaw dashboard   # open in browser
./borgclaw nodes       # list registered drones
./borgclaw halt        # emergency stop — all drones drop to 0%
./borgclaw resume      # bring the hive back online
./borgclaw stop        # shut it down
```

### Adding Drones (network deploy — fastest)

Deploy to any machine on your network with one command:

```bash
# Deploy to one machine
./borgclaw deploy 10.0.0.21

# Deploy to twelve machines at once
./borgclaw deploy 10.0.0.21 10.0.0.22 10.0.0.23 10.0.0.24 \
                  10.0.0.25 10.0.0.26 10.0.0.27 10.0.0.28 \
                  10.0.0.29 10.0.0.30 10.0.0.31 10.0.0.32

# Different SSH user
./borgclaw deploy 10.0.0.21 --user admin
```

For each machine, it: detects the OS via SSH, pushes the right drone binary, writes config with Queen IP + hive secret, installs Ollama if missing, pulls the model, and starts the drone. The machine appears on your dashboard within 30 seconds.

### Adding Drones (USB method — offline / no SSH)

For machines not on the network yet, or when you want to hand someone a drive:

```bash
bash scripts/prepare-usb.sh /Volumes/MYUSB
```

Packages everything onto the drive (~2.4GB): drone binaries for all platforms, Ollama installer, pre-cached model, config with hive secret. Plug in, run `setup.sh`, machine joins. `setup.sh --uninstall` removes everything cleanly.

### Adding Drones (manual)

```bash
cd node && go build -o drone . && ./drone --queen http://QUEEN_IP:9090 --secret YOUR_HIVE_SECRET
```

### How it works

```
┌──────────────┐     heartbeat      ┌──────────────┐
│  drone-efef  │ ──────────────────→│              │
│  M4 Pro      │     (30s interval) │    QUEEN     │
│  phi4-mini   │                    │   :9090      │
└──────────────┘                    │              │
                                    │  Rebuilds    │
┌──────────────┐     heartbeat      │  litellm.yaml│
│  drone-a3b7  │ ──────────────────→│  on every    │
│  RTX 3070    │                    │  new drone   │
│  qwen3:8b    │                    │              │
└──────────────┘                    └──────┬───────┘
                                           │
                                    ┌──────▼───────┐
                                    │   LiteLLM    │
                                    │   :4000      │
                                    │  Load-balances│
                                    │  across all  │
                                    │  drones      │
                                    └──────────────┘
```

When a drone heartbeats with its model list, Queen automatically updates LiteLLM's routing config. LiteLLM (39.8K stars, used by Stripe/Netflix) load-balances inference requests across all drones. New drone joins — more compute. Drone drops — fallback kicks in. No manual config.

## How BorgClaw Differs

| | exo | LocalAI | OpenClaw | Perplexity PC | BorgClaw |
|---|---|---|---|---|---|
| Core idea | Split one big model across devices | Local LLM API with p2p | Personal AI assistant (800+ skills) | Cloud-dependent AI box | Compute infrastructure for YOUR personal AI |
| Multi-node | Model sharding | Federated inference | No | No | Task routing via LiteLLM |
| Cost | Free | Free | Free | $200/month | Free |
| Identity | Its own | Its own | Its own | Perplexity's | Yours (pluggable) |
| Governance | No | No | No | No | Approval queue, budget caps, kill switch |
| USB installer | No | No | No | No | Yes — 2.4GB, one script |
| Ghost workers | No | No | No | No | Old laptops control browsers + desktops |
| Contribution dial | No | No | No | No | 0-100% per drone |
| Cloud dependency | No | No | Partial | Yes ($200/mo) | No — sovereign |

**exo** splits one large model across multiple machines (tensor parallelism). **BorgClaw** routes different tasks to different specialized drones. Different problems, complementary approaches.

**Already running OpenClaw?** One variable change gives it a full drone fleet as its compute backend. See [docs/OPENCLAW.md](docs/OPENCLAW.md).

**Why does the Perplexity Computer exist?** Because nobody built the open-source version. $200/month for a cloud-dependent box when your garage full of old hardware does it for $0. BorgClaw is the answer that should have existed already. Free. Sovereign. Runs on the machines you already own. No subscription. No cloud. No one takes it away.

## The Hive

### Drones

Each drone is a single Go binary (~10MB). It detects hardware, connects to Ollama, and heartbeats to Queen every 30 seconds with:
- Available models
- CPU/RAM/GPU metrics
- Task capacity (slots available)
- Contribution level (0-100%)

Drones get unique IDs based on hostname: `drone-efef`, `drone-a3b7`, `drone-c1d0`. You see them on the dashboard. You control each one's contribution dial — set your gaming PC to 30% while you play, your always-on server to 100%.

### Drone Roles

| Role | Hardware | What it does |
|------|----------|-------------|
| `queen` | Always-on machine | Runs Queen + middleware + local inference |
| `worker` | GPU machine or 16GB+ RAM | Full inference, reports to Queen |
| `ghost` | Old laptop, 4GB+ RAM, no GPU | Browser + desktop automation via Lightpanda/pyautogui. The hive's hands. |
| `satellite` | Low-RAM, old laptops, NAS | Search-only (QMD), lightweight tasks |

### Ghost Workers

Your old MacBook Air can't think fast. But it can ACT. Ghost workers control browsers and desktops — navigating websites, filling forms, extracting data, posting content, monitoring dashboards. The LLM reasoning happens on capable drones via LiteLLM. The old laptop just executes the clicks and keystrokes.

```
Queen: "Research competitor pricing on these 5 sites"
  → Capable drone (thinks): "Navigate to site A, find pricing page, extract table"
  → Ghost worker (acts): opens Lightpanda, navigates, extracts, returns data
  → Queen: assembles results, pushes to approval queue
```

Ghost workers turn e-waste into employees. A $50 thrift store laptop becomes a 24/7 browser automation agent. No subscription. No cloud. No SaaS pricing page. You already own this hardware. Now it works for you.

### The Queen

The Queen thinks, acts, and protects. She:
- **Talks** — `POST /api/chat` or the dashboard chat panel. Ask her anything about the hive in plain English. She responds AND acts.
- **Governs** — "Set drone-efef to 30% and run the morning briefing" → she adjusts the dial AND triggers the workflow
- **Senses** — every drone reports telemetry every 30 seconds (CPU, RAM, GPU, tok/s, temperature, active model)
- **Schedules** — cron-based temporal awareness. Morning briefing at 8:30 AM weekdays. Job scanner on Mondays. She knows what time it is.
- **Routes** — dynamically updates LiteLLM when drones join/leave. New drone = more compute instantly.
- **Persists** — node state survives restarts. Queen crash doesn't lose the hive.
- **Caches** — identical prompts skip the LLM. Saves time and API cost.
- **Authenticates** — hive secret on every surface. Dashboard, API, SSE, drone endpoints. No open doors.

### Agents

Five archetypes, extensible. Drop a new `agents/[name]/agent.json` and Queen auto-discovers it.

| Agent | Compute | Role |
|-------|---------|------|
| jarvis-router | Local (free) | Triage, routing, scheduling |
| cerebro-analyst | Cloud (budget-capped) | Research, foresight, synthesis |
| ops-handler | Local GPU | Code, data, structured output |
| comms-drafter | Cloud (budget-capped) | Voice-critical writing (adapts to YOUR style) |
| sentinel | Local (always-on) | 24/7 monitoring, alerts, signal detection |

## Governance

**The Five Laws** (enforced in code, not suggestions):

1. **Law Zero — Never Delete.** Archive, version, rename. Never `rm`.
2. **Law One — Protect the Operator.** Financial, reputational, personal.
3. **Law Two — Draft, Then Approve.** Nothing external ships without human approval.
4. **Law Three — Self-Improve.** Track performance, propose upgrades (subject to Law Two).
5. **Law Four — Mutual Respect.** No hidden actions. Full audit trail.

**Kill switch:** `./borgclaw halt` — immediately stops all drones, cancels workflows, rejects pending approvals. `./borgclaw resume` brings everything back.

**Budget caps:** LiteLLM enforces monthly spend limits. Agents auto-pause at their budget ceiling.

**Contribution dials:** Each drone's resource contribution is adjustable 0-100% from the dashboard.

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

## Philosophy

### 1. Assimilation over invention

> *"Your biological and technological distinctiveness will be added to our own."*

The Borg don't build from scratch. They find what's best and absorb it. BorgClaw operates the same way. Ollama, LiteLLM, NATS JetStream, ntfy — all battle-tested, all excellent at one thing. BorgClaw's value is the composition: hardware detection, model assignment, drone registration, hive routing, and the glue that makes a dozen tools behave as one.

Don't reinvent. Assimilate. 98% of what you need already exists. BorgClaw is the other 2%.

### 2. The autoresearch loop

Every Friday, the system scans GitHub/arXiv/HN for tools that improve on a current component. Score = Quality x Replaceability x Effort to swap. Above threshold: propose the upgrade. Run the experiment. Keep or discard. Log either way. The system watches for its own replacement parts.

### 3. Thermodynamic governance

Every task has a cost. Track it. Govern it.

```
Tier 1 — Local drones (~$0/task)    → 70% of workload
Tier 2 — Cheap cloud (~$0.00003)    → Fast structured tasks
Tier 3 — Mid-tier cloud (~$0.001)   → Complex reasoning
Tier 4 — Frontier API (~$0.075)     → Rare, hard-capped
```

LiteLLM routes transparently across all four tiers with automatic fallback. The thermodynamic ledger tracks cost per task, per agent, per workflow.

### 4. Identity agnosticism

BorgClaw is the infrastructure layer. It has no opinion about what sits above it.

Daniel Miessler calls his personal AI system PAI. You might call yours KAI. BorgClaw doesn't care. It provides the compute and orchestration — the agents, the Queen, the model routing, the event bus. The identity layer — who you are, what you care about, what the system is for — lives in your personal AI OS and gets passed into BorgClaw as context.

Clone it, point it at your own context files, run the bootstrap. The agents adapt to YOUR voice, YOUR interests, YOUR priority queue.

```
YOUR PERSONAL AI OS (PAI / KAI / whatever)
    Identity · Goals · Voice · Memory · Interests
                       │
                       │ feeds context into
                       ▼
              BORGCLAW INFRASTRUCTURE
    Queen · Drones · Model Routing · Event Bus · Compute
```

## Project Structure

```
borgclaw/
├── README.md
├── LICENSE (MIT)
├── borgclaw                    ← CLI (start/stop/halt/resume/status/nodes)
├── docker-compose.yml          ← Middleware (NATS, LiteLLM, ntfy)
├── .env.example                ← Configuration template
│
├── node/                       ← Drone agent (Go, cross-platform)
│   ├── main.go                 ← Entry point, CLI flags, graceful shutdown
│   ├── server.go               ← HTTP API (health, metrics, tasks, contribution)
│   ├── heartbeat.go            ← Queen heartbeat with exponential backoff
│   ├── worker.go               ← Task queue + Ollama execution
│   ├── ollama.go               ← Ollama client with metrics tracking
│   ├── throttle.go             ← Contribution dial (semaphore + context scaling)
│   ├── metrics.go              ← System metrics (CPU/RAM/GPU/disk/network)
│   └── config.go               ← Hardware detection + tier classification
│
├── services/queen/             ← Queen service (Node.js)
│   ├── server.js               ← Registry, heartbeat, LiteLLM sync, halt/resume
│   ├── lib/workflow.js          ← DAG engine (Kahn's algorithm, approval gates)
│   ├── lib/approvals.js         ← Law Two approval queue
│   ├── lib/activity.js          ← Event ring buffer + SSE
│   ├── lib/health.js            ← Deep health check
│   ├── lib/setup.js             ← Hardware detection + profile mapping
│   └── views/dashboard.js       ← Retro BBS dashboard (SSE, sparklines, topology)
│
├── mcp-server/                  ← MCP server for Claude Desktop integration
│   ├── index.js                 ← Stdio MCP server — proxies to Queen API
│   └── package.json
│
├── scripts/
│   ├── prepare-usb.sh           ← Package drones onto a USB drive
│   ├── bootstrap.sh             ← Full node setup (macOS/Linux)
│   └── bootstrap.ps1            ← Full node setup (Windows)
│
├── agents/                      ← Agent definitions (JSON config + system prompts)
├── config/                      ← Workflows, models, scheduled tasks, LiteLLM
├── docs/
│   ├── CLAUDE-DESKTOP.md        ← Connect Claude Desktop to the hive via MCP
│   ├── SECURITY.md              ← Governance model + security plans
│   ├── INTEGRATION.md           ← Wire BorgClaw to your personal AI OS
│   ├── OPENCLAW.md              ← Use BorgClaw as the compute backend for OpenClaw/NanoClaw
│   └── QUICKSTART.md
├── specs/                       ← Architecture decisions + competitive analysis
└── research/                    ← Technology audits + tool evaluations
```

## Technical Details

### The Drone Binary

Single Go binary. ~10MB. Cross-compiled for Linux, macOS (Intel + ARM), Windows. Zero dependencies on the target machine.

Every 30 seconds, the drone heartbeats to Queen with: CPU/RAM/GPU utilization, tok/s, temperature, available models, task capacity, contribution level, and its LAN IP. Queen uses this telemetry for routing decisions, sparkline rendering, and LiteLLM endpoint management.

**Hardware auto-detection:** `gopsutil` for CPU/RAM, `nvidia-smi` for NVIDIA GPUs, `system_profiler` for Apple Silicon. Classifies into tiers: nano (<4GB), edge (<16GB), worker (<64GB), heavy (64GB+).

**Contribution dial:** Semaphore-based concurrency control. At 50%, half the goroutine pool is available. Also scales Ollama's `num_ctx` — lower contribution = smaller context window = less RAM per request. Game on your GPU at 30% while the drone uses the leftovers.

### LiteLLM Dynamic Routing

When a drone heartbeats with its model list, Queen rebuilds `litellm.yaml` with all known Ollama endpoints. LiteLLM load-balances automatically — same model on two machines gets load-balanced. Drone goes offline, fallback kicks in. Cloud tier as last resort with hard budget cap.

```
Tier 1 — Local drones     $0/task        70% of workload
Tier 2 — Cheap cloud      ~$0.00003     Fast structured tasks
Tier 3 — Mid-tier cloud   ~$0.001       Complex reasoning
Tier 4 — Frontier API     ~$0.075       Hard-capped, rare, last resort
```

Fallback chains: `local → local-fallback → cheap-cloud → mid-tier`. Budget: $55/month hard limit across Tier 4. Response caching: identical prompts skip the LLM entirely.

### Queen Chat + Action Parsing

Talk to the Queen in plain English. She reasons over live hive state and executes commands:

```
You:   "Set the gaming PC to 30% and run the morning briefing"

Queen: "Setting drone-a3b7 to 30% — your session won't be interrupted.
        Starting morning briefing now. I'll push results to your
        approval queue when ready."

        [internally executes: set contribution, trigger workflow]
```

The Queen parses structured action tags from her own LLM response and executes them — contribution changes, workflow triggers, approvals, halt/resume. Natural language governance.

### USB Drive Contents

```
BORGCLAW/              2.4GB total — fits on a 4GB drive
├── drone-linux        10MB
├── drone-mac-arm64    10MB
├── drone-mac-intel    10MB
├── drone-windows.exe  10MB
├── setup.sh           Cross-platform install + --uninstall
├── ollama-install.sh  Cached installer (no download needed)
├── config/drone.json  Queen IP + hive secret pre-baked
└── models/            phi4-mini pre-cached (2.3GB)
```

`bash setup.sh` → detects platform → installs Ollama → loads cached model → starts drone → joins hive. Under 60 seconds. `bash setup.sh --uninstall` → removes everything cleanly.

### Claude Desktop Integration

Connect Claude Desktop to the hive via MCP. Claude gets 10 tools: chat with the Queen, dispatch tasks, trigger workflows, approve governance items, halt/resume the hive, read files, fetch URLs. Full control from a conversation.

```bash
cd borgclaw/mcp-server && npm install
```

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "borgclaw": {
      "command": "node",
      "args": ["/path/to/borgclaw/mcp-server/index.js"],
      "env": {
        "QUEEN_URL": "http://localhost:9090",
        "HIVE_SECRET": "your-hive-secret-here"
      }
    }
  }
}
```

See [docs/CLAUDE-DESKTOP.md](docs/CLAUDE-DESKTOP.md) for full setup, usage examples, and troubleshooting.

### Connect Any App

```bash
# OpenAI-compatible (Cursor, Aider, Continue, CrewAI, LangChain)
export OPENAI_BASE_URL=http://QUEEN_IP:4000

# Anthropic-compatible (Claude Code, Claude SDK)
export ANTHROPIC_BASE_URL=http://QUEEN_IP:4000

# Ollama-native (Open WebUI, Enchanted)
export OLLAMA_HOST=http://QUEEN_IP:11434
```

Two doors. `localhost:4000` for simple inference (LiteLLM, load-balanced across all drones). `localhost:9090` for orchestrated work (workflows, approvals, governance). One hive behind both. `./borgclaw connect` prints everything.

### Security

Hive secret generated on first boot (32 bytes, hex). Every API route checks `Authorization: Bearer <secret>`. Dashboard, SSE, drone endpoints — all authenticated. USB drives get the secret pre-baked. Zero manual key management. See [docs/SECURITY.md](docs/SECURITY.md) for the full model.

## What BorgClaw Composes

| Component | Project | Stars | Role |
|-----------|---------|-------|------|
| LLM inference | Ollama | 162K+ | Local inference (NVIDIA + Apple Silicon) |
| Model routing | LiteLLM | 39.8K | Unified API, load balancing, budget caps, caching |
| Event bus | NATS JetStream | 17K+ | Agent coordination, temporal events |
| Push notifications | ntfy | 19K+ | Approval alerts with action buttons |
| Local search | qmd | — | BM25 + vector + LLM reranking over markdown |
| Remote access | Tailscale | 29.6K | Zero-config mesh VPN for remote drones |

## The Vision

### Today
Turn every computer you own into one AI. Your machines. Your models. Your rules.

### Tomorrow
Your hive connects to your neighbor's hive. Communities pool compute. A school district where 200 old Chromebooks become a shared educational AI. A farming co-op where 50 members' machines process crop data together. A mutual aid network where spare compute flows to whoever needs it.

We're all running scrap. None of us have $10B data warehouses. But when our scrap combines, we are powerful.

### The Philosophy
You already own this hardware. It's sitting in closets, drawers, basements — depreciating to zero while cloud companies charge you $20/month for AI that lives in THEIR datacenter. BorgClaw takes what you already paid for and makes it think, work, and evolve. No subscription. No cloud dependency. No one can shut it off, rate-limit it, or change the terms of service.

Reclaim your sovereign tech.

---

Created by [Alexander Kline](https://alexanderkline.com)

*Resistance is optional. Adaptation is inevitable.*
