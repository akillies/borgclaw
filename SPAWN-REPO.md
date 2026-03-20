# BorgClaw — GitHub Repo Spawn Instructions
## Hand this file to Claude Code. It creates the open-source repo.

---

## WHAT TO BUILD

BorgClaw is an open-source tool that turns any computer into a node in a personal AI cluster. It composes existing tools (doesn't reinvent them) and adds the glue: hardware detection, optimal model assignment, node registration, and a central orchestrator.

**Tagline:** "Your Machines. Your Models. Your Rules."

**One-line pitch:** The open-source alternative to Perplexity's Personal Computer — multi-node, self-owned, privacy-first.

---

## WHAT THE RESEARCH FOUND (Key Decisions)

These decisions are justified in `research/TECHNOLOGY-AUDIT.md` with benchmarks and evidence.

### LLM Servers: Match to Hardware (Don't Force One Everywhere)
- **Apple Silicon nodes → LM Studio** (llmster daemon, MLX models, 2-3x faster)
- **NVIDIA GPU nodes → Ollama** (best NVIDIA support, massive ecosystem)
- **Edge/ARM/CPU-only → Ollama** (or llama.cpp direct)
- **LM Studio is proprietary but free** — Ollama is the open-source default, LM Studio is the recommended optimization for Mac

### Gateway: NadirClaw (Don't Build a Router)
- **github.com/doramirdor/NadirClaw** does 90% of routing: prompt classification in ~10ms, three-tier routing (simple→local, complex→cloud), cost tracking, dashboard, OpenAI-compatible proxy
- BorgClaw adds: node discovery, hardware-aware routing, hive identity
- Don't fork NadirClaw — use it as a dependency

### Orchestration: Paperclip (Don't Build Governance)
- **github.com/paperclipai/paperclip** — agent roles, budgets, audit trails, board approval
- BorgClaw agents register with Paperclip as "employees"
- Alexander operates as "board of directors"

### State Sync: Git (Not Syncthing for Code)
- Git for the knowledge base (Markdown files) — version history, conflict resolution
- Syncthing ONLY for large binary assets (audio, images) — Syncthing + git repos = corruption risk
- Google Drive backup via gws CLI

### Models: Configurable via models.json
- Don't hardcode models. `config/models.json` maps hardware profiles to recommended models.
- When better models come out, update the config. No code changes.
- See `config/models.json` for the full mapping.

---

## REPO STRUCTURE TO CREATE

```
borgclaw/
├── README.md                        ← Project overview, quick start, philosophy
├── LICENSE                          ← MIT
├── .gitignore
│
├── src/
│   ├── assimilate.sh                ← The Assimilator (Mac/Linux)
│   ├── assimilate.ps1               ← The Assimilator (Windows/PowerShell)
│   └── queen/
│       ├── package.json
│       ├── server.js                ← Queen service (Node.js, Express)
│       ├── routes/
│       │   ├── nodes.js             ← POST /register, GET /nodes, heartbeat
│       │   ├── health.js            ← GET /health, node status
│       │   └── config.js            ← GET/PUT /config, models.json management
│       ├── services/
│       │   ├── registry.js          ← Node registry (in-memory + file-backed)
│       │   ├── heartbeat.js         ← Heartbeat monitor, mark nodes offline
│       │   ├── nadirclaw-config.js  ← Dynamically update NadirClaw backends
│       │   └── hardware-profiler.js ← Classify hardware → profile
│       └── dashboard/
│           └── index.html           ← Simple status dashboard (single HTML)
│
├── config/
│   ├── models.json                  ← Hardware profile → model mapping
│   ├── queen.example.json           ← Example Queen config
│   └── hive.example.json            ← Example hive identity for USB
│
├── agents/                          ← Agent definition templates
│   ├── README.md                    ← How to create an agent
│   ├── jarvis-router/
│   │   ├── agent.json
│   │   └── instructions.md
│   ├── sentinel/
│   │   ├── agent.json
│   │   └── instructions.md
│   └── example-custom/
│       ├── agent.json
│       └── instructions.md
│
├── middleware/
│   ├── docker-compose.yml           ← Full middleware stack (Fizzy + n8n + NATS + ntfy)
│   ├── workflows/                   ← n8n workflow templates (YAML/JSON)
│   │   ├── content-publish-pipeline.json
│   │   ├── morning-briefing.json
│   │   └── signal-scan.json
│   └── context-rules.yaml           ← Context assembly rules per task type
│
├── docs/
│   ├── ARCHITECTURE.md              ← Five-layer architecture explanation
│   ├── QUICKSTART.md                ← 5-minute getting started
│   ├── TECHNOLOGY-DECISIONS.md      ← Why each tech was chosen (from audit)
│   ├── MIDDLEWARE.md                 ← Middleware layer: task queue, workflows, discovery
│   ├── AGENTS.md                    ← How agents work, how to create custom ones
│   ├── MODELS.md                    ← Model recommendations by hardware
│   ├── REMOTE-ACCESS.md             ← SSH / Tailscale / Cloudflare Tunnel
│   └── USB-INSTALLER.md            ← How to create an Assimilator USB
│
└── examples/
    ├── docker-compose.yml           ← Full stack: Queen + middleware + infra
    └── workflow-template.yaml       ← Example workflow DAG definition
```

---

## THE ASSIMILATOR SCRIPT (src/assimilate.sh)

This is the core user experience. ~200 lines of bash.

### What it does:
1. **Detect** — OS, CPU, GPU (nvidia-smi / system_profiler), RAM, network
2. **Profile** — Map hardware to profile from models.json (mac-heavy, nvidia-heavy, etc.)
3. **Install server** — LM Studio (Mac) or Ollama (everything else). Skip if present.
4. **Pull models** — From models.json for this profile. Use USB cache if available.
5. **Configure** — Set OLLAMA_HOST=0.0.0.0 or equivalent. Install as system service.
6. **Register** — POST to Queen with full hardware manifest. Start heartbeat.
7. **Verify** — Run test inference. Confirm response. Print success.

### Important implementation details:
- Must work offline if models are pre-staged on USB
- Must be idempotent (running twice doesn't break anything)
- Must detect if LM Studio is already installed (Mac) or Ollama (everything)
- Windows version (assimilate.ps1) should be equivalent PowerShell
- Print clear, colored output with the BorgClaw branding

---

## THE QUEEN SERVICE (src/queen/)

~500 lines of Node.js. The brain of the cluster.

### Endpoints:
```
POST   /api/nodes/register     ← Node sends its hardware manifest
GET    /api/nodes               ← List all registered nodes with status
GET    /api/nodes/:id           ← Get specific node details
POST   /api/nodes/:id/heartbeat ← Node reports status every 60s
DELETE /api/nodes/:id           ← Remove a node
GET    /api/health              ← Overall hive health summary
GET    /api/config/models       ← Get current models.json
PUT    /api/config/models       ← Update models.json
GET    /api/stats               ← Hive stats: tokens, costs, uptime
POST   /api/hive/generate-usb   ← Generate hive identity for USB
GET    /                        ← Dashboard (single-page HTML)
```

### State:
- In-memory node registry (fast)
- File-backed persistence (nodes.json — survives restart)
- No database required (v0.1)
- PostgreSQL optional for v0.2+ (Paperclip already uses PGlite)

### Key logic:
- Mark nodes offline after 5 missed heartbeats (5 min)
- Auto-remove nodes offline for 24+ hours
- Serve a simple dashboard at `/` showing all nodes, their status, GPU utilization, models loaded
- When a node registers, update NadirClaw config to include it as a backend

---

## THE README.md

Should convey:
1. **What this is** — one paragraph, visceral
2. **The 5-minute demo** — install on one machine, see it work
3. **The vision** — walk around your house, plug in every machine, they join
4. **What it composes** — NadirClaw, Ollama, LM Studio, Paperclip (we don't reinvent)
5. **What it builds** — the Assimilator + Queen + models.json (the unique glue)
6. **Architecture diagram** — three layers (compute → gateway → orchestration)
7. **Agent system** — folder-based, discoverable, composable
8. **Governance** — board approval, budgets, audit trail, contribution dials
9. **vs. Perplexity Personal Computer** — comparison table
10. **Contributing** — how to add agents, models, hardware profiles

Tone: Direct, technical, no hype. Let the concept sell itself. The README should feel like documentation from someone who actually built this for themselves and is sharing it because others asked.

---

## WHAT TO COMPOSE (Dependencies, Not Things We Build)

### Layer 2: Infrastructure
| Dependency | How It's Used | Install |
|-----------|--------------|---------|
| Ollama | LLM server for non-Mac nodes | `curl -fsSL https://ollama.com/install.sh \| sh` |
| LM Studio | LLM server for Mac nodes (optional, recommended) | Download from lmstudio.ai |
| NadirClaw | Smart routing gateway | `pip install nadirclaw` or Docker |
| Paperclip | Agent orchestration + governance | `git clone + npm install` |
| Tailscale | Remote access mesh VPN (optional) | `curl -fsSL https://tailscale.com/install.sh \| sh` |
| Node.js 20+ | Queen service runtime | Required |

### Layer 3: Middleware (NEW — Task-Driven Architecture)
| Dependency | How It's Used | Install |
|-----------|--------------|---------|
| Fizzy | Task queue + dispatch. REST API, webhooks, MCP server. To-dos ARE the routing mechanism. | `docker run -p 3456:3456 basecamp/fizzy` |
| n8n | Workflow orchestration. 400+ integrations. AI Agent nodes. Parallel execution. Last-mile delivery. | `docker run -p 5678:5678 n8nio/n8n` |
| MCP Gateway Registry | Dynamic tool discovery via FAISS semantic search. Agent registry. A2A communication. | `git clone github.com/agentic-community/mcp-gateway-registry && docker compose up` |
| NATS JetStream | Event bus + streaming + KV store. Single 15MB binary. Agent event backbone. | `docker run -p 4222:4222 nats -js` |
| LanceDB | Embedded vector DB for RAG. Context assembly over AK-OS knowledge base. No server needed. | `pip install lancedb` |
| nomic-embed-text | Local embedding model for LanceDB. MLX-optimized for Apple Silicon. | `ollama pull nomic-embed-text` |
| ntfy | Self-hosted push notifications. Action buttons for approval workflows. | `docker run -p 2586:80 binwiederhier/ntfy serve` |
| Apprise | Multi-channel notification fanout (110+ services). Optional complement to ntfy. | `pip install apprise` |
| LangGraph | Complex AI reasoning chains inside n8n nodes. Stateful multi-step agent logic. | `pip install langgraph` |

---

## THE TASK-DRIVEN ARCHITECTURE (Critical Insight)

To-dos are the routing mechanism. Every piece of work starts as a Fizzy task and flows through this pipeline:

```
Alexander creates task (Fizzy mobile/web/CalDAV)
    → Fizzy webhook fires
    → n8n workflow triggers
    → Jarvis classifies task (simple / compound / workflow)
    → If workflow: decompose via workflow template (YAML DAG)
    → Agents execute steps (parallel where possible)
    → Approval gates pause for human review (ntfy push)
    → Last-mile delivery via n8n integrations (email, social, publish)
    → Fizzy task updated → COMPLETE (via Fizzy MCP)
    → Audit logged to NATS JetStream
```

Key GitHub repos for this layer:
- **github.com/basecamp/fizzy (AGENTS.md — designed for agent integration)** — MCP server for Fizzy (agents read/write tasks)
- **github.com/agentic-community/mcp-gateway-registry** — Dynamic tool discovery + agent registry
- **github.com/n8n-io/n8n** — Workflow orchestration (400+ integrations, AI Agent node)

---

## PHASE 1 SCOPE (v0.1 — "First Assimilation")

Build ONLY:
- [x] `assimilate.sh` (Mac/Linux)
- [x] `assimilate.ps1` (Windows)
- [x] Queen service (Node.js, ~500 lines)
- [x] `models.json` config
- [x] Dashboard (single HTML file served by Queen)
- [x] README with vision + quick start
- [x] Agent template format (agent.json + instructions.md)
- [x] 2 example agents (jarvis-router, sentinel)
- [x] `docker-compose.yml` for middleware stack (Fizzy + n8n + NATS + ntfy)

Do NOT build yet (v0.2):
- NadirClaw integration
- Paperclip integration
- MCP Gateway Registry integration
- LanceDB RAG pipeline

Do NOT build yet (v0.3+):
- LangGraph workflow templates
- Workflow YAML definitions for all AK-OS workflows
- Go binary installer
- Documentation site

---

## CONTEXT FILES IN THIS FOLDER

Read these for full context if needed:
- `specs/CONCEPT.md` — Full product vision, architecture, competitive positioning, roadmap
- `specs/MIDDLEWARE-SPEC.md` — **NEW:** 7-sublayer middleware architecture with schemas and flows
- `specs/INFRASTRUCTURE-BUILDOUT.md` — Step-by-step build plan with concrete commands
- `research/TECHNOLOGY-AUDIT.md` — Every infra tech decision with benchmarks and evidence
- `research/MIDDLEWARE-TECHNOLOGY-AUDIT.md` — **NEW:** Every middleware tech decision with research
- `agents/*/agent.json` — Agent definitions with tools, MCPs, governance rules
- `config/models.json` — Hardware → model mapping
- `assets/borgclaw-full-stack.html` — **NEW:** Interactive 5-layer architecture diagram

---

## BRAND

- **Name:** BorgClaw
- **Tagline:** "Your Machines. Your Models. Your Rules."
- **Metaphor:** Borg (Star Trek) + Claw (OpenClaw ecosystem). Collective intelligence. USB "assimilation."
- **Central orchestrator:** "The Queen" (hive-mind metaphor)
- **Tone:** Technical, direct, no hype. Built for builders. Open-source spirit.
- **License:** MIT

---

*This file contains everything needed to create the GitHub repo. Read it, read the supporting files in this folder, and build.*
