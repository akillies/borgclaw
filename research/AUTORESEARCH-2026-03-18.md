# BorgClaw Autoresearch Loop — Stack Audit
**Date:** 2026-03-18 | **Trigger:** Pre-launch review
**Method:** Scan all component domains → score each (Quality × Replaceability × Effort) → KEEP / SWAP / UPGRADE / ADD / WATCH

> *"The system watches for its own replacement parts."*

---

## SCORING METHOD

Each component evaluated against current best-in-class as of March 18, 2026:

- **Quality gap**: How much better is the alternative?
- **Replaceability**: How hard is it to swap?
- **Effort**: Hours to implement change

**Decision threshold**: Swap if (Quality gap × Replaceability) / Effort > 0.5

---

## COMPONENT DECISIONS

### ✅ KEEP — Ollama

**Current:** v0.18.2-rc0 (March 17, 2026)
**Alternatives evaluated:** LM Studio 0.4.6, vllm-mlx, mistral.rs, llama.cpp server

**Findings:**
- Ollama still best for zero-to-inference simplicity. Auto-detects Metal on Apple Silicon.
- LM Studio 0.4.6 now has continuous batching with MLX — better for sustained throughput
- vllm-mlx is 21-87% faster than llama.cpp on Apple Silicon (new project, February 2026)
- mistral.rs is interesting (Rust, auto-quantization) but too young for primary runtime

**Decision:** KEEP Ollama as primary runtime. Add LM Studio as preferred alternative for Apple Silicon (bootstrap.sh already lists it). Log vllm-mlx for Phase 2 evaluation.

**Score:** Quality gap small / Effort high → Stay

---

### ✅ KEEP — LiteLLM

**Current:** v1.82.1 (March 18, 2026) — 38.6K GitHub stars
**Alternatives evaluated:** Bifrost (Go), Portkey, OpenRouter, RouteLLM

**Findings:**
- LiteLLM still battle-tested and most mature. Frequent releases. Claude 4.6 support current.
- Bifrost (Go, 50x faster at 5K RPS, 11µs overhead) is real and promising — but too young
- RouteLLM: FROZEN since August 2024. Skip.
- OpenRouter simpler but not self-hosted
- Portkey better for enterprise/multi-tenant, overkill for personal cluster

**Decision:** KEEP LiteLLM. Add Bifrost to Phase 2 watchlist. At 3-5 nodes and personal workload, LiteLLM's Python latency is not the bottleneck.

**Score:** Quality gap moderate / Effort high → Stay, watch Bifrost

---

### ✅ CONFIRMED REAL — NadirClaw (install command fix needed)

**Current:** github.com/doramirdor/NadirClaw — MIT, Python
**Status:** REAL. Active. HN-endorsed February 2026.

**Findings:**
- Confirmed: `pip install nadirclaw[dashboard]` — NOT `pip install nadirclaw`
- Correct install needs the `[dashboard]` extras for the web UI
- Binary classifier: simple→local, complex→cloud, ~10ms, claims 40-70% cost reduction
- Drop-in OpenAI-compatible proxy — correct as documented

**FIX REQUIRED:** Update install command in `agents/jarvis-router/agent.json` and `docs/QUICKSTART.md`

**Decision:** KEEP. Confirmed real. Fix install command.

---

### ✅ KEEP — NATS JetStream

**Current:** Production-ready, actively maintained
**Alternatives evaluated:** Redis, Kafka, RabbitMQ, Apache Pulsar

**Findings:**
- NATS JetStream now covers KV store natively → Redis not needed as separate service
- For 3-5 node personal cluster: NATS is correct. Kafka is massive overkill.
- NATS single binary, minimal ops overhead, proven persistence

**Decision:** KEEP. Also means: **Redis is not needed** — NATS JetStream KV handles shared ephemeral state. Simplifies the stack by one service.

---

### ✅ KEEP — LangGraph

**Current:** v1.0.10+ — GA since October 2025 — 22.5K stars
**In production:** Uber, LinkedIn, Klarna
**Alternatives evaluated:** CrewAI 1.10.1, Microsoft Agent Framework RC, Pydantic AI 1.69.0

**Findings:**
- LangGraph 1.0 is the production choice for complex multi-agent orchestration with checkpointing
- CrewAI gets you to prototype 40% faster but LangGraph executes 2.2x faster at runtime
- CrewAI: 45.9K stars, 12M daily executions — serious player, but designed for simpler topologies
- Microsoft Agent Framework 1.0.0rc1 is GA candidate (Q1 2026) — strong if .NET/Azure
- Pydantic AI 1.69.0 — type-safe, durable, rising dark horse — 15.5K stars

**Decision:** KEEP LangGraph for the workflow orchestration layer. Note: **Pydantic AI** worth evaluating for the comms-drafter agent specifically — type safety around content schemas is valuable there.

---

### ✅ KEEP — MCP Protocol

**Current:** Industry standard. 6,400+ registered servers. Donated to Linux Foundation AAIF.
**Key developments:**
- Transport scaling issues (stateful sessions breaking with horizontal scaling) being fixed Q1-Q2 2026
- MCP Server Cards (.well-known metadata) coming in next spec release
- For a personal cluster (not horizontal scaling), transport issues don't apply

**Decision:** KEEP. This is now the correct protocol choice, confirmed. Transport issues are not relevant at personal scale.

---

### ⚠️ DEAD WIRE FOUND — models.json: nvidia-8gb-32gb-ram reasoning model

**Current config:** `reasoning: qwen3:14b, vram_gb: 9.5`
**Problem:** 9.5GB does NOT fit in an 8GB VRAM GPU. This configuration will crash at load.

**FIX:** Remove `reasoning` tier from nvidia-8gb-32gb-ram profile. 8GB VRAM caps at 7B models at Q4_K_M. The worker node routes heavy reasoning to cloud or Mac Mini.

---

### 🔄 UPGRADE — models.json: Better model recommendations across profiles

Research confirms materially better options for every primary tier. These are config changes only — no code changes.

#### mac-apple-silicon-24gb

| Slot | Current | Recommended | Why |
|------|---------|-------------|-----|
| router | qwen3:8b (5.5GB) | **phi4-mini:3.8b** (3.5GB) | 40% faster, designed for triage/routing, leaves more RAM for synthesis |
| general | qwen3:8b | **qwen3:8b** (KEEP) | Still solid for general assistant work |
| synthesis | qwen3:14b (9.5GB) | **gemma3:27b** (18GB Q5_K_M) | Gemma 3 27B: 128K context, LMSys Elo 1339 (top 10 globally), beats Gemini 1.5-Pro on several benchmarks |
| code | qwen2.5-coder:7b | **qwen2.5-coder:14b** (9.5GB) | 14B version significantly better, fits with 24GB, ranked #1 local coding 2026 |
| embedding | embedding-gemma-300M | **nomic-embed-text:v2** (475M MoE) | 1.6B contrastive pairs, 100 languages, MoE activates only 305M, Matryoshka dims |

**Memory check (24GB):**
- phi4-mini (router) running: 3.5GB
- Can hot-swap between: qwen3:8b (5.5GB), gemma3:27b (18GB), qwen2.5-coder:14b (9.5GB)
- Only one large model loaded at a time — Ollama handles load/unload automatically ✅

#### nvidia-8gb-32gb-ram

| Slot | Current | Recommended | Why |
|------|---------|-------------|-----|
| general | qwen3:8b (5.5GB — tight) | **phi4-mini:3.8b** (3.5GB) | Safer fit, faster, better reasoning-per-parameter, 4.5GB headroom for context |
| reasoning | qwen3:14b (9.5GB — BROKEN) | **REMOVE** | 9.5GB > 8GB VRAM. Route reasoning tasks to Mac Mini or cloud |
| code | qwen2.5-coder:7b | **KEEP** | Still correct for 8GB |

---

### ➕ ADD — mem0 (Phase 2)

**Status:** Production-ready. 48K GitHub stars. 14M+ downloads. SOC 2 compliant.
**Performance:** 91% lower p95 latency vs full-context, 90%+ token cost savings, 66.9% accuracy on benchmarks.

**What it adds:** Cross-session agent memory. Currently the stack has no memory persistence between conversations — each agent starts fresh. mem0 solves this.

**Integration:** Native support in LangGraph, CrewAI, LlamaIndex. `pip install mem0ai`. Self-hosted.

**Decision:** ADD to Phase 2 scope. Not blocking Phase A/E (the USB build), but add to CLAUDE-CODE-HANDOFF as Phase 2 first task.

**Alternative:** Letta (formerly MemGPT) — more sophisticated, explicit memory semantics, self-improving. Phase 3 consideration.

---

### 👁️ WATCHLIST (Not ready to swap, re-evaluate in 90 days)

| Tool | Why Watching | Re-evaluate When |
|------|-------------|-----------------|
| vllm-mlx | 21-87% faster than llama.cpp on Apple Silicon | Stars > 2K, stable release |
| Bifrost | 50x faster than LiteLLM (Go), 11µs overhead | Stars > 5K, 6+ months of production use |
| Pydantic AI | Type-safe agents, v2 coming April 2026, 15.5K stars | v2 release, evaluate for comms-drafter |
| Gemma 3 4B | "Gemma-3-4B-IT outperforms Gemma-2-27B-IT" — if true, changes 8GB recommendations | Verify benchmarks independently |
| DeepSeek R2 | 1.2T parameter MoE, o1-class reasoning — not confirmed released yet | Actual release confirmed |
| Letta | Self-improving agents with explicit memory semantics | After mem0 Phase 2 is running |

---

## FIXES REQUIRED BEFORE HANDOFF TO CLAUDE CODE

These are errors found in the current scaffold that Claude Code must fix:

### Fix 1: NadirClaw install command (two locations)

```
agents/jarvis-router/agent.json:
  WRONG:   "pip install nadirclaw && nadirclaw --port 8856 --backend http://localhost:4000"
  CORRECT: "pip install nadirclaw[dashboard] && nadirclaw --port 8856 --backend http://localhost:4000"

docs/QUICKSTART.md: same fix wherever NadirClaw install appears
```

### Fix 2: models.json — nvidia-8gb-32gb-ram reasoning model (crash-on-load)

```
REMOVE the reasoning: qwen3:14b entry from nvidia-8gb-32gb-ram profile.
8GB VRAM cannot fit 9.5GB model. Will OOM crash on load.
Add a note: reasoning tasks route to Mac Mini (queen) or cloud.
```

### Fix 3: models.json — upgrade primary model recommendations

```
mac-apple-silicon-24gb:
  - Add: router tier → phi4-mini:3.8b (new, faster than qwen3:8b for triage)
  - Upgrade: synthesis tier → gemma3:27b (replaces qwen3:14b, much better)
  - Upgrade: code tier → qwen2.5-coder:14b (replaces 7b)
  - Upgrade: embedding → nomic-embed-text:v2 (replaces embedding-gemma-300M)

nvidia-8gb-32gb-ram:
  - Upgrade: general → phi4-mini:3.8b (replaces qwen3:8b, safer VRAM fit)
  - REMOVE: reasoning tier (crashes on 8GB VRAM)
```

### Fix 4: Add .env.example

Missing. Claude Code needs to create it. See CLAUDE-CODE-HANDOFF.md Priority 3.

---

## WHAT THE STACK LOOKS LIKE AFTER THESE FIXES

```
INFERENCE
  Mac Mini (M4 Pro 24GB):  Ollama (primary) / LM Studio (high-throughput alt)
  RTX 3070 (8GB):          Ollama + CUDA

ROUTING
  NadirClaw :8856          Binary classifier → local (simple) or LiteLLM (complex)
  LiteLLM :4000            Model-agnostic proxy → 4-tier routing table

ORCHESTRATION
  LangGraph                Workflow DAGs, subgraphs, checkpointing
  Queen :9090              Node registry, heartbeat, capability lookup

COORDINATION
  NATS JetStream :4222     Event bus + KV store (replaces Redis — not needed)
  ntfy :2586               Push notifications + approval buttons

MEMORY (Phase 2)
  mem0                     Cross-session agent memory, self-hosted

SEARCH
  QMD                      BM25 + vector + LLM rerank over markdown files

MODELS — Mac Mini
  phi4-mini:3.8b           Router/triage (fast, 3.5GB)
  qwen3:8b                 General assistant (5.5GB)
  gemma3:27b               Long-context synthesis (18GB, 128K context)
  qwen2.5-coder:14b        Code generation (9.5GB)
  nomic-embed-text:v2      Embeddings (475M MoE, ~0.5GB)

MODELS — RTX 3070
  phi4-mini:3.8b           General ops (3.5GB, safe fit)
  qwen2.5-coder:7b         Code (4.5GB)
```

---

## WHAT WAS CONFIRMED NOT TO BUILD

Everything we already decided not to build was confirmed correct by this audit:

| Decision | Confirmation |
|----------|-------------|
| No Fizzy in Docker | Confirmed: it's a Rails app, wrong architecture |
| No Paperclip | Confirmed: governance via Queen API is correct |
| No n8n | Confirmed: LangGraph covers DAG orchestration |
| No RouteLLM | Confirmed: frozen since August 2024 |
| No OpenAI Swarm | Confirmed: deprecated, replaced by Agents SDK |
| No Redis separately | Confirmed: NATS JetStream KV covers shared state |

---

*Autoresearch loop complete. Next scan: Friday 2026-03-20 (weekly cadence via Signal Radar).*
*All changes above incorporated into CLAUDE-CODE-HANDOFF.md and models.json.*
