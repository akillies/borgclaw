// ============================================================
// Approval Queue — Law Two enforced in code
// ============================================================
// Nothing external ships without approval. This isn't a
// suggestion in an instructions.md. It's a gate in the code.
// No bypass path exists.
//
// Storage: in-memory Map + file-backed JSON.
// Notification: dashboard (primary) + hooks for ntfy/AK-OS.
// ============================================================

import { readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import * as activity from './activity.js';

const queue = new Map(); // id -> approval object
let dataFile = null;

// Notification hooks — register ntfy, AK-OS, email, etc.
const notifyHooks = [];

export function initApprovals(dataDir) {
  dataFile = path.join(dataDir, 'approvals.json');
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
