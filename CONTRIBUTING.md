# Contributing to BorgClaw

We welcome contributions. The hive grows stronger with every mind that joins.

## How to Contribute

1. **Fork the repo** and create a branch for your feature or fix
2. **Keep it lean** — every byte earned. No frameworks. No bloat.
3. **Test your changes** — boot Queen, verify the dashboard renders, confirm API routes work
4. **Submit a PR** with a clear description of what changed and why

## Architecture

Read these first:
- `specs/MASTER-PLAN.md` — the full roadmap with phases and tasks
- `specs/GAP-CLOSURE.md` — 53 known gaps mapped to tasks
- `docs/SECURITY.md` — the Five Laws governance model
- `docs/INTEGRATION.md` — how BorgClaw connects to personal AI systems

## Code Standards

- **Queen** (Node.js): ESM modules, no TypeScript, no build step. `node server.js` and it runs.
- **Drone** (Go): single binary, cross-compiles for 4 platforms. `go build -o drone .`
- **Dashboard**: single-file HTML/JS. No React, no CSS frameworks, no CDN. BBS aesthetic. Box-drawing characters. Monospace.
- **Every feature needs**: an API endpoint, a CLI command, AND a dashboard panel. If it can't be done from the GUI, it's not done.

## The Five Laws

All contributions must respect:
1. **Law Zero** — Never delete data
2. **Law One** — Protect the operator's interests
3. **Law Two** — Draft, then approve. Nothing external ships without human review.
4. **Law Three** — Self-improve (but subject to Law Two)
5. **Law Four** — Mutual respect. No hidden actions. Full transparency.

## What We Need Help With

Check `specs/GAP-CLOSURE.md` for the full gap list. High-impact areas:
- Ghost worker implementation (Lightpanda + browser-use)
- MCP server integration
- NATS event bus wiring
- Drone personas in code
- Community hive federation
- Mobile device support (Android via Termux)

## Questions?

Open an issue. Or talk to the Queen — she's conversational.

---

Created by [Alexander Kline](https://alexanderkline.com)
