#!/usr/bin/env node
// ============================================================
// BorgClaw MCP Server — Claude Desktop bridge to the hive
// ============================================================
// Standalone stdio MCP server. Claude Desktop spawns this process.
// Every tool is a thin HTTP proxy to Queen's REST API.
//
// Config: QUEEN_URL and HIVE_SECRET from env vars, or
//         ~/.config/borgclaw/mcp.json
//
// Resistance is optional. Adaptation is inevitable.
// ============================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// --- Config ---

function loadConfig() {
  let queenUrl = process.env.QUEEN_URL || '';
  let hiveSecret = process.env.HIVE_SECRET || '';

  // Fall back to config file
  if (!queenUrl || !hiveSecret) {
    try {
      const cfgPath = join(homedir(), '.config', 'borgclaw', 'mcp.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      queenUrl = queenUrl || cfg.queen_url || cfg.QUEEN_URL || '';
      hiveSecret = hiveSecret || cfg.hive_secret || cfg.HIVE_SECRET || '';
    } catch {
      // No config file — that's fine, env vars might be enough
    }
  }

  return {
    queenUrl: queenUrl.replace(/\/+$/, '') || 'http://localhost:9090',
    hiveSecret,
  };
}

const config = loadConfig();

// --- Queen HTTP client ---

async function queen(method, path, body) {
  const url = `${config.queenUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (config.hiveSecret) {
    headers['Authorization'] = `Bearer ${config.hiveSecret}`;
  }

  const opts = { method, headers, signal: AbortSignal.timeout(30_000) };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    return { _error: true, error: `Queen unreachable at ${config.queenUrl}: ${err.message}` };
  }

  try {
    return await res.json();
  } catch {
    return { _error: true, error: `Queen returned non-JSON (HTTP ${res.status})` };
  }
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: 'borgclaw_chat',
    description: 'Talk to the Queen. She can both respond and act — set contribution dials, run workflows, halt the hive, approve items, read files, and more. Natural language control of the entire hive.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Your message to the Queen' },
      },
      required: ['message'],
    },
  },
  {
    name: 'borgclaw_status',
    description: 'Get hive status: Queen uptime, nodes online, pending approvals, loaded workflows, running workflows.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'borgclaw_run_workflow',
    description: 'Trigger a named workflow (morning-briefing, signal-scan, etc). Returns a run_id to track progress.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name (e.g. "morning-briefing")' },
        context: { type: 'object', description: 'Optional context variables passed to the workflow' },
      },
      required: ['name'],
    },
  },
  {
    name: 'borgclaw_dispatch_task',
    description: 'Send a task to a specific drone or the best available. Queen routes by capacity, hardware tier, and knowledge domain.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Unique task identifier' },
        type: { type: 'string', description: 'Task type (e.g. "inference", "browser", "code")' },
        model: { type: 'string', description: 'Model to use (e.g. "phi4-mini"). Optional for browser tasks.' },
        payload: { type: 'object', description: 'Task payload sent to the drone' },
        required_domain: { type: 'string', description: 'Optional knowledge domain the drone must have' },
      },
      required: ['task_id', 'type', 'payload'],
    },
  },
  {
    name: 'borgclaw_list_drones',
    description: 'List all registered drones with status, models, metrics (CPU/RAM/GPU/tok_s), contribution level, and capacity.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'borgclaw_approve',
    description: 'Approve a pending item in the governance queue (Law Two). Resumes any workflow waiting on this approval.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Approval item ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'borgclaw_reject',
    description: 'Reject a pending item in the governance queue with an optional reason.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Approval item ID' },
        reason: { type: 'string', description: 'Optional rejection reason' },
      },
      required: ['id'],
    },
  },
  {
    name: 'borgclaw_halt',
    description: 'Emergency stop the entire hive. All drones drop to 0% contribution, running workflows cancel, pending approvals reject. Use borgclaw_chat to resume.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'borgclaw_read_file',
    description: 'Read a file through Queen\'s MCP filesystem proxy. Subject to sandbox restrictions — only paths within allowed roots.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'borgclaw_fetch_url',
    description: 'Fetch web content through Queen\'s MCP fetch proxy. Subject to domain allowlist — blocked domains create a governance approval for the operator.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
];

// --- Tool handlers ---

const handlers = {
  async borgclaw_chat({ message }) {
    return queen('POST', '/api/chat', { message });
  },

  async borgclaw_status() {
    return queen('GET', '/api/status');
  },

  async borgclaw_run_workflow({ name, context }) {
    return queen('POST', `/api/workflows/${encodeURIComponent(name)}/execute`, { context });
  },

  async borgclaw_dispatch_task({ task_id, type, model, payload, required_domain }) {
    return queen('POST', '/api/tasks/dispatch', { task_id, type, model, payload, required_domain });
  },

  async borgclaw_list_drones() {
    return queen('GET', '/api/nodes');
  },

  async borgclaw_approve({ id }) {
    return queen('POST', `/api/approvals/${encodeURIComponent(id)}/approve`);
  },

  async borgclaw_reject({ id, reason }) {
    return queen('POST', `/api/approvals/${encodeURIComponent(id)}/reject`, { reason });
  },

  async borgclaw_halt() {
    return queen('POST', '/api/hive/halt');
  },

  async borgclaw_read_file({ path }) {
    return queen('POST', '/api/mcp/invoke', { server: 'filesystem', tool: 'read_file', args: { path } });
  },

  async borgclaw_fetch_url({ url }) {
    return queen('POST', '/api/mcp/invoke', { server: 'fetch', tool: 'fetch', args: { url } });
  },
};

// --- MCP Server ---

const server = new Server(
  { name: 'borgclaw', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];
  if (!handler) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  try {
    const result = await handler(args || {});
    const isError = result?._error === true;
    const text = JSON.stringify(result, null, 2);
    return {
      content: [{ type: 'text', text }],
      isError,
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
