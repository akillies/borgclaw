# BorgClaw Data Layer Audit
## "Context and AI will always be at each other's throats"
**Date:** 2026-03-15

---

## THE QUESTION

Is our data layer (LanceDB + nomic-embed-text) actually sorted? Or are we underinvesting in the layer that matters most — the context layer between the operator's knowledge and the agents that use it?

The operator flagged OpenViking (volcengine, 12.6K stars) as something to look at. This audit maps the full landscape.

---

## WHAT OUR DATA LAYER CURRENTLY DOES

### Current Stack: LanceDB + nomic-embed-text
- **LanceDB** — embedded vector DB (no server process), disk-based, zero-copy, Apache-2.0
- **nomic-embed-text** — embedding model via Ollama, runs locally
- **Context assembly** — rules in MIDDLEWARE-SPEC.md that map task types → which knowledge base files get loaded

### What It's Good At
- Zero infrastructure (library, not service)
- Fast for small datasets (500K words of markdown = small)
- Fully local, no API calls for embeddings
- Simple: embed files → query → retrieve chunks

### What It Doesn't Do
- **No memory management** — doesn't track what was useful vs. what was noise
- **No hierarchical context** — flat retrieval, no directory structure awareness
- **No session memory** — each Claude session starts cold
- **No self-evolving context** — doesn't learn from which context led to good vs bad outcomes
- **No multi-modal** — markdown only, can't handle images/PDFs natively
- **No observable retrieval** — can't see WHY certain context was retrieved (black box)

---

## THE LANDSCAPE (March 2026)

### Tier 1: Purpose-Built Context/Memory for Agents

| Tool | Stars | License | What It Does | Key Differentiator |
|------|-------|---------|-------------|-------------------|
| **mem0** | 49.9K | Apache-2.0 | Universal memory layer for AI agents. User/session/agent memory. | +26% accuracy vs OpenAI Memory. 91% faster. 90% fewer tokens. YC S24. Self-hosted option. |
| **Letta** (ex-MemGPT) | 21.6K | Apache-2.0 | Platform for stateful agents with advanced memory that self-improves over time. | Memory blocks (persona + human), CLI tool, full API, self-hosted. Agents learn across sessions. |
| **memvid** | 13.5K | Apache-2.0 | Single-file memory layer. Replaces RAG pipelines. Inspired by video encoding (Smart Frames). | +35% SOTA on LoCoMo benchmark. 0.025ms P50 latency. No database needed. Rust core. Portable single file. |
| **OpenViking** | 12.6K | Apache-2.0 | Context database for agents. Filesystem paradigm. L0/L1/L2 tiered context loading. | Unifies memory + resources + skills. Directory-based retrieval (not flat). Observable retrieval trajectories. Auto session compression. |

### Tier 2: RAG Frameworks (Broader, Less Focused)

| Tool | Stars | What It Does | Notes |
|------|-------|-------------|-------|
| LangChain | 130K | Agent engineering platform | Huge but kitchen-sink. We use LangGraph (subset) already. |
| LlamaIndex | 47.7K | Document agent + OCR platform | Strong for document-heavy RAG. Heavier than we need. |
| Haystack (deepset) | 24.5K | Context-engineered AI orchestration | "Context engineering" focus. Production-grade. |

### Tier 3: Our Current Choice

| Tool | Stars | What It Does | Notes |
|------|-------|-------------|-------|
| LanceDB | 5K+ | Embedded vector DB | Simple, fast, no server. But no memory management, no hierarchy, no self-improvement. |

---

## DEEP DIVE: THE FOUR CONTENDERS

### 1. mem0 (49.9K stars)
**What the operator would use it for:** Persistent memory across Claude sessions. mem0 would remember what the operator cares about, what they've rejected before, what voice rules they've corrected, what patterns have been detected — across every session, not just within one.

**Architecture:**
- Multi-level: User memory (operator preferences), Session memory (current conversation), Agent memory (per-agent learned behaviors)
- Graph memory for relationship-aware retrieval
- Self-hosted via `pip install mem0ai` or hosted platform
- Supports any LLM (Claude, GPT, local models)

**Fit for the host system:**
- ✅ Solves the "cold start" problem — every session starts with the operator's full context
- ✅ Agent memory means Comms-Drafter learns voice preferences, Cerebro learns research patterns
- ✅ Apache-2.0, self-hosted, Python
- ⚠️ Still needs a vector store backend (Qdrant, Chroma, or custom) — adds complexity
- ⚠️ Research paper claims are vs. OpenAI Memory, not vs. simple RAG — our use case is simpler

**Principle check:** Agnostic ✅ | Modular ✅ | Portable ✅ (self-hosted) | Extensible ✅ | Self-improving ✅ (core feature)

### 2. Letta / MemGPT (21.6K stars)
**What the operator would use it for:** Agents that actually remember and learn across sessions. Letta agents have persistent memory blocks that update over time — the agent gets smarter with use.

**Architecture:**
- Memory blocks: structured data (persona, human context) that agents read/write
- Self-improving: agents modify their own memory based on interactions
- CLI tool (`letta`) + full API + SDKs
- Model-agnostic (recommends Opus 4.5 / GPT-5.2)

**Fit for the host system:**
- ✅ Self-improving memory is THE thing our data layer is missing
- ✅ Memory blocks map to host system entity files (people.md, patterns.md, etc.)
- ✅ Agents that learn = our Self-Improvement System's Surface 2 (Agent Prompts) built-in
- ⚠️ Heavier platform — might be overkill for 5 agents + 500K words
- ⚠️ Primarily a hosted service (Letta API key), self-hosted is secondary path
- ❌ Requires Node.js 18+ for CLI — adds runtime dependency

**Principle check:** Agnostic ✅ | Modular ⚠️ (platform) | Portable ⚠️ (hosted-first) | Extensible ✅ | Self-improving ✅✅ (core thesis)

### 3. memvid (13.5K stars)
**What the operator would use it for:** Replace LanceDB entirely. Package all knowledge base content into a single portable file with instant retrieval. No database, no server, no RAG pipeline.

**Architecture:**
- Inspired by video encoding — "Smart Frames" (immutable units with timestamps, checksums, metadata)
- Append-only writes (crash safe, versioned)
- Single file = portable, backupable, transferable between machines
- Rust core, Python/JS bindings
- 0.025ms P50 retrieval latency

**Fit for the host system:**
- ✅ Single file = ultimate portability (copy to new machine, done)
- ✅ Append-only = Law Zero (never delete) built into the data structure
- ✅ Versioned = can rewind to previous knowledge states
- ✅ Rust core = fast, small footprint
- ✅ No server = simpler than LanceDB even
- ⚠️ Newer project (13.5K stars in short time = hype risk?)
- ⚠️ Less proven at scale — our dataset is small so this might not matter
- ❌ No built-in memory management or self-improvement — it's a storage layer, not a context engine

**Principle check:** Agnostic ✅ | Modular ✅ | Portable ✅✅ (single file!) | Extensible ✅ | Self-improving ❌ (storage only)

### 4. OpenViking (12.6K stars)
**What the operator would use it for:** Replace our entire context assembly approach. Instead of "load these files for this task type" (static rules), OpenViking organizes ALL context (memories, resources, skills) as a filesystem. Agents navigate directories to find what they need. Retrieval is observable — you can SEE why something was retrieved.

**Architecture:**
- Filesystem paradigm: context organized as dirs/files (not flat vector space)
- L0/L1/L2 tiered loading: L0 always loaded, L1 loaded on demand, L2 deep retrieval
- Directory recursive retrieval: combines directory positioning with semantic search
- Observable: visualize retrieval trajectories (debug why agent got wrong context)
- Auto session management: compresses conversations, extracts long-term memory
- Requires VLM (vision-language model) + embedding model

**Fit for the host system:**
- ✅ Filesystem paradigm matches the host system perfectly — knowledge is already organized as markdown files in directories
- ✅ L0/L1/L2 maps to the existing tier system (Tier 1/2/3 context files)
- ✅ Observable retrieval = solves the black box problem
- ✅ Auto session compression = cross-session memory
- ✅ Apache-2.0, Python, self-hosted
- ⚠️ Volcengine (ByteDance) backed — Chinese origin, active English community but worth noting
- ⚠️ Requires VLM + embedding model running = more compute than LanceDB
- ⚠️ 12.6K stars growing fast but younger project
- ⚠️ The "openclaw" reference in their description — are they building something like BorgClaw? Worth watching.

**Principle check:** Agnostic ✅ | Modular ✅ | Portable ✅ | Extensible ✅ | Self-improving ✅ (auto session memory)

---

## THE REAL QUESTION: WHAT PROBLEM ARE WE ACTUALLY SOLVING?

The operator nailed it: "context and AI will always be at each other's throats." The data layer isn't a solved problem — it's THE unsolved problem. Every tool here is attacking it from a different angle.

Our current approach (LanceDB + nomic-embed + static context rules) works for Phase 1. It's simple, fast, zero infrastructure. But it has three gaps that will bite us:

### Gap 1: No Cross-Session Memory
Every Claude session starts cold. The system doesn't remember what worked last time. This is the biggest gap. mem0 or Letta solve this directly.

### Gap 2: No Self-Evolving Context
The context assembly rules are static YAML. They don't learn from outcomes. If Comms-Drafter keeps getting voice corrections, nothing automatically adjusts which voice files get loaded. Our Self-Improvement System (Surface 4: Context Assembly) designs experiments around this, but the underlying data layer doesn't support it natively.

### Gap 3: No Observable Retrieval
When an agent gets wrong context, we can't see why. Was it a bad embedding? Wrong chunk size? Missing file? OpenViking's retrieval trajectory visualization solves this. For a system that's supposed to self-improve, observability is prerequisite.

---

## RECOMMENDATION: LAYERED APPROACH

Don't swap everything at once. Layer improvements as the system matures.

### Phase 1 (Now → First Pulse): Keep LanceDB + nomic-embed
- It works. It's simple. Our dataset is 500K words of markdown.
- Context assembly via static rules in YAML is fine for 5 agents and ~20 workflows.
- Don't overengineer the data layer before we have data about what's failing.

### Phase 2 (v0.2 → Middleware Integration): Add mem0 for Cross-Session Memory
- `pip install mem0ai` — Apache-2.0, self-hosted, uses our existing LLM
- User memory = operator preferences, corrections, voice rules
- Agent memory = per-agent learned behaviors (what Comms-Drafter has been corrected on)
- Session memory = conversation summaries that persist
- Runs alongside LanceDB — mem0 for memory, LanceDB for document retrieval

### Phase 3 (v0.3+): Evaluate OpenViking vs memvid for Document Layer
- By this point we'll have data on what's failing in context assembly
- If retrieval quality is the problem → OpenViking (filesystem paradigm, observable)
- If portability/simplicity is the priority → memvid (single file, Rust, fastest)
- If neither is needed → stay with LanceDB (it's fine for small datasets)

### Watch List (Don't Adopt Yet)
- **Letta** — interesting but platform-heavy. If we want self-improving agents, mem0 + our Self-Improvement System may be sufficient without another platform.
- **Haystack** — if we need production-grade RAG pipelines. Probably overkill.
- **LlamaIndex** — if we need heavy document processing (OCR, PDFs). Not our current need.

---

## QUALITY BAR CHECK

| Tool | Stars | Last Push | Community | License | Principles | Verdict |
|------|-------|-----------|-----------|---------|------------|---------|
| mem0 | 49.9K | 2026-03-14 | Active (YC backed) | Apache-2.0 | 5/5 | ✅ Passes bar |
| Letta | 21.6K | 2026-03-16 | Active | Apache-2.0 | 4/5 | ⚠️ Hosted-first concern |
| memvid | 13.5K | 2026-03-14 | Growing fast | Apache-2.0 | 4/5 | ⚠️ Young, no self-improvement |
| OpenViking | 12.6K | 2026-03-16 | Active (ByteDance) | Apache-2.0 | 5/5 | ✅ Passes bar |
| LanceDB (current) | 5K+ | Active | Moderate | Apache-2.0 | 4/5 | ✅ Fine for Phase 1 |

---

## OPEN QUESTION: DOES OPENVIKING OVERLAP WITH BORGCLAW?

OpenViking's description mentions "openclaw" — and their core concept (context database for agents, filesystem paradigm, tiered loading, self-evolving) overlaps significantly with what BorgClaw is building. Worth investigating:

1. Is OpenViking a context layer we compose INTO BorgClaw? Or a competing architecture?
2. Their "AGFS" (Agent Filesystem) component — is this similar to the host system's markdown structure?
3. The "openclaw" reference — is there a broader ecosystem here?

This might be a case where we use OpenViking AS our data layer rather than building our own context assembly from scratch. The filesystem paradigm is literally how the host system already works (directories of markdown files). OpenViking just adds the retrieval intelligence on top.

---

*This audit should be reviewed during the monthly self-improvement review (Surface 4: Context Assembly). The data layer is the foundation — get it wrong and everything above it suffers. But also: don't overengineer it before we have real failure data.*
