# Drone Personas — Adaptive Intelligence at the Edge

## The Idea

Every drone in the hive isn't dumb compute. It's a self-contained unit with three built-in personas that shift based on what the Collective needs:

```
┌─────────────────────────────────────────┐
│              DRONE-EFEF                 │
│                                         │
│   ┌───────────┐ ┌──────────┐ ┌────────┐│
│   │RESEARCHER │ │ PLANNER  │ │ WORKER ││
│   │           │ │          │ │        ││
│   │ Search    │ │ Decompose│ │ Execute││
│   │ Analyze   │ │ Prioritize│ │ Build ││
│   │ Synthesize│ │ Strategize│ │ Ship  ││
│   └───────────┘ └──────────┘ └────────┘│
│          ▲            ▲           ▲     │
│          └────────────┼───────────┘     │
│              MODE SWITCH                │
│         (Queen assigns or               │
│          drone self-selects)            │
└─────────────────────────────────────────┘
```

## The Three Personas

### Researcher
**When activated:** "Find out everything about X." Signal detection, deep dives, competitive analysis, paper review, web search, knowledge base queries.

- Tools: web search (MCP), knowledge base query (QMD/ZIM), document reading
- System prompt: synthesize, connect dots, find what others miss
- Output: structured research briefs, signal reports, source lists
- LLM preference: larger context window, reasoning-heavy models
- Maps to current: `cerebro-analyst` + `sentinel`

### Planner
**When activated:** "Figure out how to do X." Task decomposition, dependency mapping, strategy, resource allocation, timeline estimation.

- Tools: task creation, workflow generation, priority scoring
- System prompt: break down, sequence, identify risks, estimate effort
- Output: action plans, workflow DAGs, priority queues
- LLM preference: structured output, logical reasoning
- Maps to current: `jarvis-router` (triage/routing aspects)

### Worker
**When activated:** "Do X." Code generation, email drafting, document creation, data processing, content production.

- Tools: file system (MCP), code execution, content generation
- System prompt: execute precisely, match voice/style, produce deliverables
- Output: code, documents, emails, content — ready for approval (Law Two)
- LLM preference: fast inference, instruction-following
- Maps to current: `ops-handler` + `comms-drafter`

## How Mode Switching Works

### Queen-Directed
Queen assigns a persona when dispatching a task:
```json
{
  "task_id": "task-001",
  "persona": "researcher",
  "prompt": "Find all recent papers on distributed inference for consumer hardware",
  "model": "local-synthesis"
}
```

### Self-Selected
For complex tasks, the drone can self-select its persona per subtask. A recursive improvement loop might look like:

```
1. RESEARCHER — gather sources on the topic
2. PLANNER   — identify gaps, plan next research pass
3. RESEARCHER — deep dive on gaps
4. WORKER    — draft the improved section
5. PLANNER   — evaluate quality, decide if another loop is needed
6. Loop until convergence or iteration limit
```

This is the "pico loop" — research → plan → work → evaluate → repeat. Each iteration makes the output better. The drone handles this autonomously once given the initial directive.

### Hive-Adaptive
Queen can shift ALL drones to one persona when the hive has a priority:
- Morning briefing: all drones → Researcher mode (parallel signal scanning)
- Deadline approaching: all drones → Worker mode (parallel content production)
- Strategic planning session: all drones → Planner mode (parallel option generation)

## How This Simplifies the Architecture

**Before:** 5 centrally-defined agents (jarvis, cerebro, ops, comms, sentinel) — each is a JSON config + system prompt living on Queen. Drones are dumb Ollama proxies.

**After:** 3 universal personas baked into every drone. Queen doesn't need to define agents — it sends tasks with a persona tag. The drone has the system prompts built in. New drone off a USB drive already knows how to research, plan, and work.

The 5 original agents map cleanly:
| Original Agent | Drone Persona | Notes |
|---------------|--------------|-------|
| jarvis-router | Planner | Triage + routing = planning |
| cerebro-analyst | Researcher | Deep analysis + synthesis |
| sentinel | Researcher | Monitoring = continuous research |
| ops-handler | Worker | Code + data + structured output |
| comms-drafter | Worker | Writing + voice-matched content |

## Persona Prompts

Each persona has a compact system prompt (~500 tokens) embedded in the drone binary. No external files needed. The prompt includes:
- Role definition
- Output format expectations
- Tool usage patterns
- Quality criteria for self-evaluation

The personal AI OS layer (AK-OS, PAI, whatever) injects additional context — voice rules, identity, domain knowledge — on top of the persona prompt. The persona is the capability. The context is the identity.

## Implementation

### In the Drone (Go binary)
```go
type Persona string

const (
    PersonaResearcher Persona = "researcher"
    PersonaPlanner    Persona = "planner"
    PersonaWorker     Persona = "worker"
)

// Task gains a Persona field
type Task struct {
    ID       string          `json:"id"`
    Persona  Persona         `json:"persona"`
    // ... existing fields
}
```

The task worker selects the system prompt based on `task.Persona` before calling Ollama.

### In Queen (server.js)
```javascript
// When dispatching, Queen picks persona based on task type
const PERSONA_MAP = {
  'research': 'researcher',
  'signal_scan': 'researcher',
  'plan': 'planner',
  'decompose': 'planner',
  'draft': 'worker',
  'code': 'worker',
  'execute': 'worker',
};
```

### On the USB Drive
Personas ship with the drone binary. No additional files needed. A fresh drone off a USB drive already knows three ways to think.

## The Pico Loop (Recursive Self-Improvement)

The most powerful pattern: a drone running all three personas in sequence, improving its own output iteratively.

```
Input: "Write a strategic analysis of X"

Loop 1:
  RESEARCHER → gather 20 sources, summarize key findings
  PLANNER    → identify 3 gaps in coverage, score quality at 4/10
  WORKER     → draft analysis incorporating findings

Loop 2:
  RESEARCHER → deep dive on the 3 gaps
  PLANNER    → re-score at 6/10, identify 1 remaining weakness
  WORKER     → revise draft with new research

Loop 3:
  RESEARCHER → targeted search on remaining weakness
  PLANNER    → score at 8/10, declare convergence
  WORKER     → final polish pass

Output: Analysis that's been through 3 rounds of research-plan-work
```

The operator sets the convergence threshold and max iterations. The drone runs autonomously until it hits one or the other. Law Two kicks in for the final output — the operator reviews the converged result.

## What This Means for the Hive

A fleet of drones, each capable of research-plan-work, coordinated by Queen:
- **Parallel research:** 4 drones each research a different aspect, results merged
- **Parallel drafting:** 4 drones each draft a section, planner drone assembles
- **Cascading improvement:** drone A researches → drone B plans → drone C executes → drone D reviews

The hive isn't a cluster of GPUs. It's a team of adaptable workers.

---

## Future: Evolved Drone Classes (conceptual, not planned)

The three base personas (researcher/planner/worker) are universal — every drone ships with them. But as the hive learns which drones excel at what, specialized classes could emerge organically:

| Class | Evolved From | Specialization |
|-------|-------------|---------------|
| **Warrior** | Worker + Researcher | Security sentinel. Monitors for threats, validates inputs, guards the Queen. Firewall-aware. |
| **Messenger** | Worker | Communications relay. Aggregates inbox, Slack, notifications. Drafts and routes messages across all channels. |
| **Scientist** | Researcher | Deep analysis. Academic papers, long-context synthesis, hypothesis testing. Runs the autoresearch loop. |
| **Architect** | Planner | System design. Generates workflow DAGs, optimizes hive topology, plans drone deployments. |
| **Scribe** | Worker | Documentation. Voice-matched writing, content production, long-form drafts. Owns the operator's written voice. |
| **Oracle** | Researcher + Planner | Foresight. Trend analysis, scenario modeling, signal-to-noise filtering. The strategic thinker. |

These aren't designed — they emerge. A drone that consistently outperforms on security tasks gets tagged as Warrior-class by Queen. Its persona prompts get refined based on what worked. Next generation of drones inherits that refinement. Evolution, not engineering.

This is conceptual. The three base personas are the foundation. Specialization is a Phase 3+ emergent property, not a Phase 1 feature. But the architecture should never prevent it — drone classes are just persona configs with performance history attached.
