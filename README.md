# BorgClaw
## Your Machines. Your Models. Your Rules.

> Turn any computer into a node in your personal AI cluster. Plug in, run one script, it joins the hive. A Queen orchestrator routes tasks across all nodes. Your files, your models, your infrastructure. External APIs only when local can't handle it.

---

## Project Structure

```
borgclaw/
├── README.md                  ← You are here
├── LICENSE                    ← MIT
├── docker-compose.yml         ← Full middleware stack (NATS, ntfy, Fizzy)
│
├── services/
│   └── queen/                 ← Queen service (Node.js, ~500 lines)
│       ├── server.js          ← Express server — registry, heartbeat, dashboard
│       └── package.json
│
├── scripts/
│   ├── bootstrap.sh           ← The Assimilator (macOS / Linux)
│   └── bootstrap.ps1          ← The Assimilator (Windows / PowerShell)
│
├── agents/                    ← Agent definitions (the "employees")
│   ├── jarvis-router/         ← Triage + routing (always-on, local)
│   ├── cerebro-analyst/       ← Deep research + foresight (cloud)
│   ├── ops-handler/           ← Code, data, structured output (local GPU)
│   ├── comms-drafter/         ← Writing, voice-critical content (cloud)
│   └── sentinel/              ← 24/7 monitoring + alerts (always-on, local)
│
├── config/
│   ├── models.json            ← Hardware profile → model mapping
│   ├── agents/                ← Per-agent YAML configs
│   ├── workflows/             ← Workflow DAG definitions
│   └── scheduled/             ← Scheduled task configs
│
├── docs/
│   └── QUICKSTART.md          ← First node in 15 minutes
│
├── specs/
│   ├── CONCEPT.md             ← Product vision, architecture, competitive positioning
│   └── MIDDLEWARE-SPEC.md     ← 7-sublayer middleware architecture
│
├── research/
│   ├── TECHNOLOGY-AUDIT.md    ← Every infra tech decision with benchmarks
│   └── MIDDLEWARE-TECHNOLOGY-AUDIT.md ← Every middleware tech decision
│
└── assets/
    ├── borgclaw-full-stack.html  ← Interactive 5-layer architecture diagram
    └── borgclaw-concept.html     ← Concept visualization
```

---

## What BorgClaw Composes (We Don't Build These)

| Component | Project | Role | License |
|-----------|---------|------|---------|
| LLM serving (Mac) | LM Studio / llmster | MLX inference, 2-3x faster on Apple Silicon | Proprietary (free) |
| LLM serving (NVIDIA) | Ollama | GGUF inference, best NVIDIA support | MIT |
| LLM serving (edge) | llama.cpp | Zero-dependency, runs anywhere | MIT |
| Smart routing | NadirClaw | Prompt classification + cost optimization | MIT |
| Agent governance | Paperclip | Roles, budgets, audit trails, board approval | MIT |
| Workflow graphs | LangGraph | Multi-step pipelines with branching | MIT |
| Remote access | Tailscale | Zero-config mesh VPN | BSD-3 |
| State sync | Git | Version history, conflict resolution | GPL-2 |
| Embeddings | nomic-embed-text | Local vector embeddings for RAG | Apache 2.0 |

## What BorgClaw Builds (~700 Lines of Unique Code)

| Component | What | Why It Doesn't Exist |
|-----------|------|---------------------|
| Assimilator | Detect hardware → install optimal server + model → register with Queen | Nobody packages detect + install + register |
| Queen service | Node registry + heartbeat + NadirClaw config + dashboard | NadirClaw routes but doesn't discover nodes |
| models.json | Hardware profile → model mapping, updatable | Everyone hardcodes model choices |
| Multi-server abstraction | LM Studio on Mac, Ollama on NVIDIA, same API | Tools assume one server type |
| Hive identity | USB carries YOUR credentials | No tool has "plug in and join" |

---

## Agents

Each agent is a folder with: `agent.json` (config), `instructions.md` (system prompt), `tools.json` (available tools), `mcps.json` (MCP connections).

See `agents/` folder for full definitions. Summary:

| Agent | Compute | Cost | Role |
|-------|---------|------|------|
| jarvis-router | Mac Mini (local) | $0/mo | Triage, routing, scheduling |
| cerebro-analyst | Claude API | ~$20-40/mo | Research, foresight, synthesis |
| ops-handler | Ryzen/3070 (local) | $0/mo | Code, data, structured output |
| comms-drafter | Claude API | ~$5-15/mo | Writing in Alexander's voice |
| sentinel | Mac Mini (local) | $0/mo | 24/7 monitoring, alerts |

---

## Governance Model

BorgClaw implements personal governance through:

1. **Board of Directors** (Alexander) — Nothing ships without approval (Law Two)
2. **Agent budgets** — Each cloud agent has a monthly token budget. At 80% = warning. At 100% = auto-pause.
3. **Audit trail** — Immutable, append-only log of every action taken
4. **Contribution dials** — Per-node throttle control (eco → max), controllable from phone
5. **Routing profiles** — `free` (local only), `eco` (minimize cloud), `auto` (smart), `premium` (best model)

---

## Build Sequence

| Phase | Name | Effort | What |
|-------|------|--------|------|
| A | "Hello World" | 30 min | Install LM Studio on Mac Mini, test tool-calling |
| B | "Two Brains" | 1 hr | Add Ryzen/Ollama node, expose to LAN |
| C | "One Door" | 1-2 hrs | NadirClaw as gateway, single endpoint |
| D | "The Agents" | 2-4 hrs | Paperclip + agent folders + Queen service |
| E | "The Assimilator" | 1-2 hrs | USB installer script |
| F | "Superintelligence" | Ongoing | Dogfood, iterate, open-source |

---

## Status: v0.1 — Core Scaffolding Complete

Queen service, Assimilator (bash + PowerShell), agent definitions, middleware Docker Compose, and hardware model config are all present and functional.

**Next action:** `bash scripts/bootstrap.sh --role queen` on your Mac Mini. 15 minutes. $0. See [docs/QUICKSTART.md](docs/QUICKSTART.md).

---

*"Don't reinvent. Compose. Pull the best of everything, bring it together. 98% exists. BorgClaw's value is the composition and the experience."*
