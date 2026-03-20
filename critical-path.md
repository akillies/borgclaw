# BorgClaw — Critical Path

**Last Updated:** 2026-03-19 (post-build session, CTO review)

---

## What's Done

Everything below is built, tested, and running:

| Component | Lines | Status |
|-----------|-------|--------|
| Queen service v0.2.0 (server.js) | ~550 | All routes live. Tested. |
| Activity feed (lib/activity.js) | ~80 | SSE push + file persistence + external hooks |
| Approval queue (lib/approvals.js) | ~120 | Law Two enforced. Create/approve/reject/notify. |
| Deep health check (lib/health.js) | ~70 | Probes Ollama, NATS, LiteLLM, ntfy, QMD, Docker, Git |
| Setup wizard API (lib/setup.js) | ~170 | Hardware detect, profile mapping, AMD support |
| Workflow executor (lib/workflow.js) | ~926 | DAG engine, Kahn's algorithm, approval gates, template vars |
| Dashboard (views/dashboard.js) | ~1,801 | Full retro BBS. 7 panels. SSE. Sparklines. Topology. Dials. Sound. |
| CLI (borgclaw) | ~200 | start/stop/status/dashboard/nodes/logs/bootstrap |
| Bootstrap (scripts/bootstrap.sh) | ~806 | 12-step hardware-aware setup |
| ENGINEERING.md | ~180 | Shared principles from Forge |
| PRODUCT-SPEC-V1.md | ~500 | Full 5-phase spec |
| Config (models.json, agents, workflows, scheduled, mcps) | ~existing | All present |
| **Total** | **~5,800** | |

**API surface (all live):**
Nodes (CRUD + heartbeat + ping + patch), Config (models + registry + recommend-profile), Capabilities lookup, Approvals (CRUD + approve/reject), Workflows (list + execute + run status), Activity feed, SSE events, Deep health, Metrics (per-node + history), Models (list + pull), Search (QMD proxy), Setup (detect + configure + complete)

---

## What's NOT Done — Honest Assessment

### The Queen is a brain without a body.

The Queen can register nodes, track heartbeats, display dashboards, queue approvals, and execute workflows. But:

1. **No node can actually accept tasks from the Queen.** The heartbeat daemon is a dumb curl. There's no task receiver on any node. The workflow executor runs everything locally on the Queen's machine. Multi-node dispatch is wired in the API but has nothing to dispatch TO.

2. **No models are installed on this machine.** No Ollama, no Docker. The Queen works but workflows produce stub results ("No LLM provider available"). It's infrastructure without compute.

3. **The open-source scrub is incomplete.** Agent instructions, configs, and prompts have been partially scrubbed. Research files haven't been touched. Private backup is partially corrupted from the rsync incident. Can't push to GitHub yet.

4. **PicoClaw doesn't exist yet.** It's the most important piece — the node agent that gives every machine base intelligence — and it hasn't been built or forked.

---

## The Actual Critical Path

Ordered by "what unblocks the most value."

### 1. GET COMPUTE RUNNING (unblocks everything)

**Why first:** Without a model serving requests, nothing downstream works. Workflows produce stubs. The dashboard shows empty telemetry. The whole system is a shell.

- [ ] Install Ollama on this Mac Mini: `curl -fsSL https://ollama.com/install.sh | sh`
- [ ] Pull phi4-mini (3.5GB, fast router): `ollama pull phi4-mini`
- [ ] Pull qwen3:8b (5.5GB, general): `ollama pull qwen3:8b`
- [ ] Verify: `curl http://localhost:11434/api/chat -d '{"model":"phi4-mini","messages":[{"role":"user","content":"hello"}]}'`
- [ ] Start Queen: `./borgclaw start` → workflows now produce real LLM output instead of stubs

**Effort:** 15 minutes. **Impact:** Everything starts working for real.

### 2. PICOCLAW NODE AGENT (unblocks multi-node)

**Why second:** This is the product. Without PicoClaw, BorgClaw is a single-machine tool with a pretty dashboard. With PicoClaw, it's a hive.

- [ ] **Evaluate Sipeed's PicoClaw**: clone repo, read architecture, determine if hive features (heartbeat, task acceptance, contribution dials) can be added without fighting the design. 2 hours.
- [ ] **Decision: fork or build.** If Sipeed's architecture supports it → fork. If not → build a purpose-built Go binary (~500 lines) that does: model serving (via Ollama), heartbeat (to Queen), task acceptance (HTTP endpoint), metrics collection, contribution enforcement.
- [ ] **Build the hive features** (whichever path): heartbeat with full telemetry, task endpoint, contribution dials, hardware detection, model auto-selection.
- [ ] **Update bootstrap.sh**: install PicoClaw instead of raw Ollama + bash heartbeat.
- [ ] **Test**: plug a second machine into the network, run bootstrap, watch it appear on the Queen dashboard with live telemetry.

**Effort:** 1-2 days. **Impact:** BorgClaw becomes a real multi-node system.

### 3. OPEN-SOURCE SCRUB + GITHUB PUSH (unblocks thought leadership)

**Why third:** The code works. It needs to be public. Every day it sits unpushed is a day the thought leadership value is zero.

- [ ] Follow `docs/sanitization-checklist.md` (already written by Cowork session)
- [ ] Scrub research files (the only ones not yet touched)
- [ ] Final grep scan: `grep -ri "your-name\|personal-identifier\|private-contact" --include="*.md" --include="*.js" --include="*.yaml"`
- [ ] Create `.env.example`
- [ ] Write `docs/INTEGRATION.md` (how to wire in your personal AI OS)
- [ ] Decide USB device name (I recommend **"The Claw"** — it's the brand, it's simple, it's Star Trek)
- [ ] Initial commit + `gh repo create borgclaw --public --source=. --push`

**Effort:** 3-4 hours. **Impact:** Public artifact. GitHub presence. Thought leadership active.

### 4. INSTALL DOCKER + MIDDLEWARE (unblocks full stack)

**Why fourth:** NATS, LiteLLM, ntfy are in docker-compose but Docker isn't on this machine. These enable: event coordination, model routing proxy, push notifications.

- [ ] Install Docker Desktop for Mac
- [ ] `docker compose up -d` in borgclaw directory
- [ ] Verify NATS (port 4222), LiteLLM (port 4000), ntfy (port 2586) are running
- [ ] Wire NATS client into Queen (lib/nats.js — ~150 lines)
- [ ] Wire ntfy into approval hooks (push to phone with approve/reject buttons)

**Effort:** Half day. **Impact:** Real-time event coordination, phone notifications, model proxy.

### 5. END-TO-END WORKFLOW TEST (proves the system)

**Why fifth:** After 1-4, everything is in place. Run a real workflow end-to-end to prove it.

- [ ] `./borgclaw start` (Queen + Docker middleware)
- [ ] Run morning-briefing workflow from dashboard ▶ button
- [ ] Watch: Jarvis scans calendar → Cerebro scans inbox → Sentinel checks patterns → Comms formats brief → Ops creates Gmail draft
- [ ] Approval gate fires for any `requires_approval: true` step
- [ ] Approve from dashboard → workflow resumes → completes
- [ ] Activity feed shows every step. Dashboard updates live via SSE.
- [ ] Screenshot the whole thing. That screenshot is worth 1,000 words for the GitHub README.

**Effort:** 1 hour (mostly debugging). **Impact:** Proof that the product works. Real screenshot for README.

### 6. PERSONAL AI OS INTEGRATION (dogfooding)

**Why sixth:** This is why BorgClaw exists — to run your personal AI OS. Everything above makes this possible.

- [ ] Point BorgClaw's knowledge base at your personal AI OS files (set `KNOWLEDGE_BASE_PATH`)
- [ ] Configure the 5 agents with your personal AI OS instructions
- [ ] Wire scheduled tasks (morning briefing at 8:30 AM, job scanner Mondays, etc.)
- [ ] Start using it daily. Dogfood. Find what breaks.

**Effort:** Half day setup, then ongoing. **Impact:** The Unix/Space Travel moment. Building it to play your own game.

---

## What's NOT on the Critical Path (park it)

| Item | Why Not Now |
|------|------------|
| NadirClaw integration | LiteLLM handles routing adequately for now. NadirClaw adds 10ms classification — nice but not blocking. |
| Paperclip governance | The approval queue already enforces Law Two. Paperclip adds budgets + audit trails — Phase 2 value. |
| USB flash drive tooling | Needs PicoClaw binary first. Can't ship a flash drive without the node agent. |
| Autoresearch loop | Needs models running first. Can't scan for upgrades when nothing is installed. |
| Setup wizard HTML | Dashboard handles configuration. First-run wizard is nice UX but `./borgclaw bootstrap` works. |
| Minification / bundling | Optimize after it works, not before. |
| Tailscale / remote nodes | LAN first. Remote is a feature, not a requirement. |

---

## Decisions Made

| Decision | Date | Rationale |
|----------|------|-----------|
| Three-tier architecture (PicoClaw + Queen + Personal AI OS) | 2026-03-19 | Clean separation. Each tier has one job. Identity-agnostic. |
| PicoClaw is core, not optional | 2026-03-19 | Every node needs base intelligence. Borg without Collective is diminished, not dead. |
| Node.js for Queen | 2026-03-19 | One runtime. Express working. Keep it simple. |
| Model-agnostic via LiteLLM | 2026-03-19 | Swap any provider via config. |
| Retro BBS aesthetic | 2026-03-19 | Giger/Borg/arcticpunk. Monospace. Box-drawing. One red eye. |
| BorgClaw = open source, personal AI OS = private | 2026-03-19 | Permanent split. Identity-agnostic infrastructure. |
| Be direct about recommendations | 2026-03-19 | Don't hedge when the right answer is clear. Lead with it. |

## Decisions Open

| Decision | Recommendation | Blocking |
|----------|---------------|----------|
| USB device name | **"The Claw"** — it's the brand, it's simple, it's recognizable | README, any public reference |
| PicoClaw: fork Sipeed's or build custom | **Evaluate first, then decide.** Fork if architecture supports hive features. Build if it doesn't. 2 hour evaluation. | Step 2 of critical path |
