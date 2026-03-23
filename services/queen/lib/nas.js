// ============================================================
// NAS Shared Knowledge Store — network-attached storage routes
// ============================================================
// The NAS is just a directory on the filesystem — NFS/SMB/CIFS
// mounted at NAS_MOUNT_PATH. All machines on the LAN mount the
// SAME path and share one knowledge layer automatically.
//
// Routes:
//   GET /api/nas/status — mount status check
//   GET /api/nas/browse — directory listing within the NAS root
//
// Extracted from server.js — no side effects on import.
// ============================================================

import fs from 'fs/promises';
import path from 'path';

// --- Routes ---

export function registerRoutes(app, { nasMountPath }) {
  // GET /api/nas/status
  //   Returns whether the NAS mount is configured and accessible.
  //   Uses stat() so it works even on empty mounts. Never throws.
  app.get('/api/nas/status', async (_req, res) => {
    if (!nasMountPath) {
      return res.json({
        configured: false,
        accessible: false,
        path: null,
        message: 'NAS_MOUNT_PATH not set',
      });
    }

    try {
      const stat = await fs.stat(nasMountPath);
      res.json({
        configured: true,
        accessible: stat.isDirectory(),
        path: nasMountPath,
        message: stat.isDirectory() ? 'mounted' : 'path exists but is not a directory',
      });
    } catch (err) {
      // Mount dropped, share offline, path doesn't exist — all graceful.
      res.json({
        configured: true,
        accessible: false,
        path: nasMountPath,
        message: err.code === 'ENOENT' ? 'not mounted' : `inaccessible: ${err.code}`,
      });
    }
  });

  // GET /api/nas/browse
  //   Lists files within the NAS directory (sandbox enforced).
  //   Optional ?path= is relative to NAS_MOUNT_PATH.
  //   Returns a file listing suitable for the dashboard.
  app.get('/api/nas/browse', async (req, res) => {
    if (!nasMountPath) {
      return res.status(404).json({ ok: false, error: 'NAS_MOUNT_PATH not configured' });
    }

    // Resolve the requested sub-path within the NAS root.
    // path.join normalises traversal — path.resolve then sandbox-checks.
    const subPath = req.query.path ? String(req.query.path) : '';
    const targetPath = path.join(nasMountPath, subPath);

    // Sandbox: the resolved path must still be inside NAS_MOUNT_PATH.
    const resolvedNasRoot = path.resolve(nasMountPath);
    const resolvedTarget = path.resolve(targetPath);
    const prefix = resolvedNasRoot.endsWith(path.sep) ? resolvedNasRoot : resolvedNasRoot + path.sep;
    if (resolvedTarget !== resolvedNasRoot && !resolvedTarget.startsWith(prefix)) {
      return res.status(403).json({ ok: false, error: 'Path outside NAS root' });
    }

    try {
      const entries = await fs.readdir(resolvedTarget, { withFileTypes: true });
      const files = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        path: path.join(subPath || '', e.name),
      }));
      res.json({ ok: true, root: nasMountPath, path: subPath || '/', entries: files });
    } catch (err) {
      // Mount dropped mid-request — return a clean error, don't crash.
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'EIO') {
        return res.status(503).json({ ok: false, error: `NAS not accessible: ${err.code}`, path: subPath || '/' });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
