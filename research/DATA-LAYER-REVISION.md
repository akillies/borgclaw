# Data Layer Revision: QMD Changes the Calculus
**Date:** 2026-03-15

---

## THE INSIGHT

Tobi Lütke (Shopify CEO, 15.5K stars, MIT, pushed 2 days ago) built QMD — and it's exactly what the host system needs. Not a vector database. Not a context database platform. A **local search engine for your markdown files** with three-layer retrieval:

1. **BM25** (keyword, instant) — "find the file that says 'Fizzy'"
2. **Vector search** (semantic, local embeddings) — "find files about task management"
3. **LLM re-ranking** (reasoning, local GGUF models) — "which of these results actually answers the question?"

All local. Three GGUF models totaling ~2GB. SQLite index. MCP server built-in. Claude Code plugin. TypeScript SDK. MIT license.

**Why this might replace our entire LanceDB + nomic-embed + context-rules.yaml approach:**

QMD isn't just a vector DB — it's a complete retrieval pipeline. BM25 + vectors + reranking in one tool. Our current plan was: LanceDB for vectors + nomic-embed for embeddings + custom YAML rules for context assembly. QMD does all three in a single `npm install` with better retrieval quality (the reranking stage is what mem0 and others are also adding, but QMD has it native).

---

## QMD ARCHITECTURE

```
User/Agent query: "how does the content pipeline work?"
        │
        ▼
┌─ Query Expansion (qmd-query-expansion-1.7B GGUF) ──┐
│  Expands to typed sub-queries:                       │
│    lex: "content pipeline workflow publish"           │
│    vec: "how content gets from draft to published"    │
│    hyde: "the content pipeline involves..."           │
└──────────────────────────────────────────────────────┘
        │
        ▼ (parallel)
┌──────────────────┐    ┌──────────────────────┐
│ BM25 Full-Text   │    │ Vector Semantic       │
│ (SQLite FTS5)    │    │ (embedding-gemma-300M) │
│ Exact keywords   │    │ Conceptual similarity  │
└────────┬─────────┘    └──────────┬───────────┘
         │                         │
         └────────┬────────────────┘
                  ▼
┌─ Reciprocal Rank Fusion (RRF) ──────────────┐
│  Merges ranked lists from BM25 + vector      │
└──────────────────────────────────────────────┘
                  │
                  ▼
┌─ LLM Re-ranking (Qwen3-Reranker-0.6B GGUF) ┐
│  Applies reasoning: which results ACTUALLY    │
│  answer the question? Promotes best to top.   │
└──────────────────────────────────────────────┘
                  │
                  ▼
         Top-N results with scores,
         snippets, and context metadata
```

### Models (all local, ~2GB total)
| Model | Size | Purpose |
|-------|------|---------|
| embedding-gemma-300M | ~300MB | Vector embeddings |
| Qwen3-Reranker-0.6B | ~600MB | Cross-encoder reranking |
| qmd-query-expansion-1.7B | ~1GB | Query expansion (lex/vec/hyde) |

### Key Feature: Context Tree
```bash
qmd context add qmd://notes "Personal notes and ideas"
qmd context add qmd://meetings "Meeting transcripts"
qmd context add qmd://docs/knowledge-base "Host system operating files"
qmd context add qmd://docs/knowledge-base/entities "Entity registries: people, projects, patterns, decisions"
qmd context add qmd://docs/knowledge-base/projects/borgclaw "BorgClaw infrastructure project"
```

Each context annotation is returned with matching results. This means agents don't just get a chunk — they get the chunk PLUS "this came from the BorgClaw project specs" which helps them use the context correctly. This is what our YAML context rules were trying to do, but QMD does it natively with a tree structure.

---

## QMD vs EVERYTHING ELSE

| Criterion | QMD | LanceDB + nomic (current) | mem0 | OpenViking | memvid |
|-----------|-----|--------------------------|------|------------|--------|
| **Overhead** | ~2GB models, SQLite | LanceDB lib + Ollama model | Needs vector store + LLM | Server + VLM + embedding | Single file, Rust |
| **Portability** | `npm install -g`, works anywhere | pip + ollama | pip + backend store | Python + Go + Rust | Single binary/file |
| **Durability** | SQLite index (rock solid) | Lance format (good) | Depends on backend | Custom storage | Custom single file |
| **Search quality** | BM25 + vector + reranking (3-layer) | Vector only | Vector + graph | Directory + semantic | Vector only |
| **Self-improving** | Tobi used autoresearch to train query-expansion model | No | Agent memory evolves | Session compression | No |
| **MCP server** | ✅ Built-in | ❌ Build custom | ❌ Build custom | ❌ | ❌ |
| **Claude Code plugin** | ✅ Official | ❌ | ❌ | ❌ | ❌ |
| **Context annotations** | ✅ Tree structure | ❌ (our YAML rules) | ❌ | ✅ (filesystem) | ❌ |
| **Cross-session memory** | ❌ (search, not memory) | ❌ | ✅ (core feature) | ✅ (session compression) | ❌ |
| **License** | MIT | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |
| **Stars** | 15.5K | 5K+ | 49.9K | 12.6K | 13.5K |
| **Pushed** | 2026-03-14 | Active | 2026-03-14 | 2026-03-16 | 2026-03-14 |

### Key Takeaway
QMD wins on: overhead, portability, search quality, MCP integration, context annotations.
mem0 wins on: cross-session memory (QMD doesn't do memory, just search).
OpenViking wins on: session compression / self-evolving context.

**The play: QMD for search/retrieval (replaces LanceDB + nomic + context rules), mem0 for memory (adds cross-session persistence). Two tools, both lightweight, both solve different problems.**

---

## HOW QMD MAPS TO THE HOST SYSTEM

### Collections = Knowledge Base File Structure
```bash
qmd collection add ~/knowledge-base --name kb-core
qmd collection add ~/knowledge-base/entities --name entities
qmd collection add ~/knowledge-base/projects/borgclaw --name borgclaw
qmd collection add ~/knowledge-base --name master-context
qmd collection add ~/memory --name memory
```

### Context = Tier System
```bash
qmd context add qmd://kb-core "Host system: ontology, workflows, state, capabilities"
qmd context add qmd://entities "Entity registries: people, projects, patterns, decisions, financial"
qmd context add qmd://borgclaw "BorgClaw infrastructure: specs, research, agents, config"
qmd context add qmd://master-context "Deep context: operator identity, voice, brand, methodology IP"
qmd context add qmd://memory "Session-persistent knowledge: voice rules, corrections, learnings"
```

### Agent Usage (via MCP)
```
Agent: "I need context about the operator's voice for writing"
  → qmd query "operator voice style writing rules" --json -n 5
  → Returns: voice-and-brand-rules.md, Voice_Style_Guide.md
  → With context: "from memory/ — session-persistent voice rules"

Agent: "What's the status of the key contact relationship?"
  → qmd query "key contact relationship status" --json -n 3
  → Returns: people.md (relevant section), patterns.md (conversation-needed-followup)
  → With context: "from entities/ — people registry"
```

### What Replaces What
| Current Plan | QMD Replacement |
|-------------|----------------|
| LanceDB (vector store) | QMD's built-in vector search (embedding-gemma-300M) |
| nomic-embed-text via Ollama | QMD's built-in embedding model |
| context-rules.yaml (custom) | QMD's context tree annotations |
| Custom context assembly code (~100 lines) | QMD's `query` command with `--json` |
| Custom MCP for RAG | QMD's built-in MCP server |

**Lines of custom code eliminated: ~100-200**
**New dependencies: `npm install -g @tobilu/qmd` (one command)**

---

## TOBI'S AUTORESEARCH CONNECTION

Tobi literally used Karpathy's autoresearch pattern to train the qmd-query-expansion model:
> "Before going to bed I told my pi to make a version of [autoresearch] for the qmd query-expansion model with the goal of highest quality score and speed. Woke up to a 0.8B model scoring 19% higher than the previous 1.6B model after 37 experiments in 8 hours."

This is exactly what BorgClaw's Self-Improvement System is designed to do. The tools we're discovering are all converging on the same patterns.

---

## REVISED RECOMMENDATION

### Phase 1: QMD (replaces LanceDB + nomic-embed + context rules)
- `npm install -g @tobilu/qmd`
- Index knowledge base markdown files as collections
- Add context annotations for the tier system
- Use MCP server for agent access
- **Why:** Lower overhead, better search quality (3-layer), built-in MCP, MIT, zero custom code for retrieval

### Phase 2: mem0 (adds cross-session memory)
- `pip install mem0ai`
- User memory = operator preferences/corrections
- Agent memory = per-agent learned behaviors
- **Why:** QMD is search, not memory. mem0 is memory, not search. They complement.

### Phase 3: Maybe Nothing Else
- QMD + mem0 may be sufficient indefinitely for this scale
- OpenViking is worth watching but adds significant overhead
- memvid is interesting for extreme portability but QMD's SQLite is already portable enough
- Revisit only if retrieval quality degrades or dataset grows 10x+

---

## RESOURCE COMPARISON

| Stack | RAM | Disk | Custom Code | Dependencies |
|-------|-----|------|-------------|-------------|
| **Current: LanceDB + nomic-embed + YAML rules** | ~200MB (Ollama model) | ~100MB index | ~100-200 lines | LanceDB, Ollama, nomic-embed, custom MCP |
| **Proposed: QMD + mem0** | ~2GB (3 GGUF models) + mem0 overhead | ~100MB index | ~0 lines for search | QMD (npm), mem0 (pip) |
| **OpenViking** | ~2-4GB (VLM + embedding) | ~200MB+ | ~50 lines config | Python + Go + Rust server |

QMD uses more RAM for models (~2GB) but eliminates all custom retrieval code. On a Mac Mini M4 Pro with 24GB, 2GB for search models is trivial — especially since the models stay loaded and are shared across all agent queries.

---

## QUALITY BAR CHECK

| Criterion | QMD Score |
|-----------|----------|
| Stars | 15.5K ✅ |
| Last push | 2026-03-14 (2 days ago) ✅ |
| Community | Shopify-wide adoption, active issues ✅ |
| License | MIT ✅ |
| Creator | Tobi Lütke (Shopify CEO) — maximum social proof ✅ |
| Agnostic | ✅ (works with any markdown, MCP-native) |
| Modular | ✅ (standalone, swappable) |
| Portable | ✅ (npm install, SQLite, runs anywhere) |
| Extensible | ✅ (SDK, MCP, CLI, HTTP server) |
| Self-improving | ✅ (Tobi used autoresearch to improve the models) |

**5/5 principles. Passes quality bar with flying colors.**

---

*Sources: [QMD GitHub](https://github.com/tobi/qmd), [Tobi's tweet on QMD](https://x.com/tobi/status/2013217570912919575), [Tobi on autoresearch for QMD](https://x.com/tobi/status/2030771823151853938)*
