# BorgClaw Middleware Layer — Architecture Specification
## The Missing Layer Between AK-OS (Knowledge) and BorgClaw (Infrastructure)

---

## THE FULL STACK

```
┌─────────────────────────────────────────────────────┐
│  LAYER 5: HUMAN (Alexander)                         │
│  Task capture (fizzy.do / Kanban)                   │
│  Approval queue ← drafts, alerts, notifications     │
│  Governance: Law Two (draft-then-approve)            │
├─────────────────────────────────────────────────────┤
│  LAYER 4: AK-OS (Identity + Knowledge)              │  ← EXISTS
│  Entity registries, patterns, workflows,             │
│  operating laws, state, interest ontology            │
│  Storage: git-backed markdown, portable              │
├─────────────────────────────────────────────────────┤
│  LAYER 3: MIDDLEWARE (Task + Workflow + Discovery)   │  ← THIS SPEC
│  3a. Task Dispatch Queue                             │
│  3b. Workflow Decomposition Engine                   │
│  3c. Dynamic Skill/Tool Registry                     │
│  3d. Agent Communication Bus                         │
│  3e. Context Assembly Protocol                       │
│  3f. Human-in-the-Loop Approval UX                   │
│  3g. External Action Layer (last mile)               │
├─────────────────────────────────────────────────────┤
│  LAYER 2: BORGCLAW (Infrastructure)                 │  ← DESIGNED
│  Queen (node registry, heartbeat, dashboard)         │
│  NadirClaw (prompt routing, cost tracking)           │
│  Paperclip (agent governance, budgets, audit)        │
│  Node management, hardware profiles, models.json     │
├─────────────────────────────────────────────────────┤
│  LAYER 1: COMPUTE (Hardware)                        │  ← EXISTS
│  Mac Mini M4 Pro 24GB (LM Studio + MLX)              │
│  Ryzen 5 + RTX 3070 8GB / 32GB RAM (Ollama)         │
│  Cloud APIs: Claude Opus/Sonnet, GPT-4o (overflow)   │
└─────────────────────────────────────────────────────┘
```

---

## 3a. TASK DISPATCH QUEUE

### The Insight
To-dos ARE the routing mechanism. Every piece of work Alexander wants done starts as a task. Tasks get dispatched to agents. Agents execute end-to-end. The task queue is the system's heartbeat.

### Flow
```
fizzy.do (Kanban)           ← Alexander captures tasks (mobile, desktop, voice)
    │
    ▼
Task Ingestion Service      ← Polls fizzy.do API or watches webhook
    │                          Normalizes task format
    │                          Classifies: simple / compound / workflow
    ▼
Jarvis Router               ← Reads queue, classifies each task
    │                          Maps task → agent(s)
    │                          Maps task → workflow template (if compound)
    │                          Checks agent availability + node health
    ▼
Agent(s)                    ← Execute the task
    │                          Report progress back to queue
    │                          Request approval if governance requires it
    ▼
Completion                  ← Task marked done in fizzy.do
                               Output delivered (draft, file, post, notification)
                               Audit trail logged
```

### Task Schema
```json
{
  "id": "task_2026-03-15_001",
  "source": "fizzy.do",
  "title": "Publish Boundary Layer article on AI job exposure",
  "type": "workflow",
  "priority": "medium",
  "labels": ["content", "boundary-layer"],
  "status": "queued",
  "assigned_agent": null,
  "workflow_template": "content-publish-pipeline",
  "subtasks": [],
  "requires_approval": true,
  "created_at": "2026-03-15T09:00:00-07:00",
  "deadline": null,
  "context_files": ["db/ak-os/INTEREST-ONTOLOGY.md", "db/ak-os/entities/signals.md"],
  "output": null,
  "audit_log": []
}
```

### Requirements for Task Queue Tool
- Self-hosted (privacy-first, own the data)
- API access (REST or GraphQL) — agents need to read/write tasks programmatically
- Webhook or polling support — need to detect new tasks
- Labels/tags for routing classification
- Subtask support for workflow decomposition
- Mobile-friendly UI for Alexander's capture
- Lightweight — runs on the always-on node
- SELECTED: **Fizzy** (37signals) — 7.2K stars, AGENTS.md, 40+ API endpoints, signed webhooks, entropy system

---

## 3b. WORKFLOW DECOMPOSITION ENGINE

### The Insight
A single to-do like "Publish Boundary Layer article" is not one task — it's a directed acyclic graph (DAG) of subtasks across multiple agents working in parallel and sequence.

### Workflow Template Format
```yaml
name: content-publish-pipeline
description: End-to-end content publishing for Boundary Layer
trigger: task with label "content" + "boundary-layer"

steps:
  - id: research
    agent: cerebro-analyst
    action: deep_research
    inputs:
      topic: "{{task.title}}"
      context: ["INTEREST-ONTOLOGY.md", "signals.md"]
    outputs: [research_brief]

  - id: draft_article
    agent: comms-drafter
    action: write_article
    depends_on: [research]
    inputs:
      brief: "{{research.research_brief}}"
      voice_rules: "memory/context/voice-and-brand-rules.md"
    outputs: [article_draft]
    requires_approval: true

  - id: create_assets
    agent: ops-handler
    action: generate_images
    depends_on: [draft_article]
    inputs:
      article: "{{draft_article.article_draft}}"
    outputs: [header_image, social_cards]

  - id: draft_social
    agent: comms-drafter
    action: write_social_posts
    depends_on: [draft_article]  # parallel with create_assets
    inputs:
      article: "{{draft_article.article_draft}}"
      platforms: [linkedin, x, threads]
    outputs: [social_posts]
    requires_approval: true

  - id: draft_podcast_script
    agent: comms-drafter
    action: write_podcast_script
    depends_on: [draft_article]  # parallel with create_assets + social
    inputs:
      article: "{{draft_article.article_draft}}"
    outputs: [podcast_script]

  - id: publish
    agent: ops-handler
    action: publish_to_substack
    depends_on: [draft_article, create_assets]
    inputs:
      article: "{{draft_article.article_draft}}"
      images: "{{create_assets.header_image}}"
    requires_approval: true
    outputs: [published_url]

  - id: distribute_social
    agent: ops-handler
    action: post_to_social
    depends_on: [draft_social, create_assets, publish]
    inputs:
      posts: "{{draft_social.social_posts}}"
      cards: "{{create_assets.social_cards}}"
      url: "{{publish.published_url}}"
    requires_approval: true
```

### Requirements for Workflow Engine
- DAG execution (parallel where possible, sequential where dependent)
- Template-based (YAML or JSON workflow definitions)
- Variable passing between steps
- Approval gates (pause workflow, wait for human)
- Retry/error handling per step
- Workflow state persistence (survives restarts)
- Visual workflow monitoring (nice-to-have)
- CANDIDATES TO RESEARCH: LangGraph, Temporal.io, Windmill, n8n, Prefect, Dagster, Inngest

---

## 3c. DYNAMIC SKILL/TOOL REGISTRY

### The Insight
Agents shouldn't have hardcoded tool lists. They should discover what's available RIGHT NOW — which MCPs are connected, which skills exist, which external APIs are reachable, which tools are installed on which nodes.

### Registry Schema
```json
{
  "tools": [
    {
      "id": "gmail-read",
      "type": "mcp",
      "name": "Gmail (Read)",
      "endpoint": "mcp://gmail",
      "capabilities": ["search_messages", "read_message", "read_thread", "list_labels"],
      "status": "online",
      "node": "queen",
      "last_health_check": "2026-03-15T09:00:00Z"
    },
    {
      "id": "web-search",
      "type": "mcp",
      "name": "Web Search",
      "capabilities": ["search", "fetch_url"],
      "status": "online",
      "node": "queen"
    },
    {
      "id": "boundary-scanner",
      "type": "skill",
      "name": "Boundary Scanner",
      "description": "Cross-domain discovery and synthesis engine",
      "trigger_patterns": ["scan for", "find what exists", "research the landscape"],
      "status": "available"
    },
    {
      "id": "canva-design",
      "type": "mcp",
      "name": "Canva",
      "capabilities": ["generate_design", "export_design", "search_designs"],
      "status": "online",
      "node": "queen"
    }
  ],
  "last_updated": "2026-03-15T09:00:00Z"
}
```

### How Agents Query It
```
Agent → GET /api/registry/tools?capability=search_messages
Agent → GET /api/registry/tools?type=mcp&status=online
Agent → GET /api/registry/skills?trigger=content+creation
```

### Auto-Discovery
- When a new MCP connects → auto-register its tools
- When a node comes online → register its local tools
- When a tool goes offline → mark unavailable, agents route around it
- Periodic health checks (every 5 min)

### Requirements for Tool Registry
- Central registry (endpoint on Queen)
- Health-checked (knows what's actually online)
- Queryable by capability, type, status
- Auto-registers new tools/MCPs/skills
- Lightweight (JSON file + REST API, no heavy infra)
- CANDIDATES TO RESEARCH: Consul (HashiCorp), etcd, custom Queen endpoint, MCP registry protocol

---

## 3d. AGENT COMMUNICATION BUS

### The Insight
Agents need to talk to each other — not just receive tasks from Jarvis. Sentinel detects a stalled project → queues a task. Cerebro finds a signal → alerts comms-drafter. This is event-driven, not request-response.

### Event Schema
```json
{
  "event_id": "evt_2026-03-15_042",
  "type": "signal_detected",
  "source_agent": "cerebro-analyst",
  "payload": {
    "signal_id": "SIG-003",
    "title": "New Karpathy post on AI agents",
    "relevance_score": 45,
    "suggested_action": "boundary-layer-brief"
  },
  "subscribers": ["jarvis-router", "comms-drafter"],
  "timestamp": "2026-03-15T10:30:00Z"
}
```

### Event Types
- `signal_detected` — Cerebro found something worth acting on
- `task_stalled` — Sentinel detected a project past its stall threshold
- `approval_needed` — Any agent requesting human sign-off
- `task_completed` — Agent finished a subtask, downstream can proceed
- `node_status_changed` — Node came online/offline
- `budget_warning` — Cloud spend approaching limit
- `context_updated` — Knowledge base entity changed (new pattern, updated state)

### Requirements for Event Bus
- Pub/sub pattern (agents subscribe to event types they care about)
- Persistent (events survive restarts, can be replayed)
- Lightweight (not Kafka-scale — we have 5-10 agents, not 5000 microservices)
- Self-hosted
- CANDIDATES TO RESEARCH: Redis Pub/Sub, NATS, BullMQ (Node.js), simple file-based event log, SSE from Queen

---

## 3e. CONTEXT ASSEMBLY PROTOCOL

### The Insight
AK-OS has 500K+ words of context files. No model holds all of it. When an agent picks up a task, it needs the RIGHT context — not everything, not nothing.

### Context Assembly Rules
```yaml
task_type_contexts:
  content_creation:
    always_load:
      - memory/context/voice-and-brand-rules.md
      - db/ak-os/INTEREST-ONTOLOGY.md
    load_if_relevant:
      - db/ak-os/entities/signals.md
      - db/Alexander_Kline_Voice_Style_Guide_v3.md
    max_context_tokens: 32000

  signal_analysis:
    always_load:
      - db/ak-os/INTEREST-ONTOLOGY.md
      - db/ak-os/entities/signals.md
      - db/ak-os/entities/patterns.md
    load_if_relevant:
      - db/ak-os/entities/projects.md
    max_context_tokens: 64000

  meeting_prep:
    always_load:
      - db/ak-os/entities/people.md
      - db/ak-os/STATE.md
    load_if_relevant:
      - db/ak-os/entities/projects.md (filter to relevant project)
      - db/ak-os/entities/financial.md (if revenue meeting)
    max_context_tokens: 32000

  client_work:
    always_load:
      - db/ak-os/entities/projects.md (filter to client)
      - db/ak-os/entities/financial.md
    load_if_relevant:
      - db/ak-os/entities/people.md (filter to client contacts)
    max_context_tokens: 32000

  strategic_planning:
    always_load:
      - db/ak-os/STATE.md
      - db/ak-os/entities/patterns.md
      - db/ak-os/entities/decisions.md
      - db/ak-os/entities/financial.md
    load_if_relevant:
      - db/AK_Master_Context_2026.md
    max_context_tokens: 128000
```

### Context Assembly Flow
```
Task arrives at agent
    │
    ▼
Lookup task_type → context rules
    │
    ▼
Load always_load files (truncate if over budget)
    │
    ▼
Semantic search load_if_relevant against task description
    │ (vector similarity > threshold → include)
    ▼
Assemble system prompt + context + task
    │
    ▼
Check total tokens < max_context_tokens
    │ (if over → summarize oldest context)
    ▼
Send to model
```

### Requirements for Context Assembly
- Vector embeddings of all AK-OS markdown files (for semantic search)
- Token counting (tiktoken or equivalent)
- Context windowing (summarize/truncate strategies)
- File-level and section-level retrieval
- CANDIDATES TO RESEARCH: ChromaDB, Qdrant, LanceDB, txtai, local embedding models (nomic-embed, BGE)

---

## 3f. HUMAN-IN-THE-LOOP APPROVAL UX

### The Insight
Law Two says draft-then-approve. Agents produce work. Alexander reviews before anything goes external. But the approval mechanism needs to be FAST and MOBILE — or it becomes a bottleneck that kills the whole system.

### Approval Flow
```
Agent produces draft
    │
    ▼
Draft saved to approval queue
    │
    ▼
Push notification to Alexander's phone (ntfy / Pushover / Gotify)
    │ Title: "✅ Approve: Boundary Layer draft ready"
    │ Body: preview + approve/reject/edit links
    ▼
Alexander taps notification
    │
    ├─→ APPROVE → agent proceeds to next step
    ├─→ REJECT + note → agent revises or task cancelled
    └─→ EDIT → opens draft in browser/editor, saves, then approve
```

### Approval Queue Schema
```json
{
  "id": "approval_001",
  "agent": "comms-drafter",
  "task_id": "task_2026-03-15_001",
  "type": "article_draft",
  "title": "Boundary Layer: AI Job Exposure Analysis",
  "preview": "First 500 chars of the draft...",
  "full_content_path": "/ak-os/drafts/boundary-layer-ai-jobs.md",
  "status": "pending",
  "created_at": "2026-03-15T11:00:00Z",
  "actions": ["approve", "reject", "edit"],
  "urgency": "normal",
  "expires_at": null
}
```

### Requirements for Approval System
- Mobile push notifications (Alexander reviews on phone often)
- Self-hosted notification service
- Approval actions via URL (tap to approve without opening a dashboard)
- Queue persists (pending items survive restarts)
- Dashboard view for batch review
- CANDIDATES TO RESEARCH: ntfy.sh, Gotify, Apprise, custom Queen endpoint + PWA

---

## 3g. EXTERNAL ACTION LAYER (Last Mile)

### The Insight
Agents can draft, analyze, research. But the "last mile" — actually sending the email, posting to X, publishing to Substack — requires external platform access. Some is solved by MCPs. Some has gaps.

### Current State
| Action | MCP Available? | Status |
|--------|---------------|--------|
| Send email | Gmail MCP | ✅ Draft only (create_draft) — send requires manual |
| Post to LinkedIn | None | ❌ GAP |
| Post to X/Twitter | None | ❌ GAP |
| Publish to Substack | None | ❌ GAP |
| Push to GitHub | None | ❌ GAP |
| Create Canva designs | Canva MCP | ✅ Connected |
| Google Calendar | GCal MCP | ✅ Connected |
| Google Drive | Drive MCP | ✅ Read-only |
| Figma | Figma MCP | ✅ Connected |
| Apple Notes | Notes MCP | ✅ Connected (unstable) |

### Gap Mitigation Strategies
1. **Browser automation** — Claude in Chrome / Playwright for platforms without APIs
2. **API-direct** — Build lightweight MCPs for X (API v2), Substack (unofficial API)
3. **Zapier/n8n bridge** — Use automation platform as middleware for last-mile sends
4. **Manual-with-notification** — Agent drafts + saves + notifies Alexander to press "send"

### Priority Gaps to Close
1. **Email send** — Most impactful. Gmail MCP can draft. Need send capability or SMTP bridge.
2. **Social posting** — X API v2 + LinkedIn API. Could be custom MCP or n8n/Zapier.
3. **Substack publish** — Unofficial API exists. Could be custom MCP.
4. **GitHub** — Official MCP exists. Just needs connecting.

---

## DESIGN PRINCIPLES

Every tool choice for this middleware layer must pass these filters:

1. **Agnostic** — No vendor lock-in. Can swap any component without rewriting the system.
2. **Modular** — Each sublayer (3a-3g) is independent. Can upgrade one without touching others.
3. **Portable** — Runs on any hardware. No cloud-only dependencies. Works air-gapped.
4. **Extensible** — Adding a new agent, tool, workflow, or MCP should be config-not-code.
5. **Self-improving** — The system should detect its own gaps and suggest improvements (CAPABILITY-ROADMAP.md pattern).

---

## RESEARCH NEEDED

For each sublayer, we need to audit the open-source landscape and pick the best tool — or confirm we need to build a thin custom layer. The research pass should evaluate each candidate against all 5 design principles.

### Research Queue
- [x] 3a. Task Queue: **Fizzy** (37signals) — SELECTED. See MIDDLEWARE-TECHNOLOGY-AUDIT.md
- [ ] 3b. Workflow Engine: LangGraph vs Temporal vs Windmill vs n8n vs Prefect vs Inngest
- [ ] 3c. Tool Registry: Consul vs etcd vs custom vs MCP protocol native
- [ ] 3d. Event Bus: Redis Pub/Sub vs NATS vs BullMQ vs custom
- [ ] 3e. Context/RAG: ChromaDB vs Qdrant vs LanceDB vs txtai
- [ ] 3f. Approval UX: ntfy vs Gotify vs Apprise vs custom PWA
- [ ] 3g. Last Mile: n8n vs custom MCPs vs browser automation

---

*This spec defines what needs to exist between AK-OS (the brain) and BorgClaw (the nervous system). Each sublayer will be researched and tool-selected in the next pass.*
