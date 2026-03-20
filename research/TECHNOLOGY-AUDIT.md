# BorgClaw Technology Audit
## Every Decision Questioned, Every "Why" Answered
**Created:** 2026-03-14 | **Status:** Research Complete

> This document challenges every technology assumption in the BorgClaw concept and provides evidence-based recommendations. If we're going to build this and eventually open-source it, every choice needs a real reason, not a default.

---

## DECISION 1: LOCAL LLM SERVER

### The Question: Ollama vs LM Studio vs llama.cpp vs vLLM vs LocalAI?

### What We Assumed: Ollama everywhere
### What the Research Says: **It depends on the node.**

| Server | Best For | Not Great For |
|--------|----------|---------------|
| **Ollama** | Cross-platform. Headless servers. Docker. Background daemon. Auto GPU detection. Massive ecosystem. | Max Apple Silicon perf (no MLX). High-concurrency production. |
| **LM Studio** | Apple Silicon (MLX = 2-3x faster on Mac). GUI model browsing. Headless mode via `llmster` daemon. | Cross-platform consistency. Linux servers. Fully scriptable install. |
| **llama.cpp** | Maximum control. Edge devices. ARM boards. Custom builds. Zero dependencies. | Ease of setup. API compatibility out of box. |
| **vLLM** | NVIDIA GPUs. High throughput (16x over Ollama at scale). Production serving. | Apple Silicon (no Metal support). Single-user home use (overkill). |
| **LocalAI** | Multi-modal. Built-in distributed mode (p2p). Universal API hub. | Pure performance (it's a wrapper). Complexity. |

### Key Benchmarks

**Apple Silicon (Mac Mini M4 Pro):**
- LM Studio + MLX models: ~20% faster inference than Ollama + GGUF on same hardware
- For small models (7B): MLX can be 2-4x faster than GGUF
- MLX uses unified memory more efficiently (less RAM overhead per model)
- LM Studio 0.4.0 has `llmster` daemon = headless, no GUI needed, runs as service

**NVIDIA (RTX 3070):**
- Ollama: solid at ~70+ tok/s for 7B Q4_K_M models
- vLLM: 16x throughput advantage at concurrent load, but for single-user home use the overhead isn't worth it
- Ollama is the pragmatic choice for NVIDIA home nodes

**Cross-Platform API Compatibility:**
- Both Ollama and LM Studio expose OpenAI-compatible endpoints
- LM Studio also exposes Anthropic-compatible endpoints (newer)
- Both support tool-calling / function-calling

### REVISED RECOMMENDATION

**Don't force one server everywhere. Match the server to the hardware:**

```
Mac nodes (Apple Silicon):
  → LM Studio (llmster daemon) + MLX models
  → Why: 2-3x faster inference on Apple Silicon via MLX
  → Why: unified memory optimization reduces RAM overhead
  → Why: llmster daemon runs headless, same as Ollama
  → Why: Anthropic-compatible API is a bonus for Claude-based tooling

NVIDIA GPU nodes (Ryzen + 3070):
  → Ollama
  → Why: best NVIDIA support out of the box
  → Why: simpler than vLLM for single-user home workloads
  → Why: massive community, most tutorials/guides target Ollama + NVIDIA

Linux/ARM/Edge nodes (Raspberry Pi, old laptops):
  → Ollama OR llama.cpp direct
  → Why: Ollama runs anywhere with minimal setup
  → Why: llama.cpp for ultra-constrained devices

Always-on Gateway (Mac Mini):
  → LM Studio llmster (for local inference) + NadirClaw or custom gateway (for routing)
```

**This changes the Assimilator script:** Instead of always installing Ollama, it detects the hardware and installs the OPTIMAL server:
- Apple Silicon detected → install LM Studio CLI + pull MLX model
- NVIDIA GPU detected → install Ollama + pull GGUF model
- CPU-only / ARM → install Ollama + pull small GGUF model

**The gateway abstracts this away.** Agents don't know or care whether a node runs LM Studio or Ollama — they both expose OpenAI-compatible endpoints. The Queen routes to `http://node-ip:port` regardless of backend.

---

## DECISION 2: THE ROUTING / GATEWAY LAYER

### The Question: Custom nginx config vs NadirClaw vs Helicone vs RouteLLM vs custom code?

### What We Assumed: nginx reverse proxy with path-based routing
### What the Research Says: **NadirClaw already does 90% of what we need.**

### NadirClaw (github.com/doramirdor/NadirClaw)
Holy shit, this exists and it's almost exactly what we were going to build:
- **Smart routing**: classifies prompts in ~10ms using sentence embeddings
- **Three-tier routing**: simple → cheap/local, mid → mid-tier, complex → premium
- **Agentic task detection**: auto-detects tool use, multi-step loops, agent system prompts
- **Reasoning detection**: identifies chain-of-thought needs, routes to reasoning models
- **Local model support**: native Docker + Ollama integration for zero-cost local routing
- **Routing profiles**: `auto`, `eco`, `premium`, `free` (local only), `reasoning`
- **Rate limit fallback**: auto-falls back if primary model returns 429
- **Cost tracking**: built-in dashboard (terminal + web UI), JSONL logs, tier breakdown
- **Drop-in compatible**: works with Claude Code, Cursor, OpenClaw, any OpenAI-compatible client
- **Self-hosted**: Python, no middleman

### Other Options

| Tool | What It Does | BorgClaw Fit |
|------|-------------|-------------|
| **NadirClaw** | Smart prompt-level routing + cost optimization + local model support | **HIGH** — could BE our gateway layer |
| **Helicone AI Gateway** | "NGINX of LLMs" — Rust-based, latency routing, cost optimization | Medium — more enterprise-focused, heavier |
| **RouteLLM** (lm-sys) | Research-grade router, trains routing models, 85% cost savings | Medium — great routing logic but more academic |
| **LLMRouter** (ulab-uiuc) | 16+ routing strategies, OpenClaw-compatible server | Medium — very flexible but complex |
| **nginx raw** | Simple reverse proxy | Low — too dumb for what we need, no prompt analysis |
| **Custom gateway** | Build from scratch | Low — why build when NadirClaw exists? |

### REVISED RECOMMENDATION

**Use NadirClaw as the gateway layer, not raw nginx.**

```
BorgClaw Gateway = NadirClaw instance on Queen node
  ├── Route "free" profile → local nodes (LM Studio / Ollama)
  ├── Route "auto" profile → smart classification → local or cloud
  ├── Route "premium" profile → Claude API
  ├── Route "reasoning" profile → best reasoning model available
  ├── Cost tracking built in
  ├── Dashboard built in
  └── Drop-in OpenAI-compatible proxy
```

NadirClaw with its Docker + Ollama setup can route most requests locally and only pay for the complex stuff — which is literally BorgClaw's thesis.

**What we'd build on top of NadirClaw:**
- Node registry / discovery (NadirClaw doesn't know about multiple backend nodes)
- Hardware-aware model assignment (NadirClaw doesn't auto-detect GPU/RAM)
- The Assimilator script (NadirClaw doesn't have one-click install)
- Heartbeat / health monitoring across nodes
- Shared knowledge base sync

**What we'd NOT need to build:**
- Prompt classification engine (NadirClaw has it)
- Cost tracking (NadirClaw has it)
- Routing logic (NadirClaw has it)
- OpenAI-compatible proxy (NadirClaw has it)
- Dashboard (NadirClaw has it)

This saves WEEKS of development.

---

## DECISION 3: ORCHESTRATION LAYER

### The Question: Paperclip vs LangGraph/custom vs custom?

### What We Assumed: Paperclip
### What the Research Says: **Paperclip is a good fit, but know its boundaries.**

### Paperclip Stack (from GitHub):
- **Runtime:** Node.js + Express REST API
- **Database:** Embedded PGlite (dev) or external PostgreSQL (prod)
- **Frontend:** React dashboard
- **Agent interface:** Agent-agnostic — any LLM provider, any tool stack
- **Governance:** Budget-per-agent, audit trail, board approval model
- **License:** MIT
- **Maturity:** v0.3.0 (23K stars, 2 weeks old — very early)

### Paperclip vs LangGraph

| | Paperclip | LangGraph |
|---|---|---|
| **Focus** | Business orchestration (roles, budgets, governance) | Workflow orchestration (graph-based, state machines) |
| **Agent model** | "Employees" with roles, budgets, approval chains | Nodes in a directed graph with edges as routing logic |
| **State** | PostgreSQL | PostgresSaver or custom checkpointer |
| **Best for** | Multi-agent coordination with human governance | Complex multi-step workflows with branching logic |
| **Host system fit** | Law Two (draft-then-approve), budget tracking, audit trail | Methodology workflows, signal pipeline |
| **Maturity** | 2 weeks old | 1+ year, well-documented |

### REVISED RECOMMENDATION

**They solve different problems. Use both.**

```
Paperclip = "Who does what" (organizational layer)
  ├── Agent roles and permissions
  ├── Budget tracking per agent
  ├── Board approval for actions (Law Two)
  ├── Audit trail
  └── Dashboard for the operator to monitor everything

LangGraph = "How tasks flow" (workflow layer)
  ├── Morning briefing pipeline (scan → synthesize → draft → send)
  ├── Signal detection pipeline (detect → filter → embed → synthesize)
  ├── Content pipeline (brief → draft → edit → publish)
  └── Complex multi-step agent tasks with branching

BorgClaw = "Where tasks run" (infrastructure layer)
  ├── Node registry and health
  ├── Model serving (LM Studio / Ollama per node)
  ├── Smart routing (NadirClaw)
  └── Assimilator for adding nodes
```

Three layers, clean separation, no overlap.

---

## DECISION 4: SHARED STATE / KNOWLEDGE SYNC

### The Question: Git vs Syncthing vs rsync vs cloud sync?

### What We Assumed: Git recommended, with alternatives
### What the Research Says: **Git for version history, Syncthing is risky for git repos.**

Key findings:
- **Syncthing + Git repos = corruption risk.** Multiple reports of repo corruption when Syncthing syncs a working git directory across machines running simultaneously. The `.git` directory gets race conditions.
- **Bare git repo + Syncthing = works.** Syncthing a bare repo (not a working directory) is reliable. But adds complexity.
- **Git pull/push on a schedule = most reliable.** Simple cron job: `git add -A && git commit -m "auto" && git push`. Other nodes pull periodically.
- **For knowledge bases specifically:** The files are Markdown that change slowly (not code with constant saves). Conflict risk is low. Git is the right tool.

### REVISED RECOMMENDATION

```
Primary: Git (private GitHub repo)
  ├── Version history (critical — Law Zero, never delete)
  ├── Conflict resolution (merge, not overwrite)
  ├── Works offline
  ├── Queen runs auto-commit + push every 15 min
  ├── Other nodes pull on startup + every 15 min
  └── Drive sync via gws as cloud backup (existing plan)

DO NOT use Syncthing for the git-managed brain folder.
DO use Syncthing only for large binary assets (audio, images)
that don't belong in git.
```

---

## DECISION 5: MODELS

### The Question: Which models for which roles?

### What We Assumed: Qwen 2.5 everywhere
### What the Research Says: **The model landscape has shifted. GLM-5 and Qwen 3 exist now.**

### Current Best Options (March 2026)

**For Mac Mini (MLX, 24GB):**
| Model | Size | Speed | Best For |
|-------|------|-------|----------|
| Qwen 3 8B (MLX) | ~5GB | Very fast | General routing, tool-calling, triage |
| GLM-4.7-Flash (MLX) | ~5GB | Very fast | 128K context, good tool-calling |
| Phi-4-mini (MLX) | ~2.4GB | Extremely fast | Ultra-light triage, classification |

**For Ryzen + 3070 (GGUF, 8GB VRAM):**
| Model | Size | Speed | Best For |
|-------|------|-------|----------|
| Qwen 2.5 14B Q4_K_M | ~8.5GB | ~35 tok/s | Deep reasoning, code |
| DeepSeek V3.2 7B Q4 | ~4GB | ~70 tok/s | Reasoning-focused tasks |
| CodeLlama 7B Q4 | ~4GB | ~70 tok/s | Dedicated code generation |

**For embeddings (any node):**
| Model | Size | Notes |
|-------|------|-------|
| nomic-embed-text | ~274MB | Standard, well-tested |
| mxbai-embed-large | ~670MB | Better quality, still small |

**For frontier (cloud API):**
| Model | When |
|-------|------|
| Claude Sonnet | Writing in the operator's voice, content platform drafts |
| Claude Opus | Deep foresight synthesis, complex analysis |

### REVISED RECOMMENDATION

Don't hardcode models. The Assimilator should:
1. Detect hardware profile
2. Consult a `models.json` config that maps profiles to recommended models
3. Pull the recommended model
4. `models.json` is updatable — when better models come out, update the config, re-assimilate

```json
{
  "profiles": {
    "mac-heavy": {
      "server": "lmstudio",
      "format": "mlx",
      "models": {
        "primary": "qwen3-8b-mlx",
        "embed": "nomic-embed-text",
        "light": "phi-4-mini-mlx"
      }
    },
    "nvidia-heavy": {
      "server": "ollama",
      "format": "gguf",
      "models": {
        "primary": "qwen2.5:14b-instruct-q4_K_M",
        "embed": "nomic-embed-text",
        "code": "codellama:7b"
      }
    },
    "standard": {
      "server": "ollama",
      "format": "gguf",
      "models": {
        "primary": "qwen2.5:7b",
        "embed": "nomic-embed-text"
      }
    },
    "light": {
      "server": "ollama",
      "format": "gguf",
      "models": {
        "primary": "qwen2.5:3b",
        "embed": "nomic-embed-text"
      }
    }
  },
  "external": {
    "frontier": {
      "provider": "anthropic",
      "models": ["claude-sonnet-4-6", "claude-opus-4-6"]
    }
  },
  "updated": "2026-03-14"
}
```

---

## DECISION 6: THE ASSIMILATOR BINARY

### The Question: Bash script vs compiled binary (Go/Rust)?

### What We Assumed: Bash script first, compiled binary later
### What the Research Says: **Start with bash. Seriously.**

- A bash script works on macOS and Linux immediately
- Windows needs a `.bat` wrapper that calls WSL2 or PowerShell
- A Go binary is better for distribution but adds a build step and complexity
- For dogfooding (operator's own machines), bash is perfect
- For open-source distribution to others, eventually compile to Go

### REVISED RECOMMENDATION

```
v0.1: assimilate.sh (bash) + assimilate.ps1 (PowerShell for Windows)
  ├── Bash works on macOS + Linux natively
  ├── PowerShell works on Windows without WSL
  ├── Both call the same logic: detect → classify → install → register
  └── Fast to iterate, easy to debug

v0.3+: borgclaw-loader (Go binary)
  ├── Cross-compile for all platforms from one codebase
  ├── Single binary, no dependencies
  ├── Better for USB distribution
  └── Can embed model files or download them
```

---

## THE ACTUAL OPEN-SOURCE STACK

### What BorgClaw Leverages (doesn't build):

| Component | Repo | Stars | License | Role in BorgClaw |
|-----------|------|-------|---------|-----------------|
| **LM Studio / llmster** | lmstudio.ai | N/A | Proprietary (free) | LLM server for Apple Silicon nodes (MLX) |
| **Ollama** | github.com/ollama/ollama | 140K+ | MIT | LLM server for NVIDIA / Linux / ARM nodes |
| **NadirClaw** | github.com/doramirdor/NadirClaw | ~2K | MIT | Smart routing gateway + cost tracking |
| **Paperclip** | github.com/paperclipai/paperclip | 23K | MIT | Agent orchestration + governance |
| **LangGraph** | github.com/langchain-ai/langgraph | 12K+ | MIT | Workflow orchestration for complex pipelines |
| **Syncthing** | github.com/syncthing/syncthing | 68K+ | MPL-2.0 | Binary asset sync (NOT for git repos) |
| **Tailscale** | github.com/tailscale/tailscale | 20K+ | BSD-3 | Remote access mesh VPN |
| **nomic-embed-text** | nomic.ai | — | Apache 2.0 | Embedding model for RAG |

### What BorgClaw Builds (the unique value):

| Component | What It Does | Why It Doesn't Exist |
|-----------|-------------|---------------------|
| **Assimilator script** | Hardware detection → optimal server + model install → node registration | Nobody packages detect + install + register as one flow |
| **Node registry + heartbeat** | Queen tracks all nodes, their capabilities, health, load | NadirClaw routes but doesn't discover/track nodes |
| **Hardware-aware model assignment** | Maps GPU/RAM/CPU to optimal model + server | All tools assume you manually chose your model |
| **Multi-server abstraction** | LM Studio on Mac, Ollama on NVIDIA, same API to agents | Everyone assumes one server type |
| **Hive identity (queen-address.json)** | USB carries YOUR credentials, making each cluster unique | No tool has the "plug in and join" metaphor |
| **models.json config** | Updatable model recommendations per hardware profile | Models hardcoded in most setups |

### What Already Exists That We Don't Need to Build:

| Capability | Already Solved By | Don't Reinvent |
|-----------|------------------|---------------|
| LLM inference | Ollama, LM Studio, llama.cpp | ✅ |
| Prompt classification + routing | NadirClaw | ✅ |
| Cost tracking + dashboard | NadirClaw | ✅ |
| Agent orchestration + governance | Paperclip | ✅ |
| Workflow graphs | LangGraph | ✅ |
| Remote access VPN | Tailscale | ✅ |
| File sync | Git + Syncthing | ✅ |
| Embedding models | nomic-embed-text | ✅ |

---

## CRITICAL ISSUE: LM STUDIO IS NOT OPEN SOURCE

LM Studio is free but **proprietary**. This matters for BorgClaw if we're going open-source:
- We can RECOMMEND LM Studio for Mac nodes (it's free, it's best for MLX)
- We can't BUNDLE it or depend on it in the core installer
- The Assimilator should support LM Studio as an OPTION but default to Ollama
- If LM Studio disappears, the system still works (just slower on Mac)

### Fallback for fully open-source stack:
- Use `mlx-lm` (Apple's open-source MLX inference library) directly
- Or use `llama.cpp` with Metal backend (open source, just slower than MLX)
- Or use Ollama (which uses llama.cpp under the hood, so still no MLX advantage)

### RECOMMENDATION:
```
Default: Ollama (open source, works everywhere, good enough)
Recommended for Mac: LM Studio (proprietary but free, 2-3x faster via MLX)
Fully open-source fallback: mlx-lm or llama.cpp with Metal
User chooses at assimilation time.
```

---

## REVISED ARCHITECTURE (Post-Audit)

```
┌──────────────────────────────────────────────────────────────┐
│                    LAYER 3: ORCHESTRATION                      │
│                                                                │
│   Paperclip (governance, budgets, audit)                       │
│   + LangGraph (workflow graphs, pipelines)                     │
│                                                                │
├──────────────────────────────────────────────────────────────┤
│                    LAYER 2: GATEWAY                            │
│                                                                │
│   NadirClaw (smart routing, cost tracking, prompt classif.)    │
│   + BorgClaw node registry (hardware-aware discovery)          │
│                                                                │
├────────────────────┬─────────────────────────────────────────┤
│   LAYER 1: COMPUTE  │                                         │
│                     │                                         │
│  ┌──────────────┐  │  ┌──────────────┐   ┌──────────┐       │
│  │  MAC NODES    │  │  │ NVIDIA NODES  │   │  CLOUD   │       │
│  │  LM Studio    │  │  │  Ollama       │   │  APIs    │       │
│  │  (MLX models) │  │  │  (GGUF models)│   │  Claude  │       │
│  │  2-3x faster  │  │  │  solid perf   │   │  Frontier│       │
│  └──────────────┘  │  └──────────────┘   └──────────┘       │
│                     │                                         │
├────────────────────┴─────────────────────────────────────────┤
│                    SHARED STATE                                │
│   Git repo (version history, conflict resolution)              │
│   + Google Drive backup (via gws)                              │
│   + Syncthing (binary assets only)                             │
└──────────────────────────────────────────────────────────────┘
```

---

## WHAT BORGCLAW ACTUALLY NEEDS TO BUILD (Reduced Scope)

After this audit, BorgClaw's unique contribution is surprisingly small:

1. **The Assimilator script** (~200 lines bash + PowerShell)
   - Hardware detection
   - Server selection (LM Studio vs Ollama vs llama.cpp)
   - Model selection (from models.json)
   - Install + configure
   - Register with Queen

2. **The Queen service** (~500 lines Node.js or Python)
   - Node registry (accept registrations, track heartbeats)
   - Health monitoring (load, uptime, status)
   - NadirClaw configuration (add/remove backends dynamically)
   - Simple web dashboard (node status, routing stats)
   - Hive identity management (token generation, USB config export)

3. **models.json** (config file)
   - Hardware profile → model + server mapping
   - Updatable without code changes

4. **Documentation + README** (the vision)
   - Installation guide
   - Architecture explanation
   - "Why BorgClaw exists" positioning

That's it. Everything else is leverage. ~700 lines of code + config + docs.

---

## DECISION 7: GPU UTILIZATION & POWER MANAGEMENT

### The Requirement
If there's an RTX card, we need to see it being tapped. Every node should show real GPU utilization, and there should be a dial for how much background power/performance each machine contributes to the hive.

### GPU Monitoring — What's Available

**NVIDIA (Ryzen + 3070):**
```
nvidia-smi — built-in, reports:
  ├── GPU utilization %
  ├── Memory used / total
  ├── Temperature
  ├── Power draw (watts)
  ├── Clock speeds
  └── Per-process GPU usage

nvidia-smi --query-gpu=utilization.gpu,utilization.memory,temperature.gpu,power.draw --format=csv
  → "45%, 3200MiB/8192MiB, 67C, 120W"

nvidia-smi dmon — continuous monitoring mode (1-second intervals)
```

**Apple Silicon (Mac Mini M4 Pro):**
```
No nvidia-smi equivalent, but:
  ├── powermetrics — Apple's built-in power monitoring (requires sudo)
  │   → GPU active residency %, frequency, power
  ├── asitop — open-source Apple Silicon monitoring (pip install asitop)
  │   → Real-time GPU/CPU/ANE utilization, power, thermal
  ├── macOS Activity Monitor → GPU History (but no API)
  └── IOKit framework — programmatic access to power/thermal data
```

**Universal (any platform):**
```
Ollama API — /api/ps endpoint shows loaded models + VRAM usage
LM Studio — server status shows model memory + inference stats
psutil (Python) — CPU, RAM, disk I/O (cross-platform)
```

### The Power Dial — Per-Node Throttle Control

Each node gets a configurable "contribution dial" (0-100%):

```json
// In node's local config: /etc/borgclaw/node.json
{
  "contribution": {
    "mode": "balanced",      // "off" | "eco" | "balanced" | "performance" | "max"
    "max_gpu_percent": 70,   // Don't use more than 70% GPU
    "max_ram_percent": 60,   // Leave 40% RAM for other apps
    "max_power_watts": 150,  // Hard power ceiling (NVIDIA only)
    "quiet_hours": {
      "enabled": true,
      "start": "22:00",
      "end": "08:00",
      "mode": "eco"          // Drop to eco during sleep hours
    },
    "thermal_limit_c": 80,   // Throttle if GPU hits 80°C
    "priority": "background"  // "realtime" | "normal" | "background"
  }
}
```

**Contribution modes:**
| Mode | GPU | RAM | Power | Use Case |
|------|-----|-----|-------|----------|
| **off** | 0% | 0% | idle | Machine not contributing |
| **eco** | 20% | 30% | minimal | Background, overnight, quiet hours |
| **balanced** | 50% | 50% | moderate | Default — useful but not intrusive |
| **performance** | 80% | 70% | high | When you need the hive to push |
| **max** | 100% | 90% | unrestricted | Dedicated compute node, no one using it |

**How it works technically:**
- NVIDIA: `nvidia-smi -pm 1 && nvidia-smi -pl <watts>` sets power limit directly
- Ollama: `OLLAMA_MAX_LOADED_MODELS=1` + `OLLAMA_NUM_PARALLEL=1` limits concurrent work
- LM Studio: `llmster --max-concurrent=N` limits parallelism
- OS-level: `nice` / `ionice` (Linux), `taskpolicy` (macOS) for process priority
- Queen-level: simply don't route tasks to nodes in `eco` or `off` mode

### Hivemind Dashboard — What Each Node Reports

Every heartbeat (60s), each node reports to the Queen:

```json
{
  "node": "ryzen-tower",
  "timestamp": "2026-03-14T15:30:00-07:00",
  "status": "online",
  "contribution_mode": "balanced",
  "hardware": {
    "gpu": {
      "name": "RTX 3070",
      "utilization_percent": 45,
      "memory_used_mb": 3200,
      "memory_total_mb": 8192,
      "temperature_c": 67,
      "power_draw_w": 120,
      "power_limit_w": 220
    },
    "cpu": {
      "utilization_percent": 22,
      "temperature_c": 55
    },
    "ram": {
      "used_gb": 12.4,
      "total_gb": 32,
      "model_loaded_gb": 8.5
    }
  },
  "inference": {
    "model_loaded": "qwen2.5:14b-instruct-q4_K_M",
    "requests_last_hour": 47,
    "tokens_generated_last_hour": 23400,
    "avg_tokens_per_sec": 38.2,
    "queue_depth": 0
  },
  "cost_estimate": {
    "power_kwh_today": 1.8,
    "power_cost_today_local": 0.22,
    "power_cost_month_local": 6.60
  }
}
```

### Dashboard Views

The Queen's web dashboard shows:

```
┌─────────────────────────────────────────────────────┐
│  BORGCLAW HIVE — 3 nodes online                      │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────────┐  ┌─────────────────┐           │
│  │ 🟢 mac-mini      │  │ 🟡 ryzen-tower   │           │
│  │ M4 Pro · 24GB   │  │ RTX 3070 · 32GB │           │
│  │                  │  │                  │           │
│  │ GPU: ██░░░ 18%  │  │ GPU: ████░ 45%  │           │
│  │ RAM: ███░░ 42%  │  │ RAM: ███░░ 39%  │           │
│  │ Temp: 52°C      │  │ Temp: 67°C      │           │
│  │ Power: 12W      │  │ Power: 120W     │           │
│  │                  │  │                  │           │
│  │ Model: qwen3-8b │  │ Model: qwen14b  │           │
│  │ Reqs/hr: 124    │  │ Reqs/hr: 47     │           │
│  │ Tok/s: 85       │  │ Tok/s: 38       │           │
│  │                  │  │                  │           │
│  │ Mode: [balanced] │  │ Mode: [balanced] │           │
│  │ ◀ eco ═══●═ max ▶│  │ ◀ eco ═══●═ max ▶│           │
│  │                  │  │                  │           │
│  │ Cost: $0.08/day │  │ Cost: $0.22/day │           │
│  └─────────────────┘  └─────────────────┘           │
│                                                       │
│  ┌─────────────────┐  ┌─────────────────┐           │
│  │ ⚫ laptop (off)   │  │ 🟣 claude-api    │           │
│  │ Last seen: 2h    │  │ Frontier · Cloud │           │
│  │                  │  │ Budget: $14/$50  │           │
│  └─────────────────┘  │ Reqs today: 12   │           │
│                        └─────────────────┘           │
│                                                       │
│  ── HIVE TOTALS ──────────────────────────────       │
│  Tokens today: 52,400 (91% local, 9% cloud)          │
│  Power cost today: $0.30                              │
│  Cloud cost today: $2.10 USD                          │
│  Total estimated monthly: $9.00 power + $14 API       │
└─────────────────────────────────────────────────────┘
```

The slider (contribution dial) is interactive — the operator can drag it from their phone via Tailscale and throttle any node in real time. "Ryzen is running hot and someone's gaming? Slide it to eco." "Need a heavy research pass? Slide everything to max."

### Electricity Cost Estimation

The Queen calculates approximate electricity cost per node:

```
For NVIDIA:
  nvidia-smi reports real-time wattage
  Integrate over time → kWh
  Multiply by local electricity rate (configurable per region)

For Apple Silicon:
  powermetrics or asitop reports package power
  Much lower (~10-30W under load vs 120-220W for GPU)

For CPU-only nodes:
  Estimate from TDP + utilization percentage

Configuration:
  "electricity_rate_per_kwh": 0.12  // configurable per region/currency
```

---

## OPEN QUESTIONS (Need Operator Input)

1. **LM Studio dependency:** Comfortable recommending a proprietary (but free) tool for Mac nodes? Or strictly open-source only?
2. **NadirClaw vs custom gateway:** NadirClaw does 90% of routing — use it directly or fork it?
3. **Paperclip maturity:** It's 2 weeks old with 23K stars. Bet on it now or wait?
4. **v0.1 scope:** Just the Assimilator + basic Queen? Or include NadirClaw integration from day one?
5. **Repo name:** `borgclaw`? Need to check GitHub availability.

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-03-14 | v1.0 created. Full technology audit with benchmarks, competitive analysis, revised recommendations. |
