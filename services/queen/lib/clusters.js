// ============================================================
// Clusters — Inference cluster management for rpc-worker drones
// ============================================================
// A cluster groups rpc-worker drones so they can shard a model
// that's too large for any single machine. This is the registry
// layer — actual llama.cpp coordination comes later.
//
// Extracted from server.js — no side effects on import.
// ============================================================

import { readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

// --- State ---
const clusters = new Map();
let CLUSTERS_FILE = null;
let CLUSTERS_CONFIG_FILE = null;

// --- Init ---

export function initClusters(dataDir, configDir) {
  CLUSTERS_FILE = path.join(dataDir, 'clusters.json');
  CLUSTERS_CONFIG_FILE = path.join(configDir, 'clusters.json');
  loadClusters();
}

// --- Persistence ---

function loadClusters() {
  try {
    const raw = readFileSync(CLUSTERS_FILE, 'utf-8');
    const loaded = JSON.parse(raw);
    for (const [name, cluster] of Object.entries(loaded)) {
      clusters.set(name, cluster);
    }
    if (clusters.size > 0) {
      console.log(`[QUEEN] Restored ${clusters.size} cluster(s) from disk`);
    }
  } catch { /* fresh start — no clusters yet */ }
}

function persistClusters() {
  const obj = Object.fromEntries(clusters);
  fs.writeFile(CLUSTERS_FILE, JSON.stringify(obj, null, 2)).catch(() => {});
}

// Load static formation rules from config/clusters.json.
// Returns the parsed object, or {} if the file doesn't exist yet.
function loadClusterFormationRules() {
  try {
    const raw = readFileSync(CLUSTERS_CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// --- Helpers ---

// Return all online rpc-worker drone IDs with their metadata.
function rpcWorkerDrones(nodes, heartbeatTimeoutMs) {
  const onlineThreshold = Date.now() - heartbeatTimeoutMs;
  return [...nodes.entries()]
    .filter(([, n]) => n.mode === 'rpc-worker' && n.lastHeartbeat?.getTime() > onlineThreshold)
    .map(([id, n]) => ({
      node_id: id,
      rpc_port: n.rpc_port,
      addr: n.addr || n.config?.addr || null,
      hardware: n.config?.hardware || null,
      status: n.status,
    }));
}

// --- Accessors (for dashboard data, etc.) ---

export function getClusters() {
  return clusters;
}

export function getClustersList() {
  return [...clusters.values()].map(c => ({
    name: c.name,
    members: c.members,
    member_count: c.members.length,
    formation_rule: c.formation_rule || null,
    notes: c.notes || null,
    created_at: c.created_at,
  }));
}

// --- Routes ---

export function registerRoutes(app, { nodes, activity, heartbeatTimeoutMs }) {
  // POST /api/clusters/create
  app.post('/api/clusters/create', (req, res) => {
    const { name, members, formation_rule, notes } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: 'members array is required and must be non-empty' });
    }

    const clusterName = name.trim();

    // Validate all members exist and are rpc-worker drones
    const invalid = [];
    for (const nodeId of members) {
      const n = nodes.get(nodeId);
      if (!n) { invalid.push(`${nodeId}: not registered`); continue; }
      if (n.mode !== 'rpc-worker') { invalid.push(`${nodeId}: mode is '${n.mode || 'task'}', not 'rpc-worker'`); }
    }
    if (invalid.length > 0) {
      return res.status(400).json({ error: 'Invalid cluster members', details: invalid });
    }

    const cluster = {
      name: clusterName,
      members,
      formation_rule: formation_rule || null,
      notes: notes || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    clusters.set(clusterName, cluster);
    persistClusters();

    activity.log({ type: 'cluster_created', cluster: clusterName, members, formation_rule: formation_rule || null });
    console.log(`[QUEEN] Inference cluster '${clusterName}' created with ${members.length} rpc-worker(s): ${members.join(', ')}`);

    res.status(201).json(cluster);
  });

  // GET /api/clusters
  app.get('/api/clusters', (_req, res) => {
    const formationRules = loadClusterFormationRules();
    const onlineThreshold = Date.now() - heartbeatTimeoutMs;

    const list = [...clusters.entries()].map(([name, cluster]) => {
      // Annotate each member with current live status
      const memberDetails = cluster.members.map(nodeId => {
        const n = nodes.get(nodeId);
        if (!n) return { node_id: nodeId, status: 'unknown', rpc_port: null, addr: null };
        const isOnline = n.lastHeartbeat && n.lastHeartbeat.getTime() > onlineThreshold;
        return {
          node_id: nodeId,
          status: isOnline ? n.status : 'offline',
          rpc_port: n.rpc_port,
          addr: n.addr || n.config?.addr || null,
          hardware: n.config?.hardware || null,
        };
      });

      const onlineCount = memberDetails.filter(m => m.status === 'online').length;

      return {
        ...cluster,
        member_details: memberDetails,
        online_count: onlineCount,
        total_count: cluster.members.length,
        ready: onlineCount === cluster.members.length,
      };
    });

    // Also report which rpc-worker drones are online but not yet in any cluster
    const clustered = new Set([...clusters.values()].flatMap(c => c.members));
    const unclustered = rpcWorkerDrones(nodes, heartbeatTimeoutMs).filter(d => !clustered.has(d.node_id));

    // Surface any applicable formation rules from config
    const applicableRules = (formationRules.rules || []).filter(rule => {
      if (!rule.min_members) return true;
      return unclustered.length >= rule.min_members;
    });

    res.json({
      clusters: list,
      unclustered_rpc_workers: unclustered,
      formation_rules: applicableRules,
    });
  });

  // DELETE /api/clusters/:name
  app.delete('/api/clusters/:name', (req, res) => {
    const name = req.params.name;
    if (!clusters.has(name)) {
      return res.status(404).json({ error: `Cluster '${name}' not found` });
    }
    clusters.delete(name);
    persistClusters();
    activity.log({ type: 'cluster_deleted', cluster: name });
    res.json({ ok: true, deleted: name });
  });
}
