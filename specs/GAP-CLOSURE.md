# Gap Closure Map

*Last updated: 2026-10-05 (dogfood slice for v0.21)*

Full phased backlog: **53** tracked gaps below. For daily dogfooding, only the **dogfood slice** matters first.

---

## Dogfood slice (v0.21)

Gaps that block running workflows on **your** files on **your** hardware. Status reflects repo on `main` around Oct 2026 — not marketing claims.

| Gap | Sev | Status | What closes it |
|-----|-----|--------|----------------|
| No live LLM on cluster | CRITICAL | **YOU** | Ollama/LM Studio on Queen or drone; verify health + one workflow |
| `KNOWLEDGE_BASE_PATH` not wired | HIGH | **YOU** | `.env` + workflow YAMLs + agent instructions (`docs/INTEGRATION.md`) |
| Workflows untested end-to-end | HIGH | **YOU** | Manual run → then enable `config/scheduled/*.yaml` |
| Docker / NATS / LiteLLM not up | MEDIUM | **YOU** | `docker compose up -d` when workflows need middleware |
| ntfy on approvals | MEDIUM | OPEN | Wire approval hook → ntfy (Phase 1.7) |
| Model auto-pull on drone boot | MEDIUM | OPEN | `EnsureModels()` path (Phase 1.5) |
| Runtime output governance filter | MEDIUM | OPEN | Rule-based filter before delivery (Phase 1.11) |
| MCP registry nulls (gws, GitHub, HA, …) | MEDIUM | OPEN | Connect only the MCPs you need; registry marks pending |
| Dashboard / API auth | HIGH | **DONE** | Login + Bearer session token; SSE cookie-gated |
| Competing workflow engines | HIGH | **DONE** | `lib/workflow.js` executor (Phase 0.2) |
| Node registry lost on crash | MEDIUM | **DONE** | `persistNodes()` in Queen |

If the slice is green for your setup, use `docs/DOGFOOD.md` as the daily checklist. Everything else is polish or later phases.

---

## INFRASTRUCTURE GAPS (the plumbing)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Queen has never booted | CRITICAL | Fix dashboard auth, boot, verify | 0 | 0.1-0.3 |
| Two drones have never communicated | CRITICAL | USB drive + RTX test | 0 | 0.5-0.7 |
| Workflows produce stub output | CRITICAL | Live Ollama/LiteLLM + workflow test on your hardware | 0 | 0.8 |
| Two competing workflow engines | HIGH | Wire lib/workflow.js, remove inline engine | 0 | 0.2 — **DONE** |
| Dashboard API calls lack auth | HIGH | Login + Bearer session token | 0 | 0.1 — **DONE** |
| Docker not installed | MEDIUM | Install Docker, `docker compose up -d` | 0-1 | 0.3 |
| No cron scheduler for workflows | MEDIUM | node-cron or setInterval in Queen reading config/scheduled/*.yaml | 1 | 1.10 — **DONE** |
| Node registrations lost on crash | FIXED | persistNodes() already wired in server.js | — | DONE |
| NATS client not wired | MEDIUM | lib/nats.js, Queen publishes/subscribes | 1 | 1.6 — **DONE** |
| ntfy not wired for approvals | MEDIUM | POST to ntfy on approval creation, action buttons | 1 | 1.7 |
| host.docker.internal breaks on Linux | LOW | Use host network mode or detect OS in docker-compose | 1 | 1.6 |

## AGENT GAPS (the brains)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Agents have no real tools | CRITICAL | MCP server integration (filesystem, web fetch, git) | 1 | 1.1-1.2 — **DONE** |
| Agents are just prompt files, no runtime | HIGH | Workflow executor loads agent instructions + MCP tools per step | 1 | 1.2 — **DONE** |
| No runtime governance enforcement | HIGH | Output filter: rule-based check before delivery | 1 | 1.11 |
| Drone personas not in code | MEDIUM | Persona field + embedded system prompts in Go | 2 | — **DONE** |
| DRONE.md learning loop not built | MEDIUM | Structured metrics + operator corrections → periodic summary | 3 | 3.3 |
| No agent sandboxing | MEDIUM | Filesystem restriction to KNOWLEDGE_BASE_PATH, network via MCP only | 3 | 3.13-3.14 |

## GHOST WORKER GAPS (the hands)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Lightpanda not on USB drive | HIGH | Download Zig binary, add to prepare-usb.sh | 2 | 2.1 |
| browser-use wrapper not written | HIGH | worker.py wrapping browser-use + LiteLLM endpoint | 2 | 2.2 |
| Drone has no `type: browser` handler | HIGH | Add case in worker.go to spawn Python subprocess | 2 | 2.3 |
| setup.sh doesn't detect hardware for roles | MEDIUM | RAM/GPU check → compute vs ghost vs satellite | 2 | 2.4 |
| Desktop mode (pyautogui) only works Linux+Xvfb | KNOWN LIMIT | Document. Mac = browser-only. | 2 | 2.5 |
| Mac headless ghost worker = dead end | KNOWN LIMIT | Don't promise it. | — | DOC |
| Drone doesn't try MCP/API before ghost worker | MEDIUM | Smart routing: MCP → API → ghost fallback | 2 | 2.3 |
| Screenshot→click = 61% accuracy | KNOWN LIMIT | Background batch only; checkpoint + retry. | 2 | 2.5 |
| No vision model on small drones | KNOWN LIMIT | Desktop ghost needs larger model; browser mode = no vision. | — | DOC |

## COMMUNICATION GAPS (the voices)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Queen has no chat endpoint | HIGH | POST /api/chat with Queen system prompt + hive state | 2 | 2.6 — **DONE** |
| Drones have no chat endpoint | HIGH | POST /chat in Go binary with DRONE.md + persona | 2 | 2.7 |
| Dashboard has no chat panel | HIGH | BBS-style chat in dashboard | 2 | 2.8 — **DONE** |
| Drone has no BBS mini-terminal | MEDIUM | HTML served from Go binary | 2 | 2.9 |
| No drone-to-drone communication | LOW | Queen-mediated routing | 3 | — |
| No external AI → Queen chat | LOW | POST /api/chat for OpenClaw/DeerFlow-style clients | 2 | 2.6 — **DONE** |

## DEPLOYMENT GAPS (the assimilation)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No Make Disk dashboard button | HIGH | POST /api/hive/make-disk + dashboard UI | 2 | 2.10-2.11 |
| No mDNS auto-discovery | MEDIUM | hashicorp/mdns in Go, bonjour in Node | 1 | 1.4 — **DONE** |
| No model auto-pull on boot | MEDIUM | EnsureModels() in ollama.go | 1 | 1.5 |
| prepare-usb.sh doesn't include Lightpanda | MEDIUM | Download binary, add to staging | 2 | 2.1 |
| No Android drone support | LOW | Termux + arm64 binary | 4 | 4.7 |
| No Queen auto-deploy to USB-connected devices | LOW | ADB detection, future | 4 | 4.8 |

## SECURITY GAPS (the walls)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Dashboard leaks raw hive secret in HTML | HIGH | Session cookie + HMAC `bc_api_token`; SSE cookie-gated | 1 | 1.13 — **DONE** (Oct 2026) |
| Drone HTTP server has zero auth | HIGH | Check hive secret on all drone endpoints | 1 | — |
| No TLS anywhere | MEDIUM | Tailscale or accept LAN risk | 1 | 1.3 |
| LiteLLM has no auth key set | MEDIUM | Set LITELLM_MASTER_KEY in .env | 1 | — |
| Ollama listens on 0.0.0.0 (LAN) | MEDIUM | Bind localhost on Queen; drones as needed | 1 | — |

## ECOSYSTEM GAPS (the connections)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No OpenClaw integration docs | HIGH | Env-var / endpoint guide | 1 | 1.14 — **DONE** |
| Dashboard has no Connect panel | MEDIUM | Copy-paste URLs for clients | 1 | 1.12 — **DONE** |
| No DeerFlow task type | LOW | `type: deerflow` workflow step | 2 | 2.13 |
| No Paperclip integration | LOW | Deferred — approval queue for now | — | — |
| Dashboard has no Integrations panel | LOW | Toggle switches per system | 2 | 2.14 |

## OBSERVABILITY GAPS (the eyes)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No Prometheus export | MEDIUM | Drone /metrics/prom + Prometheus in compose | 3 | 3.10-3.11 |
| No alerting | MEDIUM | ntfy for threshold alerts | 1 | 1.7 |
| No structured logging | LOW | JSON logging later | — | — |

## EVOLUTION GAPS (the growth)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No autoresearch loop in code | MEDIUM | Scheduled upgrade-scan workflow | 2 | 2.12 |
| DRONE.md not generated from real data | MEDIUM | Metrics → periodic summary | 3 | 3.3 |
| Make Disk doesn't inherit learnings | MEDIUM | Copy best drone template to USB | 3 | 3.4 |
| No canary deployment | LOW | One-drone trial before rollout | 3 | — |

## SCALE GAPS (the vision)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No distributed inference | LOW | drone --mode rpc-worker + InferenceCluster | 3 | 3.5-3.6 |
| No knowledge packs | LOW | ZIM + sqlite-vec / MCP | 3 | 3.7-3.9 |
| No community hive federation | LOW | Community pool + mesh | 4 | 4.1-4.3 |
| No Queen emergence | LOW | Leadership scoring on Queen failure | 4 | 4.4 |
| No education use case | LOW | Scholar profile + per-student DRONE.md | 4 | 4.5-4.6 |

---

## Closure sequence (unchanged)

```
Phase 0: Make it BOOT
Phase 1: Make it USEFUL  ← dogfood slice mostly here
Phase 2: Make it SPECIAL
Phase 3: Make it ALIVE
Phase 4: Make it a MOVEMENT
```

Phase counts in the table above are planning labels; **DONE** markers follow `specs/MASTER-PLAN.md` where they agree. Operator-owned items (**YOU**) are environment-specific — the repo cannot close them for you.
