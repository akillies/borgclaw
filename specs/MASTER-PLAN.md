# BorgClaw Master Plan
## The Single Source of Truth

> "Turn every computer you own into one AI."

Created by [Alexander Kline](https://alexanderkline.com)

*Supersedes ROADMAP.md and critical-path.md*

---

## Timeline

```
Phase 0 ████████████████████                             COMPLETE ✓
Phase 1      ████████████████████████                     COMPLETE ✓
Phase 2                      ████████████████░░░░░░░      IN PROGRESS (most done)
Phase 5                      ████████████████              Launch (alongside Phase 2)
Phase 3                                      ████████████  Q3 2026 (60 hrs)
Phase 4                                                  ████████→  Q4+ (40+ hrs)
Phase 6                                      ████████████████████→  Community (ongoing)
        ─────────────────────────────────────────────────────────────────
        Mar        Apr          May-Jun         Jul-Sep       Oct+
         ↑ HERE (Mar 22)
```

---

## Phase 0: "It Works" — COMPLETE
**Goal:** Two drones talking. Screenshot for README. Push to GitHub.
**Exit criteria:** Dashboard shows two drones with live telemetry. One LLM request routed to a remote drone.

| # | Task | Depends On | Effort | Status |
|---|------|-----------|--------|--------|
| 0.1 | Fix dashboard auth headers (API calls lack Bearer token) | — | 2 hrs | DONE |
| 0.2 | Wire lib/workflow.js as the executor (replace inline engine in server.js) | — | 3 hrs | DONE |
| 0.3 | Boot Queen, verify it starts | 0.1, 0.2 | 30 min | DONE |
| 0.4 | Start local drone (Mac Mini), verify heartbeat + LiteLLM sync | 0.3 | 30 min | DONE |
| 0.5 | Find USB drive, prep with prepare-usb.sh | 0.3 | 30 min | DONE |
| 0.6 | Boot drone on RTX Windows machine via USB setup.sh | 0.5 | 1 hr | DONE |
| 0.7 | Verify: remote drone appears on dashboard with telemetry | 0.6 | 30 min | DONE |
| 0.8 | Execute morning-briefing workflow with real LLM output | 0.4 | 2 hrs | DONE |
| 0.9 | Screenshot dashboard with live drones for README | 0.7 | 15 min | DONE |
| 0.10 | Push to GitHub: `gh repo create borgclaw --public --source=. --push` | 0.9 | 15 min | DONE (54 commits) |

**Demo moment:** Dashboard screenshot with two drones, sparklines, live metrics.
**Result:** Phase 0 shipped. GitHub is live. 54 commits. Auth, heartbeat, workflow executor, and first workflow execution all confirmed working.

---

## Phase 1: "It's Useful" — COMPLETE
**Goal:** Alexander dogfoods BorgClaw daily for AK-OS. Agents have real tools.
**Exit criteria:** Morning briefing runs end-to-end daily against real data. Agents can search web, read files, and take actions.

| # | Task | Depends On | Effort | Status |
|---|------|-----------|--------|--------|
| 1.1 | MCP server integration — filesystem + web fetch + git | Phase 0 | 8 hrs | DONE |
| 1.2 | Wire MCP tools to workflow executor (agents call real tools) | 1.1 | 4 hrs | DONE |
| 1.3 | Tailscale in docker-compose (remote access from phone) | Phase 0 | 2 hrs | TODO |
| 1.4 | mDNS auto-discovery (drones find Queen without IP) | Phase 0 | 4 hrs | DONE |
| 1.5 | Model auto-pull on drone startup (EnsureModels) | Phase 0 | 3 hrs | TODO |
| 1.6 | NATS event bus wiring (lib/nats.js, ~150 LOC) | Phase 0 | 8 hrs | DONE |
| 1.7 | ntfy approval notifications with action buttons | 1.6 | 4 hrs | TODO |
| 1.8 | AK-OS integration — KNOWLEDGE_BASE_PATH → real files | Phase 0 | 4 hrs | TODO |
| 1.9 | Configure scheduled tasks (morning briefing 8:30 AM, job scanner Mon) | 1.8 | 4 hrs | DONE |
| 1.10 | Cron scheduler in Queen (run workflows on schedule) | 1.2 | 6 hrs | DONE |
| 1.11 | Runtime output governance filter (rule-based check before delivery) | 1.2 | 4 hrs | TODO |
| 1.12 | Dashboard: Connect panel (copy-paste URLs for OpenClaw/DeerFlow/Cursor) | Phase 0 | 3 hrs | DONE |
| 1.13 | Dashboard: login page / auth flow for browser | 0.1 | 4 hrs | DONE |
| 1.14 | OpenClaw integration doc ("Use BorgClaw with OpenClaw") | Phase 0 | 4 hrs | DONE |

**Demo moment:** "My morning briefing runs automatically at 8:30 AM, searches my inbox, checks my calendar, scans signals, and drafts a summary — all on my own hardware."
**Result:** MCP wired, Queen chat working, cron scheduler live, NATS event bus active, mDNS auto-discovery shipped, dashboard panels (chat, connect, security, Queen status) complete. OpenClaw guide written.

---

## Phase 2: "It's Special" — IN PROGRESS (March 2026)
**Goal:** The features nobody else has. The viral demo. Show HN.
**Exit criteria:** Ghost workers browse the web. Drones chat with each other. Make Disk from dashboard.

| # | Task | Depends On | Effort | Status |
|---|------|-----------|--------|--------|
| 2.1 | Ghost worker: Lightpanda integration (replace Chrome in ghost worker) | Phase 1 | 2 hrs | IN PROGRESS |
| 2.2 | Ghost worker: browser-use Python wrapper (worker.py, ~100 LOC) | 2.1 | 8 hrs | DONE (tested, example.com browsed) |
| 2.3 | Ghost worker: `type: browser` in drone task handler | 2.2 | 4 hrs | DONE |
| 2.4 | Ghost worker: setup.sh hardware-aware role detection | 2.1 | 4 hrs | DONE |
| 2.5 | Ghost worker: Linux desktop mode (Xvfb + pyautogui/ydotool) | 2.2 | 8 hrs | TODO |
| 2.6 | Queen chat endpoint (POST /api/chat) | Phase 1 | 8 hrs | DONE |
| 2.7 | Drone chat endpoint (POST /chat in Go binary) | Phase 1 | 4 hrs | DONE |
| 2.8 | Dashboard: chat panel (talk to Queen + per-drone terminals) | 2.6, 2.7 | 12 hrs | DONE |
| 2.9 | Drone BBS mini-terminal (< 5KB HTML served from Go binary) | 2.7 | 4 hrs | DONE |
| 2.10 | Make Disk: POST /api/hive/make-disk endpoint | Phase 1 | 4 hrs | DONE |
| 2.11 | Make Disk: dashboard button with profile dropdown + chiptune audio | 2.10 | 4 hrs | IN PROGRESS |
| 2.12 | Autoresearch evolution loop (scheduled scan for better tools/models) | 1.10 | 8 hrs | DONE |
| 2.13 | DeerFlow evaluation + `type: deerflow` step in workflow engine | 1.2 | 12 hrs | TODO |
| 2.14 | Dashboard: Integrations panel (OpenClaw/DeerFlow/Paperclip toggles) | 2.13 | 6 hrs | TODO |
| 2.15 | Dashboard: Security panel (all open ports, toggles, auth status) | Phase 1 | 4 hrs | DONE |
| 2.16 | Chiptune events (assimilation, first heartbeat, halt, chat) | 2.8 | 2 hrs | TODO |
| 2.17 | Drone personas | Phase 1 | 4 hrs | DONE |
| 2.18 | DRONE.md per-drone learning file | 2.17 | 4 hrs | DONE |
| 2.19 | Real DAG executor (lib/workflow.js fully wired) | Phase 1 | 4 hrs | DONE |
| 2.20 | Workflow approval resume (paused workflows resume after human approval) | 2.19 | 4 hrs | DONE |
| 2.21 | USB profiles: Scout / Worker / Scholar / Arsenal | Phase 1 | 6 hrs | IN PROGRESS |
| 2.22 | Smart model selection per hardware tier | 2.21 | 4 hrs | IN PROGRESS |
| 2.23 | Drone auto-updater (background model pulls, no manual intervention) | 2.22 | 4 hrs | IN PROGRESS |
| 2.24 | "The Awakening" demo video (USB into 4 devices, they think together) | ALL above | 4 hrs | TODO |
| 2.25 | Show HN post | 2.24 | 2 hrs | TODO |

**Demo moment:** "The Awakening" — 60-second video. 4 devices, USB into each, dashboard shows them appearing, one question, all four light up. Title: "I plugged a USB drive into 4 old computers. Now they think together."
**Risk:** Ghost worker Lightpanda integration replacing Chrome. Hive chat quality depends on model capability. Profile-aware Make Disk needs USB write validation.

---

## Phase 3: "It's Alive" — Q3 2026
**Goal:** The hive improves itself. Drones specialize. Distributed inference works.
**Exit criteria:** Drones accumulate learnings that improve output quality. 70B model runs across multiple machines.

| # | Task | Depends On | Effort | Status |
|---|------|-----------|--------|--------|
| 3.1 | Structured metrics collection per drone (tok/s, approval rates, thermals) | Phase 2 | 8 hrs | TODO |
| 3.2 | Queen aggregates metrics across hive (performance profiles) | 3.1 | 4 hrs | TODO |
| 3.3 | DRONE.md generation from structured metrics + operator corrections | 3.1 | 8 hrs | TODO |
| 3.4 | Make Disk inherits best drone's learnings | 3.3 | 4 hrs | TODO |
| 3.5 | Distributed inference: drone --mode rpc-worker (llama.cpp RPC) | Phase 2 | 12 hrs | TODO |
| 3.6 | Queen InferenceCluster concept (group drones for large models) | 3.5 | 8 hrs | TODO |
| 3.7 | Knowledge packs: ZIM file support on USB | Phase 2 | 8 hrs | TODO |
| 3.8 | Knowledge packs: openzim-mcp or sqlite-vec query endpoint on drone | 3.7 | 8 hrs | TODO |
| 3.9 | Knowledge routing: drone declares knowledge_domains in heartbeat | 3.8 | 2 hrs | TODO |
| 3.10 | Prometheus + Grafana in docker-compose | Phase 2 | 4 hrs | TODO |
| 3.11 | Drone /metrics/prom endpoint (Prometheus text format) | 3.10 | 3 hrs | TODO |
| 3.12 | Evaluate prima.cpp as llama.cpp RPC replacement (5-17x faster) | 3.5 | 8 hrs | TODO |
| 3.13 | Agent sandboxing: filesystem restriction to KNOWLEDGE_BASE_PATH | Phase 2 | 8 hrs | TODO |
| 3.14 | Agent sandboxing: network egress via MCP only | 3.13 | 4 hrs | TODO |

**Demo moment:** "My hive ran a 70B model across 3 machines overnight and produced a 15-page research report. Total cost: $0."
**Risk:** prima.cpp may not build on macOS. Distributed inference at 1-3 tok/s may feel too slow for demos.

---

## Phase 4: "It's a Movement" — Q4 2026+
**Goal:** Hives connect to hives. Communities pool compute. The vision scales.
**Exit criteria:** Two separate hives federate and share resources.

*Flagged 2026-03-22: Community hive federation and Education use case are the two highest-signal Phase 4 outcomes. Scholar profile (4.5) seeded by USB profile work in Phase 2.*

| # | Task | Depends On | Effort | Status |
|---|------|-----------|--------|--------|
| 4.1 | Community hive federation: Community Pool Queen (lightweight coordinator across member hives) | Phase 3 | 12 hrs | TODO |
| 4.2 | Community hive federation: hive-to-hive mesh via Tailscale | 4.1 | 8 hrs | TODO |
| 4.3 | Community hive federation: compute credit system (donate when spare, draw when needed) | 4.2 | 8 hrs | TODO |
| 4.4 | Queen emergence (highest-scoring drone auto-promotes on Queen failure) | Phase 3 | 8 hrs | TODO |
| 4.5 | Education use case: Scholar drone profile (Wikipedia + Khan Academy ZIM) | 3.7 | 4 hrs | TODO |
| 4.6 | Education use case: personalized learning via DRONE.md per student | 3.3, 4.5 | 8 hrs | TODO |
| 4.7 | Mobile: Android drone via Termux + OllamaServer APK | Phase 3 | 8 hrs | TODO |
| 4.8 | Mobile: Queen auto-detects USB-connected Android, deploys drone | 4.7 | 8 hrs | TODO |
| 4.9 | Community knowledge pack marketplace | 3.7 | 12 hrs | TODO |
| 4.10 | Plugin system for custom drone personas | Phase 3 | 8 hrs | TODO |

**Demo moment:** "Two families pooled their old hardware. 8 machines across 2 houses. One community AI. Free."
**Risk:** NAT traversal across households without Tailscale. Governance of shared resources. Privacy boundaries between hives.

---

## The 80/20

Five things that deliver 80% of the value:

1. **Working cluster routing** (Queen + 2+ drones + LiteLLM) — Phase 0
2. **Dashboard with live telemetry** — Phase 0
3. **MCP tools for agents** (web search, file access) — Phase 1
4. **Ghost workers** (Lightpanda browser automation) — Phase 2
5. **Hive chat** (intelligence-to-intelligence) — Phase 2

Everything else amplifies these five.

---

## Competitive Positioning

**"Turn every computer you own into one AI."**

| Competitor | What they do | What BorgClaw adds |
|---|---|---|
| Ollama (162K stars) | Run LLMs on one machine | Run LLMs on ALL your machines |
| OpenClaw (327K stars) | Personal AI assistant | Infrastructure that makes OpenClaw 10x more powerful |
| exo (42K stars) | Split models across Apple devices | Route tasks + govern + ghost workers across ANY device |
| Perplexity PC ($200/mo) | Cloud-dependent AI box | Same capability, free, sovereign, runs on your existing hardware |

**The gap we fill:** OpenClaw Issue #47871 — multi-machine awareness. OpenClaw's most-requested infrastructure feature. We ARE the answer.

---

## Principles (non-negotiable)

1. **Build wide, never cut.** Features get deferred, never dropped.
2. **Every byte earned.** BBS aesthetic. Drone UI < 5KB. No frameworks.
3. **Snap-in, don't replace.** BorgClaw augments whatever you already run.
4. **Intelligence everywhere.** Every drone can think, talk, learn, and evolve.
5. **Sovereign.** No cloud dependency. Your machines. Your models. Your rules.
6. **Law Two always.** Nothing external ships without human approval.

---

## Phase 5: "They Know It Exists" — Launch (alongside Phase 2)
**Goal:** The world sees BorgClaw. OpenClaw community discovers it. First external contributors.
**Exit criteria:** Show HN front page. 100+ stars. First external PR.

| # | Task | Depends On | Effort | Status |
|---|------|-----------|--------|--------|
| 5.1 | Record "The Awakening" demo video (USB into 4 devices, they think together) | Phase 0 complete | 4 hrs | TODO |
| 5.2 | Write "Use BorgClaw with OpenClaw" integration guide | Phase 1 | 4 hrs | DONE |
| 5.3 | Test NanoClaw pointing at BorgClaw's LiteLLM :4000 — prove snap-in works | 5.2 | 2 hrs | TODO |
| 5.4 | Reference OpenClaw Issue #47871 in integration guide | 5.2 | 30 min | TODO |
| 5.5 | Write Boundary Layer blog post — "I turned my garage into a data center for $0" | Phase 2 | 4 hrs | TODO |
| 5.6 | Submit to Show HN — "Turn every computer you own into one AI" | 5.1, 5.5 | 1 hr | TODO |
| 5.7 | Post to r/LocalLLaMA, r/selfhosted, r/homelab | 5.6 | 2 hrs | TODO |
| 5.8 | DM Brian Roemmele — "your ZHC vision, open source, runs on your hardware" | 5.6 | 30 min | TODO |
| 5.9 | Post demo video to X/Twitter with alexanderkline.com | 5.1 | 1 hr | TODO |

**Demo moment:** The 60-second video. 4 devices. USB into each. Dashboard lights up. "I plugged a USB drive into 4 old computers. Now they think together."

---

## Phase 6: "They're Using It" — Community (Q3-Q4 2026)
**Goal:** External contributors. Drone profiles shared. Knowledge packs created by others. BorgClaw is a project, not just a repo.
**Exit criteria:** 10+ contributors. 3+ community-contributed drone profiles. 1000+ stars.

| # | Task | Depends On | Effort | Status |
|---|------|-----------|--------|--------|
| 6.1 | GitHub issue templates (bug report, feature request, drone profile submission) | Phase 5 | 2 hrs | TODO |
| 6.2 | GitHub Actions CI (go build + node --check on every PR) | Phase 5 | 3 hrs | TODO |
| 6.3 | First external PR — review, merge, celebrate | 6.1 | ongoing | TODO |
| 6.4 | Community drone profile template + submission process | Phase 3 | 4 hrs | TODO |
| 6.5 | Knowledge pack contribution guide (how to create ZIM-based packs) | Phase 3 | 4 hrs | TODO |
| 6.6 | Discord or GitHub Discussions for community | Phase 5 | 2 hrs | TODO |
| 6.7 | Monthly changelog / release notes | Phase 5 | ongoing | TODO |
| 6.8 | Respond to every issue within 24 hours | 6.1 | ongoing | TODO |
| 6.9 | "Built with BorgClaw" showcase — highlight community deployments | 6.3 | ongoing | TODO |
| 6.10 | Conference talk / podcast pitch — "Sovereign AI for Everyone" | Phase 5 | 4 hrs | TODO |

**Demo moment:** "50 people are running BorgClaw. Here's what they built."

---

## CTO Assessment

- **Total effort:** ~320 hours across all phases
- **At 15 hrs/week alongside consulting:** ~6 months to full vision
- **Status as of 2026-03-22:** Phase 0 and Phase 1 are complete. Phase 2 is majority done — USB profiles, Lightpanda, and auto-updater are the remaining active tracks. Show HN is one demo video away.
- **Critical window:** Phase 2 must close before April ends or the almost-done trap activates.
- **Competitive window:** PicoClaw (25K stars), MicroClaw emerging. GitHub is live (54 commits). Stars need the demo video.
- **Show HN timing:** Phase 2 completion. Ghost worker Lightpanda swap + USB profiles = the unlock.
- **The spec-to-code ratio is inverted.** Every hour past this plan should be code, not spec.

---

*Last updated: 2026-03-22 (Phase 0+1 marked DONE, Phase 2 updated with new tasks and IN PROGRESS items, Phase 4 community/education flagged)*

*Resistance is optional. Adaptation is inevitable.*
