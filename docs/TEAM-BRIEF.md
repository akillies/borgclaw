# BorgClaw — Team Brief

> *"Absorb what is useful. Discard what is not. Add what is essentially your own."*
> — Bruce Lee

---

## The Problem

Every AI tool your team uses runs on someone else's computer. Your prompts are their training data. Your workflows depend on their uptime. Your costs scale with their pricing decisions. The intelligence layer of your work is rented, not owned — and that rent goes up every quarter.

Worse: the tools don't talk to each other. You have an inference provider, a workflow tool, an embedding store, a notification system, a task manager. Each one is excellent at one thing. None of them know the others exist.

---

## What BorgClaw Is

BorgClaw turns any computer — Mac, PC, Raspberry Pi, cloud VM — into a node in a personal AI cluster.

One script. The node detects its own hardware, installs the right inference server, loads the right models for that hardware, and registers with the Queen (the cluster orchestrator). Every machine you own becomes part of one hive. Tasks route to the best machine for the job. Local inference for ~70% of workload. Cloud APIs only when local can't handle it — with hard spending caps.

The Queen is a lightweight Node.js server: node registry, heartbeat monitor, capability lookup, dashboard. The Assimilator is a single bash script. Together, they're ~700 lines of original code composing a stack of best-in-class open source tools.

---

## The Philosophy

BorgClaw doesn't build from scratch. It composes.

Like Bruce Lee building Jeet Kune Do — not inventing a martial art, but taking the best of Wing Chun, boxing, fencing, wrestling, and synthesizing something that worked for his body, his mind, his instincts — BorgClaw takes what's already excellent and connects it. Ollama, LiteLLM, NATS JetStream, LangGraph, QMD, ntfy. Each is battle-tested and best-in-class at exactly one thing.

Every component is also replaceable. The autoresearch loop runs weekly: scan for better tools in each component's domain, score candidates against a measurable metric, run an experiment, keep or discard. If something better appears, the system flags itself for an upgrade. The stack evolves without maintenance debt.

**The Borg aesthetic is intentional and slightly ironic.** You're not being assimilated by the collective — *you are the collective.* The hive serves you.

---

## How It Could Launch

| Phase | Name | Time | What Happens |
|-------|------|------|-------------|
| A | "Hello World" | 30 min | Bootstrap.sh on one machine. Queen running. Dashboard live. First local inference. |
| B | "Two Brains" | 1 hr | Second machine joins. Mac on MLX, PC on CUDA. Routing between them. |
| C | "One Door" | 1-2 hrs | NadirClaw binary router active. Single endpoint. Simple tasks local, complex tasks cloud. |
| D | "The Agents" | 2-4 hrs | Five agents with roles, budgets, approval queues. Scheduled tasks. Nothing ships without sign-off. |
| E | "The Assimilator" | 1-2 hrs | USB installer. Plug into any machine, run script, it joins the hive. Plug and assimilate. |
| F | "Superintelligence" | Ongoing | Dogfood. Autoresearch loop running. Stack improving itself. Open-source community forming. |

---

## How Teams Can Use It

**Shared intelligence layer without a shared API bill.** Each team member runs their own node. The Queen coordinates. Models stay local. Cloud costs are per-agent, hard-capped, auditable.

**Five agents cover the core workflows:**

| Agent | Role | Cost |
|-------|------|------|
| jarvis-router | Triage every request, route to right agent | $0 (local) |
| cerebro-analyst | Deep research, signal scanning, foresight synthesis | ~$20-40/mo |
| comms-drafter | Writing in your voice — emails, posts, articles | ~$5-15/mo |
| ops-handler | Code, data, file operations, structured output | $0 (local GPU) |
| sentinel | 24/7 monitor — inbox, calendar, project stalls, alerts | $0 (local) |

**Governance is built in.** Every agent has a monthly budget. At 80% usage: warning. At 100%: auto-pause. Every action is logged to an append-only audit trail. Anything that touches the outside world — email send, content publish, API call — requires explicit approval. The board of directors is one person: you.

**The thermodynamic ledger** makes cost visible: cost per task, cost per agent, cost per workflow. When cloud usage climbs, the system flags it. You tune the routing. Maximum intelligence per dollar, not maximum model size.

---

## What It Isn't

- Not a SaaS. No subscription. No vendor lock-in.
- Not an enterprise tool. It's personal infrastructure, designed to scale from 1 machine to a team.
- Not finished. v0.1 is scaffolding. The agents are defined, not yet fully wired. The interesting work is in Phase D.

---

## The Numbers

| Item | Cost |
|------|------|
| Bootstrap a node | $0 |
| Run Queen + middleware stack | $0 (Docker, local) |
| Local inference (70% of workload) | $0 marginal |
| Full agent suite, cloud tasks | ~$30-55/month hard cap |
| Equivalent via pure API access | $200-400/month |

---

## Discussion Questions

1. Which workflows would benefit most from always-on local intelligence?
2. What's the right governance model for a shared team Queen vs. individual Queens?
3. Which agent should be built first for our actual use case?
4. What does the USB installer unlock for onboarding new team members or machines?

---

*BorgClaw is MIT licensed. Your machines. Your models. Your rules.*
