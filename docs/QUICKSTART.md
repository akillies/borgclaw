# BorgClaw Quickstart

**Time to first node: ~15 minutes.**

---

## Prerequisites

- macOS or Linux (Windows: use `scripts/bootstrap.ps1`)
- Node.js 20+
- Docker (for middleware stack)
- 8GB+ RAM, 10GB+ free disk

---

## Step 1: Start the Queen (your primary machine)

The Queen is the central orchestrator. Run it on your always-on machine — a Mac Mini, a desktop, a home server. Whatever doesn't sleep.

```bash
cd services/queen
npm install
node server.js
```

Queen starts at `http://localhost:9090`. Visit it — you'll see an empty node registry.

---

## Step 2: Assimilate your first node

Run the Assimilator on any machine you want to add to your cluster:

```bash
# On the Queen machine itself (makes it a node too)
bash scripts/bootstrap.sh --role queen --queen-ip localhost

# On another machine on your network
bash scripts/bootstrap.sh --role worker --queen-ip 192.168.1.X
```

The Assimilator:
1. Detects your hardware (CPU, GPU, RAM)
2. Maps it to a hardware profile
3. Installs LM Studio (Mac) or Ollama (everything else)
4. Pulls the right models for your hardware
5. Registers with the Queen
6. Starts sending heartbeats

After a minute, refresh `http://localhost:9090` — your node appears.

---

## Step 3: Start the middleware stack

```bash
docker compose up -d
```

This starts:
- **NATS JetStream** — event bus, port 4222
- **ntfy** — push notifications + approval buttons, port 2586
- **Fizzy** — task queue (if configured)

---

## Step 4: Verify

```bash
# Check Queen status
curl http://localhost:9090

# List registered nodes
curl http://localhost:9090/api/status

# Check NATS is running
curl http://localhost:8222/healthz
```

---

## Step 5: Add agents

Agents are folders in `agents/`. Each has:
- `agent.json` — metadata, compute assignment, budget
- `instructions.md` — the system prompt

Five agents are pre-defined: `jarvis-router`, `cerebro-analyst`, `ops-handler`, `comms-drafter`, `sentinel`.

To activate an agent, load its `instructions.md` as the system prompt for whichever AI runtime you're using (Claude, local Ollama, etc.).

---

## Next steps

- **Add a node via USB:** Generate a hive identity (`POST /api/hive/generate-usb`), copy to USB, run `bootstrap.sh` on the new machine — it auto-discovers the Queen.
- **Configure NadirClaw:** Smart LLM routing across all your nodes. See `config/models.json` for model assignments.
- **Configure models:** Edit `config/models.json` to change which models run on which hardware profiles.

---

## Architecture in 30 seconds

```
Your phone
  ↓ (ntfy push — tap Approve/Reject)
Queen (Mac Mini)
  ├── Node registry (which machines are alive)
  ├── Approval queue (drafts waiting for your sign-off)
  └── Dashboard (http://localhost:9090)
      ↓
NATS JetStream (event bus)
      ↓
Agents (jarvis, cerebro, ops, comms, sentinel)
  ├── Local models via Ollama/LM Studio (free)
  └── Cloud APIs via LiteLLM (last resort, budget-capped)
```

Law Two: **Everything is a draft until you approve it.** No email gets sent, no post goes live, no file gets modified without your explicit tap.

---

*Full architecture: `docs/ARCHITECTURE.md` | Technology decisions: `research/TECHNOLOGY-AUDIT.md`*
