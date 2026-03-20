# BorgClaw + AK-OS — Build Handoff
## Read this AFTER the Compendium. It captures every decision that changed since.
**Date:** 2026-03-15 | **For:** Claude Code (or any builder)

---

## WHY THIS FILE EXISTS

The `BORGCLAW-COMPENDIUM.md` is the original complete picture. But several key decisions shifted during design sessions on March 15, 2026. The Compendium still references some superseded choices (LanceDB, n8n as definite, etc.). This file is the correction layer — read the Compendium first for the full vision, then read THIS to know what actually changed.

**Read order for Claude Code:**
1. `BORGCLAW-COMPENDIUM.md` — the full 5-layer architecture, vision, agents, build sequence
2. **This file** (`BUILD-HANDOFF.md`) — decision revisions, current state, build plan
3. `SPAWN-REPO.md` — repo structure template (NOTE: some dependencies are stale, this file corrects them)
4. `specs/MIDDLEWARE-SPEC.md` — detailed middleware architecture (7 sublayers)
5. `research/DATA-LAYER-REVISION.md` — QMD replaces LanceDB (full analysis)
6. `SELF-IMPROVEMENT-SYSTEM.md` — autoresearch-inspired evolution architecture
7. `TOOL-LANDSCAPE.md` — living inventory of 30+ tools (know what exists before building)

---

## DECISION REVISIONS (What Changed)

### 1. Data Layer: QMD replaces LanceDB + nomic-embed + context-rules.yaml

**Old plan (in Compendium):** LanceDB for vectors + nomic-embed-text via Ollama for embeddings + custom YAML rules for context assembly + custom MCP for RAG. ~100-200 lines custom code.

**New plan:** QMD (Tobi Lütke, 15.5K stars, MIT). Single `npm install -g @tobilu/qmd`. Three-layer retrieval: BM25 (keyword) + vector (semantic, embedding-gemma-300M) + LLM re-ranking (Qwen3-Reranker-0.6B). Built-in MCP server. Context tree annotations replace YAML rules natively. Zero custom retrieval code.

**Why:** Lower overhead, better search quality (3-layer vs 1-layer), built-in MCP server, context annotations native, MIT license. Eliminates ~100-200 lines of custom code entirely.

**Impact on build:** Remove LanceDB and nomic-embed-text from all dependency lists. Replace `pip install lancedb` + `ollama pull nomic-embed-text` with `npm install -g @tobilu/qmd`. Remove `context-rules.yaml` — use QMD context tree instead. Remove custom MCP for RAG — use QMD's built-in MCP server.

**Full analysis:** `research/DATA-LAYER-REVISION.md`

### 2. Middleware: n8n is UNDER REVIEW — lean option recommended

**Old plan (in Compendium):** n8n as definite workflow engine. Docker container. 400+ integrations.

**New plan:** n8n is under review. Three options documented in `entities/decisions.md` → `n8n-vs-lean-middleware`:
- Option 1: Keep n8n (works, 179K stars, but Sustainable Use License, heavy, 95% more than needed)
- Option 2: Swap to Activepieces (MIT core, 280+ pieces as MCP servers natively)
- **Option C (recommended): Go lean.** No workflow platform. Fizzy webhook → Python router → LangGraph agents → thin MCPs for last-mile. ~200 lines custom code. Build 5-6 thin MCPs: Gmail send, LinkedIn post, Substack publish, GitHub push, X/Twitter post, Google Drive write.

**Why:** We only need 5-6 last-mile integrations. LangGraph already handles workflow orchestration for agent chains. Alexander works with Claude, not drag-and-drop UI. n8n's license is "Sustainable Use" (not truly open source).

**Impact on build:** For Phase 1, build WITHOUT n8n. Use LangGraph for workflow DAG execution + thin MCPs for last-mile delivery. If any integration proves harder than expected, pull that specific Activepieces piece as a standalone MCP — don't install the whole platform.

**Decision status:** OPEN — needs Alexander's final call. Build Phase 1 assuming Option C (lean).

### 3. mem0 for Phase 2 — cross-session memory

**New addition (not in Compendium):** mem0 (49.9K stars, Apache-2.0) for cross-session memory. QMD is search, mem0 is memory — they complement, don't overlap.

**Phase 2 scope:**
- `pip install mem0ai` — self-hosted
- User memory = Alexander's preferences, corrections, voice rules
- Agent memory = per-agent learned behaviors
- Session memory = conversation summaries that persist

### 4. Superpowers as development methodology

**New addition (not in Compendium):** Superpowers (86K stars, MIT, obra) is the recommended development methodology for building BorgClaw itself. Install before Phase 1 begins: `/plugin install superpowers@superpowers-marketplace`. It handles spec → plan → subagent-driven-development → TDD automatically.

**Decision status:** OPEN — needs Alexander's approval. Recommended.

---

## REVISED DEPENDENCY LIST

### Phase 1 — What to Install

| Dependency | Install Command | Purpose | Layer |
|-----------|----------------|---------|-------|
| Node.js 22 LTS | System install | Queen service runtime | 2 |
| Python 3.12+ | System install | Agents, scripts, mem0 (Phase 2) | 2-3 |
| QMD | `npm install -g @tobilu/qmd` | Search/retrieval (replaces LanceDB) | 4 |
| Ollama | `curl -fsSL https://ollama.com/install.sh \| sh` | Local LLM server (non-Mac) | 1 |
| LM Studio | Download from lmstudio.ai | Local LLM server (Mac, optional) | 1 |
| Fizzy | `docker run -p 3456:3456 basecamp/fizzy` | Task queue + dispatch | 3 |
| NATS JetStream | `docker run -p 4222:4222 nats -js` | Event bus | 3 |
| ntfy | `docker run -p 2586:80 binwiederhier/ntfy serve` | Push notifications | 5 |
| LangGraph | `pip install langgraph` | Workflow/reasoning DAG execution | 3 |
| gws | `npm install -g @googleworkspace/cli` | Gmail send + Drive write | 3 |
| Claude Code | Installed separately | Agent runtime, CLAUDE.md bootstrap | 2 |

### Removed from Phase 1
| Was | Why Removed |
|-----|-------------|
| LanceDB | Replaced by QMD |
| nomic-embed-text | Replaced by QMD's built-in embedding-gemma-300M |
| n8n | Under review — building lean (Option C) for Phase 1 |
| context-rules.yaml | Replaced by QMD context tree annotations |
| Custom MCP for RAG | Replaced by QMD built-in MCP server |

### Phase 2 Additions
| Dependency | Install | Purpose |
|-----------|---------|---------|
| mem0 | `pip install mem0ai` | Cross-session memory |
| NadirClaw | `pip install nadirclaw` | Smart LLM routing |
| Paperclip | `git clone + npm install` | Agent governance |

---

## REVISED REPO STRUCTURE

```
borgclaw/
├── README.md
├── LICENSE (MIT)
├── bootstrap.sh                     ← The Bootstrap (Mac/Linux) — provisions any machine
├── bootstrap.ps1                    ← The Bootstrap (Windows)
│
├── src/
│   └── queen/
│       ├── package.json
│       ├── server.js                ← Queen service (~500 lines Node.js)
│       ├── routes/
│       │   ├── nodes.js             ← POST /register, GET /nodes, heartbeat
│       │   ├── health.js            ← GET /health
│       │   └── config.js            ← GET/PUT /config
│       ├── services/
│       │   ├── registry.js          ← Node registry
│       │   ├── heartbeat.js         ← Heartbeat monitor
│       │   └── hardware-profiler.js ← Hardware → profile classification
│       └── dashboard/
│           └── index.html           ← Queen status dashboard
│
├── config/
│   ├── models.json                  ← Hardware profile → model mapping
│   ├── queen.yaml                   ← Queen node configuration
│   ├── nodes/                       ← Per-node YAML configs (auto-generated by bootstrap)
│   │   ├── mac-mini-queen.yaml
│   │   └── tower-worker.yaml
│   ├── agents/                      ← Agent definitions
│   │   ├── jarvis-router.yaml
│   │   ├── cerebro-analyst.yaml
│   │   ├── comms-drafter.yaml
│   │   ├── sentinel.yaml
│   │   └── ops-handler.yaml
│   ├── workflows/                   ← Workflow DAG templates (YAML)
│   │   ├── content-publish-pipeline.yaml
│   │   ├── morning-briefing.yaml
│   │   ├── meeting-prep.yaml
│   │   ├── signal-scan.yaml
│   │   └── job-application.yaml
│   ├── scheduled/                   ← Cron task definitions
│   │   ├── morning-briefing.yaml
│   │   ├── signal-radar-scan.yaml
│   │   ├── network-radar.yaml
│   │   ├── job-scanner.yaml
│   │   ├── content-drafter.yaml
│   │   └── self-improvement-scan.yaml
│   ├── mcps/                        ← MCP registry and thin MCP configs
│   │   ├── registry.yaml            ← Master tool/MCP registry
│   │   ├── qmd.yaml                 ← QMD MCP config
│   │   ├── fizzy.yaml               ← Fizzy MCP config
│   │   └── gws.yaml                 ← Google Workspace CLI config
│   └── experiments/                 ← Self-improvement experiment configs
│       └── META.tsv                 ← Experiment log (autoresearch format)
│
├── agents/                          ← Agent instruction files (Markdown)
│   ├── jarvis-router/
│   │   └── instructions.md
│   ├── cerebro-analyst/
│   │   └── instructions.md
│   ├── comms-drafter/
│   │   └── instructions.md
│   ├── sentinel/
│   │   └── instructions.md
│   └── ops-handler/
│       └── instructions.md
│
├── mcps/                            ← Thin custom MCPs (Option C lean)
│   ├── gmail-send/                  ← ~30 lines, wraps gws or SMTP
│   ├── linkedin-post/               ← ~30 lines, LinkedIn API
│   ├── substack-publish/            ← Unofficial API or browser automation
│   ├── github-push/                 ← Wraps git commands
│   ├── x-post/                      ← ~30 lines, X/Twitter API
│   └── gdrive-write/               ← Wraps gws or Google API
│
├── prompts/                         ← Scheduled task prompt templates
│   ├── morning-briefing.md
│   ├── signal-radar-scan.md
│   ├── job-market-scanner.md
│   ├── weekly-content-drafter.md
│   └── self-improvement-scan.md
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── QUICKSTART.md
│   ├── TECHNOLOGY-DECISIONS.md
│   ├── AGENTS.md
│   ├── MODELS.md
│   └── BOOTSTRAP.md
│
├── docker-compose.yml               ← Fizzy + NATS + ntfy (NO n8n for Phase 1)
│
└── examples/
    ├── workflow-template.yaml
    └── agent-template.yaml
```

---

## WHAT'S MISSING (Documentation Gaps)

### Agent Instructions — ✅ ALL 5 COMPLETE
All agent instructions now exist:
- ✅ `jarvis-router/instructions.md` — Chief of Staff, triage and routing
- ✅ `cerebro-analyst/instructions.md` — Intelligence, research, signal scanning
- ✅ `comms-drafter/instructions.md` — Voice-matched writing, all communications
- ✅ `sentinel/instructions.md` — Pattern detection, risk monitoring, relationship decay
- ✅ `ops-handler/instructions.md` — Last-mile execution, file ops, delivery

### Workflow YAML Templates — 3 of 6 Complete
Three core workflows now exist as parseable YAML DAGs in `config/workflows/`:
- ✅ `content-publish-pipeline.yaml` — Full 10-step DAG: research → draft → parallel (assets, social, podcast) → publish → distribute
- ✅ `morning-briefing.yaml` — 6-step DAG: calendar + inbox + signals + patterns → format → deliver
- ✅ `signal-scan.yaml` — 9-step DAG: 5 parallel source scans → classify → update landscape + signals → deliver

**Still need:**
- `meeting-prep.yaml` — Calendar trigger T-24h → research attendees → draft prep doc
- `job-application.yaml` — Research company → tailor resume → draft cover letter → submit
- `relationship-nudge.yaml` — Decay threshold → draft outreach → send (approval required)

### Config Directory — ✅ CREATED
Core config files now exist in `config/`:
- ✅ `models.json` — Hardware profile → model mapping (4 profiles, routing rules)
- ✅ `nodes/queen-mac-mini.yaml` — Queen node config (services, QMD collections, capabilities)
- ✅ `nodes/tower-worker.yaml` — Worker node config (hardware, services, heartbeat)
- ✅ `mcps/registry.yaml` — Master MCP/tool registry with capability index
- ✅ `MODULARITY.md` — The modularity philosophy as an architecture principle
- ✅ `workflows/` — 3 workflow DAG templates (see above)

### Thin MCPs — 0 of 6 Built
The Option C (lean middleware) approach requires building 5-6 thin MCPs (~30 lines each) for last-mile delivery.

**Need to build:**
- gmail-send MCP (or wrapper around gws CLI)
- linkedin-post MCP
- substack-publish MCP (hardest — no official API)
- github-push MCP (or connect existing GitHub MCP)
- x-post MCP
- gdrive-write MCP (or wrapper around gws CLI)

### bootstrap.sh — Not Written
The Compendium describes `assimilate.sh` (hardware detection, model install, node registration). The config dashboard describes `bootstrap.sh` (broader: full AK-OS provisioning including QMD indexing, scheduled tasks, MCP servers).

**Need to write:** A unified bootstrap script that:
1. Detects hardware (CPU, GPU, RAM, OS)
2. Maps to hardware profile from models.json
3. Installs dependencies (Node.js, Python, QMD, Ollama/LM Studio)
4. Configures node role (Queen/Worker/Satellite)
5. Indexes akos/ knowledge base in QMD
6. Adds context annotations
7. Starts appropriate services (NATS, QMD MCP, Fizzy MCP, etc.)
8. Registers with Queen (if Worker)
9. Sets up scheduled cron tasks
10. Runs health check

### BORGCLAW-COMPENDIUM.md — Stale in 3 Areas
The Compendium (the primary handoff doc) still references:
1. **Layer 4:** "Vector index: LanceDB + nomic-embed-text" — should be "QMD (BM25 + vector + reranking)"
2. **Layer 3:** "Fizzy → n8n (orchestration) → LangGraph" — n8n is under review, lean option recommended
3. **Technology Choices section:** Still lists LanceDB and n8n as definite — needs QMD and lean middleware revision
4. **Dependencies table:** Still lists LanceDB, nomic-embed-text, n8n — needs update

**Recommendation:** Update the Compendium to reflect current decisions, OR accept that this BUILD-HANDOFF.md serves as the correction layer and instruct Claude Code to read both.

---

## REVISED BUILD SEQUENCE

### Phase 0: Setup (Before Building)
- [ ] Install Superpowers development methodology (`/plugin install superpowers@superpowers-marketplace`)
- [ ] Initialize akos as git repo, push to GitHub private
- [ ] Install gws on tower (`npm install -g @googleworkspace/cli`)
- [ ] Install QMD on queen (`npm install -g @tobilu/qmd`)
- [ ] Index AK-OS files in QMD, add context annotations

### Phase 1: "First Pulse" (v0.1)
**Goal:** One Queen node online. Tasks flow in, agents execute, results come out.

1. **Queen Service** — Node.js HTTP server (~500 lines)
   - Node registration, heartbeat, dashboard
   - In-memory + file-backed state (no DB)
   - Single HTML dashboard at `/`

2. **bootstrap.sh** — The bootstrap script (~300 lines bash)
   - Hardware detection, dependency install, QMD indexing
   - Node role selection (Queen/Worker/Satellite)
   - Idempotent (running twice is safe)

3. **docker-compose.yml** — Fizzy + NATS + ntfy
   - NO n8n in Phase 1
   - Fizzy for task capture
   - NATS for event bus
   - ntfy for approval notifications

4. **Agent instruction files** — 5 agents (Markdown)
   - Jarvis (router), Cerebro (intelligence), Comms (writing), Sentinel (monitoring), Ops (delivery)
   - Each agent has: role, capabilities, tools, governance rules, context files

5. **Config structure** — YAML files for nodes, agents, workflows, MCPs, scheduled tasks

6. **2-3 workflow templates** — content-publish-pipeline, morning-briefing, signal-scan (YAML)

### Phase 2: "Nervous System" (v0.2)
- NadirClaw integration (smart LLM routing)
- Paperclip integration (agent governance, budgets)
- mem0 integration (cross-session memory)
- Multi-node cluster (Worker joins Queen)
- Thin MCPs for last-mile delivery (5-6)

### Phase 3: "Full Orchestra" (v0.3)
- All 5 agents running with persistent memory
- Self-improvement experiments running
- Signal Radar executing weekly
- Content pipeline end-to-end
- Public GitHub release

---

## OPEN DECISIONS (Need Alexander's Input Before Build)

| Decision | Options | Recommendation | File Reference |
|----------|---------|---------------|----------------|
| n8n vs lean middleware | Keep n8n / Swap Activepieces / Go lean | Option C (lean) | `entities/decisions.md` → `n8n-vs-lean-middleware` |
| Install Superpowers for dev | Yes / No | Yes (86K stars, MIT, handles spec→build→test) | `entities/decisions.md` → `superpowers-adoption` |
| QMD as data layer | QMD / Keep LanceDB | QMD (15.5K stars, MIT, 3-layer retrieval) | `research/DATA-LAYER-REVISION.md` |
| Arcana operating model | Clarify scope | Needs Alexander's input | `entities/decisions.md` → `arcana-operating-model` |

---

## FILE REFERENCE MAP

| What You Need | Where To Find It |
|--------------|-----------------|
| Full system vision | `BORGCLAW-COMPENDIUM.md` (read first, but see revisions above) |
| Decision corrections | This file (`BUILD-HANDOFF.md`) |
| Repo structure template | `SPAWN-REPO.md` (note: dependencies stale, use revised list above) |
| 5-layer architecture | `BORGCLAW-COMPENDIUM.md` §2 |
| Middleware spec (7 sublayers) | `specs/MIDDLEWARE-SPEC.md` |
| Infrastructure buildout | `specs/INFRASTRUCTURE-BUILDOUT.md` |
| QMD analysis (data layer revision) | `research/DATA-LAYER-REVISION.md` |
| Data layer audit (landscape) | `research/DATA-LAYER-AUDIT.md` |
| Middleware technology audit | `research/MIDDLEWARE-TECHNOLOGY-AUDIT.md` |
| Infrastructure technology audit | `research/TECHNOLOGY-AUDIT.md` |
| Self-improvement system | `../../SELF-IMPROVEMENT-SYSTEM.md` |
| Tool landscape (30+ tools) | `../../TOOL-LANDSCAPE.md` |
| Signal Radar spec | `research/SIGNAL-RADAR-SPEC.md` |
| Operating laws | `../../entities/operating-laws.md` |
| Open decisions | `../../entities/decisions.md` |
| Agent instructions (Jarvis) | `agents/jarvis-router/instructions.md` |
| Agent instructions (Cerebro) | `agents/cerebro-analyst/instructions.md` |
| Voice/brand rules | `../../../memory/context/voice-and-brand-rules.md` |
| Config dashboard (visual) | `assets/akos-config-dashboard.html` |
| Full stack diagram (visual) | `assets/borgclaw-full-stack.html` |

---

*This file is the bridge between design and build. The Compendium gave the vision. This file gives the current truth. Read both, build from here.*
