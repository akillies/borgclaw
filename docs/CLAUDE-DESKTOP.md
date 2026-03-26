# Claude Desktop Integration

Connect Claude Desktop to your BorgClaw hive. Once configured, Claude gains 10 tools that give it full control of the hive — talk to the Queen, dispatch tasks to drones, trigger workflows, approve governance items, read files, and fetch web content.

The MCP server is a separate process from Queen. It is a thin HTTP proxy — Claude Desktop spawns it, sends tool calls over stdio, and the server forwards them to Queen's REST API.

---

## Setup

### 1. Install dependencies

```bash
cd borgclaw/mcp-server
npm install
```

### 2. Get your hive secret

The secret is auto-generated on Queen's first boot. Find it in:

```bash
cat ~/borgclaw/data/hive-identity.json | grep secret
```

Or check Queen's boot output — she prints the first 8 characters on startup.

### 3. Configure Claude Desktop

Open Claude Desktop settings and add the MCP server to your config.

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "borgclaw": {
      "command": "node",
      "args": ["/absolute/path/to/borgclaw/mcp-server/index.js"],
      "env": {
        "QUEEN_URL": "http://localhost:9090",
        "HIVE_SECRET": "your-hive-secret-here"
      }
    }
  }
}
```

Replace `/absolute/path/to/borgclaw` with the actual path on your machine.

### 4. Alternative: config file

Instead of putting the secret in Claude Desktop's config, create a config file:

```bash
mkdir -p ~/.config/borgclaw
cat > ~/.config/borgclaw/mcp.json << 'EOF'
{
  "queen_url": "http://localhost:9090",
  "hive_secret": "your-hive-secret-here"
}
EOF
chmod 600 ~/.config/borgclaw/mcp.json
```

Then your Claude Desktop config only needs:

```json
{
  "mcpServers": {
    "borgclaw": {
      "command": "node",
      "args": ["/absolute/path/to/borgclaw/mcp-server/index.js"]
    }
  }
}
```

### 5. Restart Claude Desktop

Quit and reopen Claude Desktop. The BorgClaw tools should appear in the tools menu (hammer icon).

---

## Available Tools

| Tool | What it does |
|------|-------------|
| `borgclaw_chat` | Talk to the Queen in natural language. She responds AND acts. |
| `borgclaw_status` | Hive status: uptime, nodes online, pending approvals, workflows loaded. |
| `borgclaw_run_workflow` | Trigger a workflow by name (morning-briefing, signal-scan, etc). |
| `borgclaw_dispatch_task` | Send a task to the best available drone (or a specific one). |
| `borgclaw_list_drones` | List all drones with status, models, metrics, contribution levels. |
| `borgclaw_approve` | Approve a pending governance item (Law Two). Resumes paused workflows. |
| `borgclaw_reject` | Reject a pending governance item with an optional reason. |
| `borgclaw_halt` | Emergency stop. All drones to 0%, workflows cancel, approvals reject. |
| `borgclaw_read_file` | Read a file via Queen's sandboxed MCP filesystem. |
| `borgclaw_fetch_url` | Fetch web content via Queen's sandboxed MCP fetch. |

---

## Usage Examples

Once connected, just talk to Claude naturally. It will invoke the right tools.

**Check on the hive:**
> "What's the status of my BorgClaw hive?"

Claude calls `borgclaw_status` and summarizes: nodes online, pending approvals, running workflows.

**Talk to the Queen:**
> "Tell the Queen to set the gaming PC drone to 30% and run the morning briefing."

Claude calls `borgclaw_chat` — the Queen sets the contribution dial AND triggers the workflow in a single response.

**Dispatch work:**
> "Send a research task to the best available drone with phi4-mini."

Claude calls `borgclaw_dispatch_task` with the right parameters.

**Approve governance items:**
> "Show me pending approvals and approve the first one."

Claude calls `borgclaw_status` to check pending count, then `borgclaw_approve` to clear it.

**Emergency stop:**
> "Halt the hive immediately."

Claude calls `borgclaw_halt`. Everything stops. Resume via `borgclaw_chat` with "resume the hive."

---

## Troubleshooting

**"Queen unreachable"** — Make sure Queen is running (`./borgclaw start`) and listening on the configured URL.

**"Unauthorized"** — Check that HIVE_SECRET matches what Queen generated. Look in `data/hive-identity.json`.

**Tools not showing in Claude Desktop** — Check the path in `claude_desktop_config.json` is absolute and correct. Check that `npm install` ran in the mcp-server directory. Restart Claude Desktop completely (quit, not just close window).

**Sandbox violations on file read** — Queen enforces sandbox roots. The file must be within `KNOWLEDGE_BASE_PATH`, `BORGCLAW_HOME/data/`, or `/tmp/borgclaw/`. Configure `SANDBOX_ROOTS` in your `.env` to add more paths.

**Fetch blocked** — Queen's domain allowlist blocked the URL. Check the approvals queue — a governance item was created for operator review.

---

## Architecture

```
Claude Desktop
    |
    | (stdio — JSON-RPC / MCP protocol)
    |
    v
borgclaw-mcp-server  (this process — thin HTTP proxy)
    |
    | (HTTP — Bearer auth)
    |
    v
Queen :9090  (REST API — the real brain)
    |
    |--- Drones (heartbeat, task dispatch)
    |--- LiteLLM :4000 (model routing)
    |--- NATS (event bus)
    |--- Workflows, Approvals, MCP tools
```

The MCP server has no state, no intelligence, no persistence. It translates MCP tool calls into Queen API calls and returns the results. If Queen is offline, every tool returns a clear error. The server never crashes — it just reports what happened.

---

## Remote Hive

If your hive is on a home server or remote machine, set `QUEEN_URL` to its Tailscale IP or LAN address:

```json
{
  "env": {
    "QUEEN_URL": "http://100.64.0.1:9090",
    "HIVE_SECRET": "your-secret"
  }
}
```

Control your entire home compute fleet from Claude Desktop on your laptop, on the go.
