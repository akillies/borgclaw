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

> Turn any computer into a drone in your personal AI cluster. Plug in a USB drive, run one script, it joins the hive. A Queen orchestrator routes tasks across all drones via LiteLLM. Your files, your models, your infrastructure.

## Status: Alpha

**What works today:**
- Queen service boots, retro BBS dashboard at `localhost:9090`
- Drone agent compiles and runs on Linux, macOS (Intel + ARM), and Windows
- Hardware auto-detection (CPU, RAM, GPU — NVIDIA + Apple Silicon)
- Each drone gets a unique ID (`drone-efef`, `drone-a3b7`, etc.)
- LiteLLM dynamic routing — drones auto-register as inference endpoints
- Response caching — identical prompts skip the LLM
- Hive halt/resume kill switch
- Approval queue (Law Two — nothing external ships without human approval)
- USB drive prep script — 2.4GB, fits on a 4GB drive
- Workflow engine with DAG execution, approval gates, template variables
- 5 agent archetypes defined (router, analyst, ops, comms, sentinel)
- Full open-source scrub — no personal data, template variables for your setup

**What's in progress:**
- Multi-drone end-to-end test (architecture wired, first live test pending)
- NATS event bus integration (in docker-compose, client wiring pending)

**What's planned:**
- mDNS auto-discovery (drones find Queen without knowing the IP)
- Knowledge-specialized drones (Medic, Engineer, Scholar — ZIM-based knowledge packs)
- Voice interface (Pipecat + Whisper.cpp + Kokoro TTS)
- Agent sandboxing (NemoClaw-inspired filesystem + network isolation)
- Prometheus + Grafana observability

## Quick Start

### The Queen (your primary machine)

```bash
git clone https://github.com/yourusername/borgclaw.git
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

### Adding Drones (USB method)

Prep a USB drive on the Queen machine:

```bash
bash scripts/prepare-usb.sh /Volumes/MYUSB
```

This packages everything onto the drive (~2.4GB):
- Drone binary (Linux, Mac, Windows — all included)
- Ollama installer
- Pre-cached LLM model (phi4-mini, 2.3GB — no download needed on target)
- Config with Queen's IP auto-detected

Plug the USB into any machine. Run one command:

```bash
bash /path/to/BORGCLAW/setup.sh
```

The machine installs Ollama, loads the cached model, starts the drone, and joins the hive. It appears on the Queen dashboard within 30 seconds.

### Adding Drones (manual method)

If you prefer, download the drone binary for your platform from the `node/` directory, or compile it:

```bash
cd node && go build -o drone . && ./drone --queen http://QUEEN_IP:9090
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

| | exo | LocalAI | OpenClaw | BorgClaw |
|---|---|---|---|---|
| Core idea | Split one big model across devices | Local LLM API with p2p | Personal AI assistant (800+ skills) | Compute infrastructure for YOUR personal AI |
| Multi-node | Model sharding | Federated inference | No | Task routing via LiteLLM |
| Identity | Its own | Its own | Its own | Yours (pluggable) |
| Governance | No | No | No | Approval queue, budget caps, kill switch |
| USB installer | No | No | No | Yes — 2.4GB, one script |
| Contribution dial | No | No | No | 0-100% per drone |

**exo** splits one large model across multiple machines (tensor parallelism). **BorgClaw** routes different tasks to different specialized drones. Different problems, complementary approaches.

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
| `satellite` | Low-RAM, old laptops, NAS | Search-only (QMD), no LLM inference |

### The Queen

The Queen doesn't think — she routes, monitors, enforces governance, and dispatches. She:
- Tracks all drones via heartbeat
- Dynamically updates LiteLLM routing when drones join/leave
- Serves the retro BBS dashboard
- Runs the workflow engine (DAG execution with approval gates)
- Manages the approval queue (Law Two)
- Enforces budget caps per agent

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
├── scripts/
│   ├── prepare-usb.sh           ← Package drones onto a USB drive
│   ├── bootstrap.sh             ← Full node setup (macOS/Linux)
│   └── bootstrap.ps1            ← Full node setup (Windows)
│
├── agents/                      ← Agent definitions (JSON config + system prompts)
├── config/                      ← Workflows, models, scheduled tasks, LiteLLM
├── docs/
│   ├── SECURITY.md              ← Governance model + security plans
│   ├── INTEGRATION.md           ← Wire BorgClaw to your personal AI OS
│   └── QUICKSTART.md
├── specs/                       ← Architecture decisions + competitive analysis
└── research/                    ← Technology audits + tool evaluations
```

## What BorgClaw Composes

| Component | Project | Stars | Role |
|-----------|---------|-------|------|
| LLM inference | Ollama | 162K+ | Local inference (NVIDIA + Apple Silicon) |
| Model routing | LiteLLM | 39.8K | Unified API, load balancing, budget caps, caching |
| Event bus | NATS JetStream | 17K+ | Agent coordination, temporal events |
| Push notifications | ntfy | 19K+ | Approval alerts with action buttons |
| Local search | qmd | — | BM25 + vector + LLM reranking over markdown |
| Remote access | Tailscale | 29.6K | Zero-config mesh VPN for remote drones |

---

*"Don't reinvent. Compose. Pull the best of everything, bring it together. 98% exists. BorgClaw's value is the composition and the experience."*
