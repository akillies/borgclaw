# BorgClaw Roadmap — From Alpha to Hive Intelligence

## Design Principles (apply to every phase)

1. **Snap-in, don't replace.** BorgClaw augments your existing AI environment.
2. **Every drone is a whole unit.** Research, plan, work — three personas, one binary.
3. **The hive learns.** Each generation of drones is better than the last.
4. **Fractal structure.** A drone is a micro-hive. A hive of drones is a macro-drone. Queens emerge from the collective, not from design.
5. **Assimilate, don't invent.** Use battle-tested tools. BorgClaw is the 2% glue.

---

## Phase 0: Foundation (CURRENT — March 2026)
**Goal:** Prove the base product works. Two drones talking to Queen.

### Done
- [x] Queen service (Express, dashboard, approval queue, workflow engine)
- [x] Drone binary (Go, cross-platform, hardware detection, heartbeat)
- [x] LiteLLM dynamic routing (drones auto-register as inference endpoints)
- [x] Response caching (LiteLLM local cache)
- [x] USB installer (prepare-usb.sh + setup.sh, 2.4GB)
- [x] Hive halt/resume kill switch
- [x] SECURITY.md (Five Laws governance)
- [x] Open-source scrub (verified clean)
- [x] Drone personas spec (researcher/planner/worker)

### Remaining
- [ ] **Two-drone test** — boot Queen, plug USB into RTX machine, verify heartbeat + LiteLLM routing
- [ ] **First real workflow** — morning briefing against live Ollama (not stubs)
- [ ] **Screenshot** for README — dashboard with live telemetry
- [ ] **Push to GitHub** — `gh repo create borgclaw --public --source=. --push`

**Exit criteria:** Two drones visible on dashboard. One LLM request routed to a remote drone and response returned.

### Dashboard UX Requirements (apply across all phases)

The dashboard is the operator's control surface. Every major feature needs a GUI hook, not just an API endpoint. If it can't be done from the dashboard, it doesn't exist for most users.

**Required panels:**
- **Connect** — copy-paste URLs for OpenClaw, DeerFlow, Cursor, Aider, any OpenAI/Anthropic-compatible app. `borgclaw connect` output but in the GUI with copy buttons.
- **Integrations** — toggle switches for supported systems. Each integration shows: status (connected/disconnected), setup instructions inline, config fields. Covers: OpenClaw/NanoClaw, DeerFlow, Paperclip, MCP servers, Tailscale, Prometheus.
- **Make Disk** — select connected USB drive, choose drone profile (compute/workstation/knowledge), click "Create Drone." Progress bar with chiptune audio.
- **Drone Manager** — per-drone: contribution dial, role assignment, model swap, kill/restart, view DRONE.md learnings, performance history sparklines.
- **Security** — view all open ports/doors, toggle each on/off, view auth status, rotate hive secret.
- **Autoresearch** — last scan results, proposed upgrades awaiting approval, upgrade history.

**Chiptune audio:**
- Plays during USB prep / drone assimilation (the "assimilation sequence")
- Plays on drone first heartbeat (the "welcome to the hive" chime)
- Plays on hive halt (alarm tone)
- Always mutable. Default muted. localStorage persist. Already implemented in dashboard.js — extend to new events.

---

## Phase 1: Functional Hive (April 2026)
**Goal:** Drones are useful. Agents have tools. The system produces real value daily.

### 1A. MCP Integration (~80 lines + npm)
Agents gain real tools. Without this, they're just LLM wrappers.
- [ ] Run MCP servers as sidecar processes (filesystem, fetch, git)
- [ ] `POST /api/mcp/invoke` route in Queen
- [ ] Wire Brave Search MCP for web research
- [ ] Wire filesystem MCP for knowledge base access
- [ ] Agents can now: read files, search the web, check git repos

### 1B. Drone Personas in Code (~200 lines Go)
Bake researcher/planner/worker into the drone binary.
- [ ] Add `Persona` field to Task struct
- [ ] 3 embedded system prompts (~500 tokens each)
- [ ] Task worker selects prompt based on persona
- [ ] Queen maps task types → personas automatically
- [ ] Pico loop: drone can cycle R→P→W on a single task

### 1C. Tailscale Remote Access (~30 min)
Access from anywhere.
- [ ] Add Tailscale to docker-compose
- [ ] `TS_AUTHKEY` in .env.example
- [ ] Dashboard accessible over Tailscale mesh
- [ ] Remote drones join via Tailscale IP

### 1D. mDNS Auto-Discovery (~60 lines)
Zero-config drone joining.
- [ ] Queen advertises via mDNS (`bonjour-service` npm)
- [ ] Drone discovers Queen via mDNS (`hashicorp/mdns` Go)
- [ ] No `--queen` flag needed on LAN

### 1E. Model Auto-Pull (~50 lines Go)
Drones pull the right models for their hardware on first boot.
- [ ] `EnsureModels()` in ollama.go
- [ ] Read preferred models from config
- [ ] Auto-pull on startup if missing

### 1F. NATS Event Bus (~150 lines)
Real-time event coordination between Queen and drones.
- [ ] `lib/nats.js` in Queen
- [ ] Workflow events published to NATS
- [ ] Dashboard SSE switches from polling to NATS-driven

### 1G. AK-OS Dogfooding
Point BorgClaw at the real knowledge base.
- [ ] Set KNOWLEDGE_BASE_PATH to AK-OS files
- [ ] Configure morning briefing with real Gmail/Calendar queries
- [ ] Run daily. Find what breaks.

**Exit criteria:** Morning briefing runs end-to-end with real data. Agents search the web and read files. Dashboard accessible from phone.

---

## Phase 2: Distributed Intelligence (May-June 2026)
**Goal:** The hive is smarter than any single machine. Drones improve themselves.

### 2A. Distributed Inference — Junkyard NVLink
Run models too large for any single machine.
- [ ] Drone `--mode rpc-worker` flag (llama.cpp RPC backend)
- [ ] Ship `rpc-server` binary alongside drone
- [ ] Queen `InferenceCluster` concept — groups of drones for large models
- [ ] LiteLLM config entry for cluster endpoint
- [ ] Test: 70B model across Mac Mini + RTX machine (~1-3 tok/s)
- [ ] Evaluate prima.cpp as Phase 2B upgrade (5-17x faster if stable)

### 2B. Drone Self-Improvement Loop
The hive gets smarter about itself.
- [ ] Each drone tracks: tok/s per model, task success rates, thermal patterns
- [ ] Queen aggregates performance data across all drones
- [ ] `models.json` evolves based on real performance data
- [ ] Next Make Disk inherits accumulated knowledge
- [ ] Weekly autoresearch scan: better models, better tools, better configs

### 2C. Make Disk Dashboard Button
The hive reproduces.
- [ ] `POST /api/hive/make-disk` endpoint
- [ ] Dashboard UI: select drive, select drone profile, click "Create Drone"
- [ ] Prep script runs with learned optimizations baked in
- [ ] Each new generation inherits the hive's performance data

### 2D. Voice Interface
Talk to your hive.
- [ ] Pipecat server alongside Queen (Python sidecar)
- [ ] Whisper.cpp for local STT (Metal-accelerated on Mac)
- [ ] Kokoro TTS (~500ms voice-to-voice)
- [ ] Voice → Queen API → drone execution → voice response
- [ ] Requires Tailscale for mobile voice access

### 2E. Observability
See everything. Govern thermodynamically.
- [ ] Prometheus + Grafana in docker-compose
- [ ] Drone `/metrics/prom` endpoint (Prometheus text format)
- [ ] Pre-built Grafana dashboard: per-drone CPU/GPU/tok/s/cost
- [ ] Alert rules: thermal throttling, budget approaching, drone offline

### 2F. Agent Sandboxing (NemoClaw-inspired)
Agents can only touch what they should.
- [ ] Filesystem restriction to KNOWLEDGE_BASE_PATH + data/ + /tmp
- [ ] Network egress via MCP layer only (no arbitrary HTTP)
- [ ] Node auth: shared hive secret in heartbeat headers

**Exit criteria:** 70B model running across 2+ machines. Drones improving their own model selection. Make Disk button works. Voice works from phone.

---

## Phase 3: Emergent Intelligence (Q3 2026+)
**Goal:** The hive is self-organizing. Drones specialize. Queens emerge.

### 3A. Knowledge-Specialized Drones
Different drones, different knowledge.
- [ ] ZIM-based knowledge packs (Medic, Engineer, Scholar)
- [ ] openzim-mcp or sqlite-vec for knowledge queries
- [ ] Drone declares `knowledge_domains` in heartbeat
- [ ] Queen routes domain-specific queries to the right drone
- [ ] Make Disk offers drone profiles: "Create Medic Drone"

### 3B. Fractal Hive Structure
A drone is a micro-hive. A cluster is a macro-drone.
- [ ] Sub-Queen concept: a drone that coordinates a local cluster
- [ ] Multi-hive federation: your home hive + your office hive
- [ ] Cross-hive task routing via Tailscale
- [ ] Hierarchical governance: Sub-Queen approvals escalate to Queen

### 3C. Drone Generational Learning
After enough generations, patterns emerge.
- [ ] Drone performance genome: hardware profile + model configs + task history
- [ ] Mutation: each new generation tweaks one parameter
- [ ] Selection: best-performing configs propagate to next generation
- [ ] After N generations, optimal configs emerge organically
- [ ] The system evolves its own architecture

### 3D. Queen Emergence
A drone that accumulates enough capability becomes a Queen candidate.
- [ ] Track "leadership score" per drone: uptime, task success, breadth of models
- [ ] If Queen goes offline, highest-scoring drone auto-promotes
- [ ] Queen failover without human intervention
- [ ] The hive is resilient — cut off the head, another grows

### 3E. Community Ecosystem
The hive grows beyond one operator.
- [ ] Published drone profiles (community-contributed)
- [ ] Knowledge pack marketplace (community-curated ZIM bundles)
- [ ] Shared autoresearch findings (what models work best on what hardware)
- [ ] Plugin system for custom personas beyond researcher/planner/worker

---

## Gap Analysis — What Each Phase Addresses

| Gap | Phase | Solution |
|-----|-------|---------|
| Agents can't use tools | 1A | MCP integration |
| Drones are dumb compute | 1B | Three personas (researcher/planner/worker) |
| No remote access | 1C | Tailscale |
| Need Queen IP manually | 1D | mDNS auto-discovery |
| Manual model installation | 1E | Auto-pull on boot |
| No real-time coordination | 1F | NATS event bus |
| Not dogfooded | 1G | AK-OS integration |
| Can't run big models | 2A | Distributed inference (llama.cpp RPC → prima.cpp) |
| Drones don't learn | 2B | Self-improvement loop |
| Can't make new drones easily | 2C | Make Disk dashboard button |
| No voice | 2D | Pipecat + Whisper.cpp + Kokoro |
| No observability | 2E | Prometheus + Grafana |
| No sandboxing | 2F | NemoClaw-inspired restrictions |
| No specialized knowledge | 3A | ZIM-based knowledge packs |
| Single point of failure | 3D | Queen emergence from drones |
| No community | 3E | Profiles, packs, plugins |

---

## The Vision

Phase 0: A coordinator and some drones.
Phase 1: A useful personal AI infrastructure.
Phase 2: A self-improving distributed intelligence.
Phase 3: An emergent, self-organizing collective.

Each phase builds on the last. Nothing in Phase 2 requires redesigning Phase 1. Nothing in Phase 3 requires redesigning Phase 2. The architecture is fractal — the same patterns (research → plan → work → improve) repeat at every scale, from a single drone's pico loop to the hive's generational evolution.

*"We are the Borg. Your biological and technological distinctiveness will be added to our own."*

But in this case: YOUR old laptop's compute, YOUR knowledge, YOUR identity. Added to YOUR collective. The machines serve you. That's the inversion. Not assimilation by the collective — assimilation BY you, OF everything you own.

---

*Last updated: 2026-03-20*
