# AK-OS Modularity Manifesto
## Nothing is permanent. Everything is a slot.

> "Nothing is definite, right? It's all modular — we swap things out and replace them or upgrade components when something better comes along. That's part of the philosophy." — Alexander Kline, 2026-03-15

---

## The Principle

Every component in AK-OS is a **slot**, not a **commitment**. What matters is the CAPABILITY (what it does), not the IMPLEMENTATION (which tool does it). When something better comes along — and it will — the swap should be:

1. **Cheap:** Change a config file, not rewrite the system.
2. **Safe:** The old component stays archived (Law Zero). The new one proves itself before the old one is removed.
3. **Transparent:** The system logs every swap. We know what changed, when, and why.

## How This Works in Practice

### Agents query capabilities, not tools
```
# WRONG: Agent hardcodes the tool
result = gmail_mcp.search_messages("from:guidepoint")

# RIGHT: Agent queries the registry for a capability
tool = registry.resolve("search_messages")
result = tool.execute("from:guidepoint")
```

When Gmail MCP is replaced by gws CLI, the registry updates. Agents don't change.

### Config files are the swap mechanism
Every component is defined in a YAML config. To swap a component:
1. Update the config file (e.g., change `tool: lancedb` to `tool: qmd` in registry.yaml)
2. Install the new tool
3. Run `borgclaw sync --reload`
4. Verify with `borgclaw status`

No code changes. No rebuild. No deploy. Just config + install + reload.

### The evaluation pipeline is continuous
Signal Radar scans weekly for better tools. The self-improvement system proposes swaps when it detects a component that scores higher on the 5-principle check (Agnostic, Modular, Portable, Extensible, Self-Improving). But swaps still require Alexander's approval (Law Two) unless they're in the autonomous zone.

## What's Swappable (Everything)

| Layer | Current Slot | Could Be Replaced By | Swap Cost |
|-------|-------------|---------------------|-----------|
| Search/Retrieval | QMD | Any MCP-compatible search | Config change |
| Memory | mem0 (Phase 2) | cognee, Letta, custom | Config + install |
| Task Queue | Fizzy | Any REST API task board | Config + MCP swap |
| Event Bus | NATS JetStream | Redis Streams, Kafka, RabbitMQ | Config + Docker swap |
| LLM Server (Mac) | LM Studio | Ollama, vLLM, llama.cpp | models.json update |
| LLM Server (GPU) | Ollama | vLLM, TGI, llama.cpp | models.json update |
| Cloud API | Anthropic Claude | OpenAI, Google, local-only | models.json update |
| Routing | NadirClaw (Phase 2) | LiteLLM, custom router | Config change |
| Governance | Paperclip (Phase 2) | Custom, or remove entirely | Config change |
| Notifications | ntfy + Apprise | Pushover, Gotify, any webhook | Config change |
| Workflow Engine | LangGraph | CrewAI, custom DAG runner | Workflow YAML stays, engine swaps |
| Gmail | Anthropic MCP → gws | Any Gmail API wrapper | registry.yaml update |
| Drive | Anthropic MCP → gws | Any Drive API wrapper | registry.yaml update |

## What's NOT Swappable (The Stable Core)

These are the foundations. They don't change because they're not tools — they're structures:

- **Markdown files** — The knowledge base format. Human-readable, AI-readable, tool-agnostic.
- **YAML configs** — The configuration format. Parseable by any language.
- **The Operating Laws** — Law Zero through Five. Non-negotiable constraints.
- **The Entity Ontology** — People, Projects, Patterns, Decisions, Signals, Financial. The schema is stable.
- **The Agent Roles** — Jarvis (routing), Cerebro (intelligence), Comms (writing), Sentinel (monitoring), Ops (execution). Roles persist even if the underlying LLM or framework changes.
- **The Workflow DAG structure** — Steps, dependencies, approval gates. The DAG format stays even if the execution engine changes.
- **Git** — Version control for the knowledge base. This is infrastructure, not a component.

## The Upgrade Path

```
Signal Radar detects better tool
    → Scored against 5 principles (Agnostic, Modular, Portable, Extensible, Self-Improving)
    → Added to TOOL-LANDSCAPE.md with status: 🗺️ Mapped
    → If score > current tool: promoted to 🔍 Evaluating
    → Spike test on isolated node (Docker or worktree)
    → If passes: proposal to Alexander (Law Two)
    → If approved: config update + install + reload
    → Old tool moved to Parked in TOOL-LANDSCAPE.md (Law Zero: never delete)
    → Experiment log updated with before/after metrics
```

---

*The goal is a system that gets better every week without ever breaking. Components flow through like water. The structure is the riverbed — it guides, but it doesn't restrict.*
