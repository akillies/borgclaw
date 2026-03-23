// ============================================================
// MCP Tool Invocation — Model Context Protocol proxy layer
// ============================================================
// Spawn MCP servers on demand (stdio transport), send a tool
// call via JSON-RPC, return the result. No persistent procs.
//
// Supported servers:
//   filesystem  — @modelcontextprotocol/server-filesystem
//   fetch       — @modelcontextprotocol/server-fetch
//
// Extracted from server.js — no side effects on import.
// ============================================================

import path from 'path';
import { spawn } from 'child_process';
import * as sandbox from './sandbox.js';

// --- State (populated via init) ---
let MCP_SERVERS = {};
let MCP_FS_ROOTS = [];
let VERSION = '0.2.0';

// --- Init ---

export function initMcp({ fsRoots, knowledgeBasePath, nasMountPath, version }) {
  VERSION = version || VERSION;
  MCP_FS_ROOTS = fsRoots || [];

  MCP_SERVERS = {
    filesystem: {
      description: 'File read/write via @modelcontextprotocol/server-filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', ...MCP_FS_ROOTS],
    },
    fetch: {
      description: 'Web content fetching via mcp-fetch-server',
      command: 'npx',
      args: ['-y', 'mcp-fetch-server'],
    },
  };
}

// --- Accessors ---

export function getServers() {
  return MCP_SERVERS;
}

export function getFsRoots() {
  return MCP_FS_ROOTS;
}

// --- Sandbox check helper ---

// Verify a file path is within the configured sandbox roots.
// Returns true if the path is allowed, false if it is blocked.
function sandboxCheck(filePath, roots) {
  if (roots && roots.length) {
    const resolved = path.resolve(filePath);
    return roots.some(root => {
      const r = path.resolve(root);
      const prefix = r.endsWith(path.sep) ? r : r + path.sep;
      return resolved === r || resolved.startsWith(prefix);
    });
  }
  return sandbox.checkPath(filePath);
}

// --- MCP Tool Call ---

// callMcpTool — spawn an MCP server, run one tool call, return the result.
// Protocol sequence:
//   1. Spawn process (stdio transport)
//   2. Send initialize request — required handshake before any tool call
//   3. Wait for initialize response
//   4. Send tools/call request
//   5. Wait for tools/call response
//   6. Kill the process, return the result or throw on error
//
// Each JSON-RPC message is newline-delimited on stdout. The server may emit
// progress/notification frames before the final response — we match by id.
export async function callMcpTool(serverKey, toolName, toolArgs, timeoutMs = 30000) {
  const serverDef = MCP_SERVERS[serverKey];
  if (!serverDef) throw new Error(`Unknown MCP server: ${serverKey}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(serverDef.command, serverDef.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let settled = false;
    let stdoutBuf = '';
    const pending = new Map(); // id -> { resolve, reject }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        reject(new Error(`MCP tool call timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    function finish(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      if (err) reject(err);
      else resolve(result);
    }

    // Send a JSON-RPC message over stdin
    function send(msg) {
      try {
        proc.stdin.write(JSON.stringify(msg) + '\n');
      } catch (err) {
        finish(new Error(`MCP stdin write failed: ${err.message}`));
      }
    }

    // Dispatch a response frame matched by id
    function dispatch(frame) {
      const handler = pending.get(frame.id);
      if (!handler) return; // notification or unknown id — ignore
      pending.delete(frame.id);
      if (frame.error) {
        handler.reject(new Error(`MCP error ${frame.error.code}: ${frame.error.message}`));
      } else {
        handler.resolve(frame.result);
      }
    }

    // Send a request and wait for its response
    function request(msg) {
      return new Promise((res, rej) => {
        pending.set(msg.id, { resolve: res, reject: rej });
        send(msg);
      });
    }

    // Parse newline-delimited JSON from stdout
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop(); // keep incomplete tail
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const frame = JSON.parse(trimmed);
          dispatch(frame);
        } catch {
          // Non-JSON line (e.g. banner text) — ignore
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      // Log stderr for debugging but don't fail the call
      const msg = chunk.toString().trim();
      if (msg) console.debug(`[MCP:${serverKey}] stderr: ${msg}`);
    });

    proc.on('error', (err) => {
      finish(new Error(`MCP process spawn failed: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (!settled) {
        finish(new Error(`MCP process exited unexpectedly (code ${code})`));
      }
    });

    // Execute the protocol sequence once the process is up
    async function run() {
      try {
        // 1. Initialize handshake
        await request({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'borgclaw', version: VERSION },
          },
        });

        // 2. Tool call
        const result = await request({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: toolArgs },
        });

        finish(null, result);
      } catch (err) {
        finish(err);
      }
    }

    run();
  });
}

// --- Routes ---

export function registerRoutes(app, { activity, approvals }) {
  // GET /api/mcp/servers — list available MCP servers
  app.get('/api/mcp/servers', (_req, res) => {
    const list = Object.entries(MCP_SERVERS).map(([key, def]) => ({
      key,
      description: def.description,
      command: `${def.command} ${def.args.join(' ')}`,
    }));
    res.json({ servers: list, count: list.length });
  });

  // POST /api/mcp/invoke — proxy a tool call to an MCP server
  //
  // Sandbox enforcement runs before the MCP process is spawned:
  //   filesystem server — every string value in args is tested as a file path
  //   fetch server      — args.url is validated against the domain allowlist
  //
  // Blocks return { ok: false, error: "Sandbox violation: ..." } and log a
  // sandbox_block event to the activity feed. Blocked fetch calls additionally
  // create a governance approval so the operator can whitelist the domain.
  app.post('/api/mcp/invoke', async (req, res) => {
    const { server, tool, args } = req.body;

    if (!server) return res.status(400).json({ error: 'server is required (filesystem | fetch)' });
    if (!tool) return res.status(400).json({ error: 'tool is required' });
    if (!MCP_SERVERS[server]) {
      return res.status(400).json({
        error: `Unknown server: ${server}`,
        available: Object.keys(MCP_SERVERS),
      });
    }

    const safeArgs = args || {};
    const allowedRoots = sandbox.getRoots();

    // -- Filesystem sandbox check --
    if (server === 'filesystem') {
      const pathsToCheck = Object.values(safeArgs).filter(v => typeof v === 'string');
      for (const p of pathsToCheck) {
        if (!sandboxCheck(p, allowedRoots)) {
          const blockedPath = p;
          console.warn(`[SANDBOX] Blocked filesystem access: ${blockedPath}`);
          activity.log({
            type: 'sandbox_block',
            server,
            tool,
            path: blockedPath,
            allowed_roots: allowedRoots,
          });
          return res.status(403).json({
            ok: false,
            error: `Sandbox violation: path outside allowed roots`,
            path: blockedPath,
            allowed_roots: allowedRoots,
          });
        }
      }
    }

    // -- Network sandbox check --
    if (server === 'fetch') {
      const targetUrl = safeArgs.url;
      if (targetUrl && !sandbox.checkUrl(targetUrl)) {
        console.warn(`[SANDBOX] Blocked fetch: ${targetUrl}`);
        activity.log({
          type: 'sandbox_block',
          server,
          tool,
          url: targetUrl,
          allowed_domains: sandbox.getDomains(),
        });
        // Create a governance approval so the operator can review and whitelist.
        approvals.create({
          type: 'sandbox_domain_request',
          summary: `Agent requested fetch to unlisted domain: ${targetUrl}`,
          url: targetUrl,
          allowed_domains: sandbox.getDomains(),
          source_agent: req.headers['x-agent-id'] || 'unknown',
          source_workflow: req.headers['x-workflow-id'] || null,
        });
        return res.status(403).json({
          ok: false,
          error: `Sandbox violation: domain not in allowlist`,
          url: targetUrl,
          allowed_domains: sandbox.getDomains(),
        });
      }
    }

    // -- Execute --
    const started = Date.now();
    activity.log({ type: 'mcp_invoke', server, tool, args_keys: Object.keys(safeArgs) });

    try {
      const result = await callMcpTool(server, tool, safeArgs);
      const elapsed_ms = Date.now() - started;

      activity.log({ type: 'mcp_invoke_ok', server, tool, elapsed_ms });
      res.json({ ok: true, server, tool, result, elapsed_ms });
    } catch (err) {
      const elapsed_ms = Date.now() - started;
      activity.log({ type: 'mcp_invoke_error', server, tool, error: err.message, elapsed_ms });
      res.status(500).json({ ok: false, server, tool, error: err.message, elapsed_ms });
    }
  });
}
