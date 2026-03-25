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

## SANDBOX

Agent sandboxing is the application-level enforcement layer that constrains what files agents can read/write and which network destinations they can reach. It runs before any MCP server process is spawned, so violations are blocked without touching the OS.

This is not OS-level isolation (Landlock, sandbox-exec). OS-level controls are a future addition on top of this layer, not a replacement. For the current threat model — a personal hive on your own hardware — application-level enforcement is the right first step.

### Filesystem sandboxing

Agents may only access files within a configured set of allowed roots. Any `POST /api/mcp/invoke` call to the `filesystem` server has every path argument checked before the MCP process starts.

**Default allowed roots:**

| Root | Purpose |
|------|---------|
| `$KNOWLEDGE_BASE_PATH` | Your personal AI OS knowledge base |
| `$BORGCLAW_HOME/data/` | Queen's working data (activity, approvals, nodes) |
| `/tmp/borgclaw/` | Ephemeral agent scratch space |

**Configuration:**

Set `SANDBOX_ROOTS` in your `.env` as a colon-separated list of absolute paths to fully override the defaults:

```
SANDBOX_ROOTS=/home/you/knowledge:/home/you/borgclaw/data:/tmp/borgclaw
```

If `SANDBOX_ROOTS` is set it replaces all defaults — list every root you need.

**What happens when a path is blocked:**

- The invoke request returns `{ ok: false, error: "Sandbox violation: path outside allowed roots" }`
- An activity event of type `sandbox_block` is logged with the blocked path and the current allowed roots
- The MCP filesystem process is never spawned

### Network egress control

Agents may only fetch URLs whose hostname is in the domain allowlist. Any `POST /api/mcp/invoke` call to the `fetch` server has the URL checked before the MCP process starts.

**Default allowed domains:**

| Pattern | Matches |
|---------|--------|
| `localhost` | Local Queen |
| `127.0.0.1` | Local loopback (IPv4) |
| `::1` | Local loopback (IPv6) |
| `*.local` | LAN mDNS hostnames (e.g. `mac-mini.local`) |

**Configuration:**

Set `SANDBOX_ALLOWED_DOMAINS` in your `.env` as a colon-separated list:

```
SANDBOX_ALLOWED_DOMAINS=localhost:*.local:api.openai.com:your-domain.com
```

Wildcard patterns match anything ending in the suffix. `*.local` matches `queen.local` and `node-1.local` and `deep.node.local` — all LAN mDNS peers are considered equally trusted.

**What happens when a domain is blocked:**

- The invoke request returns `{ ok: false, error: "Sandbox violation: domain not in allowlist" }`
- An activity event of type `sandbox_block` is logged with the blocked URL and the current allowlist
- A governance approval is created in the queue (type: `sandbox_domain_request`) so you can review the request, then add the domain to `SANDBOX_ALLOWED_DOMAINS` if you trust it
- The MCP fetch process is never spawned

### Governance approvals for blocked network requests

When a fetch is blocked, an approval appears in the queue with:

```json
{
  "type": "sandbox_domain_request",
  "summary": "Agent requested fetch to unlisted domain: https://example.com/api",
  "url": "https://example.com/api",
  "allowed_domains": ["localhost", "*.local", "127.0.0.1", "::1"],
  "source_agent": "agent-id-from-header",
  "source_workflow": "workflow-id-from-header"
}
```

Approving it does not automatically whitelist the domain — it is a human-readable record. To permanently allow the domain: add it to `SANDBOX_ALLOWED_DOMAINS` and restart Queen.

### Summary table

| Layer | Mechanism | Configured by |
|-------|-----------|---------------|
| Filesystem | Path prefix matching in `lib/sandbox.js` | `SANDBOX_ROOTS` env var |
| Network egress | Domain allowlist in `lib/sandbox.js` | `SANDBOX_ALLOWED_DOMAINS` env var |
| OS isolation | Not yet implemented | — |

---

## Supply Chain Security

BorgClaw depends on upstream packages (npm, Go modules, PyPI, Docker images). A compromised upstream dependency can inject malicious code into the hive. This section documents what we do about it.

### LiteLLM image is pinned

The LiteLLM Docker image in `docker-compose.yml` is pinned to a specific version tag (`main-v1.63.14.dev1`), not `main-latest`. This prevents a compromised or broken upstream push from automatically entering your hive on the next `docker compose pull`.

**Why this matters:** In late 2024, a malicious package named `litellm` appeared on PyPI (distinct from the legitimate `litellm` project on GitHub). It contained credential-harvesting code. While BorgClaw runs LiteLLM via Docker (not pip), the incident demonstrates that the LiteLLM ecosystem is a target. Pinning the Docker image to a verified tag is a direct mitigation against supply chain compromise of the container image.

**To update:** Check the [LiteLLM releases page](https://github.com/BerriAI/litellm/releases), verify the release notes, then manually update the tag in `docker-compose.yml`. Never use `main-latest` in production.

### Autoresearch security scan

The weekly autoresearch workflow (`config/workflows/autoresearch.yaml`) includes a `scan_security` step that runs in parallel with the model, tool, device, and fork scans. It checks:

- **npm:** `services/queen/package.json` + `package-lock.json` against `npm audit`
- **Go:** `node/go.mod` + `go.sum` against `go vuln check`
- **Python:** `scripts/browser-worker/requirements.txt` against PyPI safety databases
- **Docker:** `docker-compose.yml` image tags for floating/unpinned versions

Security findings are fed into the evaluate step alongside upgrade candidates, so the weekly proposal includes both opportunities and vulnerabilities.

### Checking dependency status

Two ways to check the current security posture:

1. **API:** `GET /api/security/status` on Queen (port 9090). Returns a JSON object:
   ```json
   {
     "status": "ok",
     "findings": [
       { "check": "npm_lockfile", "status": "ok", "detail": "package-lock.json exists" },
       { "check": "go_sum", "status": "ok", "detail": "go.sum exists — Go deps are verified" },
       { "check": "litellm_image", "status": "ok", "detail": "LiteLLM image pinned: main-v1.63.14.dev1" }
     ],
     "checked_at": "2026-03-24T..."
   }
   ```

2. **CLI:** `./borgclaw security` (planned — not yet implemented)

Status values: `ok` (all checks pass), `warning` (non-critical issues), `critical` (immediate action needed).

### Drone security reporting

Each drone includes a `security` field in its heartbeat payload:

```json
{
  "security": {
    "go_version": "go1.25.0",
    "ollama_version": "0.6.2",
    "unusual_ports": []
  }
}
```

`go_version` comes from `runtime.Version()`. `ollama_version` is fetched from the Ollama API (`/api/version`). `unusual_ports` is a placeholder for future network monitoring — detecting unexpected listeners on the drone host.

---

## What's Planned

### Agent Sandboxing — OS-level isolation (in progress)
Application-level sandboxing is implemented (see SANDBOX section above). The next layer is OS-level process isolation so that even a compromised agent process cannot escape the sandbox:

- **Linux:** Landlock LSM — restrict filesystem access at the kernel level per process
- **macOS:** `sandbox-exec` profiles — restrict file and network access per process
- **Containers:** Long-term, agents run in rootless containers (Podman) with explicit volume mounts, not in the Queen's Node.js process

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
