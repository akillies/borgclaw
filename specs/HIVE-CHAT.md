# Hive Chat — Intelligence Talking to Intelligence

## The Realization

Every drone in the hive has a brain (Ollama + a model). Every drone has identity (DRONE.md learnings, persona, hardware profile). Queen has access to every brain via LiteLLM. We've been treating these as compute pipes when they're conversational entities.

Wire the chat layer. Let them talk.

## Chat Surfaces

### 1. Operator ↔ Queen (Dashboard)
The Queen dashboard gets a chat panel. Talk to Queen directly.

```
Operator: "How's the hive?"
Queen: "4 drones online. drone-efef is at 78% CPU running a research
        task. drone-a3b7 is idle. Morning briefing completed at 8:32 AM.
        2 approvals pending your review."

Operator: "Run the job scanner"
Queen: "Starting job-market-scanner workflow. I'll notify you when
        results need approval."

Operator: "What's drone-efef been working on?"
Queen: "drone-efef completed 14 tasks today. 12 approved, 2 rejected.
        Its DRONE.md shows it's strongest at code generation (100%
        approval) and weakest at voice-matched writing (rejected twice).
        Should I route writing tasks elsewhere?"
```

Queen's system prompt includes: hive status, node registry, activity feed, approval queue. She reasons over the state of her hive.

### 2. Operator ↔ Drone (Dashboard per-drone terminal)
Each drone card in the dashboard has a mini terminal. Talk to the drone directly.

```
Operator: "What models do you have?"
drone-efef: "phi4-mini (2.3GB, 28 tok/s) and qwen3:8b (5.5GB, 15 tok/s).
             My hardware supports up to 14B models with this 24GB RAM."

Operator: "How are your thermals?"
drone-efef: "CPU at 62°C, well under throttle threshold. I've learned
             from my history that sustained work above 75% contribution
             pushes me to 89°C after 30 minutes. I keep to 70% for
             sustained loads."

Operator: "What did you learn this week?"
drone-efef: "Three things: (1) Researcher persona gets better results
             when I gather 4+ sources before synthesizing. (2) My
             phi4-mini handles classification faster than qwen3:8b.
             (3) The operator rejected two writing tasks — I need
             longer context for voice-matched content."
```

Drone's system prompt includes: its DRONE.md, hardware profile, current metrics, task history, persona state.

### 3. Queen ↔ Drone (Internal coordination)
Queen talks to drones programmatically for coordination. Not displayed to operator unless requested.

```
Queen → drone-efef: "Your approval rate on writing tasks dropped to 60%
                      this week. drone-a3b7 has 95% on writing. I'm
                      routing writing tasks to drone-a3b7 going forward.
                      Focus on what you're good at — code and research."

Queen → drone-a3b7: "drone-efef is overloaded. Can you take 3 research
                      tasks from its queue?"
drone-a3b7 → Queen: "I have capacity for 2. My phi4-mini is slower on
                      research than drone-efef's qwen3:8b. Send me the
                      shorter ones."
```

### 4. Drone ↔ Drone (Peer coordination)
Drones can talk to each other when collaborating on complex tasks.

```
drone-efef → drone-a3b7: "I'm researching competitor pricing. Can you
                           handle the European market while I cover
                           North America?"
drone-a3b7 → drone-efef: "Starting European market scan now. I'll POST
                           results to the shared task callback when done."
```

### 5. External AI ↔ Queen (API)
OpenClaw, NanoClaw, DeerFlow, or any external system can talk to Queen conversationally via `POST /api/chat`.

```json
POST /api/chat
{
  "message": "I need a deep competitive analysis of the local AI inference market. Budget: use local models only, no cloud spend.",
  "context": {"source": "openclaw", "priority": "P2"}
}
```

Queen responds with natural language AND takes action:
```json
{
  "response": "Starting competitive analysis. I'll use drone-efef (qwen3:8b) for research and drone-a3b7 (phi4-mini) for summarization. Estimated completion: 45 minutes. I'll push results to your approval queue.",
  "actions_taken": [
    {"type": "workflow_started", "id": "wf-competitive-analysis-001"}
  ]
}
```

## Implementation

### Queen Chat Endpoint
```javascript
// POST /api/chat — conversational interface to Queen
app.post('/api/chat', async (req, res) => {
  const { message, context } = req.body;

  // Build Queen's context from live hive state
  const queenContext = {
    nodes: nodeList(),
    approvals: approvals.pending(),
    activity: activity.get(20),
    workflows: [...workflows.keys()],
    hiveSecret: '[REDACTED]',
  };

  // Queen's system prompt + hive state + user message → LLM
  const response = await callLLM({
    system: QUEEN_SYSTEM_PROMPT + JSON.stringify(queenContext),
    user: message,
    model: 'local-router', // fast, cheap, always-on
  });

  // Parse response for actionable instructions
  // (Queen can trigger workflows, route tasks, etc. from natural language)
  const actions = parseQueenActions(response);
  for (const action of actions) {
    await executeQueenAction(action);
  }

  res.json({ response: response.content, actions_taken: actions });
});
```

### Drone Chat Endpoint (in Go binary)
```go
// POST /chat — talk to this drone directly
func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
    var body struct {
        Message string `json:"message"`
    }
    json.NewDecoder(r.Body).Decode(&body)

    // Build drone context from local state
    droneContext := buildDroneContext(s.cfg, s.metrics, s.ollama)

    // Inject DRONE.md learnings
    learnings := loadDroneMD()

    // Call local Ollama with drone persona
    resp, _ := s.ollama.Chat(r.Context(), OllamaChatRequest{
        Model: s.cfg.PreferredModels[0],
        Messages: []OllamaChatMessage{
            {Role: "system", Content: DRONE_CHAT_PROMPT + droneContext + learnings},
            {Role: "user", Content: body.Message},
        },
    })

    json.NewEncoder(w).Encode(map[string]string{
        "drone_id": s.cfg.NodeID,
        "response": resp.Message.Content,
    })
}
```

### Dashboard Chat UI
The dashboard gains a chat panel in the bottom-right corner (like Intercom but for your hive):

- Default: talks to Queen
- Click a drone card → chat switches to that drone
- Messages stream via SSE (real-time responses)
- History persisted in Queen's activity log
- Chiptune notification sound on new messages (mutable)

## Why This Matters

This isn't a feature. It's the unlock.

When intelligences can talk to each other:
- Queen can **negotiate** with drones about task allocation
- Drones can **ask for help** when stuck
- The operator can **understand** what the hive is doing in natural language
- External systems can **request work** conversationally, not just via structured API calls
- The hive becomes a **team**, not a cluster

The difference between BorgClaw and every other compute orchestrator: the nodes can think, speak, and coordinate. They're not containers. They're intelligences.

## The Chiptune

Every chat interaction gets a subtle audio cue:
- Operator message sent: soft key click
- Queen responds: low synth tone
- Drone responds: higher pitched blip (pitch varies by drone ID for audible identification)
- External system connects: "incoming transmission" warble
- Urgent message (approval needed): alert chime

All mutable. All Web Audio API. All groovy.
