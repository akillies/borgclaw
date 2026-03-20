# BorgClaw
## Your Machines. Your Models. Your Rules.
**Created:** 2026-03-14 | **Status:** Concept | **Author:** the operator

> Plug a USB into any computer in your house. Run one script. It detects hardware, installs the optimal LLM, and joins the hive. A Queen orchestrator routes tasks across all nodes. Your files, your models, your infrastructure. External APIs only when local can't handle it.

---

## THE PITCH (One Paragraph)

BorgClaw is an open-source tool that turns any computer into a node in your personal AI cluster. Plug in, run `assimilate.sh`, and the machine auto-detects its hardware (CPU, GPU, RAM), installs Ollama, pulls the optimal model for its specs, and registers with a central Queen orchestrator. The Queen maintains a live map of all nodes, their capabilities, and their current load — then routes tasks intelligently: quick triage to your always-on Mac Mini, heavy reasoning to your GPU tower, frontier-grade work to external APIs (only when needed). All nodes share a common knowledge base (a synced folder of Markdown files). The result: a self-owned, privacy-first, multi-node AI system that runs 24/7 in your house, costs almost nothing, and scales by plugging in more hardware.

---

## WHY THIS EXISTS

### The Competitive Landscape (as of March 2026)

| Product | What It Is | The Catch |
|---------|-----------|-----------|
| **Perplexity Personal Computer** (announced March 11, 2026) | Mac Mini running 24/7 as AI agent with local file access | Cloud-dependent. Proprietary. Single machine. Requires Perplexity servers. You're renting intelligence. |
| **OpenClaw** (68K+ GitHub stars) | Self-hosted AI agent, multi-channel (WhatsApp, Discord, etc.) | Single-node. Bring your own API key (still cloud-dependent for LLM). No multi-machine orchestration. |
| **Paperclip** (23K stars) | Multi-agent orchestration ("zero-human company") | Agent-agnostic but doesn't handle the infrastructure layer. Assumes you already have LLM endpoints. |
| **AnythingLLM** | All-in-one local LLM app with RAG | Single-machine. No multi-node. More of an app than an infrastructure layer. |
| **Dify** | Workflow/agent builder with local LLM support | More of an app builder than infrastructure. No multi-node. |

### The Gap BorgClaw Fills

Nobody is doing **multi-node home infrastructure with one-click assimilation + intelligent routing + shared state**. The pieces exist (Ollama, nginx, Paperclip) but nobody has packaged them into a single tool that says: "Here's a USB. Walk around your house. Plug it into every machine. They all become part of your AI."

Perplexity's Personal Computer is the closest vision, but it's:
- One machine (no cluster)
- Cloud-dependent (Perplexity servers required)
- Proprietary (you don't own the intelligence layer)
- Closed (no community, no extensibility)

BorgClaw is the open-source answer: **self-owned, multi-node, privacy-first, extensible.**

---

## ARCHITECTURE

```
┌────────────────────────────────────────────────────────┐
│                    THE QUEEN                            │
│         Central orchestrator + node registry             │
│     Knows every node's capabilities, load, status        │
│     Routes tasks to optimal node automatically           │
│     Exposes single API endpoint for all agents           │
│     Runs on the always-on primary node                   │
├────────────────────────────────────────────────────────┤
│                                                          │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐  │
│   │  NODE 1   │  │  NODE 2   │  │  NODE 3   │  │ ...  │  │
│   │  Mac Mini │  │  Tower    │  │  Laptop   │  │      │  │
│   │  24GB     │  │  32GB     │  │  16GB     │  │      │  │
│   │  M4 Pro   │  │  GPU      │  │  iGPU     │  │      │  │
│   │           │  │           │  │           │  │      │  │
│   │  7B fast  │  │  14B deep │  │  3B light │  │      │  │
│   │  embed    │  │  code     │  │  embed    │  │      │  │
│   │  ALWAYS   │  │  ON-DEMAND│  │  ON-DEMAND│  │      │  │
│   └──────────┘  └──────────┘  └──────────┘  └──────┘  │
│                                                          │
├────────────────────────────────────────────────────────┤
│                 SHARED BRAIN                             │
│     Synced folder of Markdown files (knowledge base)     │
│     Agent configs, skill folders, state files            │
│     Git-synced across nodes, Drive-backed to cloud       │
└────────────────────────────────────────────────────────┘

         ┌──────────────────────────┐
         │    EXTERNAL APIs          │
         │    (only when needed)     │
         │    Claude, OpenAI, etc.   │
         │    Frontier reasoning     │
         │    Voice/brand work       │
         └──────────────────────────┘
```

---

## THE ASSIMILATION FLOW

### What happens when you plug in the USB:

```
1. DETECT
   ├── OS: macOS / Linux / Windows (WSL2)
   ├── CPU: Apple Silicon / x86_64 / ARM
   ├── GPU: NVIDIA (VRAM?) / Apple Neural Engine / Intel iGPU / None
   ├── RAM: total available
   └── Network: LAN IP, connectivity to Queen

2. CLASSIFY → Hardware Profile
   ├── HEAVY   (32GB+ RAM AND discrete GPU)  → 14B+ reasoning model
   ├── STANDARD (16-31GB RAM)                 → 7-9B general model
   ├── LIGHT   (8-15GB RAM)                   → 3B model or embeddings-only
   └── MICRO   (<8GB RAM)                     → embeddings-only node

3. INSTALL
   ├── Ollama (if not present)
   ├── Model pull (based on profile)
   ├── nomic-embed-text (always, it's tiny)
   └── Configure OLLAMA_HOST=0.0.0.0 (LAN access)

4. REGISTER WITH QUEEN
   ├── POST node-registration.json to Queen endpoint
   │   {
   │     "hostname": "my-macbook",
   │     "ip": "192.168.1.42",
   │     "port": 11434,
   │     "profile": "standard",
   │     "models": ["qwen2.5:7b", "nomic-embed-text"],
   │     "gpu": "Apple M2",
   │     "ram_gb": 16,
   │     "capabilities": ["chat", "tool-calling", "embeddings"],
   │     "status": "online"
   │   }
   ├── Queen updates routing table
   └── Queen confirms: "NODE ASSIMILATED"

5. HEARTBEAT
   ├── Node pings Queen every 60s with status + load
   ├── Queen removes nodes that go silent for 5 min
   └── Node auto-reconnects on reboot
```

---

## THE QUEEN: SMART ROUTING

The Queen isn't just a load balancer. She understands task types and node capabilities:

```
ROUTING RULES:

if task.type == "triage" or task.type == "routing":
    → send to fastest available node (lowest latency)

if task.type == "code" or task.type == "reasoning":
    → send to HEAVY node (best model)
    → fallback: STANDARD node
    → fallback: external API

if task.type == "writing" or task.type == "voice-match":
    → send to external API (needs full context + frontier model)
    → this is the ONLY case where we leave the house

if task.type == "embeddings":
    → send to ANY node (they all have nomic-embed)
    → prefer least-loaded node

if task.type == "monitoring" or task.type == "scheduled":
    → send to ALWAYS-ON node (primary/Mac Mini)

if all_local_nodes_busy:
    → queue task (don't go external unless explicitly frontier-grade)
    → alert user if queue exceeds threshold
```

### Cost Intelligence

The Queen tracks token usage per node and per external API call:
- Local calls: $0 marginal cost (just electricity)
- External calls: tracked, budgeted, alerting at thresholds
- Monthly report: "You processed 847K tokens. 91% local ($0). 9% Claude API ($14.20)."

---

## SHARED BRAIN: HOW NODES SHARE KNOWLEDGE

Every node has access to the same knowledge base — a synced folder:

```
borgclaw-brain/
├── config/
│   ├── queen.json           ← Queen location, port, auth token
│   ├── nodes/               ← Auto-populated node registrations
│   └── routing-rules.json   ← Customizable routing logic
├── agents/
│   ├── router/              ← Triage/routing agent definition
│   │   ├── agent.json
│   │   ├── instructions.md
│   │   └── tools/
│   ├── researcher/          ← Deep research agent
│   ├── ops/                 ← Operations/code agent
│   ├── writer/              ← Communications agent
│   └── sentinel/            ← 24/7 monitoring agent
├── knowledge/
│   ├── [user's knowledge base files]
│   ├── [context docs, notes, projects]
│   └── [whatever the user wants agents to know]
├── state/
│   ├── current.md           ← System state dashboard
│   ├── tasks.md             ← Active task queue
│   └── signals.md           ← Captured signals
└── logs/
    ├── audit.jsonl           ← Immutable audit trail
    ├── routing.jsonl         ← Where tasks went and why
    └── cost.jsonl            ← Token usage and API costs
```

Sync options (user chooses):
- **Git** (recommended) — version history, conflict resolution, works offline
- **Syncthing** — real-time p2p sync across LAN, no cloud dependency
- **rsync cron** — simple, works everywhere
- **Google Drive / iCloud** — cloud backup for cross-network access

---

## WHAT MAKES BORGCLAW DIFFERENT

### vs. Perplexity Personal Computer
| | Perplexity PC | BorgClaw |
|---|---|---|
| Nodes | 1 Mac Mini | Any number of any machines |
| Intelligence | Perplexity cloud | Local models + optional cloud APIs |
| Ownership | Perplexity owns the brain | You own everything |
| Privacy | Data touches Perplexity servers | Nothing leaves your LAN (unless you choose) |
| Cost | Subscription | $0 (electricity + optional API budget) |
| Extensibility | Closed | Open-source, agent-folder pattern |
| Assimilation | Buy their hardware | Plug USB into any machine you already own |

### vs. OpenClaw
| | OpenClaw | BorgClaw |
|---|---|---|
| Nodes | 1 | Many |
| LLM | External API (bring your key) | Local-first (external as fallback) |
| Orchestration | Single-agent | Multi-agent with Queen routing |
| Hardware-aware | No | Auto-detects and optimizes per machine |
| Multi-machine | No | Core feature |

### vs. Paperclip
| | Paperclip | BorgClaw |
|---|---|---|
| Focus | Agent orchestration (Layer 3) | Full stack: hardware → models → routing → agents |
| Infrastructure | Assumes you have endpoints | Creates the endpoints for you |
| Hardware | Not hardware-aware | Auto-detects, auto-optimizes |
| Installation | Manual setup per service | One USB, one script, per machine |

### The BorgClaw Position
BorgClaw is **infrastructure**, not an app. It's the layer that turns your house into a compute cluster. You can run Paperclip on top for governance. You can run OpenClaw-style agents on top for chat. You can run your own custom agents. BorgClaw doesn't care — it just makes sure every machine is running the right model and the Queen knows where to send work.

---

## NAMING & BRAND

**BorgClaw** — portmanteau of:
- **Borg** (Star Trek) — "We are the Borg. You will be assimilated. Resistance is futile." The USB assimilation metaphor. Collective intelligence. Shared consciousness across nodes.
- **Claw** (OpenClaw lineage) — The AI agent ecosystem. Open-source spirit. Community-driven.

Tagline options:
- "Your machines. Your models. Your rules."
- "Assimilate your hardware."
- "The open-source Personal Computer."
- "Resistance is futile. Cloud dependency is optional."

The Queen terminology fits the hive-mind metaphor (bee colony, Borg collective).

---

## HOST SYSTEM INTEGRATION

For operators running a personal AI OS, BorgClaw IS the infrastructure layer:

```
BorgClaw (infrastructure)
├── Queen on Mac Mini (always-on)
├── GPU tower as heavy-compute node
├── Laptop as mobile node (when home)
│
└── Personal AI OS (application layer on top)
    ├── borgclaw-brain/ = knowledge base folder
    ├── agents/ = agent definitions
    │   ├── jarvis-router → Queen's default router
    │   ├── cerebro-analyst → Claude API agent
    │   ├── sentinel → always-on monitoring
    │   ├── ops-handler → deep-compute agent
    │   └── comms-drafter → Claude API for voice/brand
    ├── knowledge/ = context, entities, research
    ├── Paperclip = orchestration layer on top
    └── External APIs = Claude (frontier), ElevenLabs (voice)
```

BorgClaw solves the infrastructure problem. The personal AI OS is the application. Paperclip is the governance. They're three distinct layers that compose together.

---

## THE FLASH DRIVE: BOOTLOADER DESIGN

Not just a script on a USB — a proper bootloader-grade installer that works on anything.

### Physical USB Contents (8-32GB drive)

```
BORGCLAW/
├── autorun.inf                ← Windows auto-detect
├── .autorun                   ← macOS/Linux auto-detect
├── boot/
│   ├── borgclaw-loader        ← Tiny embedded runtime (PicoClaw-style)
│   │                            Cross-platform binary (Go or Rust compiled
│   │                            for x86_64 + ARM64 + x86)
│   │                            Self-contained, no dependencies
│   │                            This IS the intelligence on the drive
│   ├── borgclaw-loader.exe    ← Windows binary
│   └── borgclaw-loader-arm64  ← Apple Silicon / ARM binary
├── models/                    ← Pre-staged model files (optional)
│   ├── qwen2.5-3b.gguf       ← ~2GB (LIGHT profile)
│   ├── qwen2.5-7b.gguf       ← ~4.4GB (STANDARD profile)
│   ├── qwen2.5-14b-q4.gguf   ← ~8.5GB (HEAVY profile)
│   └── nomic-embed.gguf      ← ~274MB (always)
├── hive/
│   ├── queen-address.json     ← YOUR Queen's LAN address + auth token
│   │                            This is what makes this YOUR collective
│   │                            {
│   │                              "queen": "192.168.1.10:8000",
│   │                              "token": "hive-token-xxxx",
│   │                              "hive_name": "my-hive",
│   │                              "owner": "the operator"
│   │                            }
│   ├── brain-sync.json        ← How to sync the shared knowledge base
│   │                            (git repo URL, or Syncthing config, etc.)
│   └── agent-templates/       ← Default agent folder definitions
│       ├── router/
│       ├── sentinel/
│       └── ops/
└── README.md                  ← "Plug in. Run borgclaw-loader. Done."
```

### How the Loader Works

The `borgclaw-loader` binary is a tiny, self-contained program (~5MB) that:

```
1. DETECT ENVIRONMENT
   ├── What OS am I on? (macOS, Linux, Windows)
   ├── What CPU? (x86_64, ARM64, Apple Silicon)
   ├── What GPU? (NVIDIA → VRAM, Apple Neural Engine, Intel, AMD, None)
   ├── How much RAM?
   ├── What's on the network? (scan for Queen at known address)
   └── Is Ollama already installed?

2. ASSESS + MATCH-FIT
   ├── Hardware profile: HEAVY / STANDARD / LIGHT / MICRO
   ├── Best model for this hardware (from pre-staged on USB or download)
   ├── Can this machine be an always-on node or on-demand?
   ├── Network connectivity to Queen confirmed?
   └── Any conflicting services on port 11434?

3. INSTALL + CONFIGURE
   ├── Install Ollama (if not present)
   │   └── Use pre-staged installer from USB if available (no internet needed!)
   ├── Load model from USB (if pre-staged) or pull from Ollama registry
   ├── Configure OLLAMA_HOST=0.0.0.0
   ├── Install borgclaw-agent service (auto-start on boot)
   │   ├── macOS: launchd plist
   │   ├── Linux: systemd unit
   │   └── Windows: Windows Service or Task Scheduler
   └── Write local config: /etc/borgclaw/node.json

4. JOIN THE HIVE
   ├── Read queen-address.json from USB
   ├── POST registration to Queen with full hardware manifest
   ├── Queen validates auth token → accepts node
   ├── Begin heartbeat (every 60s)
   ├── Sync knowledge base (clone git repo / join Syncthing cluster)
   └── Output: "NODE ASSIMILATED — Welcome to [hive_name]"

5. ONGOING (runs as background service)
   ├── Heartbeat to Queen every 60s
   ├── Accept task requests from Queen
   ├── Report load, temperature, availability
   ├── Auto-reconnect if Queen goes down and comes back
   └── Self-update when Queen pushes new config
```

### Key Design Principle: The USB Carries YOUR Identity

The flash drive isn't generic. When you first set up BorgClaw, the Queen generates a `queen-address.json` with your hive credentials. You copy that to the USB. Now every machine you plug that USB into joins YOUR specific collective — not some generic setup. It's like a skeleton key for your personal AI infrastructure.

**Lost the USB?** No problem — the credentials are on the Queen. Generate a new USB anytime. Revoke the old token.

**Someone else wants their own hive?** They set up their own Queen, generate their own USB. Two hives on the same network? The auth tokens keep them separate.

### Air-Gap Capable

If you pre-stage the model files on the USB (8-32GB is plenty), the assimilation process needs ZERO internet connectivity. Plug into an air-gapped machine, run the loader, it installs everything from the USB. The only network it needs is LAN access to the Queen.

---

## REMOTE ACCESS: YOUR HIVE FROM ANYWHERE

### The Problem
You're not always at home. You need to check on your hive, dispatch tasks, or access your knowledge base from your phone, a coffee shop, or a client site.

### Solution Layers (pick your comfort level)

#### Layer 1: SSH Tunnel (Simplest, most secure)
```
Set up on Queen (Mac Mini):
  - Enable SSH (System Settings → Sharing → Remote Login)
  - Port forward 22 on your home router (or use a non-standard port)
  - Use SSH keys, not passwords

From anywhere:
  ssh -L 8000:localhost:8000 -L 3100:localhost:3100 user@home-ip

  Now localhost:8000 = your Queen gateway
  And  localhost:3100 = your Paperclip dashboard

  From phone: Use Termius, Blink, or any SSH app to tunnel in.
```

#### Layer 2: Tailscale / ZeroTier (Zero config VPN)
```
Install Tailscale on Queen + your phone/laptop:
  - Free for personal use (up to 100 devices)
  - No port forwarding needed
  - Encrypted mesh network
  - Every device gets a stable IP

From anywhere:
  Your Queen is always at tailscale-ip:8000
  Your Paperclip dashboard at tailscale-ip:3100
  Full LAN access as if you were home

  Even works from cellular. Your phone becomes a node.
```

#### Layer 3: Cloudflare Tunnel (Public URL, zero ports open)
```
Install cloudflared on Queen:
  cloudflared tunnel create borgclaw
  cloudflared tunnel route dns borgclaw queen.yourdomain.com

From anywhere:
  https://queen.yourdomain.com → your Queen dashboard
  Protected by Cloudflare Access (email OTP, SSO, etc.)
  Zero ports open on your router
  Free tier handles personal use
```

#### Layer 4: Mobile Web Dashboard
```
The Queen's React dashboard is responsive by design.
From your phone browser:
  - View all nodes and their status
  - See the task queue
  - Dispatch new tasks
  - Review agent outputs
  - Check cost dashboard
  - Approve/reject agent drafts (Law Two)

Bonus: PWA (Progressive Web App) — add to home screen,
gets its own icon, feels native, push notifications
when agents need your approval.
```

### The Phone as a Node

With Tailscale, your phone becomes a node on the mesh network. You can't run Ollama on a phone, but you CAN:
- Be a **control surface** — dispatch tasks, approve outputs
- Be a **notification endpoint** — get alerts from Sentinel
- Be a **voice input** — speak tasks, Whisper transcribes, Queen routes
- Be a **mobile knowledge reader** — access the brain from anywhere

```
PHONE ACCESS ARCHITECTURE:

Phone (anywhere)
    │
    ├── Tailscale VPN → Home LAN
    │       │
    │       ├── Queen dashboard (web)
    │       ├── Task dispatch (API)
    │       ├── Approval queue (Law Two)
    │       └── Knowledge base (read)
    │
    ├── SSH tunnel → Queen (alternative)
    │
    └── Push notifications ← Sentinel agent
            │
            ├── "Expert network opportunity detected"
            ├── "Morning briefing ready for review"
            ├── "Meeting in 30 min — prep attached"
            └── "Node ryzen-tower went offline"
```

---

## DEVELOPMENT ROADMAP

### v0.1 — "First Assimilation" (Weekend project)
- [ ] `assimilate.sh` — hardware detection, Ollama install, model pull
- [ ] `assimilate.bat` — Windows wrapper
- [ ] Queen: minimal Node.js server with node registry + heartbeat
- [ ] Basic routing: path-based nginx (fast vs deep vs external)
- [ ] README with the vision

### v0.2 — "Smart Queen"
- [ ] Model-name-based routing (not just path-based)
- [ ] Node health monitoring (load, uptime, temperature)
- [ ] Cost tracking (local vs API token counts)
- [ ] Web dashboard (React, inspired by Paperclip's UI)
- [ ] Auto-reconnect on reboot

### v0.3 — "Agent Folders"
- [ ] Agent definition format (agent.json + instructions.md + tools/)
- [ ] Skill discovery (Queen scans folders, knows what agents can do)
- [ ] Task queue with priority
- [ ] Paperclip integration (BorgClaw as compute layer, Paperclip as governance)

### v0.4 — "The Brain"
- [ ] Synced knowledge base (git or Syncthing)
- [ ] RAG pipeline (embeddings → vector DB → retrieval)
- [ ] Shared context across agents (all agents can read the brain)
- [ ] Audit trail (immutable, append-only log)

### v1.0 — "Resistance Is Futile"
- [ ] One-command install: `curl borgclaw.dev/install | sh`
- [ ] Cross-platform (macOS, Linux, Windows/WSL2)
- [ ] Community agent templates (like Paperclip's Clipmart)
- [ ] Plugin system for external APIs
- [ ] Documentation site

---

## CONTENT ANGLE

This is absolutely an article for a technology newsletter:

**"I Built a Personal AI Cluster From Hardware I Already Owned"**
or
**"Perplexity Wants to Sell You a Personal Computer. Here's How to Build Your Own."**
or
**"The Open-Source Alternative to Perplexity's Personal Computer"**

Timing is perfect — Perplexity PC was announced March 11. The conversation is happening RIGHT NOW. Writing about the open-source alternative positions the author as the builder, not the consumer.

---

## STRATEGIC VALUE

1. **Open-source project with real traction potential** — Perplexity PC creates demand, BorgClaw satisfies the "I want to own it" crowd
2. **Authority builder** — "The person who made the open-source Personal Computer"
3. **Consulting IP** — "I'll set up BorgClaw for your company" ($$$)
4. **Content material** — Multiple articles worth of material
5. **Solves the operator's own problem** — Any personal AI OS gets its infrastructure layer
6. **Cross-domain synthesis** — Where AI systems, information architecture, and personal sovereignty intersect.

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-03-14 | v1.0 concept document created. Architecture, routing, competitive positioning, roadmap. |
