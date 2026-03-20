# Local Infrastructure Buildout
## "Project Assimilator" — The Home AI Cluster Blueprint
**Created:** 2026-03-14 | **Status:** Research + Design Complete, Ready to Spike

> **The vision:** A personal AI OS is the always-on operational layer. The home cluster makes it literal — running 24/7 on hardware you already own, dispatching to cloud APIs only when deep reasoning is needed. A USB installer ("The Assimilator") can turn any machine at home into a new node in minutes.

---

## ARCHITECTURE: THREE LAYERS

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 3: ORCHESTRATION                     │
│         Paperclip / LangGraph / Agent Spine                   │
│   Agent definitions, task routing, budgets, audit trail       │
│   "The Board of Directors"                                    │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 2: GATEWAY                           │
│              nginx / custom router                            │
│     Single OpenAI-compatible endpoint: llm-gateway:8000       │
│     Routes by model name, task type, or load                  │
├──────────────────────┬──────────────────────────────────────┤
│   LAYER 1: COMPUTE   │                                       │
│                      │                                       │
│  ┌─────────────┐    │    ┌─────────────┐                    │
│  │  MAC MINI   │    │    │   GPU TOWER │    ┌──────────┐   │
│  │  M4 Pro     │    │    │   + 3070    │    │  CLOUD   │   │
│  │  24GB RAM   │    │    │   32GB RAM  │    │  Claude  │   │
│  │             │    │    │             │    │  API     │   │
│  │  Ollama     │    │    │  Ollama     │    │          │   │
│  │  7-8B fast  │    │    │  9-14B deep │    │ Frontier │   │
│  │  router     │    │    │  reasoning  │    │ reasoning│   │
│  │  triage     │    │    │  code       │    │ writing  │   │
│  │  drafts     │    │    │  verify     │    │ foresight│   │
│  │  embeddings │    │    │             │    │ full ctx │   │
│  └─────────────┘    │    └─────────────┘    └──────────┘   │
│       ALWAYS ON     │       ON DEMAND          ON DEMAND    │
└──────────────────────┴──────────────────────────────────────┘

         ┌──────────────────────────────────┐
         │        SHARED STATE LAYER         │
         │    knowledge base folder           │
         │    (Markdown files)               │
         │    Git sync ↔ Google Drive sync   │
         │    Same files, any node reads     │
         └──────────────────────────────────┘
```

### What each layer does:

**Layer 1 — Compute nodes.** Each machine runs Ollama (or vLLM on the GPU tower). They expose OpenAI-compatible HTTP endpoints on the LAN. They don't know about each other. They just serve models.

**Layer 2 — Gateway.** A single endpoint (`http://llm-gateway:8000`) that all agents talk to. Routes requests based on `model` name:
- `model="fast"` → Mac Mini (7B, instant response, cheap)
- `model="deep"` → GPU tower (14B, heavier reasoning)
- `model="frontier"` → Claude API (full context, writing, foresight)
- `model="embed"` → whichever node runs the embedding model

**Layer 3 — Orchestration.** The brain. Defines agents, assigns tasks, tracks budgets, maintains audit trails. This is where Paperclip's governance model (or LangGraph) lives. Agents are defined as folders with JSON configs and skill files — the same pattern knowledge-base skills already follow.

---

## THE STUPID SIMPLE STEPS

### Phase A: "Hello World" — Get One Local Node Running
**Time: 1 afternoon. Cost: $0.**

```
Step 1: Install Ollama on Mac Mini
─────────────────────────────────
  curl -fsSL https://ollama.com/install.sh | sh

  That's it. One command. Ollama runs as a service on port 11434.

Step 2: Pull a fast routing model
─────────────────────────────────
  ollama pull qwen2.5:7b

  ~4.4GB download. Qwen 2.5 7B is fast, good at tool-calling,
  fits comfortably in 24GB with room to spare.

  Alternative: ollama pull glm4:9b (GLM-4.7-Flash, 128K context)

Step 3: Test it works
─────────────────────
  curl http://localhost:11434/api/chat -d '{
    "model": "qwen2.5:7b",
    "messages": [{"role": "user", "content": "Hello from BorgClaw"}]
  }'

  If you get a response, your first node is live.

Step 4: Test tool-calling (the key capability for routing)
──────────────────────────────────────────────────────────
  curl http://localhost:11434/api/chat -d '{
    "model": "qwen2.5:7b",
    "messages": [{"role": "user", "content": "What time is it in Victoria BC?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_time",
        "description": "Get current time for a timezone",
        "parameters": {
          "type": "object",
          "properties": {
            "timezone": {"type": "string"}
          }
        }
      }
    }]
  }'

  If the model emits a tool_call instead of hallucinating a time,
  it can route. That's all we need from the local model.

Step 5: Pull an embedding model (for future RAG)
─────────────────────────────────────────────────
  ollama pull nomic-embed-text

  ~274MB. Tiny. Runs alongside the chat model no problem.
  Now you have local embeddings for vector search later.
```

**After Phase A:** You have a local LLM running 24/7 on your Mac Mini. It can answer questions, call tools, and generate embeddings. Total cost: $0. Total time: 30 minutes.

---

### Phase B: "Two Brains" — Add the GPU Tower Node
**Time: 1 hour. Cost: $0.**

```
Step 6: Install Ollama on GPU tower (Windows or WSL2)
─────────────────────────────────────────────────
  Windows: Download installer from https://ollama.com/download/windows
  WSL2: Same curl command as Mac

Step 7: Pull a heavier reasoning model
───────────────────────────────────────
  ollama pull qwen2.5:14b-instruct-q4_K_M

  ~8.5GB. Q4_K_M quantization fits the RTX 3070's 8GB VRAM
  with room for KV cache. This is your "deep thinker."

  Alternative for fully in-VRAM: ollama pull codellama:7b
  (dedicated code model)

Step 8: Expose Ollama to the LAN
────────────────────────────────
  Set environment variable:
    OLLAMA_HOST=0.0.0.0:11434

  Restart Ollama. Now any machine on your home network can
  reach it at http://<tower-ip>:11434

Step 9: Do the same on Mac Mini
───────────────────────────────
  launchctl setenv OLLAMA_HOST 0.0.0.0
  # or edit /etc/environment depending on your Ollama install method

  Restart Ollama.

Step 10: Test cross-node communication
──────────────────────────────────────
  From the Mac Mini:
    curl http://<tower-ip>:11434/api/chat -d '{
      "model": "qwen2.5:14b-instruct-q4_K_M",
      "messages": [{"role": "user", "content": "Explain quantum decoherence in 2 sentences"}]
    }'

  If you get a response, your two nodes can talk.
```

**After Phase B:** Two LLM nodes on your LAN. Fast model on Mac, deep model on tower. They can talk to each other. Total new cost: $0.

---

### Phase C: "One Door" — The Gateway
**Time: 1-2 hours. Cost: $0.**

```
Step 11: Install nginx on Mac Mini (it's the always-on box)
───────────────────────────────────────────────────────────
  brew install nginx

Step 12: Configure routing
──────────────────────────
  Edit /opt/homebrew/etc/nginx/nginx.conf (or wherever brew puts it):

  upstream mac_llm {
      server 127.0.0.1:11434;
  }

  upstream tower_llm {
      server <tower-ip>:11434;
  }

  server {
      listen 8000;

      # Default: route to Mac (fast)
      location / {
          proxy_pass http://mac_llm;
      }

      # Explicit deep reasoning route
      location /deep/ {
          proxy_pass http://tower_llm/;
      }
  }

  (A smarter version would route based on the model name
  in the JSON body, but path-based routing gets you started
  in 5 minutes. Upgrade to a 50-line Python gateway later
  if you want model-name routing.)

Step 13: Start nginx
────────────────────
  brew services start nginx

Step 14: Test the gateway
─────────────────────────
  # Fast route (Mac):
  curl http://localhost:8000/api/chat -d '{
    "model": "qwen2.5:7b",
    "messages": [{"role": "user", "content": "quick test"}]
  }'

  # Deep route (tower):
  curl http://localhost:8000/deep/api/chat -d '{
    "model": "qwen2.5:14b-instruct-q4_K_M",
    "messages": [{"role": "user", "content": "deep test"}]
  }'
```

**After Phase C:** Single endpoint at `http://mac-mini:8000`. Any agent, any tool, any script on your network talks to one URL. The gateway decides where it goes. Total cost still: $0.

---

### Phase D: "The Agents" — Orchestration Layer
**Time: 2-4 hours. Cost: $0 (or Claude API costs for cloud calls).**

```
Step 15: Install Paperclip on Mac Mini
──────────────────────────────────────
  git clone https://github.com/paperclipai/paperclip.git
  cd paperclip
  npm install
  npm start

  → API at http://localhost:3100
  → Dashboard at http://localhost:3100 (React UI)
  → Embedded PostgreSQL auto-created. No setup.

Step 16: Define your personal AI OS as a "company" in Paperclip
──────────────────────────────────────────────────────────────────
  Create agents that map to your operating system's functions:

  AGENT: jarvis-router
    Role: "Chief of Staff"
    Model: fast (Mac Mini, qwen2.5:7b)
    Job: Triage incoming requests. Route to the right agent.
         Monitor scheduled tasks. First-pass email scanning.
    Budget: Unlimited (it's local, it's free)

  AGENT: cerebro-analyst
    Role: "Chief Intelligence Officer"
    Model: frontier (Claude API)
    Job: Deep research. Signal analysis. Foresight synthesis.
         Content platform drafting. Methodology work.
    Budget: $X/month (API costs)

  AGENT: ops-handler
    Role: "Operations Manager"
    Model: deep (GPU tower, 14B)
    Job: Code generation. File operations. Data processing.
         Template filling. Structured output.
    Budget: Unlimited (local)

  AGENT: comms-drafter
    Role: "Communications Director"
    Model: frontier (Claude API)
    Job: Draft emails, social posts, follow-ups.
         Requires voice/brand context (needs full context).
    Budget: $X/month

  AGENT: sentinel
    Role: "Night Watch"
    Model: fast (Mac Mini)
    Job: Runs 24/7. Monitors inbox for opportunities.
         Checks calendar for upcoming meetings needing prep.
         Fires alerts when something needs attention.
    Budget: Unlimited (local, always on)

Step 17: Define skill folders
─────────────────────────────
  Each agent gets a folder:

  knowledge-base/agents/
  ├── jarvis-router/
  │   ├── agent.json          ← role, model, budget, triggers
  │   ├── instructions.md     ← system prompt / personality
  │   ├── tools/              ← available tool definitions
  │   └── skills/             ← skill folders it can invoke
  ├── cerebro-analyst/
  │   ├── agent.json
  │   ├── instructions.md     ← includes Interest Ontology
  │   ├── tools/
  │   └── skills/
  ├── ops-handler/
  │   └── ...
  ├── comms-drafter/
  │   ├── instructions.md     ← includes Voice Style Guide
  │   └── ...
  └── sentinel/
      ├── agent.json
      ├── instructions.md
      ├── tools/
      │   ├── gmail-check.json
      │   ├── calendar-check.json
      │   └── alert.json
      └── schedules/
          ├── morning-briefing.json
          ├── expert-network-monitor.json
          └── stall-detector.json

  This IS the knowledge-base skill-folder pattern, just formalized
  with JSON configs that any orchestrator can discover.

Step 18: Wire agents to the gateway
────────────────────────────────────
  In each agent.json, the endpoint is just:
    "endpoint": "http://localhost:8000"  (for local models)
    "endpoint": "https://api.anthropic.com"  (for Claude)

  The orchestrator (Paperclip) handles the rest.
```

**After Phase D:** You have a multi-agent system running on your home network. Agents are defined as folders. Orchestration tracks budgets and audit trails. Jarvis runs 24/7 on the Mac Mini for free. Cloud APIs are called only when needed.

---

### Phase E: "The Assimilator" — USB Installer
**Time: 1-2 hours to create. Then: 5 minutes per new machine forever.**

```
Step 19: Create the Assimilator script
───────────────────────────────────────
  A single bash script on a USB drive (or hosted on your LAN)
  that turns any machine into a BorgClaw node:

  #!/bin/bash
  # BORGCLAW ASSIMILATOR v1.0
  # Plug in. Run. Machine joins the hive.

  echo "BORGCLAW ASSIMILATOR"
  echo "===================="

  # Detect hardware
  OS=$(uname -s)
  ARCH=$(uname -m)

  if [[ "$OS" == "Darwin" ]]; then
      GPU="apple-silicon"
      RAM=$(sysctl -n hw.memsize | awk '{print int($1/1024/1024/1024)}')
  elif [[ "$OS" == "Linux" ]] || [[ "$OS" == "MINGW"* ]]; then
      GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo "none")
      RAM=$(free -g | awk '/^Mem:/{print $2}')
  fi

  echo "Detected: $OS / $ARCH / GPU: $GPU / RAM: ${RAM}GB"

  # Choose model profile based on hardware
  if [[ $RAM -ge 32 ]] && [[ "$GPU" != "none" ]]; then
      PROFILE="heavy"       # 14B reasoning model
      MODEL="qwen2.5:14b-instruct-q4_K_M"
  elif [[ $RAM -ge 16 ]]; then
      PROFILE="standard"    # 7-9B general model
      MODEL="qwen2.5:7b"
  else
      PROFILE="light"       # 3B or embeddings only
      MODEL="qwen2.5:3b"
  fi

  echo "Profile: $PROFILE → Model: $MODEL"

  # Install Ollama
  if ! command -v ollama &> /dev/null; then
      echo "Installing Ollama..."
      if [[ "$OS" == "Darwin" ]] || [[ "$OS" == "Linux" ]]; then
          curl -fsSL https://ollama.com/install.sh | sh
      else
          echo "Windows detected. Download from https://ollama.com/download/windows"
          echo "Then re-run this script."
          exit 1
      fi
  fi

  # Configure for LAN access
  export OLLAMA_HOST=0.0.0.0

  # Pull the right model
  echo "Pulling $MODEL (this may take a few minutes)..."
  ollama pull $MODEL

  # Pull embedding model (always, it's tiny)
  ollama pull nomic-embed-text

  # Register with gateway (write a config file)
  HOSTNAME=$(hostname)
  IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0)

  cat > /tmp/borgclaw-node-registration.json << EOF
  {
    "node": "$HOSTNAME",
    "ip": "$IP",
    "port": 11434,
    "profile": "$PROFILE",
    "model": "$MODEL",
    "ram_gb": $RAM,
    "gpu": "$GPU",
    "registered": "$(date -Iseconds)"
  }
  EOF

  echo ""
  echo "NODE ASSIMILATED"
  echo "   Host: $HOSTNAME ($IP:11434)"
  echo "   Profile: $PROFILE"
  echo "   Model: $MODEL"
  echo ""
  echo "Next: Add this node to the gateway config."
  echo "Registration file: /tmp/borgclaw-node-registration.json"
  echo ""
  echo "Test: curl http://$IP:11434/api/chat -d '{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello from BorgClaw\"}]}'"

Step 20: Put it on a USB drive
──────────────────────────────
  USB drive contents:

  BORGCLAW-ASSIMILATOR/
  ├── assimilate.sh           ← The script above
  ├── assimilate.bat          ← Windows wrapper (calls WSL or downloads Ollama)
  ├── README.md               ← "Plug in. Run assimilate.sh. Done."
  ├── models/                 ← OPTIONAL: pre-downloaded model files
  │   ├── qwen2.5-7b.gguf    ← Skip the download if you pre-stage
  │   └── nomic-embed.gguf
  └── gateway/
      ├── nginx.conf.template ← Drop-in gateway config
      └── register-node.sh    ← Auto-update nginx upstream with new node
```

**After Phase E:** You have a USB drive. Plug it into any machine in your house. Run one script. It detects the hardware, installs Ollama, pulls the right model for that machine's capabilities, and registers itself with the gateway. 5 minutes, zero thinking.

---

## HOW THIS MAPS TO A PERSONAL AI OS

| AI OS Concept | Local Infrastructure Equivalent |
|---------------|--------------------------------|
| Jarvis (operational layer) | Mac Mini always-on + sentinel agent + Paperclip orchestration |
| Cerebro (sense-making) | Claude API, called by jarvis-router when deep reasoning needed |
| Shared state | knowledge base folder, git-synced across nodes, Drive-synced to cloud |
| Skill folders | `agents/<name>/skills/` — discoverable by any orchestrator |
| Law Two (draft-then-approve) | Paperclip governance: agents can't act without operator approval |
| Law Five (direct tooling) | Local models = no cloud dependency for routine tasks |
| Portability | Assimilator USB = any machine joins in 5 minutes. knowledge base folder is the brain, nodes are disposable |
| Energy-aware routing | Gateway routes by task type: quick → Mac (free, instant), deep → tower, frontier → Claude (costs money) |

---

## COST MODEL

| Component | Monthly Cost |
|-----------|-------------|
| Mac Mini running 24/7 | ~$5-8 electricity |
| GPU tower on-demand | ~$2-3 electricity (only when called) |
| Ollama | $0 (open source) |
| nginx | $0 |
| Paperclip | $0 (open source, self-hosted) |
| Claude API (frontier calls) | Variable — $10-50/month depending on usage |
| **Total** | **~$17-61/month** |

Compare to: Running everything through Claude API = $100-300+/month. The local layer pays for itself by handling 80% of requests at zero marginal cost.

---

## WHAT THIS DOESN'T SOLVE (YET)

- **Voice conversation** — Still needs ElevenLabs or Anthropic voice API. Local whisper for STT is possible on the Mac Mini though.
- **Push notifications** — Still needs Ntfy/Pushover MCP or phone integration.
- **Gmail send** — Still needs gws CLI on tower (already planned).
- **LinkedIn/Substack** — Still needs platform MCPs.

These are Layer 3 (orchestration) and integration problems, not infrastructure problems. The local cluster solves the compute and always-on backbone. The integrations get layered on top.

---

## SEQUENCE: WHAT TO DO FIRST

The minimum viable setup is Phase A + B + C. That's a Saturday afternoon project:

1. Install Ollama on Mac Mini (10 min)
2. Pull qwen2.5:7b (5 min download)
3. Test it works (2 min)
4. Install Ollama on GPU tower (10 min)
5. Pull qwen2.5:14b (10 min download)
6. Expose both to LAN (5 min)
7. Install nginx, configure routing (30 min)
8. Test the gateway (5 min)

**Total: ~1.5 hours** and you have a two-node AI cluster with a unified endpoint.

Phase D (agents/Paperclip) is a Sunday afternoon. Phase E (Assimilator USB) is an evening project once you've validated the pattern.

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-03-14 | v1.0 created. Architecture, concrete steps, Assimilator design, cost model. |
