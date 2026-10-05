# Dogfooding BorgClaw (v0.21)

Use BorgClaw on your own hardware with your own knowledge files. This is a one-screen checklist — details live in `docs/INTEGRATION.md` and `docs/QUICKSTART.md`.

## Before you start

- Queen machine: Node 20+, `./borgclaw start` (dashboard at `http://localhost:9090/dashboard`).
- Optional but typical: `docker compose up -d` for NATS, LiteLLM, ntfy, Grafana (see `.env.example`).
- At least one inference path: local Ollama/LM Studio on the Queen or a drone (`./borgclaw deploy <ip>` or `node/` binary).
- Hive secret: from `hive-identity.json` (or env). Log in at `/auth/login` — API/SSE use the session cookie, not the raw secret in the page.

## Wire your context (once)

1. Set `KNOWLEDGE_BASE_PATH` in `.env` to a directory you already maintain (or use `./knowledge`).
2. Point workflow YAMLs under `config/workflows/` at your files via `{{KNOWLEDGE_BASE_PATH}}/...` (replace shipped examples).
3. Edit `agents/*/instructions.md` so prompts match how you actually work — BorgClaw does not ship your life context.

## Daily loop

| Step | Action | Pass? |
|------|--------|-------|
| 1 | `./borgclaw status` — Queen up, drones heartbeating | ☐ |
| 2 | Dashboard → deep health — Ollama/LiteLLM/NATS green or explained | ☐ |
| 3 | Run one workflow from the dashboard (▶) — real LLM text, not stub errors | ☐ |
| 4 | If the workflow touches the outside world, confirm approval queue (Law Two) | ☐ |
| 5 | Check activity feed / SSE — steps appear as the run progresses | ☐ |
| 6 | Note failures in a GitHub issue or your own log — dogfood means filing what broke | ☐ |

## Scheduled use

- Cron workflows: `config/scheduled/*.yaml` (Queen scheduler must be running with Queen).
- After changing YAML or agent instructions, trigger once manually before trusting the schedule.

## What “done” looks like for dogfood

You can run **one** recurring workflow you care about (e.g. morning scan, inbox triage draft) on **your** files, on **your** machines, with approvals when required — without hand-editing the Queen on every run.

## Not in scope for this doc

Ghost workers, Make Disk, federation, and Phase 3+ polish — see `specs/GAP-CLOSURE.md` (dogfood slice) and `critical-path.md`.
