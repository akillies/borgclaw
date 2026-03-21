# BorgClaw Security Model

## Intent

BorgClaw runs AI agents on your hardware, touching your files, sending requests on your behalf. That's a serious trust surface. This document describes the security principles, what's implemented, and what's planned.

**BorgClaw is designed for personal/home use.** It assumes the operator trusts all machines on the hive (they're yours). It does NOT assume agents should have unlimited access to your system.

---

## The Five Laws (Governance)

BorgClaw's agents operate under five laws, enforced in code where possible:

- **Law Zero — Never Delete.** The system never destroys data. Archive, rename, version — never `rm`.
- **Law One — Protect the Operator.** The system acts in the operator's interest. Financial, reputational, personal. If an action could harm the operator, it doesn't execute.
- **Law Two — Draft, Then Approve.** Nothing external (emails, posts, API calls, file writes outside sandbox) ships without operator approval. The approval queue is a code-level gate, not a suggestion.
- **Law Three — Self-Improve.** The system tracks its own performance and suggests improvements. But improvements are drafted, not applied (Law Two).
- **Law Four — Mutual Respect.** The system communicates transparently. No hidden actions, no obscured logs.

**Law Two is the kill switch.** If you turn off auto-approve, every external action requires explicit human approval via the dashboard or ntfy push notification.

---

## What's Implemented

### Approval Queue (Law Two)
Every agent action tagged `requires_approval: true` in the workflow YAML enters the approval queue. The operator approves or rejects from the dashboard or phone (via ntfy). No bypass path exists in the code.

### Budget Caps
LiteLLM enforces a hard monthly spend cap ($55 default). Individual agents have per-agent budget limits. When a budget is exhausted, the agent pauses — it doesn't failover to a more expensive model.

### Contribution Dial (Resource Governance)
Each node has a 0-100% dial controlling how much compute it offers the hive. At 0%, the node refuses all tasks. The operator controls this per-node from the Queen dashboard. This prevents runaway resource consumption.

### Activity Logging
Every action, heartbeat, approval, and workflow step is logged to the activity feed. SSE pushes events to the dashboard in real-time. The log is the audit trail.

### LiteLLM as Inference Gateway
All LLM requests route through LiteLLM — agents never call Ollama or cloud APIs directly. This gives one control point for: routing, budgets, caching, rate limiting, and logging. If you revoke an API key in LiteLLM, all agents lose access simultaneously.

---

## What's Planned

### Agent Sandboxing (NemoClaw-inspired)
Agents should only access files within `{{KNOWLEDGE_BASE_PATH}}` and designated working directories. No agent should be able to read `/etc/passwd`, your SSH keys, or files outside its sandbox.

Planned approach (inspired by NVIDIA NemoClaw):
- **Filesystem:** Restrict agent file access to `KNOWLEDGE_BASE_PATH` + `BORGCLAW_HOME/data/` + `/tmp`. Use OS-level controls (Landlock on Linux, sandbox-exec on macOS) where available. Fall back to path validation in the agent runtime.
- **Network egress:** Agents cannot make arbitrary HTTP requests. Outbound calls go through the MCP layer or LiteLLM proxy. New external endpoints require operator approval (Law Two).
- **Process isolation:** Long-term, agents run in containers or sandboxed subprocesses, not in the Queen's Node.js process.

### Hive Halt (Panic Button)
`POST /api/hive/halt` — Queen broadcasts HALT to all nodes. All tasks drop, all contributions go to 0%, all pending approvals are rejected. Dashboard red button. Also available via CLI: `./borgclaw halt`.

### Node Authentication
Currently, any machine that knows Queen's IP can register. Planned: a shared hive secret (generated at bootstrap, stored in `hive-identity.json` which is gitignored). Nodes present the secret in the heartbeat header. Queen rejects unrecognized nodes.

### Encrypted Transport
Currently all node-Queen communication is plain HTTP on LAN. Planned: mTLS between Queen and nodes, or Tailscale mesh which encrypts at the network layer. For LAN-only deployments, the threat model is low. For remote nodes, encryption is mandatory.

### Audit Export
Export the activity log as structured JSON for external analysis. Enables: cost auditing, agent behavior review, compliance evidence, pattern detection.

---

## What's NOT in Scope

- **Multi-tenant access control.** BorgClaw is for one operator. There's no user/role system. If you need multi-user, use Tailscale ACLs to control who can reach the Queen.
- **Prompt injection defense.** Agents execute prompts against LLMs. If an attacker can inject into the prompt (e.g., via a malicious email that gets summarized), the LLM may follow the injected instructions. Mitigation: Law Two (approval gate before any external action). Long-term: input sanitization in the MCP layer.
- **Supply chain security for models.** BorgClaw pulls models from Ollama's registry. If a model is compromised upstream, BorgClaw will run it. Mitigation: pin model digests in `config/models.json`. Planned: hash verification on model pull.

---

## The Operator's Responsibilities

- Keep your machines physically secure (they're on your LAN)
- Review approvals before clicking "approve" (Law Two only works if you read the drafts)
- Set budget caps that match your actual risk tolerance
- Don't expose Queen to the public internet without Tailscale or similar
- Rotate API keys periodically (stored in `.env`, which is gitignored)

---

## Design Principle: Snap-In, Don't Replace

BorgClaw is compute infrastructure, not a brain. It augments whatever personal AI system you already run. Your AI OS (AK-OS, PAI, KAI, Cowork, custom) calls BorgClaw's LiteLLM endpoint the same way it calls any LLM API — but now that request hits a fleet of local drones instead of one machine or a cloud provider.

BorgClaw doesn't own your workflows, your memory, your voice rules, or your identity. It provides the drones that execute compute, the Queen that coordinates them, and the governance layer that keeps everything safe.

The recursive research loop that runs all night improving a paper? That's YOUR system's workflow engine. BorgClaw's drones just make it fast, cheap, and parallel.

---

*This document will be updated as security features are implemented. The intent is transparency — operators should know exactly what protections exist and what's still planned.*
