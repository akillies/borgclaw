// ============================================================
// Activity Feed — Ring buffer of recent system events
// ============================================================
// In-memory ring buffer + file persistence. No database.
// Everything that happens in the hive gets logged here.
// Dashboard reads from this. SSE pushes from this.
// your AI OS hooks into this for cross-system routing.
// ============================================================

import { readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

const MAX_ENTRIES = 500;
const entries = [];
let dataFile = null;

// SSE listeners for real-time push
const listeners = new Set();

// External hooks — other systems (your AI OS, ntfy, etc) register here
const hooks = [];

export function initActivity(dataDir) {
  dataFile = path.join(dataDir, 'activity.json');
  try {
    const raw = readFileSync(dataFile, 'utf-8');
    const loaded = JSON.parse(raw);
    if (Array.isArray(loaded)) entries.push(...loaded.slice(-MAX_ENTRIES));
  } catch { /* fresh start */ }
}

export function log(event) {
  const entry = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    ...event,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  // Persist last 100 async
  if (dataFile) fs.writeFile(dataFile, JSON.stringify(entries.slice(-100), null, 2)).catch(() => {});

  // Push to SSE listeners
  for (const res of listeners) {
    try { res.write(`data: ${JSON.stringify(entry)}\n\n`); }
    catch { listeners.delete(res); }
  }

  // Fire external hooks
  for (const hook of hooks) {
    try { hook(entry); } catch { /* hooks don't break the system */ }
  }

  return entry;
}

export function get(limit = 50, since = null) {
  let result = entries;
  if (since) result = result.filter(e => e.ts > since);
  return result.slice(-limit).reverse();
}

export function addSSEListener(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`);
  listeners.add(res);
  res.on('close', () => listeners.delete(res));
}

// Register an external hook — called on every event
// Use this to route events to your AI OS, ntfy, NATS, etc.
export function onEvent(fn) {
  hooks.push(fn);
}
