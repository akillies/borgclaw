# Gap Closure Map
## Every gap, what closes it, and when

---

## INFRASTRUCTURE GAPS (the plumbing)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Queen has never booted | CRITICAL | Fix dashboard auth, boot, verify | 0 | 0.1-0.3 |
| Two drones have never communicated | CRITICAL | USB drive + RTX test | 0 | 0.5-0.7 |
| Workflows produce stub output | CRITICAL | callLLM already wired to Ollama — just needs live test | 0 | 0.8 |
| Two competing workflow engines | HIGH | Wire lib/workflow.js, remove inline engine | 0 | 0.2 |
| Dashboard API calls lack auth | HIGH | Inject Bearer token from embedded hive secret | 0 | 0.1 |
| Docker not installed | MEDIUM | Install Docker Desktop, `docker compose up -d` | 0-1 | 0.3 |
| No cron scheduler for workflows | MEDIUM | node-cron or setInterval in Queen reading config/scheduled/*.yaml | 1 | 1.10 |
| Node registrations lost on crash | FIXED | persistNodes() already wired in server.js | — | DONE |
| NATS client not wired | MEDIUM | lib/nats.js, ~150 LOC, Queen publishes/subscribes | 1 | 1.6 |
| ntfy not wired for approvals | MEDIUM | POST to ntfy on approval creation, action buttons | 1 | 1.7 |
| host.docker.internal breaks on Linux | LOW | Use host network mode or detect OS in docker-compose | 1 | 1.6 |

## AGENT GAPS (the brains)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Agents have no real tools | CRITICAL | MCP server integration (filesystem, web fetch, git) | 1 | 1.1-1.2 |
| Agents are just prompt files, no runtime | HIGH | Workflow executor loads agent instructions + MCP tools per step | 1 | 1.2 |
| No runtime governance enforcement | HIGH | Output filter: rule-based check before delivery (not just LLM instructions) | 1 | 1.11 |
| Drone personas not in code | MEDIUM | Add Persona field to Task struct, 3 embedded system prompts in Go | 2 | — |
| DRONE.md learning loop not built | MEDIUM | Structured metrics + operator corrections → periodic summary | 3 | 3.3 |
| No agent sandboxing | MEDIUM | Filesystem restriction to KNOWLEDGE_BASE_PATH, network via MCP only | 3 | 3.13-3.14 |

## GHOST WORKER GAPS (the hands)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Lightpanda not on USB drive | HIGH | Download Zig binary, add to prepare-usb.sh + /tmp/BORGCLAW/ | 2 | 2.1 |
| browser-use wrapper not written | HIGH | worker.py (~100 LOC) wrapping browser-use + LiteLLM endpoint | 2 | 2.2 |
| Drone has no `type: browser` handler | HIGH | Add case in worker.go to spawn Python subprocess | 2 | 2.3 |
| setup.sh doesn't detect hardware for roles | MEDIUM | RAM/GPU check → compute vs ghost vs satellite assignment | 2 | 2.4 |
| Desktop mode (pyautogui) only works Linux+Xvfb | KNOWN LIMIT | Document clearly. Ship Xvfb setup for Linux drones. Mac = browser-only. | 2 | 2.5 |
| Mac headless ghost worker = dead end | KNOWN LIMIT | Don't promise it. Mac ghost workers need a monitor or run browser-only. | — | DOC |
| Drone doesn't try MCP/API before ghost worker | MEDIUM | Smart routing: check for MCP tool → API → ghost worker fallback | 2 | 2.3 |
| Screenshot→click = 61% accuracy | KNOWN LIMIT | Use for background batch only. Checkpointed workflows with retry. | 2 | 2.5 |
| No vision model on small drones | KNOWN LIMIT | Desktop ghost worker needs Qwen3-VL-8B min (~10GB). Browser mode = no vision needed. | — | DOC |

## COMMUNICATION GAPS (the voices)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Queen has no chat endpoint | HIGH | POST /api/chat with Queen system prompt + hive state context | 2 | 2.6 |
| Drones have no chat endpoint | HIGH | POST /chat in Go binary with DRONE.md + persona context | 2 | 2.7 |
| Dashboard has no chat panel | HIGH | BBS-style chat in bottom corner, switches between Queen/drone | 2 | 2.8 |
| Drone has no BBS mini-terminal | MEDIUM | < 5KB HTML string served from Go binary at :9091 | 2 | 2.9 |
| No drone-to-drone communication | LOW | Drones POST to each other via Queen-mediated routing | 3 | — |
| No external AI → Queen chat | LOW | POST /api/chat already serves this (OpenClaw/DeerFlow calls Queen) | 2 | 2.6 |

## DEPLOYMENT GAPS (the assimilation)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No Make Disk dashboard button | HIGH | POST /api/hive/make-disk + dashboard UI with chiptune | 2 | 2.10-2.11 |
| No mDNS auto-discovery | MEDIUM | hashicorp/mdns in Go, bonjour-service in Node | 1 | 1.4 |
| No model auto-pull on boot | MEDIUM | EnsureModels() in ollama.go, check preferred vs available | 1 | 1.5 |
| prepare-usb.sh doesn't include Lightpanda | MEDIUM | Download binary, add to staging | 2 | 2.1 |
| No Android drone support | LOW | Termux + Go binary cross-compiled GOOS=linux GOARCH=arm64 | 4 | 4.7 |
| No Queen auto-deploy to USB-connected devices | LOW | ADB detection for Android, future | 4 | 4.8 |

## SECURITY GAPS (the walls)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| Dashboard leaks hive secret in HTML | HIGH | Session cookie after login, don't embed raw secret | 1 | 1.13 |
| Drone HTTP server has zero auth | HIGH | Check hive secret on all drone endpoints | 1 | — |
| No TLS anywhere | MEDIUM | Tailscale encrypts transport. For LAN-only, accept the risk. | 1 | 1.3 |
| LiteLLM has no auth key set | MEDIUM | Set LITELLM_MASTER_KEY in .env | 1 | — |
| Ollama listens on 0.0.0.0 (anyone on LAN) | MEDIUM | Bind to localhost on Queen, 0.0.0.0 on drones only | 1 | — |

## ECOSYSTEM GAPS (the connections)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No OpenClaw integration docs | HIGH | "Use BorgClaw with OpenClaw" page — one env var change | 1 | 1.14 |
| Dashboard has no Connect panel | MEDIUM | Copy-paste URLs for OpenClaw/DeerFlow/Cursor | 1 | 1.12 |
| No DeerFlow task type | LOW | `type: deerflow` step in workflow YAML, HTTP dispatch to DeerFlow API | 2 | 2.13 |
| No Paperclip integration | LOW | Deferred — approval queue covers governance for now | — | — |
| Dashboard has no Integrations panel | LOW | Toggle switches for each supported system | 2 | 2.14 |

## OBSERVABILITY GAPS (the eyes)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No Prometheus export | MEDIUM | Drone /metrics/prom endpoint, Prometheus in docker-compose | 3 | 3.10-3.11 |
| No alerting | MEDIUM | ntfy integration for threshold alerts (thermal, budget, drone offline) | 1 | 1.7 |
| No structured logging | LOW | JSON logging in Queen + drones, ship later | — | — |

## EVOLUTION GAPS (the growth)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No autoresearch loop in code | MEDIUM | Scheduled workflow that scans GitHub/arXiv, proposes upgrades | 2 | 2.12 |
| DRONE.md not generated from real data | MEDIUM | Structured metrics → periodic summary → file write | 3 | 3.3 |
| Make Disk doesn't inherit learnings | MEDIUM | Copy best drone's DRONE.md + metrics to USB template | 3 | 3.4 |
| No canary deployment (test upgrade on one drone first) | LOW | Queen routes to one drone, compares metrics, rolls out if better | 3 | — |

## SCALE GAPS (the vision)

| Gap | Severity | What Closes It | Phase | Task |
|-----|----------|---------------|-------|------|
| No distributed inference | LOW | drone --mode rpc-worker + Queen InferenceCluster | 3 | 3.5-3.6 |
| No knowledge packs | LOW | ZIM files + openzim-mcp or sqlite-vec | 3 | 3.7-3.9 |
| No community hive federation | LOW | Community Pool Queen + Tailscale mesh + compute credits | 4 | 4.1-4.3 |
| No Queen emergence | LOW | Leadership scoring + auto-promotion on Queen failure | 4 | 4.4 |
| No education use case | LOW | Scholar drone profile + per-student DRONE.md | 4 | 4.5-4.6 |

---

## Gap Count by Phase

| Phase | Gaps Closed | Critical | High | Medium | Low |
|-------|------------|----------|------|--------|-----|
| 0 | 5 | 3 | 2 | 0 | 0 |
| 1 | 16 | 1 | 5 | 8 | 2 |
| 2 | 16 | 0 | 6 | 6 | 4 |
| 3 | 10 | 0 | 0 | 7 | 3 |
| 4 | 6 | 0 | 0 | 0 | 6 |
| **Total** | **53** | **4** | **13** | **21** | **15** |

---

## The Closure Sequence

```
Phase 0: Make it BOOT (4 critical, 2 high)
Phase 1: Make it USEFUL (1 critical, 5 high)
Phase 2: Make it SPECIAL (6 high — ghost workers + hive chat)
Phase 3: Make it ALIVE (metrics, learning, distributed)
Phase 4: Make it a MOVEMENT (community, education, scale)
```

Every phase reduces severity. By end of Phase 1, zero critical gaps remain. By end of Phase 2, zero high gaps remain. Phases 3-4 are medium/low — polish and vision.

---

*Last updated: 2026-03-21*
