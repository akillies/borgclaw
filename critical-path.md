# BorgClaw — Critical Path

**Last Updated:** 2026-10-05 (dogfood docs v0.21)  
**Tip reference:** `main` @ security hardening (session cookie, SSE auth, configurable Grafana password)

This file is the **operator critical path** for running BorgClaw for real — not a feature roadmap. Phases and task IDs live in `specs/MASTER-PLAN.md`.

---

## Shipped (use these today)

| Area | What exists |
|------|-------------|
| Queen v0.2.0 | API, dashboard (BBS), workflows, approvals, activity + SSE, chat, setup API |
| Drones | Go binary in `node/` — heartbeat, tasks, personas, learning, mDNS, ghost worker hooks |
| Ops | `./borgclaw` CLI — start/stop/status/deploy/halt; `scripts/bootstrap.sh`, `prepare-usb.sh` |
| Middleware | `docker-compose.yml` — NATS, LiteLLM, ntfy, Grafana (password via `GRAFANA_PASSWORD`) |
| Integration | `KNOWLEDGE_BASE_PATH`, MCP tools, `docs/INTEGRATION.md`, OpenClaw doc |
| Security (recent) | Login gate; HMAC session token for dashboard API; SSE requires session cookie |

README “Alpha — First Drone Online” matches the above at a high level. If your machine diverges (no Docker, no GPU), expect gaps — see dogfood slice in `specs/GAP-CLOSURE.md`.

---

## Dogfood critical path (ordered)

What blocks **daily use on your own knowledge**, in sequence.

### 1. Compute online

Without a reachable model, workflows return stub/errors.

- [ ] Ollama or LM Studio serving on Queen or at least one drone
- [ ] `curl` or dashboard health shows inference reachable
- [ ] One manual workflow run produces non-stub LLM output

**Doc:** `docs/QUICKSTART.md` · **Checklist:** `docs/DOGFOOD.md`

### 2. Knowledge wired

BorgClaw ships infrastructure, not your context.

- [ ] `KNOWLEDGE_BASE_PATH` set in `.env`
- [ ] Workflow YAMLs reference your files (not only shipped examples)
- [ ] Agent `instructions.md` files updated for your scoring/rules

**Doc:** `docs/INTEGRATION.md`

### 3. Middleware you actually need

Not every install needs the full stack — enable what your workflows touch.

- [ ] `docker compose up -d` if using NATS / LiteLLM proxy / ntfy
- [ ] LiteLLM routing verified if drones register as remote endpoints
- [ ] ntfy tested if you want approval pushes (still a known gap if unwired)

### 4. Trust the loop once

- [ ] `./borgclaw status` + dashboard telemetry on expected drones
- [ ] Approval gate tested for any `requires_approval` step
- [ ] One scheduled job enabled only after a clean manual run

### 5. File what breaks

Dogfood value is honest signal.

- [ ] Issues or notes for failures (health red, workflow step, MCP tool, drone drop)

---

## Parked (not on dogfood path)

| Item | Why park |
|------|----------|
| Distributed inference / NVLink garage | Phase 3+ research |
| Community hive federation | Phase 4 |
| Full ghost-worker polish | Phase 2 — browser path exists; don’t block daily LLM workflows |
| Paperclip / budgets beyond approval queue | Deferred in gap map |
| USB branding / thought-leadership packaging | After stable daily loop |

---

## Decisions (still true)

| Decision | Rationale |
|----------|-----------|
| Queen + drones + your knowledge files (three layers) | Infra vs compute vs context stay separate |
| Go drones, Node Queen | Single drone binary; Queen stays scriptable |
| Law Two — draft then approve | External actions wait on approval queue |
| Open infra, private knowledge | Repo is identity-agnostic; `KNOWLEDGE_BASE_PATH` is yours |

Open research items (distributed inference, knowledge pack format, voice stack) remain in the “Planned” section of older specs — not gating dogfood.

---

## Quick links

- `docs/DOGFOOD.md` — one-screen daily checklist  
- `specs/GAP-CLOSURE.md` — dogfood slice + full gap map  
- `specs/MASTER-PLAN.md` — phased task list and status  
