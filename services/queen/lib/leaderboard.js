// ============================================================
// Leaderboard Scanner — Ollama library discovery + upgrade triage
// ============================================================
// Compares what's in config/models.json against what Ollama's
// public library exposes. Flags candidates that:
//   - Fit within a tier's RAM limits
//   - Are not already deployed anywhere in the hive
//   - Represent a plausible upgrade or new capability
//
// Used by: autoresearch workflow (scan_models step)
//          GET /api/models/available route
//          GET /api/models/search route
//
// This runs on a cron. It NEVER throws. Network failures →
// warn + return empty array. The Queen keeps running.
// ============================================================

import fs from 'fs/promises';
import path from 'path';

const OLLAMA_LIBRARY_URL = 'https://ollama.com/library';
const OLLAMA_SEARCH_URL  = 'https://ollama.com/search';
const FETCH_TIMEOUT_MS   = 12_000;

// Tier RAM ceilings (GB). Models exceeding these are skipped.
// Matches drone_tiers in config/models.json.
const TIER_RAM_CEILINGS = {
  nano:   4,
  edge:   8,
  worker: 24,
  heavy:  64,
  beast:  Infinity,
};

// Known approximate VRAM/RAM usage by param count at Q4_K_M.
// Used to estimate fit when a model's size isn't in the API response.
const PARAM_TO_GB = {
  '1b':  1.5,
  '1.7b': 2.0,
  '3b':  2.5,
  '3.8b': 3.5,
  '4b':  3.0,
  '7b':  4.5,
  '8b':  5.5,
  '9b':  6.0,
  '12b': 8.0,
  '14b': 9.5,
  '27b': 18.0,
  '32b': 21.0,
  '70b': 48.0,
};

// ============================================================
// Internal helpers
// ============================================================

/**
 * Fetch with a hard timeout. Returns null on any failure.
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<Response|null>}
 */
async function fetchSafe(url, timeoutMs = FETCH_TIMEOUT_MS) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res;
  } catch (err) {
    console.warn(`[LEADERBOARD] fetch failed (${url}): ${err.message}`);
    return null;
  }
}

/**
 * Extract the approximate size in GB from an Ollama model entry.
 * Tries the size field first, then falls back to param-count heuristics.
 *
 * @param {object} model  - Entry from Ollama library JSON
 * @returns {number}      - Estimated size in GB, or 999 if unknown
 */
function estimateSizeGb(model) {
  // Ollama search API includes size in bytes
  if (typeof model.size === 'number' && model.size > 0) {
    return model.size / 1_073_741_824; // bytes → GB
  }

  // Fall back to name-based param count lookup
  const nameLower = (model.name || '').toLowerCase();
  for (const [key, gb] of Object.entries(PARAM_TO_GB)) {
    if (nameLower.includes(key)) return gb;
  }

  return 999; // unknown — conservative: assume it won't fit
}

/**
 * Collect all model names already deployed across tiers.
 * Normalises names to bare model strings (no :latest suffix).
 *
 * @param {object} modelsConfig - Parsed models.json
 * @returns {Set<string>}
 */
function buildCurrentModelSet(modelsConfig) {
  const current = new Set();

  const addName = (name) => {
    if (typeof name !== 'string') return;
    current.add(name.toLowerCase().replace(/:latest$/, ''));
  };

  // profiles section
  for (const profile of Object.values(modelsConfig.profiles || {})) {
    for (const entry of Object.values(profile.models || {})) {
      if (entry.name) addName(entry.name);
    }
    // cloud providers
    for (const provider of Object.values(profile.providers || {})) {
      if (provider.model) addName(provider.model);
    }
  }

  // drone_tiers section
  for (const tier of Object.values(modelsConfig.drone_tiers || {})) {
    for (const name of tier.recommended || []) addName(name);
  }

  return current;
}

/**
 * Determine which tiers a model fits in, given its size.
 * Returns the smallest fitting tier (most constrained useful context).
 *
 * @param {number} sizeGb
 * @returns {string|null}  - tier name or null if fits nowhere
 */
function fittingTier(sizeGb) {
  for (const [tier, ceiling] of Object.entries(TIER_RAM_CEILINGS)) {
    if (sizeGb <= ceiling * 0.85) return tier; // 15% headroom for context
  }
  return null;
}

// ============================================================
// Public exports
// ============================================================

/**
 * Fetch and parse the Ollama model library.
 * Uses the JSON search endpoint with an empty query to get trending/all models.
 *
 * @returns {Promise<Array<object>>} - Raw model objects from Ollama, or []
 */
async function fetchOllamaLibrary() {
  // The Ollama search endpoint returns JSON when queried with ?q=
  const url = `${OLLAMA_SEARCH_URL}?q=&sort=newest&limit=50`;
  const res = await fetchSafe(url);

  if (!res) return [];

  // The endpoint returns JSON with a models array
  if (!res.ok) {
    console.warn(`[LEADERBOARD] Ollama search returned ${res.status}`);
    return [];
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.warn(`[LEADERBOARD] Failed to parse Ollama response: ${err.message}`);
    return [];
  }

  // Ollama search API returns { models: [...] }
  return Array.isArray(data?.models) ? data.models : [];
}

/**
 * Search the Ollama model library for a specific query.
 * Used by autoresearch or direct calls to find models by capability.
 *
 * @param {string} query  - Search term (e.g. "vision", "code", "7b")
 * @returns {Promise<Array<{name: string, description: string, pulls: number, tags: string[]}>>}
 */
export async function checkOllamaLibrary(query) {
  if (!query || typeof query !== 'string') {
    console.warn('[LEADERBOARD] checkOllamaLibrary: query must be a non-empty string');
    return [];
  }

  const encoded = encodeURIComponent(query.trim());
  const url = `${OLLAMA_SEARCH_URL}?q=${encoded}&limit=20`;
  const res = await fetchSafe(url);

  if (!res || !res.ok) return [];

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.warn(`[LEADERBOARD] checkOllamaLibrary parse error: ${err.message}`);
    return [];
  }

  const models = Array.isArray(data?.models) ? data.models : [];

  return models.map(m => ({
    name:        m.name || m.model || 'unknown',
    description: m.description || '',
    pulls:       m.pulls || 0,
    tags:        m.tags || [],
    size_gb:     estimateSizeGb(m),
  }));
}

/**
 * Scan for upgrade candidates.
 *
 * Fetches the Ollama library, filters by tier RAM limits, and compares
 * against what's already in models.json. Returns only models that are
 * not currently deployed anywhere in the hive.
 *
 * @param {object} currentModels  - Parsed content of config/models.json
 * @param {string[]} [tiers]      - Tier names to evaluate. Defaults to all tiers.
 * @returns {Promise<Array<{
 *   name: string,
 *   size_gb: number,
 *   tier: string,
 *   reason: string,
 *   replaces: string|null,
 *   pulls: number,
 *   description: string,
 * }>>}
 */
export async function scanLeaderboard(currentModels, tiers) {
  const targetTiers = Array.isArray(tiers) && tiers.length > 0
    ? tiers
    : Object.keys(TIER_RAM_CEILINGS);

  let library;
  try {
    library = await fetchOllamaLibrary();
  } catch (err) {
    // Belt-and-suspenders: fetchOllamaLibrary never throws, but guard anyway
    console.warn(`[LEADERBOARD] scanLeaderboard: unexpected error: ${err.message}`);
    return [];
  }

  if (library.length === 0) {
    console.warn('[LEADERBOARD] Library returned 0 models — network issue or API change');
    return [];
  }

  const currentSet = buildCurrentModelSet(currentModels || {});
  const candidates = [];

  for (const model of library) {
    const name = (model.name || model.model || '').toLowerCase().replace(/:latest$/, '');
    if (!name) continue;

    // Skip anything already in the hive
    if (currentSet.has(name)) continue;

    const sizeGb = estimateSizeGb(model);

    // Check which tiers can accommodate this model
    for (const tier of targetTiers) {
      const ceiling = TIER_RAM_CEILINGS[tier];
      if (!ceiling) continue;

      if (sizeGb > ceiling * 0.85) continue; // doesn't fit with headroom

      const fittedTier = fittingTier(sizeGb);
      if (!fittedTier) continue;

      // Find what this might replace in the target tier
      const tierConfig = currentModels?.drone_tiers?.[tier];
      const currentInTier = tierConfig?.recommended || [];
      const replaces = currentInTier.length > 0 ? currentInTier[0] : null;

      // Build the reason string
      const pullsStr = model.pulls ? ` (${(model.pulls / 1000).toFixed(0)}K pulls)` : '';
      const reason = `New on Ollama library${pullsStr}. Fits ${tier} tier (${sizeGb.toFixed(1)}GB < ${(ceiling * 0.85).toFixed(0)}GB limit). Not currently deployed.`;

      candidates.push({
        name:        model.name || name,
        size_gb:     Math.round(sizeGb * 10) / 10,
        tier:        fittedTier,
        reason,
        replaces,
        pulls:       model.pulls || 0,
        description: model.description || '',
      });

      break; // Only list a model once (smallest fitting tier)
    }
  }

  // Sort by pull count descending — community adoption as a quality signal
  candidates.sort((a, b) => b.pulls - a.pulls);

  console.log(`[LEADERBOARD] Scan complete: ${library.length} library models → ${candidates.length} candidates`);
  return candidates;
}

// --- Routes ---

export function registerRoutes(app, { activity, configDir }) {
  // GET /api/models/available — scan for upgrade candidates from the Ollama library
  //   Optional ?tiers= query param limits which tiers to evaluate.
  app.get('/api/models/available', async (req, res) => {
    let currentModels = {};
    try {
      const raw = await fs.readFile(path.join(configDir, 'models.json'), 'utf-8');
      currentModels = JSON.parse(raw);
    } catch (err) {
      console.warn(`[QUEEN] /api/models/available: could not read models.json: ${err.message}`);
      // Proceed with empty config — leaderboard will still run, just can't de-dupe
    }

    const tiersParam = req.query.tiers;
    const tiers = tiersParam
      ? tiersParam.split(',').map(t => t.trim()).filter(Boolean)
      : null;

    activity.log({ type: 'leaderboard_scan_started', tiers: tiers || 'all' });

    const candidates = await scanLeaderboard(currentModels, tiers);

    activity.log({ type: 'leaderboard_scan_complete', candidates_found: candidates.length });

    res.json({
      scanned_at: new Date().toISOString(),
      tiers_evaluated: tiers || Object.keys(currentModels.drone_tiers || {}),
      candidates_found: candidates.length,
      candidates,
    });
  });

  // GET /api/models/search — search the Ollama library by keyword
  app.get('/api/models/search', async (req, res) => {
    const q = req.query.q || '';
    if (!q.trim()) {
      return res.status(400).json({ error: 'q parameter required (e.g. ?q=vision)' });
    }

    const results = await checkOllamaLibrary(q);
    res.json({ query: q, results });
  });
}
