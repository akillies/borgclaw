// ============================================================
// Approval Queue — Law Two enforced in code
// ============================================================
// Nothing external ships without approval. This isn't a
// suggestion in an instructions.md. It's a gate in the code.
// No bypass path exists.
//
// Storage: in-memory Map + file-backed JSON.
// Notification: ntfy push (primary) + hooks for your AI OS.
// ============================================================

import { readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import * as activity from './activity.js';

const queue = new Map(); // id -> approval object
let dataFile = null;
let queenBaseUrl = null; // set by initApprovals so ntfy can build action URLs

// Notification hooks — register your AI OS, email, etc.
const notifyHooks = [];

// ============================================================
// ntfy Push Notifications
// ============================================================
// Sends approval requests to your phone/desktop with action buttons.
// Topic: borgclaw-approvals
// Buttons: [Approve] [Reject] — tap to POST to Queen API.
// If ntfy is offline the system keeps working — log, don't crash.
// ============================================================

const NTFY_URL = process.env.NTFY_URL || 'http://localhost:2586';
const NTFY_TOPIC = 'borgclaw-approvals';

async function pushNtfy(item, queenBaseUrl) {
  // Build action button URLs. queenBaseUrl is best-effort — falls back to localhost.
  const base = queenBaseUrl || 'http://localhost:9090';
  const approveUrl = `${base}/api/approvals/${item.id}/approve`;
  const rejectUrl  = `${base}/api/approvals/${item.id}/reject`;

  const title = `Approval required: ${item.type || 'unknown'}`;
  const body  = item.summary || item.type || item.id;

  try {
    await fetch(`${NTFY_URL}/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        'Title':   title,
        'Tags':    'robot,borgclaw',
        'Actions': [
          `http, Approve, ${approveUrl}, method=POST, clear=true`,
          `http, Reject,  ${rejectUrl},  method=POST, clear=true`,
        ].join('; '),
      },
      body,
      signal: AbortSignal.timeout(4000),
    });
    console.log(`[APPROVALS] ntfy sent for ${item.id}`);
  } catch (err) {
    // ntfy being offline must never crash the approval gate
    console.warn(`[APPROVALS] ntfy unavailable (${err.message}) — approval still queued`);
  }
}

export function initApprovals(dataDir, opts = {}) {
  dataFile = path.join(dataDir, 'approvals.json');
  if (opts.queenBaseUrl) queenBaseUrl = opts.queenBaseUrl;
  try {
    const raw = readFileSync(dataFile, 'utf-8');
    const loaded = JSON.parse(raw);
    if (Array.isArray(loaded)) {
      for (const item of loaded) queue.set(item.id, item);
    }
  } catch { /* fresh start */ }
}

function persist() {
  if (!dataFile) return;
  const data = [...queue.values()];
  fs.writeFile(dataFile, JSON.stringify(data, null, 2)).catch(() => {});
}

export function create(approval) {
  const item = {
    id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'pending',
    created_at: new Date().toISOString(),
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    ...approval,
  };
  queue.set(item.id, item);
  persist();

  activity.log({
    type: 'approval_created',
    approval_id: item.id,
    summary: item.summary || item.type,
    source_agent: item.source_agent,
    source_workflow: item.source_workflow,
  });

  // Push to ntfy — fire and forget, no await so create() stays synchronous
  pushNtfy(item, queenBaseUrl);

  // Fire notification hooks
  for (const hook of notifyHooks) {
    try { hook('created', item); } catch { /* hooks don't break the system */ }
  }

  return item;
}

export function approve(id) {
  const item = queue.get(id);
  if (!item) return null;
  if (item.status !== 'pending') return item; // already processed

  item.status = 'approved';
  item.approved_at = new Date().toISOString();
  persist();

  activity.log({
    type: 'approval_approved',
    approval_id: id,
    summary: item.summary || item.type,
  });

  // Fire notification hooks
  for (const hook of notifyHooks) {
    try { hook('approved', item); } catch {}
  }

  return item;
}

export function reject(id, reason = null) {
  const item = queue.get(id);
  if (!item) return null;
  if (item.status !== 'pending') return item;

  item.status = 'rejected';
  item.rejected_at = new Date().toISOString();
  item.rejection_reason = reason;
  persist();

  activity.log({
    type: 'approval_rejected',
    approval_id: id,
    summary: item.summary || item.type,
    reason,
  });

  for (const hook of notifyHooks) {
    try { hook('rejected', item); } catch {}
  }

  return item;
}

export function markExecuted(id) {
  const item = queue.get(id);
  if (!item) return null;
  item.executed_at = new Date().toISOString();
  persist();
  return item;
}

export function get(id) {
  return queue.get(id) || null;
}

export function list(status = null) {
  let items = [...queue.values()];
  if (status) items = items.filter(i => i.status === status);
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function pending() {
  return list('pending');
}

// Register a notification hook
// fn(action: 'created'|'approved'|'rejected', item)
export function onNotify(fn) {
  notifyHooks.push(fn);
}
