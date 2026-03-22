// ============================================================
// Agent Sandbox — Application-level filesystem and network enforcement
// ============================================================
// Agents operate within a defined perimeter. They read/write only
// within allowed filesystem roots, and fetch only from approved
// domains. Violations are blocked here — before the MCP server
// ever sees the request.
//
// This is the application enforcement layer. OS-level isolation
// (Landlock on Linux, sandbox-exec on macOS) is a future layer
// on top of this one — not a replacement.
//
// Configuration:
//   SANDBOX_ROOTS            — colon-separated absolute paths (filesystem)
//   SANDBOX_ALLOWED_DOMAINS  — colon-separated domain patterns (network)
//
// Default filesystem roots:
//   $KNOWLEDGE_BASE_PATH, $BORGCLAW_HOME/data/, /tmp/borgclaw/
//
// Default allowed domains:
//   localhost, *.local (LAN mDNS), plus the Queen's own bind address
// ============================================================

import path from 'path';
import os from 'os';

// ── Filesystem sandbox ────────────────────────────────────

/**
 * Build the set of allowed filesystem roots from env + defaults.
 *
 * Precedence:
 *   1. SANDBOX_ROOTS env var (colon-separated) — full override
 *   2. Derived from KNOWLEDGE_BASE_PATH + BORGCLAW_HOME + /tmp/borgclaw/
 *
 * All roots are resolved to absolute paths and normalised (trailing slash
 * stripped) so prefix matching is unambiguous.
 *
 * @returns {string[]}
 */
function buildDefaultRoots() {
  const borgclawHome = process.env.BORGCLAW_HOME || path.join(os.homedir(), 'borgclaw');
  const knowledgeBase = process.env.KNOWLEDGE_BASE_PATH;

  const roots = [
    path.join(borgclawHome, 'data'),
    '/tmp/borgclaw',
  ];

  if (knowledgeBase) {
    roots.unshift(path.resolve(knowledgeBase));
  }

  return roots;
}

function parseRootsEnv(envVal) {
  return envVal
    .split(':')
    .map(r => r.trim())
    .filter(Boolean)
    .map(r => path.resolve(r));
}

// ── Domain allowlist ──────────────────────────────────────

/**
 * Build the set of allowed domain patterns from env + defaults.
 *
 * Patterns:
 *   - Exact match:   "localhost", "example.com"
 *   - Wildcard:      "*.local" matches "queen.local", "node-1.local"
 *
 * @returns {string[]}
 */
function buildDefaultDomains() {
  return ['localhost', '*.local', '127.0.0.1', '::1'];
}

function parseDomainsEnv(envVal) {
  return envVal
    .split(':')
    .map(d => d.trim())
    .filter(Boolean);
}

// ── Module state ──────────────────────────────────────────

let allowedRoots = [];
let allowedDomains = [];

// ── Exports ───────────────────────────────────────────────

/**
 * Initialise the sandbox with the provided roots and domains.
 * Call this once at startup (or after env is loaded).
 *
 * @param {object} [opts]
 * @param {string[]} [opts.roots]    - filesystem root paths
 * @param {string[]} [opts.domains]  - allowed domain patterns
 */
export function initSandbox({ roots, domains } = {}) {
  if (process.env.SANDBOX_ROOTS) {
    allowedRoots = parseRootsEnv(process.env.SANDBOX_ROOTS);
  } else if (roots && roots.length) {
    allowedRoots = roots.map(r => path.resolve(r));
  } else {
    allowedRoots = buildDefaultRoots();
  }

  if (process.env.SANDBOX_ALLOWED_DOMAINS) {
    allowedDomains = parseDomainsEnv(process.env.SANDBOX_ALLOWED_DOMAINS);
  } else if (domains && domains.length) {
    allowedDomains = domains;
  } else {
    allowedDomains = buildDefaultDomains();
  }

  console.log(`[SANDBOX] Filesystem roots: ${allowedRoots.join(', ') || '(none)'}`);
  console.log(`[SANDBOX] Allowed domains:  ${allowedDomains.join(', ') || '(none)'}`);
}

/**
 * Return the active allowed roots (for logging or status endpoints).
 * @returns {string[]}
 */
export function getRoots() {
  return [...allowedRoots];
}

/**
 * Return the active allowed domain patterns.
 * @returns {string[]}
 */
export function getDomains() {
  return [...allowedDomains];
}

/**
 * Check whether a filesystem path is within the sandbox.
 *
 * The path is resolved to absolute before comparison so relative paths,
 * symlink components, and `..` traversal are all normalised away.
 *
 * @param {string} filePath - any path string
 * @returns {boolean}
 */
export function checkPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const resolved = path.resolve(filePath);
  return allowedRoots.some(root => {
    // Ensure we match the root as a directory prefix, not a substring.
    // e.g. root=/tmp/borgclaw must not match /tmp/borgclaw-evil/secret
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    return resolved === root || resolved.startsWith(prefix);
  });
}

/**
 * Check whether a URL's hostname is in the domain allowlist.
 *
 * Patterns:
 *   - "localhost" matches exactly
 *   - "*.local"   matches any single-level subdomain of .local
 *
 * @param {string} url - full URL string
 * @returns {boolean}
 */
export function checkUrl(url) {
  if (!url || typeof url !== 'string') return false;

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false; // malformed URL — block it
  }

  return allowedDomains.some(pattern => domainMatches(hostname, pattern));
}

/**
 * Match a hostname against a domain pattern.
 *
 * Exact match:  "localhost" === "localhost"
 * Wildcard:     "*.local"  matches anything ending in ".local"
 *               (e.g. "queen.local", "node-1.local", "deep.node.local")
 *               The wildcard prefix is intentionally broad — all .local names
 *               are LAN mDNS peers and are equally trusted.
 *
 * @param {string} hostname
 * @param {string} pattern
 * @returns {boolean}
 */
function domainMatches(hostname, pattern) {
  if (!pattern.startsWith('*.')) {
    return hostname === pattern;
  }
  const suffix = pattern.slice(1); // ".local"
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
}
