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

> Turn any computer into a node in your personal AI cluster. Plug in, run one script, it joins the hive. A Queen orchestrator routes tasks across all nodes. Your files, your models, your infrastructure. External APIs only when local can't handle it.

## Quick Start

```bash
git clone https://github.com/yourusername/borgclaw.git
cd borgclaw
./borgclaw start
```

That's it. The Queen boots, auto-detects your hardware, and opens a dashboard at `http://localhost:9090/dashboard`. Add more nodes with `./borgclaw bootstrap` on any machine in your network.

```bash
./borgclaw status      # cluster health
./borgclaw dashboard   # open in browser
./borgclaw nodes       # list registered nodes
./borgclaw stop        # shut it down
```

## Adding Nodes to the Hive

BorgClaw is a multi-node system. The Queen runs on your primary machine. Every other machine in your house joins the hive.

### On your primary machine (the Queen):

```bash
git clone https://github.com/yourusername/borgclaw.git
cd borgclaw
./borgclaw start
```

Note the Queen's IP address (e.g., `192.168.1.100`). Every other machine needs this.

### On any other machine:

```bash
git clone https://github.com/yourusername/borgclaw.git
cd borgclaw
bash scripts/bootstrap.sh --role worker --queen-ip 192.168.1.100
```

The bootstrap script will:
1. **Detect** your hardware — OS, CPU, GPU (NVIDIA/Apple Silicon/AMD/none), RAM
2. **Classify** it into a hardware profile (`nvidia-8gb-32gb-ram`, `mac-apple-silicon-16gb`, `cpu-only-8gb`, etc.)
3. **Install** Ollama + pull the optimal models for your hardware from `config/models.json`
4. **Register** with the Queen — POST its capabilities to `http://<queen-ip>:9090/api/nodes/register`
5. **Install a heartbeat daemon** — launchd (macOS) or systemd (Linux) pings the Queen every 30 seconds

Once registered, the node shows up on the Queen's dashboard. The Queen knows what models each node has, what it's capable of, and whether it's online.

### Node roles

| Role | What it does | When to use |
|------|-------------|-------------|
| `queen` | Runs the Queen service + middleware + local inference | Your always-on primary machine |
| `worker` | Local inference + Docker services, reports to Queen | Any machine with a decent GPU or 16GB+ RAM |
| `satellite` | Search-only (QMD), no LLM inference | Low-RAM machines, old laptops, NAS boxes |

### Beyond your LAN

For remote nodes (e.g., a GPU tower at the office), the spec calls for [Tailscale](https://tailscale.com) — zero-config mesh VPN. Install Tailscale on both machines and the LAN model works identically over the internet. No port forwarding, no firewall rules, no dynamic DNS.

```bash
# On both machines:
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Then bootstrap with the Tailscale IP instead:
bash scripts/bootstrap.sh --role worker --queen-ip 100.x.y.z
```

---

## Project Structure

```
borgclaw/
├── README.md                  ← You are here
├── LICENSE                    ← MIT
├── docker-compose.yml         ← Full middleware stack (NATS, LiteLLM, ntfy)
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

## Philosophy

Three ideas that run through everything BorgClaw does.

### 1. Assimilation over invention

> *"Your biological and technological distinctiveness will be added to our own."*

The Borg don't build from scratch. They find what's best in the universe and absorb it. BorgClaw operates on the same principle. Ollama, LM Studio, NadirClaw, LangGraph, NATS JetStream, LiteLLM, LanceDB, ntfy — all of these exist, are battle-tested, and are excellent at exactly one thing. BorgClaw's value isn't any individual component. It's the composition: hardware detection, optimal model assignment, node registration, hive identity, and the glue that makes a dozen tools behave as one.

Don't reinvent. Assimilate. 98% of what you need already exists. BorgClaw is the other 2%.

### 2. The autoresearch loop

Inspired by Karpathy's [autoresearch](https://github.com/karpathy/autoresearch) pattern: *modify → test → measure → keep/discard → loop forever.*

BorgClaw applies this to its own stack. Every Friday, the Signal Radar runs:

```
Scan GitHub/arXiv/HN for new tools in the stack's domains
    → Score each candidate: does it improve on a current component?
    → Score = Quality × Replaceability × Effort to swap
    → Above threshold: create task "Evaluate X as replacement for Y"
    → Run experiment: swap component, measure target metric
    → If metric improves: keep. If not: discard. Log either way.
    → Loop.
```

The system watches for its own replacement parts. When a better router appears, it flags itself for replacement. When a new embedding model benchmarks higher, it proposes the upgrade. This is how the stack stays current without manual maintenance — the same evolutionary pressure that produced it keeps improving it.

Every component has a measurable metric (inference speed, approval rate, signal-to-noise ratio, cost-per-task). Every swap is an experiment with a binary keep/discard outcome. The system gets smarter about its own architecture over time.

### 3. Thermodynamic governance

Every task has a cost. Track it. Govern it.

The three-tier compute stack isn't just an architecture decision — it's an economic model:

```
Tier 1 — Local (your machines, ~$0 marginal cost)
    Handles ~70% of workload. Always-on. No API calls.

Tier 2 — Burst (wholesale GPU: Lambda/CoreWeave/Vast.ai)
    Reserved instances at wholesale rates. You own the compute,
    not the tokens. A100 at $1.29/hr vs ~$150/hr equivalent via API.
    For sustained workloads, the economics are not close.

Tier 3 — Frontier API (hard-capped, last resort)
    Only when local can't handle it. LiteLLM routes transparently.
    Budget cap enforced per agent. Auto-pause at limit.
```

The thermodynamic ledger makes this visible: cost per task, cost per agent, cost per workflow. When Tier 3 usage climbs, the system flags it. You tune the routing. The goal is maximum intelligence per dollar, not maximum model size.

### 4. Identity agnosticism

BorgClaw is the infrastructure layer. It has no opinion about what sits above it.

Daniel Miessler calls his personal AI system PAI. You might call yours KAI. The AK-OS that BorgClaw was originally built for has a TELOS, a CLAUDE.md, an entity graph. None of that lives in BorgClaw. BorgClaw is the compute and orchestration — the agents, the Queen, the model routing, the event bus. The identity layer — who you are, what you care about, what the system is for — lives in your personal AI OS and gets passed into BorgClaw as context.

This separation is intentional. It means BorgClaw can be forked and adopted without stripping out someone else's identity. Clone it, point it at your own context files, run the bootstrap. The agents don't care whether your personal OS is called PAI, KAI, AK-OS, or something you invented last Tuesday. They run on context, not branding.

The `comms-drafter` agent adapts to *your* voice rules. The `cerebro-analyst` agent surfaces signals from *your* interest domains. The `jarvis-router` routes tasks against *your* priority queue. BorgClaw is the body. You bring the brain.

```
YOUR PERSONAL AI OS (PAI / KAI / AK-OS / whatever)
    Identity · Goals · Voice · Memory · Interests
                       │
                       │ feeds context into
                       ▼
              BORGCLAW INFRASTRUCTURE
    Queen · Agents · Model Routing · Event Bus · Compute
```

---

## What BorgClaw Composes (We Don't Build These)

| Component | Project | Role | License |
|-----------|---------|------|---------|
| LLM serving (Mac) | LM Studio / Ollama (MLX) | MLX inference, 2-3x faster on Apple Silicon | Proprietary (free) / MIT |
| LLM serving (NVIDIA) | Ollama | GGUF inference, best NVIDIA support | MIT |
| LLM serving (edge) | llama.cpp | Zero-dependency, runs anywhere | MIT |
| Binary prompt router | NadirClaw | Classifies simple→local vs complex→cloud in ~10ms, ~94% accuracy | MIT |
| Model-agnostic proxy | LiteLLM | Single OpenAI-compatible endpoint; swap providers via config | MIT |
| Workflow graphs | LangGraph | Multi-step pipelines with branching and subgraphs | MIT |
| Event bus | NATS JetStream | Typed agent events, temporal coordination, KV store | Apache 2.0 |
| Remote access | Tailscale | Zero-config mesh VPN | BSD-3 |
| State sync | Git | Version history, conflict resolution | GPL-2 |
| Embeddings | nomic-embed-text | Local vector embeddings for RAG | Apache 2.0 |
| Local search | qmd (@tobilu/qmd) | BM25 + vector + LLM reranking over markdown files | MIT |
| Push notifications | ntfy | Self-hosted push alerts with approval action buttons | Apache 2.0 |

## What BorgClaw Builds (~700 Lines of Unique Code)

| Component | What | Why It Doesn't Exist |
|-----------|------|---------------------|
| Assimilator | Detect hardware → install optimal server + model → register with Queen | Nobody packages detect + install + register |
| Queen service | Node registry + heartbeat + dashboard + agent coordination API | NadirClaw routes requests; nobody discovers nodes |
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
| comms-drafter | Claude API | ~$5-15/mo | Voice-critical writing (adapts to your style) |
| sentinel | Mac Mini (local) | $0/mo | 24/7 monitoring, alerts |

---

## Governance Model

BorgClaw implements personal governance through:

1. **Board of Directors** (the owner) — Nothing ships without approval (Law Two)
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
