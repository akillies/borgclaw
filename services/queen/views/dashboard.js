// ============================================================
// BorgClaw Queen Dashboard — HTML Renderer
// ============================================================
// Single-file HTML template rendered server-side.
// Called as: renderDashboard({ nodes, services, approvals,
//   activity, uptime, version, nodesOnline, nodesTotal,
//   pendingApprovals })
//
// Aesthetic: Giger/Borg/arcticpunk BBS terminal from 1985
// imagined by a 1980s anime director with a grudge against
// rounded corners.
// ============================================================

export default function renderDashboard(data) {
  const {
    nodes = [],
    services = {},
    approvals = [],
    activity = [],
    uptime = '0s',
    version = '0.1.0',
    nodesOnline = 0,
    nodesTotal = 0,
    pendingApprovals = 0,
    workflows: wfList = [],
    runs = [],
    workflowsLoaded = 0,
    runningWorkflows: runningCount = 0,
    // hiveSecretPrefix: first 8 chars only — used for display in Queen status panel.
    // The full secret is NEVER sent to the browser. Client JS reads it from the
    // session cookie set by POST /auth/login via a helper below.
    hiveSecretPrefix = '',
    clusters: clusterList = [],
    sandboxRoots = [],
    sandboxDomains = [],
  } = data;
  const port = data.port || process.env.QUEEN_PORT || '9090';
  const queenHost = data.queenHost || 'localhost';

  // ── Node rows ──────────────────────────────────────────────
  function statusDot(status) {
    if (status === 'online')   return '<span class="dot-green">●</span>';
    if (status === 'offline')  return '<span class="dot-red">○</span>';
    return '<span class="dot-amber">◐</span>';
  }

  const nodeRows = nodes.length === 0
    ? `<tr><td colspan="9" class="empty-row">── NO NODES REGISTERED ── run bootstrap.sh on a machine to join the hive</td></tr>`
    : nodes.map(n => {
      const domainTags = Array.isArray(n.knowledge_domains) && n.knowledge_domains.length > 0
        ? n.knowledge_domains.map(d => `<span class="cap-tag" style="border-color:rgba(0,255,136,0.25);color:var(--green)">${escHtml(d)}</span>`).join(' ')
        : '<span class="dim">—</span>';
      return `<tr class="data-row">
        <td>${statusDot(n.status)} <span class="node-id">${escHtml(n.node_id || 'unknown')}</span>${n.hostname ? `<br><span class="dim" style="font-size:9px">${escHtml(n.hostname)}</span>` : ''}</td>
        <td>${escHtml(n.role || '—')}</td>
        <td class="dim">${escHtml(n.profile || '—')}</td>
        <td>${statusDot(n.status)} ${escHtml(n.status)}</td>
        <td class="dim" style="font-size:10px">${n.ip ? escHtml(n.ip) : '—'}${n.connection_speed ? `<br><span style="color:var(--cyan);font-size:9px">${escHtml(n.connection_speed)}</span>` : ''}</td>
        <td class="dim">${escHtml(n.age || n.last_heartbeat || 'never')}</td>
        <td class="caps">${Array.isArray(n.capabilities) ? n.capabilities.map(c => `<span class="cap-tag">${escHtml(c)}</span>`).join(' ') : '—'}</td>
        <td class="caps">${domainTags}</td>
      </tr>`;
    }).join('');

  // ── Service tiles ──────────────────────────────────────────
  const SERVICE_DEFS = [
    { key: 'queen',   label: 'QUEEN',   icon: '♛' },
    { key: 'ollama',  label: 'OLLAMA',  icon: '◈' },
    { key: 'nats',    label: 'NATS',    icon: '⟁' },
    { key: 'litellm', label: 'LITELLM', icon: '◭' },
    { key: 'ntfy',    label: 'NTFY',    icon: '▲' },
    { key: 'qmd',     label: 'QMD',     icon: '◇' },
    { key: 'docker',  label: 'DOCKER',  icon: '⬡' },
    { key: 'git',     label: 'GIT',     icon: '⬢' },
  ];

  function svcStatus(svc) {
    if (!svc) return 'offline';
    if (svc.status === 'online') return 'online';
    if (svc.status === 'degraded') return 'degraded';
    if (svc.installed === true) return 'online';
    if (svc.installed === false) return 'offline';
    return 'offline';
  }

  function svcSubtext(key, svc) {
    if (!svc) return 'NO SIGNAL';
    if (key === 'ollama' && svc.models && svc.models.length > 0) {
      return svc.models.slice(0, 2).join(' / ') + (svc.models.length > 2 ? ` +${svc.models.length - 2}` : '');
    }
    if (svc.version) return svc.version.slice(0, 20);
    if (svc.uptime_seconds != null) return `UP ${formatSeconds(svc.uptime_seconds)}`;
    if (svc.status === 'online') return 'NOMINAL';
    if (svc.installed === true) return 'INSTALLED';
    return 'NO SIGNAL';
  }

  const serviceTiles = SERVICE_DEFS.map(({ key, label, icon }) => {
    const svc = services[key];
    const st = svcStatus(svc);
    const dot = st === 'online' ? '●' : st === 'degraded' ? '◐' : '○';
    const cls = st === 'online' ? 'svc-online' : st === 'degraded' ? 'svc-degraded' : 'svc-offline';
    const sub = svcSubtext(key, svc);
    return `<div class="svc-tile ${cls}">
      <div class="svc-header"><span class="svc-icon">${icon}</span> ${label}</div>
      <div class="svc-dot">${dot}</div>
      <div class="svc-sub">${escHtml(sub)}</div>
    </div>`;
  }).join('');

  // ── Approval rows ─────────────────────────────────────────
  const pendingApprovalList = approvals.filter(a => a.status === 'pending');
  const approvalRows = pendingApprovalList.length === 0
    ? `<tr><td colspan="4" class="empty-row">── QUEUE CLEAR ── no pending approvals</td></tr>`
    : pendingApprovalList.map((a, i) => `<tr class="data-row appr-row" id="appr-${escHtml(a.id)}">
        <td class="appr-num">${String(i + 1).padStart(2, '0')}</td>
        <td class="appr-summary">${escHtml(a.summary || a.type || 'unknown')}<br><span class="dim appr-meta">TYPE:${escHtml(a.type || '?')} · SRC:${escHtml(a.source_agent || '?')} · ${escHtml(a.created_at ? new Date(a.created_at).toISOString().slice(11, 19) : '??:??:??')}</span></td>
        <td class="appr-type">${escHtml(a.type || '—')}</td>
        <td class="appr-actions">
          <button class="btn btn-approve" onclick="doApprove('${escHtml(a.id)}')">✓ APPROVE</button>
          <button class="btn btn-reject"  onclick="doReject('${escHtml(a.id)}')">✗ REJECT</button>
          <button class="btn btn-view"    onclick="doView('${escHtml(a.id)}')">⊞ VIEW</button>
        </td>
      </tr>`).join('');

  // ── Activity feed ─────────────────────────────────────────
  function fmtActivityTime(ts) {
    try { return new Date(ts).toISOString().slice(11, 19); }
    catch { return '??:??:??'; }
  }

  function fmtActivityLine(evt) {
    const t = fmtActivityTime(evt.ts);
    const type = (evt.type || 'event').toUpperCase().padEnd(22, ' ');
    const desc = evt.summary || evt.message || evt.description
      || (evt.approval_id ? `[${evt.approval_id}]` : '')
      || JSON.stringify(evt).slice(0, 80);
    return `<div class="act-line"><span class="act-time">${t}</span> <span class="act-sep">░</span> <span class="act-type">${escHtml(type)}</span><span class="act-sep">──</span> <span class="act-desc">${escHtml(desc)}</span></div>`;
  }

  const activityLines = activity.length === 0
    ? `<div class="act-line empty-row">── AWAITING FIRST EVENT ──</div>`
    : activity.slice(0, 60).map(fmtActivityLine).join('');

  // ── Helpers ───────────────────────────────────────────────
  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatSeconds(s) {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  // ── Sparkline (server-side initial render) ────────────
  function sparkline(values, width) {
    if (!values || values.length < 2) return '────────────────────';
    const blocks = '▁▂▃▄▅▆▇█';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = Math.max(1, Math.floor(values.length / width));
    let result = '';
    for (let i = 0; i < values.length && result.length < width; i += step) {
      const idx = Math.round(((values[i] - min) / range) * (blocks.length - 1));
      result += blocks[idx];
    }
    return result;
  }

  // ── Hive Topology (server-side initial render) ─────────
  function renderTopology(nodeList) {
    const workers = nodeList.filter(n => n.role !== 'queen');
    if (workers.length === 0) {
      return `<div class="topology-pre"><span class="topo-queen">♛ QUEEN</span>  <span class="topo-solo">(solo mode — add nodes with bootstrap.sh)</span></div>`;
    }
    // Build lines
    const queenLabel = '<span class="topo-queen">♛ QUEEN</span>';
    // connector line — one branch per worker
    const connectorParts = workers.map(() => '─────');
    let connLine = '        ';
    const workerCols = workers.map((n, i) => {
      const isOnline = n.status === 'online';
      const sym = isOnline
        ? `<span class="topo-online">◈ ${escHtml(n.node_id)}</span>`
        : `<span class="topo-offline">○ ${escHtml(n.node_id)}(offline)</span>`;
      return sym;
    });
    // Build ASCII tree centered on queen
    const pad = '        ';
    const lines = [];
    lines.push(`${pad}${queenLabel}`);
    if (workers.length === 1) {
      lines.push(`${pad}    │`);
      lines.push(`${pad}    ${workerCols[0]}`);
    } else if (workers.length === 2) {
      lines.push(`${pad}   ╱ ╲`);
      lines.push(`${pad}${workerCols[0]}   ${workerCols[1]}`);
    } else {
      // 3+ workers: split into left / center / right
      const mid = Math.floor(workers.length / 2);
      lines.push(`${pad}  ╱  │  ╲`);
      lines.push(workerCols.map(s => '  ' + s).join('  '));
    }
    return `<div class="topology-pre" id="topo-pre">${lines.join('\n')}</div>`;
  }

  // ── Render ────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30" id="meta-refresh">
<title>BORGCLAW//QUEEN v${escHtml(version)}</title>
<style>
/* ── RESET & BASE ─────────────────────────────────────── */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --green:  #00FF88;
  --cyan:   #00CCFF;
  --red:    #FF4444;
  --amber:  #EAAB00;
  --void:   #0A0A0A;
  --panel:  #111111;
  --border: #2A2A2A;
  --dimmer: #1A1A1A;
  --muted:  #555555;
  --grey:   #888888;
  --white:  #CCCCCC;
  --font:   'JetBrains Mono', 'IBM Plex Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace;
}
html, body {
  background: var(--void);
  color: var(--white);
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.5;
  min-height: 100vh;
  overflow-x: hidden;
}

/* ── TRIANGLE GRID BACKGROUND ─────────────────────────── */
/* SVG data URI — repeating triangle mesh, Giger biomechanical */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.055;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='52'%3E%3Cg stroke='%2300FF88' stroke-width='0.6' fill='none'%3E%3Cpolygon points='30,2 58,50 2,50'/%3E%3Cpolygon points='0,2 28,50 -28,50'/%3E%3Cpolygon points='60,2 88,50 32,50'/%3E%3Cpolygon points='30,52 58,4 2,4'/%3E%3C/g%3E%3C/svg%3E");
  background-repeat: repeat;
}

/* ── SCANLINE OVERLAY ─────────────────────────────────── */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.04) 2px,
    rgba(0, 0, 0, 0.04) 4px
  );
}

/* ── LAYOUT ───────────────────────────────────────────── */
.page-wrap {
  position: relative;
  z-index: 1;
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1rem 2rem;
}

/* ── BOX DRAWING CHROME ───────────────────────────────── */
.box-top    { color: var(--muted); display: block; letter-spacing: 0; white-space: pre; overflow: hidden; line-height: 1.2; font-size: 12px; }
.box-bottom { color: var(--muted); display: block; letter-spacing: 0; white-space: pre; overflow: hidden; line-height: 1.2; font-size: 12px; }
.box-mid    { color: var(--muted); display: block; letter-spacing: 0; white-space: pre; overflow: hidden; line-height: 1.2; font-size: 12px; }

/* ── HEADER ───────────────────────────────────────────── */
.hdr-wrap {
  border-left: 2px solid var(--green);
  border-right: 2px solid var(--green);
  margin-top: 1.5rem;
}
.hdr-inner {
  display: flex;
  align-items: flex-start;
  gap: 1.5rem;
  padding: 1rem 1.5rem 0.75rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.hdr-logo {
  color: var(--green);
  font-size: 11px;
  line-height: 1.3;
  white-space: pre;
  opacity: 0.9;
  flex-shrink: 0;
}
.hdr-text { flex: 1; }
.hdr-title {
  color: var(--green);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
}
.hdr-sub {
  color: var(--cyan);
  font-size: 11px;
  letter-spacing: 2px;
  margin-top: 2px;
}
.hdr-tagline {
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 1px;
  margin-top: 4px;
}
.hdr-stats {
  background: var(--dimmer);
  border-top: 1px solid var(--border);
  padding: 0.5rem 1.5rem;
  display: flex;
  gap: 0;
  align-items: center;
  flex-wrap: wrap;
}
.stat-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 1.2rem;
  font-size: 12px;
  border-right: 1px solid var(--border);
}
.stat-item:first-child { padding-left: 0; }
.stat-item:last-child  { border-right: none; }
.stat-label { color: var(--grey); }
.stat-value { color: var(--green); font-weight: 700; }
.stat-value.warn  { color: var(--amber); }
.stat-value.alert { color: var(--red); }

/* ── SECTION HEADER ───────────────────────────────────── */
.section { margin-top: 1.5rem; }
.section-header {
  background: var(--dimmer);
  border: 1px solid var(--border);
  border-bottom: none;
  padding: 0.35rem 0.8rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.section-title {
  color: var(--cyan);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
}
.section-title::before { content: '╠══ '; color: var(--muted); }
.section-title::after  { content: ' ══╣'; color: var(--muted); }
.section-badge {
  font-size: 10px;
  color: var(--grey);
  letter-spacing: 1px;
}
.section-body {
  border: 1px solid var(--border);
  background: var(--panel);
}

/* ── TABLES ───────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
}
thead tr {
  background: var(--dimmer);
  border-bottom: 1px solid var(--border);
}
th {
  color: var(--grey);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-right: 1px solid var(--border);
  white-space: nowrap;
}
th:last-child { border-right: none; }
td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  vertical-align: top;
  font-size: 12px;
}
td:last-child { border-right: none; }
tr:last-child td { border-bottom: none; }
.data-row:hover td { background: rgba(0, 255, 136, 0.03); }
.empty-row { color: var(--muted); font-size: 11px; letter-spacing: 1px; padding: 1rem 0.75rem; }

/* ── STATUS DOTS ─────────────────────────────────────── */
.dot-green { color: var(--green); }
.dot-red   { color: var(--red); }
.dot-amber { color: var(--amber); }

/* ── NODE TABLE SPECIFICS ────────────────────────────── */
.node-id { color: var(--cyan); font-weight: 700; }
.dim { color: var(--grey); }
.caps { font-size: 11px; }
.cap-tag {
  display: inline-block;
  background: rgba(0, 204, 255, 0.08);
  border: 1px solid rgba(0, 204, 255, 0.25);
  color: var(--cyan);
  padding: 0 4px;
  font-size: 10px;
  margin: 1px;
  letter-spacing: 0.5px;
}

/* ── SERVICES GRID ────────────────────────────────────── */
.svc-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
}
@media (max-width: 900px)  { .svc-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px)  { .svc-grid { grid-template-columns: 1fr; } }
.svc-tile {
  padding: 0.75rem 1rem;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.svc-tile:nth-child(4n)   { border-right: none; }
.svc-tile:nth-last-child(-n+4) { border-bottom: none; }
@media (max-width: 900px) {
  .svc-tile:nth-child(4n)   { border-right: 1px solid var(--border); }
  .svc-tile:nth-child(2n)   { border-right: none; }
  .svc-tile:nth-last-child(-n+4) { border-bottom: 1px solid var(--border); }
  .svc-tile:nth-last-child(-n+2) { border-bottom: none; }
}
.svc-header {
  font-size: 10px;
  letter-spacing: 2px;
  font-weight: 700;
  margin-bottom: 0.4rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.svc-icon { font-size: 12px; }
.svc-dot  { font-size: 18px; line-height: 1; margin-bottom: 0.25rem; }
.svc-sub  { font-size: 10px; color: var(--grey); letter-spacing: 0.5px; word-break: break-all; }
.svc-online   .svc-header { color: var(--green); }
.svc-online   .svc-dot    { color: var(--green); }
.svc-degraded .svc-header { color: var(--amber); }
.svc-degraded .svc-dot    { color: var(--amber); }
.svc-offline  .svc-header { color: var(--muted); }
.svc-offline  .svc-dot    { color: var(--muted); }

/* ── APPROVAL TABLE ────────────────────────────────────── */
.appr-num     { color: var(--muted); font-size: 11px; width: 2.5rem; }
.appr-summary { color: var(--white); }
.appr-meta    { font-size: 10px; letter-spacing: 0.5px; }
.appr-type    { color: var(--cyan); font-size: 11px; letter-spacing: 1px; width: 8rem; }
.appr-actions { width: 18rem; white-space: nowrap; }
.appr-row.resolved td { opacity: 0.4; }

/* ── BUTTONS ─────────────────────────────────────────── */
.btn {
  font-family: var(--font);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  border: 1px solid;
  background: transparent;
  padding: 3px 8px;
  cursor: pointer;
  margin-right: 4px;
  transition: background 0.1s, color 0.1s;
}
.btn-approve { color: var(--green); border-color: var(--green); }
.btn-approve:hover { background: var(--green); color: var(--void); }
.btn-reject  { color: var(--red);   border-color: var(--red); }
.btn-reject:hover  { background: var(--red);   color: var(--void); }
.btn-view    { color: var(--grey);  border-color: var(--muted); }
.btn-view:hover    { background: var(--muted);  color: var(--void); }
.btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── ACTIVITY FEED ────────────────────────────────────── */
.act-feed {
  padding: 0.5rem 0;
  max-height: 380px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.act-feed::-webkit-scrollbar       { width: 4px; }
.act-feed::-webkit-scrollbar-thumb { background: var(--border); }
.act-line {
  padding: 2px 0.75rem;
  font-size: 11px;
  line-height: 1.6;
  border-bottom: 1px solid rgba(42, 42, 42, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.act-line:last-child { border-bottom: none; }
.act-line.act-new { animation: flash-in 0.4s ease-out; }
.act-time { color: var(--cyan); font-size: 10px; flex-shrink: 0; }
.act-sep  { color: var(--muted); margin: 0 0.3rem; }
.act-type { color: var(--amber); font-size: 10px; font-weight: 700; letter-spacing: 0.5px; }
.act-desc { color: var(--grey); }

@keyframes flash-in {
  from { background: rgba(0, 255, 136, 0.12); color: var(--green); }
  to   { background: transparent; }
}

/* ── FOOTER ──────────────────────────────────────────── */
.footer-wrap {
  border-left: 2px solid var(--green);
  border-right: 2px solid var(--green);
  border-bottom: 2px solid var(--green);
}
.footer-inner {
  background: var(--dimmer);
  border-top: 1px solid var(--border);
  padding: 0.4rem 1.5rem;
  display: flex;
  gap: 0;
  align-items: center;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--grey);
  letter-spacing: 0.5px;
}
.footer-item {
  padding: 0 1rem;
  border-right: 1px solid var(--border);
}
.footer-item:first-child { padding-left: 0; }
.footer-item:last-child  { border-right: none; }
.footer-link { color: var(--cyan); text-decoration: none; }
.footer-link:hover { color: var(--green); text-decoration: underline; }
.sse-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  margin-right: 4px;
  vertical-align: middle;
}
.sse-indicator.live { background: var(--green); box-shadow: 0 0 4px var(--green); }

/* ── SSE TOAST ───────────────────────────────────────── */
#sse-toast {
  position: fixed;
  top: 1rem;
  right: 1rem;
  background: var(--panel);
  border: 1px solid var(--green);
  color: var(--green);
  font-size: 10px;
  letter-spacing: 1px;
  padding: 0.4rem 0.75rem;
  z-index: 10000;
  display: none;
}
#sse-toast.show { display: block; }

/* ── MODAL (VIEW approval) ────────────────────────────── */
#modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 10001;
  display: none;
  align-items: center;
  justify-content: center;
}
#modal-overlay.show { display: flex; }
#modal-box {
  background: var(--panel);
  border: 2px solid var(--cyan);
  max-width: 640px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}
#modal-header {
  background: var(--dimmer);
  border-bottom: 1px solid var(--border);
  padding: 0.5rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--cyan);
  letter-spacing: 2px;
}
#modal-close {
  background: none;
  border: none;
  color: var(--red);
  cursor: pointer;
  font-family: var(--font);
  font-size: 14px;
  padding: 0 4px;
}
#modal-body { padding: 1rem; font-size: 12px; white-space: pre-wrap; color: var(--white); }

/* ── CONTRIBUTION DIAL (range slider) ────────────────── */
.dial-cell { white-space: nowrap; min-width: 130px; }
.dial-wrap { display: flex; align-items: center; gap: 6px; }
.dial-pct  { color: var(--green); font-size: 10px; font-weight: 700; min-width: 32px; text-align: right; }
input[type="range"].dial {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 3px;
  background: var(--border);
  outline: none;
  border: none;
  cursor: pointer;
  padding: 0;
  margin: 0;
}
input[type="range"].dial::-webkit-slider-runnable-track {
  height: 3px;
  background: linear-gradient(
    to right,
    var(--green) 0%,
    var(--green) var(--dial-pct, 100%),
    var(--border) var(--dial-pct, 100%),
    var(--border) 100%
  );
  border: none;
}
input[type="range"].dial::-moz-range-track {
  height: 3px;
  background: var(--border);
  border: none;
}
input[type="range"].dial::-moz-range-progress {
  height: 3px;
  background: var(--green);
}
input[type="range"].dial::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 9px;
  height: 9px;
  background: var(--green);
  border: none;
  border-radius: 0;
  cursor: pointer;
  margin-top: -3px;
}
input[type="range"].dial::-moz-range-thumb {
  width: 9px;
  height: 9px;
  background: var(--green);
  border: none;
  border-radius: 0;
  cursor: pointer;
}
input[type="range"].dial:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── SPARKLINE ────────────────────────────────────────── */
.sparkline {
  font-size: 11px;
  letter-spacing: 0;
  color: var(--amber);
  white-space: nowrap;
  font-family: var(--font);
}
.sparkline.empty { color: var(--muted); }

/* ── HIVE TOPOLOGY PANEL ─────────────────────────────── */
.topology-pre {
  font-family: var(--font);
  font-size: 11px;
  line-height: 1.7;
  padding: 1rem 1.5rem;
  color: var(--grey);
  white-space: pre;
  overflow-x: auto;
}
.topo-queen  { color: var(--green); font-weight: 700; }
.topo-online { color: var(--green); }
.topo-offline{ color: var(--red); }
.topo-solo   { color: var(--muted); font-style: italic; }

/* ── MODEL SWAP MODAL ────────────────────────────────── */
.model-swap-list { padding: 0.5rem 0; }
.model-swap-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem 1rem;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  gap: 1rem;
}
.model-swap-item:last-child { border-bottom: none; }
.model-swap-name { color: var(--cyan); flex: 1; }
.model-swap-size { color: var(--muted); min-width: 5rem; text-align: right; }
.model-cell { cursor: pointer; color: var(--cyan); font-size: 10px; }
.model-cell:hover { color: var(--green); text-decoration: underline; }

/* ── SOUND TOGGLE ────────────────────────────────────── */
.snd-btn {
  font-family: var(--font);
  font-size: 11px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--muted);
  padding: 0;
  letter-spacing: 1px;
}
.snd-btn.active { color: var(--green); }

/* ── QUEEN STATUS PANEL ───────────────────────────────── */
.queen-stats {
  padding: 0.75rem 1.5rem;
  display: grid;
  grid-template-columns: repeat(4, auto);
  gap: 0.3rem 2.5rem;
  align-items: center;
  justify-content: start;
  font-size: 12px;
}
.queen-stat-row { display: contents; }
.queen-stat-label { color: var(--grey); letter-spacing: 1px; font-size: 11px; white-space: nowrap; }
.queen-stat-value { color: var(--green); font-weight: 700; white-space: nowrap; }
.queen-stat-value.alert { color: var(--amber); }
.queen-online-line {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 1.2rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.3rem;
  font-size: 12px;
}
.queen-online-dot { color: var(--green); font-size: 14px; }
.queen-online-label { color: var(--green); font-weight: 700; letter-spacing: 2px; }
.queen-online-version { color: var(--grey); letter-spacing: 1px; }
.queen-online-uptime { color: var(--cyan); letter-spacing: 1px; }
.queen-secret { color: var(--muted); font-size: 11px; letter-spacing: 0.5px; font-family: var(--font); }

/* ── MAKE DISK PANEL ─────────────────────────────────── */
.disk-body {
  padding: 0.75rem 1rem;
}
.disk-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}
.disk-label {
  color: var(--grey);
  font-size: 10px;
  letter-spacing: 1px;
  white-space: nowrap;
  min-width: 9rem;
}
.disk-input {
  flex: 1;
  min-width: 200px;
  background: var(--void);
  border: 1px solid var(--border);
  color: var(--green);
  font-family: var(--font);
  font-size: 12px;
  padding: 4px 8px;
  outline: none;
}
.disk-input:focus {
  border-color: var(--green);
}
.disk-progress {
  margin-top: 0.5rem;
  background: var(--void);
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
  font-size: 11px;
  color: var(--grey);
  min-height: 2.5rem;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  display: none;
}
.disk-progress.visible { display: block; }
.disk-progress.ok   { color: var(--green); border-color: var(--green); }
.disk-progress.err  { color: var(--red);   border-color: var(--red); }
</style>
</head>
<body>
<div class="page-wrap">

  <!-- ═══ HEADER ════════════════════════════════════════ -->
  <span class="box-top">╔══════════════════════════════════════════════════════════════════════════════════════════╗</span>
  <div class="hdr-wrap">
    <div class="hdr-inner">
      <pre class="hdr-logo"> ╭━━╮  ╭━━╮
╭╯<span style="color:var(--red)">●</span>  ╰╮╭╯  <span style="color:var(--green)">●</span>╰╮
┃  ╭━━╯╰━━╮  ┃
╰━━╯    ╰━━╯
  ╰════════╯</pre>
      <div class="hdr-text">
        <div class="hdr-title">BORGCLAW // QUEEN</div>
        <div class="hdr-sub">HIVE COORDINATION NODE · v${escHtml(version)}</div>
        <div class="hdr-tagline">Resistance is optional. &nbsp;·&nbsp; Adaptation is inevitable.</div>
      </div>
    </div>
    <div class="hdr-stats">
      <div class="stat-item">
        <span class="stat-label">UPTIME</span>
        <span class="stat-value">${escHtml(uptime)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">NODES</span>
        <span class="stat-value ${nodesOnline < nodesTotal ? 'warn' : ''}">${nodesOnline}/${nodesTotal}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">APPROVALS</span>
        <span class="stat-value ${pendingApprovals > 0 ? 'alert' : ''}">${pendingApprovals}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">COST</span>
        <span class="stat-value" id="cost-value" data-cost="0.00">$0.00</span>
      </div>
      <div class="stat-item" id="sse-stat">
        <span class="sse-indicator" id="sse-dot"></span>
        <span class="stat-label" id="sse-label">STREAM</span>
        <span class="stat-value" id="sse-value" style="color: var(--muted)">CONN…</span>
      </div>
      <div class="stat-item">
        <button class="snd-btn" id="snd-toggle" onclick="toggleSound()" title="Toggle chiptune sounds">♪ MUTE</button>
      </div>
    </div>
  </div>
  <span class="box-bottom">╚══════════════════════════════════════════════════════════════════════════════════════════╝</span>

  <!-- ═══ QUEEN ═════════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">QUEEN</span>
      <span class="section-badge">HIVE COORDINATOR · THIS NODE</span>
    </div>
    <div class="section-body">
      <div class="queen-stats">
        <div class="queen-online-line">
          <span class="queen-online-dot">●</span>
          <span class="queen-online-label">ONLINE</span>
          <span class="queen-online-version">v${escHtml(version)}</span>
          <span class="queen-online-uptime">UP: ${escHtml(uptime)}</span>
          <span class="queen-secret">SECRET: ${escHtml(hiveSecretPrefix || '(not set)')}${hiveSecretPrefix ? '...' : ''}</span>
        </div>
        <span class="queen-stat-label">WORKFLOWS</span>
        <span class="queen-stat-value">${workflowsLoaded} loaded</span>
        <span class="queen-stat-label">RUNNING</span>
        <span class="queen-stat-value ${runningCount > 0 ? 'alert' : ''}">${runningCount} active</span>
        <span class="queen-stat-label">SCHEDULED</span>
        <span class="queen-stat-value">${(data.scheduledTasks || data.scheduled_tasks || []).length || '—'} tasks</span>
        <span class="queen-stat-label">APPROVALS</span>
        <span class="queen-stat-value ${pendingApprovals > 0 ? 'alert' : ''}">${pendingApprovals} pending</span>
      </div>
    </div>
  </div>

  <!-- ═══ NODES ══════════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">NODES</span>
      <span class="section-badge">REGISTERED WORKERS IN THE HIVE</span>
    </div>
    <div class="section-body">
      <table id="nodes-table">
        <thead>
          <tr>
            <th>NODE</th>
            <th>ROLE</th>
            <th>PROFILE</th>
            <th>STATUS</th>
            <th>ADDRESS</th>
            <th>LAST HB</th>
            <th>CAPABILITIES</th>
            <th>KNOWLEDGE</th>
          </tr>
        </thead>
        <tbody id="nodes-tbody">
          ${nodeRows}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ═══ HIVE TOPOLOGY ══════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">TOPOLOGY</span>
      <span class="section-badge">HIVE NETWORK MAP</span>
    </div>
    <div class="section-body" id="topology-panel">
      ${renderTopology(nodes)}
    </div>
  </div>

  <!-- ═══ CLUSTERS ════════════════════════════════════════ -->
  ${clusterList.length === 0 ? '' : `<div class="section" id="clusters-section">
    <div class="section-header">
      <span class="section-title">CLUSTERS</span>
      <span class="section-badge">${clusterList.length} INFERENCE CLUSTER${clusterList.length !== 1 ? 'S' : ''} · RPC-WORKER SHARDS</span>
    </div>
    <div class="section-body">
      <table>
        <thead><tr><th>CLUSTER</th><th>MEMBERS</th><th>RULE</th><th>NOTES</th><th>CREATED</th></tr></thead>
        <tbody>
          ${clusterList.map(c => `<tr class="data-row">
            <td style="color:var(--cyan);font-weight:700">${escHtml(c.name)}</td>
            <td class="caps">${(c.members || []).map(m => `<span class="cap-tag">${escHtml(m)}</span>`).join(' ')}</td>
            <td class="dim">${escHtml(c.formation_rule || '—')}</td>
            <td class="dim">${escHtml(c.notes || '—')}</td>
            <td class="dim" style="font-size:10px">${escHtml(c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`}

  <!-- ═══ SERVICES ═══════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">SERVICES</span>
      <span class="section-badge">SUBSYSTEM HEALTH MATRIX</span>
    </div>
    <div class="section-body">
      <div class="svc-grid" id="svc-grid">
        ${serviceTiles}
      </div>
    </div>
  </div>

  <!-- ═══ METRICS ══════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">TELEMETRY</span>
      <span class="section-badge">NODE PERFORMANCE MATRIX</span>
    </div>
    <div class="section-body">
      <table>
        <thead>
          <tr>
            <th>NODE</th>
            <th>TOK/S</th>
            <th>TREND</th>
            <th>CPU</th>
            <th>RAM</th>
            <th>GPU</th>
            <th>VRAM</th>
            <th>NET ↓/↑</th>
            <th>LATENCY</th>
            <th>TEMP</th>
            <th>MODEL</th>
            <th>DIAL</th>
          </tr>
        </thead>
        <tbody>
          ${nodes.length === 0
            ? '<tr><td colspan="12" class="empty-row">── NO TELEMETRY ── nodes report metrics via heartbeat</td></tr>'
            : nodes.map(n => {
              const m = n.metrics || {};
              const hasTelemetry = m.tokens_per_sec != null || m.cpu_pct != null || m.net_rx_mbps != null;
              if (!hasTelemetry && n.status === 'offline') return '';
              const tokColor = (m.tokens_per_sec || 0) > 20 ? 'var(--green)' : (m.tokens_per_sec || 0) > 5 ? 'var(--amber)' : 'var(--muted)';
              const cpuColor = (m.cpu_pct || 0) > 80 ? 'var(--red)' : (m.cpu_pct || 0) > 50 ? 'var(--amber)' : 'var(--green)';
              const gpuColor = (m.gpu_util_pct || 0) > 80 ? 'var(--red)' : (m.gpu_util_pct || 0) > 50 ? 'var(--amber)' : 'var(--green)';
              const tempColor = (t) => !t ? 'var(--muted)' : t > 85 ? 'var(--red)' : t > 70 ? 'var(--amber)' : 'var(--green)';
              // Sparkline
              const history = m._history || [];
              const histVals = history.map(h => h.tokens_per_sec || 0);
              const sparkStr = sparkline(histVals, 20);
              const sparkClass = histVals.length < 2 ? 'sparkline empty' : 'sparkline';
              // Contribution dial
              const contrib = n.config != null && n.config.contribution != null ? n.config.contribution : 100;
              const nodeIdSafe = escHtml(n.node_id || 'unknown');
              const dialPct = contrib + '%';
              return '<tr class="data-row">'
                + '<td>' + statusDot(n.status) + ' ' + nodeIdSafe + '</td>'
                + '<td style="color:' + tokColor + ';font-weight:bold">' + (m.tokens_per_sec != null ? m.tokens_per_sec.toFixed(1) : '—') + '</td>'
                + '<td><span class="' + sparkClass + '">' + sparkStr + '</span></td>'
                + '<td style="color:' + cpuColor + '">' + (m.cpu_pct != null ? m.cpu_pct + '%' : '—') + '</td>'
                + '<td class="dim">' + (m.ram_used_gb != null ? m.ram_used_gb.toFixed(1) + '/' + (m.ram_total_gb || '?') + 'G' : '—') + '</td>'
                + '<td style="color:' + gpuColor + '">' + (m.gpu_util_pct != null ? m.gpu_util_pct + '%' : '—') + '</td>'
                + '<td class="dim">' + (m.gpu_vram_used_mb != null ? Math.round(m.gpu_vram_used_mb / 1024 * 10) / 10 + '/' + Math.round((m.gpu_vram_total_mb || 0) / 1024 * 10) / 10 + 'G' : '—') + '</td>'
                + '<td class="dim">' + (m.net_rx_mbps != null ? m.net_rx_mbps.toFixed(1) + '/' + (m.net_tx_mbps || 0).toFixed(1) + ' Mb' : '—') + '</td>'
                + '<td class="dim">' + (m.ping_ms != null ? m.ping_ms + 'ms' : m.queen_rtt_ms != null ? m.queen_rtt_ms + 'ms' : '—') + '</td>'
                + '<td><span style="color:' + tempColor(m.cpu_temp_c) + '">' + (m.cpu_temp_c != null ? m.cpu_temp_c + '°' : '—') + '</span>'
                + (m.gpu_temp_c != null ? '/<span style="color:' + tempColor(m.gpu_temp_c) + '">' + m.gpu_temp_c + '°</span>' : '') + '</td>'
                + '<td class="model-cell" data-action="modelswap" data-node="' + nodeIdSafe + '" data-profile="' + escHtml(n.profile || '') + '" title="Click to swap model" style="font-size:10px;cursor:pointer">' + escHtml(m.active_model || '—') + ' <span style="color:var(--muted)">▾</span></td>'
                + '<td class="dial-cell"><div class="dial-wrap">'
                + '<input type="range" class="dial" min="0" max="100" value="' + contrib + '" style="--dial-pct:' + dialPct + '" data-node="' + nodeIdSafe + '" oninput="updateDialPct(this)"  onchange="patchContribution(this)">'
                + '<span class="dial-pct" id="dial-pct-' + nodeIdSafe + '">' + contrib + '%</span>'
                + '</div></td>'
                + '</tr>';
            }).filter(Boolean).join('') || '<tr><td colspan="12" class="empty-row">── AWAITING TELEMETRY ── heartbeat metrics not yet received</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ═══ QUICK ACTIONS ═════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">ACTIONS</span>
      <span class="section-badge">COMMAND CONSOLE</span>
    </div>
    <div class="section-body" style="display:flex;gap:8px;flex-wrap:wrap;padding:0.75rem">
      <button class="btn btn-approve" onclick="refreshHealth()">⟳ REFRESH HEALTH</button>
      <button class="btn btn-view" onclick="refreshApprovals()">⟳ RELOAD APPROVALS</button>
      <button class="btn btn-view" onclick="fetchModels()">◈ LIST MODELS</button>
      <button class="btn btn-view" onclick="scanAvailableModels()">◈ SCAN MODELS</button>
      <button class="btn btn-view" onclick="showSearch()">◇ QMD SEARCH</button>
      ${wfList.map(wf => `<button class="btn btn-approve" onclick="runWorkflow('${escHtml(wf.name)}')" title="${escHtml(wf.description)}">▶ ${escHtml(wf.name.toUpperCase())}</button>`).join(' ')}
    </div>
  </div>

  <!-- ═══ WORKFLOWS ════════════════════════════════════ -->
  <div class="section" id="workflows-section">
    <div class="section-header">
      <span class="section-title">WORKFLOWS</span>
      <span class="section-badge">${workflowsLoaded} LOADED · ${runningCount} RUNNING</span>
    </div>
    <div class="section-body">
      <table>
        <thead><tr><th>WORKFLOW</th><th>STEPS</th><th>TRIGGER</th><th>DESCRIPTION</th><th>ACTION</th></tr></thead>
        <tbody>
          ${wfList.length === 0
            ? `<tr><td colspan="5" class="empty-row">── NO WORKFLOWS LOADED ── add YAML files to config/workflows/</td></tr>`
            : wfList.map(wf => `<tr class="data-row">
                <td style="color:var(--cyan)">${escHtml(wf.name)}</td>
                <td class="dim">${wf.steps}</td>
                <td class="dim">${escHtml(wf.trigger)}</td>
                <td class="dim" style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${escHtml(wf.description)}</td>
                <td><button class="btn btn-approve" onclick="runWorkflow('${escHtml(wf.name)}')">▶ RUN</button></td>
              </tr>`).join('')}
        </tbody>
      </table>
      ${runs.length > 0 ? `
      <div style="margin-top:0.5rem;padding:0.5rem;border-top:1px solid var(--border)">
        <span style="color:var(--amber);font-size:10px;letter-spacing:1px">ACTIVE RUNS</span>
        ${runs.map(r => `<div style="font-size:11px;padding:2px 0;color:var(--grey)">
          <span style="color:${r.status === 'running' ? 'var(--green)' : r.status === 'paused' ? 'var(--amber)' : 'var(--red)'}">●</span>
          ${escHtml(r.name)} — ${escHtml(r.status)} (${escHtml(r.id)})
        </div>`).join('')}
      </div>` : ''}
    </div>
  </div>

  <!-- ═══ APPROVALS ══════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">APPROVALS</span>
      <span class="section-badge">LAW TWO ENFORCEMENT QUEUE · ${pendingApprovals} PENDING</span>
    </div>
    <div class="section-body">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>ITEM</th>
            <th>TYPE</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody id="approvals-tbody">
          ${approvalRows}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ═══ ACTIVITY ════════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">ACTIVITY</span>
      <span class="section-badge">REAL-TIME EVENT STREAM · NEWEST FIRST</span>
    </div>
    <div class="section-body">
      <div class="act-feed" id="act-feed">
        ${activityLines}
      </div>
    </div>
  </div>

  <!-- ═══ QUEEN CHAT ══════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">QUEEN CHAT</span>
      <span class="section-badge">NATURAL LANGUAGE GOVERNANCE · TALK TO THE HIVE</span>
    </div>
    <div class="section-body" style="padding:0">
      <div id="chat-log" style="height:200px;overflow-y:auto;padding:0.5rem;font-size:11px;border-bottom:1px solid var(--border)">
        <div style="color:var(--muted)">── QUEEN READY ── type a command or question below</div>
      </div>
      <div style="display:flex;border-top:1px solid var(--border)">
        <span style="padding:6px 8px;color:var(--green);font-size:12px;background:var(--surface)">▶</span>
        <input id="chat-input" type="text" placeholder="Talk to the Queen..."
          style="flex:1;background:var(--surface);border:none;color:var(--green);font:12px monospace;padding:6px 8px;outline:none"
          onkeydown="if(event.key==='Enter')sendChat()">
        <button onclick="sendChat()" style="background:var(--green);color:var(--void);border:none;padding:6px 12px;font:11px monospace;cursor:pointer">SEND</button>
      </div>
    </div>
  </div>

  <!-- ═══ CONNECT ═══════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">CONNECT</span>
      <span class="section-badge">SNAP YOUR AI INTO THE HIVE</span>
    </div>
    <div class="section-body" style="padding:0.75rem;font-size:11px">
      <div style="margin-bottom:8px;color:var(--muted)">── Point any AI app at these URLs ──</div>
      <table style="width:100%">
        <tr><td style="color:var(--cyan);width:180px">OpenAI-compatible</td><td><code style="color:var(--green)">OPENAI_BASE_URL=http://${queenHost}:4000</code></td></tr>
        <tr><td style="color:var(--cyan)">Anthropic-compatible</td><td><code style="color:var(--green)">ANTHROPIC_BASE_URL=http://${queenHost}:4000</code></td></tr>
        <tr><td style="color:var(--cyan)">Ollama-native</td><td><code style="color:var(--green)">OLLAMA_HOST=http://${queenHost}:11434</code></td></tr>
        <tr><td style="color:var(--cyan)">Queen API</td><td><code style="color:var(--green)">http://${queenHost}:${port}</code></td></tr>
      </table>
      <div style="margin-top:8px;color:var(--muted)">Works with: OpenClaw · NanoClaw · DeerFlow · Cursor · Aider · Continue · CrewAI · LangChain · any OpenAI SDK</div>
    </div>
  </div>

  <!-- ═══ SECURITY ════════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">SECURITY</span>
      <span class="section-badge">HIVE DOORS · AUTH STATUS</span>
    </div>
    <div class="section-body" style="padding:0.75rem;font-size:11px">
      <table style="width:100%">
        <tr><td style="width:200px">Queen API (:${port})</td><td style="color:var(--green)">● AUTHENTICATED</td><td style="color:var(--muted)">Bearer token required</td></tr>
        <tr><td>LiteLLM (:4000)</td><td style="color:${services.litellm?.status === 'online' ? 'var(--amber)' : 'var(--muted)'}">● ${services.litellm?.status === 'online' ? 'SET LITELLM_MASTER_KEY' : 'OFFLINE'}</td><td style="color:var(--muted)">Set in .env</td></tr>
        <tr><td>Drone endpoints (:9091)</td><td style="color:var(--green)">● AUTHENTICATED</td><td style="color:var(--muted)">Hive secret on all routes</td></tr>
        <tr><td>NATS (:4222)</td><td style="color:var(--cyan)">● INTERNAL ONLY</td><td style="color:var(--muted)">Not exposed externally</td></tr>
        <tr><td>ntfy (:2586)</td><td style="color:${services.ntfy?.status === 'online' ? 'var(--green)' : 'var(--muted)'}">● ${services.ntfy?.status === 'online' ? 'ONLINE' : 'OFFLINE'}</td><td style="color:var(--muted)">Push notifications</td></tr>
        <tr><td>Dashboard</td><td style="color:var(--green)">● AUTHENTICATED</td><td style="color:var(--muted)">All API calls use Bearer token</td></tr>
        <tr><td>Sandbox roots</td><td style="color:var(--cyan)">● ${sandboxRoots.length > 0 ? 'ACTIVE' : 'NONE'}</td><td style="color:var(--muted);font-size:10px">${sandboxRoots.length > 0 ? sandboxRoots.map(r => escHtml(r)).join(' · ') : 'no filesystem restrictions'}</td></tr>
        <tr><td>Allowed domains</td><td style="color:var(--cyan)">● ${sandboxDomains.length > 0 ? 'FILTERED' : 'OPEN'}</td><td style="color:var(--muted);font-size:10px">${sandboxDomains.length > 0 ? sandboxDomains.map(d => escHtml(d)).join(' · ') : 'all domains permitted'}</td></tr>
      </table>
      <div style="margin-top:8px">
        <button class="btn btn-reject" onclick="if(confirm('HALT THE HIVE?')){authFetch('/api/hive/halt',{method:'POST'}).then(function(){this.textContent='HALTED'}.bind(this))}">⚠ HALT HIVE</button>
        <button class="btn btn-approve" onclick="authFetch('/api/hive/resume',{method:'POST'}).then(function(){this.textContent='RESUMED'}.bind(this))">▶ RESUME HIVE</button>
      </div>
    </div>
  </div>

  <!-- ═══ MAKE DISK ════════════════════════════════════════ -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">MAKE DISK</span>
      <span class="section-badge">ASSIMILATE NEW DRONES · WRITE THE CLAW TO USB</span>
    </div>
    <div class="section-body">
      <div class="disk-body">
        <div style="color:var(--muted);font-size:10px;letter-spacing:1px;margin-bottom:0.6rem">── Insert USB drive, enter mount path, click CREATE DRONE ──</div>
        <div class="disk-row">
          <span class="disk-label">▸ DRIVE PATH</span>
          <input id="makedisk-path" class="disk-input" type="text" value="/Volumes/" placeholder="/Volumes/MYUSB" spellcheck="false" autocomplete="off">
          <button class="btn btn-approve" id="makedisk-btn" data-action="makedisk">◈ CREATE DRONE</button>
        </div>
        <div id="makedisk-progress" class="disk-progress"></div>
      </div>
    </div>
  </div>

  <!-- ═══ FOOTER ══════════════════════════════════════════ -->
  <div class="footer-wrap">
    <div class="footer-inner">
      <span class="footer-item">AUTO-REFRESH 30s</span>
      <span class="footer-item"><a class="footer-link" href="/api/status">/api/status</a></span>
      <span class="footer-item"><a class="footer-link" href="/api/nodes">/api/nodes</a></span>
      <span class="footer-item"><a class="footer-link" href="/api/health">/api/health</a></span>
      <span class="footer-item">v${escHtml(version)}</span>
      <span class="footer-item" style="margin-left: auto; border-right: none;">BORGCLAW//QUEEN · ${new Date().toISOString().slice(0, 10)}</span>
    </div>
  </div>

</div><!-- /page-wrap -->

<!-- ═══ SSE TOAST ═══════════════════════════════════════ -->
<div id="sse-toast"></div>

<!-- ═══ MODAL (approval view) ═══════════════════════════ -->
<div id="modal-overlay">
  <div id="modal-box">
    <div id="modal-header">
      <span>╠══ APPROVAL DETAIL ══╣</span>
      <button id="modal-close" onclick="closeModal()">✕ CLOSE</button>
    </div>
    <div id="modal-body"></div>
  </div>
</div>

<script>
// ════════════════════════════════════════════════════════
// BorgClaw Queen Dashboard — Client JS
// Vanilla only. No frameworks. Every byte earned.
// ════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Auth — wrap all API calls with hive secret ────────
  // Secret is read from the bc_api_token cookie set by POST /auth/login.
  // It is never embedded in the HTML (Bug 1 fix).
  function getCookieValue(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }
  var HIVE_SECRET = getCookieValue('bc_api_token');
  function authFetch(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (HIVE_SECRET) opts.headers['Authorization'] = 'Bearer ' + HIVE_SECRET;
    if (!opts.headers['Content-Type'] && opts.method && opts.method !== 'GET')
      opts.headers['Content-Type'] = 'application/json';
    return fetch(url, opts);
  }

  // ── SSE Connection ─────────────────────────────────────
  var sseDot    = document.getElementById('sse-dot');
  var sseValue  = document.getElementById('sse-value');
  var sseToast  = document.getElementById('sse-toast');
  var toastTimer = null;

  function showToast(msg, durationMs) {
    sseToast.textContent = msg;
    sseToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      sseToast.classList.remove('show');
    }, durationMs || 3000);
  }

  function setSseStatus(status) {
    if (status === 'live') {
      sseDot.classList.add('live');
      sseValue.style.color = 'var(--green)';
      sseValue.textContent = 'LIVE';
      // Remove meta-refresh — SSE handles updates
      var metaRefresh = document.getElementById('meta-refresh');
      if (metaRefresh) metaRefresh.setAttribute('content', '300');
    } else if (status === 'error') {
      sseDot.classList.remove('live');
      sseValue.style.color = 'var(--red)';
      sseValue.textContent = 'DEAD';
    } else {
      sseDot.classList.remove('live');
      sseValue.style.color = 'var(--amber)';
      sseValue.textContent = 'CONN…';
    }
  }

  var sseRetryDelay = 2000;
  var sseMaxRetry   = 30000;
  var sseSource     = null;

  function connectSSE() {
    if (sseSource) {
      try { sseSource.close(); } catch (e) {}
    }
    setSseStatus('connecting');

    try {
      sseSource = new EventSource('/api/events?token=' + encodeURIComponent(HIVE_SECRET));

      sseSource.onopen = function () {
        setSseStatus('live');
        sseRetryDelay = 2000;
        showToast('▲ SSE STREAM CONNECTED', 2000);
      };

      sseSource.onmessage = function (e) {
        var evt;
        try { evt = JSON.parse(e.data); } catch (err) { return; }
        handleSSEEvent(evt);
      };

      sseSource.onerror = function () {
        setSseStatus('error');
        sseSource.close();
        sseSource = null;
        showToast('▼ SSE LOST — RETRYING IN ' + Math.round(sseRetryDelay / 1000) + 's', sseRetryDelay);
        setTimeout(connectSSE, sseRetryDelay);
        sseRetryDelay = Math.min(sseRetryDelay * 2, sseMaxRetry);
      };
    } catch (err) {
      setSseStatus('error');
      // SSE not supported or blocked — fall back to meta-refresh
    }
  }

  // ── SSE Event Handlers ─────────────────────────────────
  function handleSSEEvent(evt) {
    if (!evt || !evt.type) return;

    // Always prepend to activity feed
    prependActivity(evt);

    // Sound effect
    soundForEvent(evt);

    // Cost tracking
    accumulateCost(evt);

    // Dispatch by type
    switch (evt.type) {
      case 'connected':
        break;
      case 'node_registered':
      case 'node_heartbeat':
      case 'node_offline':
        refreshNodes();
        break;
      case 'health_update':
        if (evt.services) updateServices(evt.services);
        break;
      case 'approval_created':
        refreshApprovals();
        updatePendingBadge(1);
        showToast('▲ NEW APPROVAL REQUEST: ' + (evt.summary || evt.approval_id || ''), 4000);
        break;
      case 'approval_approved':
        resolveApprovalRow(evt.approval_id, 'approved');
        updatePendingBadge(-1);
        break;
      case 'approval_rejected':
        resolveApprovalRow(evt.approval_id, 'rejected');
        updatePendingBadge(-1);
        break;
      default:
        break;
    }
  }

  // ── Activity Feed ──────────────────────────────────────
  var actFeed = document.getElementById('act-feed');

  function fmtTime(ts) {
    try {
      var d = new Date(ts);
      return d.toISOString().slice(11, 19);
    } catch (e) { return '??:??:??'; }
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtActLine(evt) {
    var t    = fmtTime(evt.ts);
    var type = (evt.type || 'event').toUpperCase();
    var desc = evt.summary || evt.message || evt.description
            || (evt.approval_id ? '[' + evt.approval_id + ']' : '')
            || '';
    return '<div class="act-line act-new">'
      + '<span class="act-time">' + escHtml(t) + '</span>'
      + ' <span class="act-sep">░</span> '
      + '<span class="act-type">' + escHtml(type) + '</span>'
      + '<span class="act-sep">──</span> '
      + '<span class="act-desc">' + escHtml(desc) + '</span>'
      + '</div>';
  }

  function prependActivity(evt) {
    if (!actFeed) return;
    var empty = actFeed.querySelector('.empty-row');
    if (empty) empty.remove();

    var html = fmtActLine(evt);
    actFeed.insertAdjacentHTML('afterbegin', html);

    // Trim to 60 entries
    var lines = actFeed.querySelectorAll('.act-line');
    if (lines.length > 60) {
      for (var i = 60; i < lines.length; i++) {
        lines[i].remove();
      }
    }
  }

  // ── Node refresh (lightweight — fetches /api/status) ───
  var refreshNodesTimer = null;
  function refreshNodes() {
    clearTimeout(refreshNodesTimer);
    refreshNodesTimer = setTimeout(function () {
      authFetch('/api/status')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.nodes) return;
          rebuildNodesTable(data.nodes);
          rebuildTopology(data.nodes);
          var online = data.nodes.filter(function (n) { return n.status === 'online'; }).length;
          var total  = data.nodes.length;
          var el = document.querySelector('.stat-item:nth-child(2) .stat-value');
          if (el) {
            el.textContent = online + '/' + total;
            el.className = 'stat-value' + (online < total ? ' warn' : '');
          }
        })
        .catch(function () {});
    }, 300);
  }

  // Stub for topology panel — not yet implemented.
  // Called after every node refresh; replace with a real D3/canvas render when needed.
  function rebuildTopology() {}

  function dotHtml(status) {
    if (status === 'online')  return '<span class="dot-green">●</span>';
    if (status === 'offline') return '<span class="dot-red">○</span>';
    return '<span class="dot-amber">◐</span>';
  }

  function rebuildNodesTable(nodeList) {
    var tbody = document.getElementById('nodes-tbody');
    if (!tbody) return;
    if (!nodeList || nodeList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">── NO NODES REGISTERED ──</td></tr>';
      return;
    }
    var html = nodeList.map(function (n) {
      var caps = Array.isArray(n.capabilities)
        ? n.capabilities.map(function (c) { return '<span class="cap-tag">' + escHtml(c) + '</span>'; }).join(' ')
        : '—';
      var hb = n.last_heartbeat
        ? (n.seconds_since_heartbeat != null ? n.seconds_since_heartbeat + 's ago' : n.last_heartbeat)
        : 'never';
      return '<tr class="data-row">'
        + '<td>' + dotHtml(n.status) + ' <span class="node-id">' + escHtml(n.node_id || 'unknown') + '</span></td>'
        + '<td>' + escHtml(n.role || '—') + '</td>'
        + '<td class="dim">' + escHtml(n.profile || '—') + '</td>'
        + '<td>' + dotHtml(n.status) + ' ' + escHtml(n.status) + '</td>'
        + '<td class="dim">' + escHtml(hb) + '</td>'
        + '<td class="caps">' + caps + '</td>'
        + '</tr>';
    }).join('');
    tbody.innerHTML = html;
  }

  // ── Service tiles update ───────────────────────────────
  function updateServices(services) {
    // Full re-render of the service grid on health update
    var grid = document.getElementById('svc-grid');
    if (!grid || !services) return;
    var defs = [
      { key: 'queen',   label: 'QUEEN',   icon: '♛' },
      { key: 'ollama',  label: 'OLLAMA',  icon: '◈' },
      { key: 'nats',    label: 'NATS',    icon: '⟁' },
      { key: 'litellm', label: 'LITELLM', icon: '◭' },
      { key: 'ntfy',    label: 'NTFY',    icon: '▲' },
      { key: 'qmd',     label: 'QMD',     icon: '◇' },
      { key: 'docker',  label: 'DOCKER',  icon: '⬡' },
      { key: 'git',     label: 'GIT',     icon: '⬢' },
    ];
    var html = defs.map(function (d) {
      var svc = services[d.key] || null;
      var st  = svcStatus(svc);
      var dot = st === 'online' ? '●' : st === 'degraded' ? '◐' : '○';
      var cls = 'svc-tile svc-' + st;
      var sub = svcSubtext(d.key, svc);
      return '<div class="' + cls + '">'
        + '<div class="svc-header"><span class="svc-icon">' + d.icon + '</span> ' + d.label + '</div>'
        + '<div class="svc-dot">' + dot + '</div>'
        + '<div class="svc-sub">' + escHtml(sub) + '</div>'
        + '</div>';
    }).join('');
    grid.innerHTML = html;
  }

  function svcStatus(svc) {
    if (!svc) return 'offline';
    if (svc.status === 'online')   return 'online';
    if (svc.status === 'degraded') return 'degraded';
    if (svc.installed === true)    return 'online';
    if (svc.installed === false)   return 'offline';
    return 'offline';
  }

  function svcSubtext(key, svc) {
    if (!svc) return 'NO SIGNAL';
    if (key === 'ollama' && svc.models && svc.models.length > 0) {
      return svc.models.slice(0, 2).join(' / ') + (svc.models.length > 2 ? ' +' + (svc.models.length - 2) : '');
    }
    if (svc.version) return String(svc.version).slice(0, 20);
    if (svc.uptime_seconds != null) return 'UP ' + formatSeconds(svc.uptime_seconds);
    if (svc.status === 'online')  return 'NOMINAL';
    if (svc.installed === true)   return 'INSTALLED';
    return 'NO SIGNAL';
  }

  function formatSeconds(s) {
    s = parseInt(s, 10);
    if (s < 60)   return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  }

  // ── Approval actions ───────────────────────────────────
  var pendingCount = ${pendingApprovals};

  function updatePendingBadge(delta) {
    pendingCount = Math.max(0, pendingCount + delta);
    var badge = document.querySelector('.section-badge');
    // Find the approvals section badge specifically
    var badges = document.querySelectorAll('.section-badge');
    badges.forEach(function (b) {
      if (b.textContent.indexOf('PENDING') !== -1) {
        b.textContent = 'LAW TWO ENFORCEMENT QUEUE · ' + pendingCount + ' PENDING';
      }
    });
    var stat = document.querySelector('.stat-item:nth-child(3) .stat-value');
    if (stat) {
      stat.textContent = pendingCount;
      stat.className   = 'stat-value' + (pendingCount > 0 ? ' alert' : '');
    }
  }

  function resolveApprovalRow(id, resolution) {
    var row = document.getElementById('appr-' + id);
    if (!row) return;
    row.classList.add('resolved');
    var actionsCell = row.querySelector('.appr-actions');
    if (actionsCell) {
      var color = resolution === 'approved' ? 'var(--green)' : 'var(--red)';
      actionsCell.innerHTML = '<span style="color:' + color + '; font-size:11px; letter-spacing:1px;">'
        + (resolution === 'approved' ? '✓ APPROVED' : '✗ REJECTED')
        + '</span>';
    }
    setTimeout(function () {
      if (row.parentNode) row.parentNode.removeChild(row);
      // Check if tbody is empty
      var tbody = document.getElementById('approvals-tbody');
      if (tbody && tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">── QUEUE CLEAR ── no pending approvals</td></tr>';
      }
    }, 1500);
  }

  function refreshApprovals() {
    authFetch('/api/approvals')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!Array.isArray(data)) return;
        var pending = data.filter(function (a) { return a.status === 'pending'; });
        var tbody = document.getElementById('approvals-tbody');
        if (!tbody) return;
        if (pending.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="empty-row">── QUEUE CLEAR ── no pending approvals</td></tr>';
          return;
        }
        var html = pending.map(function (a, i) {
          var id = escHtml(a.id);
          return '<tr class="data-row appr-row" id="appr-' + id + '">'
            + '<td class="appr-num">' + String(i + 1).padStart(2, '0') + '</td>'
            + '<td class="appr-summary">' + escHtml(a.summary || a.type || 'unknown')
              + '<br><span class="dim appr-meta">TYPE:' + escHtml(a.type || '?')
              + ' · SRC:' + escHtml(a.source_agent || '?') + '</span></td>'
            + '<td class="appr-type">' + escHtml(a.type || '—') + '</td>'
            + '<td class="appr-actions">'
              + '<button class="btn btn-approve" data-action="approve" data-id="' + id + '">✓ APPROVE</button>'
              + '<button class="btn btn-reject"  data-action="reject"  data-id="' + id + '">✗ REJECT</button>'
              + '<button class="btn btn-view"    data-action="view"    data-id="' + id + '">⊞ VIEW</button>'
            + '</td>'
            + '</tr>';
        }).join('');
        tbody.innerHTML = html;
      })
      .catch(function () {});
  }

  // ── Global approval button handlers ───────────────────
  window.doApprove = function (id) {
    var row = document.getElementById('appr-' + id);
    if (row) {
      var btns = row.querySelectorAll('.btn');
      btns.forEach(function (b) { b.disabled = true; });
    }
    authFetch('/api/approvals/' + encodeURIComponent(id) + '/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        resolveApprovalRow(id, 'approved');
        updatePendingBadge(-1);
        showToast('✓ APPROVED: ' + id, 2500);
      })
      .catch(function (err) {
        showToast('✗ APPROVE FAILED: ' + err.message, 4000);
        if (row) {
          var btns = row.querySelectorAll('.btn');
          btns.forEach(function (b) { b.disabled = false; });
        }
      });
  };

  window.doReject = function (id) {
    var row = document.getElementById('appr-' + id);
    if (row) {
      var btns = row.querySelectorAll('.btn');
      btns.forEach(function (b) { b.disabled = true; });
    }
    authFetch('/api/approvals/' + encodeURIComponent(id) + '/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        resolveApprovalRow(id, 'rejected');
        updatePendingBadge(-1);
        showToast('✗ REJECTED: ' + id, 2500);
      })
      .catch(function (err) {
        showToast('✗ REJECT FAILED: ' + err.message, 4000);
        if (row) {
          var btns = row.querySelectorAll('.btn');
          btns.forEach(function (b) { b.disabled = false; });
        }
      });
  };

  window.doView = function (id) {
    authFetch('/api/approvals/' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var body = document.getElementById('modal-body');
        if (body) body.textContent = JSON.stringify(data, null, 2);
        var overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.add('show');
      })
      .catch(function (err) {
        showToast('VIEW FAILED: ' + err.message, 3000);
      });
  };

  window.closeModal = function () {
    var overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('show');
  };

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  // ── Interactive action handlers ─────────────────────────

  window.runWorkflow = function (name) {
    showToast('▶ EXECUTING: ' + name + '...', 2000);
    authFetch('/api/workflows/' + encodeURIComponent(name) + '/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: {} }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.run_id) {
          showToast('▶ STARTED: ' + name + ' (run: ' + data.run_id + ')', 3000);
        } else {
          showToast('✗ FAILED: ' + (data.error || 'unknown'), 4000);
        }
      })
      .catch(function (err) { showToast('✗ ERROR: ' + err.message, 4000); });
  };

  window.refreshHealth = function () {
    showToast('⟳ PROBING SERVICES...', 1500);
    authFetch('/api/actions/refresh-health', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        updateServices(data);
        showToast('⟳ HEALTH: ' + (data.overall || 'unknown').toUpperCase(), 2500);
      })
      .catch(function (err) { showToast('✗ HEALTH CHECK FAILED: ' + err.message, 4000); });
  };

  window.fetchModels = function () {
    authFetch('/api/models')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var body = document.getElementById('modal-body');
        if (body) {
          if (data.models && data.models.length > 0) {
            body.textContent = 'SOURCE: ' + data.source + '\\\\n\\\\n' + data.models.map(function (m) {
              return '  ' + (m.name || m) + (m.size ? ' (' + Math.round(m.size / 1e9 * 10) / 10 + 'GB)' : '');
            }).join('\\\\n');
          } else {
            body.textContent = 'No models loaded.\\\\n\\\\nSource: ' + (data.source || 'none') + '\\\\nError: ' + (data.error || 'Ollama not running');
          }
        }
        var overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.add('show');
      })
      .catch(function (err) { showToast('✗ MODEL LIST FAILED: ' + err.message, 3000); });
  };

  window.showSearch = function () {
    var query = prompt('QMD Search Query:');
    if (!query) return;
    showToast('◇ SEARCHING: ' + query, 1500);
    authFetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, limit: 5 }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var body = document.getElementById('modal-body');
        if (body) body.textContent = data.results || data.error || 'No results';
        var overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.add('show');
      })
      .catch(function (err) { showToast('✗ SEARCH FAILED: ' + err.message, 3000); });
  };

  // ══════════════════════════════════════════════════════
  // ── Chiptune Sound System ──────────────────────────────
  // ══════════════════════════════════════════════════════
  var audioCtx = null;
  var muted = localStorage.getItem('borgclaw_mute') !== 'false'; // default muted

  function initSndBtn() {
    var btn = document.getElementById('snd-toggle');
    if (!btn) return;
    if (muted) {
      btn.textContent = '♪ MUTE';
      btn.classList.remove('active');
    } else {
      btn.textContent = '♪ SND';
      btn.classList.add('active');
    }
  }

  window.toggleSound = function () {
    muted = !muted;
    localStorage.setItem('borgclaw_mute', muted ? 'true' : 'false');
    initSndBtn();
    if (!muted) {
      // Play a little confirmation blip when unmuting
      playTone(800, 0.03, 0.05, 'sine');
    }
  };

  function playTone(freq, duration, volume, type) {
    if (muted) return;
    if (!window.AudioContext && !window.webkitAudioContext) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var osc  = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.value = volume || 0.05;
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }

  function playSequence(tones) {
    // tones: array of [freq, duration, volume, type, delayFromStart]
    tones.forEach(function (t) {
      var delay = t[4] || 0;
      setTimeout(function () {
        playTone(t[0], t[1], t[2], t[3]);
      }, delay * 1000);
    });
  }

  function soundForEvent(evt) {
    switch (evt.type) {
      case 'approval_created':
        // Two-tone ascending: 600Hz → 900Hz, 100ms total
        playSequence([
          [600, 0.05, 0.08, 'sine', 0],
          [900, 0.05, 0.08, 'sine', 0.05],
        ]);
        break;
      case 'approval_approved':
        // Three-tone ascending chord: 400→600→800Hz, 150ms
        playSequence([
          [400, 0.05, 0.08, 'sine', 0],
          [600, 0.05, 0.08, 'sine', 0.05],
          [800, 0.05, 0.08, 'sine', 0.10],
        ]);
        break;
      case 'approval_rejected':
        // Descending 600→300Hz, 100ms
        playSequence([
          [600, 0.05, 0.06, 'sine', 0],
          [300, 0.05, 0.06, 'sine', 0.05],
        ]);
        break;
      case 'node_offline':
        // Low warning tone 200Hz, 200ms
        playTone(200, 0.2, 0.06, 'sine');
        break;
      default:
        // Generic event blip: 800Hz, 30ms
        playTone(800, 0.03, 0.05, 'sine');
        break;
    }
  }

  // ══════════════════════════════════════════════════════
  // ── Contribution Dial ─────────────────────────────────
  // ══════════════════════════════════════════════════════
  window.updateDialPct = function (input) {
    var val = parseInt(input.value, 10);
    var nodeId = input.getAttribute('data-node');
    var label = document.getElementById('dial-pct-' + nodeId);
    if (label) label.textContent = val + '%';
    // Update CSS custom property for track fill
    input.style.setProperty('--dial-pct', val + '%');
  };

  window.patchContribution = function (input) {
    var val = parseInt(input.value, 10);
    var nodeId = input.getAttribute('data-node');
    input.disabled = true;
    authFetch('/api/nodes/' + encodeURIComponent(nodeId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contribution: val }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        showToast('◈ CONTRIBUTION SET: ' + nodeId + ' → ' + val + '%', 2500);
      })
      .catch(function (err) {
        showToast('✗ DIAL PATCH FAILED: ' + err.message, 4000);
      })
      .finally(function () {
        input.disabled = false;
      });
  };

  // ══════════════════════════════════════════════════════
  // ── Model Swap UI ─────────────────────────────────────
  // ══════════════════════════════════════════════════════
  window.openModelSwap = function (nodeId, profile) {
    var overlay = document.getElementById('modal-overlay');
    var header  = document.getElementById('modal-header').querySelector('span');
    var body    = document.getElementById('modal-body');
    if (!overlay || !body) return;
    header.textContent = '╠══ MODEL SWAP ── ' + nodeId + ' ══╣';
    body.innerHTML = '<div style="color:var(--muted);padding:0.5rem">Loading available models…</div>';
    overlay.classList.add('show');

    authFetch('/api/config/models' + (profile ? '?profile=' + encodeURIComponent(profile) : ''))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var models = data.models || data || [];
        if (!Array.isArray(models) || models.length === 0) {
          body.innerHTML = '<div style="color:var(--muted);padding:0.5rem">── No models available ── check Ollama service</div>';
          return;
        }
        var html = '<div class="model-swap-list">';
        models.forEach(function (m) {
          var name = m.name || m;
          var size = m.size ? (Math.round(m.size / 1e9 * 10) / 10) + ' GB' : '';
          var nameEsc = escHtml(name);
          html += '<div class="model-swap-item">'
            + '<span class="model-swap-name">' + nameEsc + '</span>'
            + '<span class="model-swap-size">' + escHtml(size) + '</span>'
            + '<button class="btn btn-view" data-action="pull" data-model="' + nameEsc + '" data-node="' + escHtml(nodeId) + '">PULL</button>'
            + '</div>';
        });
        html += '</div>';
        body.innerHTML = html;
      })
      .catch(function (err) {
        body.innerHTML = '<div style="color:var(--red);padding:0.5rem">✗ Failed to load models: ' + escHtml(err.message) + '</div>';
      });
  };

  window.pullModel = function (modelName, nodeId) {
    showToast('◈ PULLING: ' + modelName + '…', 3000);
    authFetch('/api/models/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, node_id: nodeId }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        showToast('✓ PULL STARTED: ' + modelName, 3000);
        closeModal();
      })
      .catch(function (err) {
        showToast('✗ PULL FAILED: ' + err.message, 4000);
      });
  };

  // ══════════════════════════════════════════════════════
  // ── Topology Live Update ──────────────────────────────
  // ══════════════════════════════════════════════════════
  function rebuildTopology(nodeList) {
    var panel = document.getElementById('topology-panel');
    if (!panel || !nodeList) return;

    var workers = nodeList.filter(function (n) { return n.role !== 'queen'; });
    if (workers.length === 0) {
      panel.innerHTML = '<div class="topology-pre">'
        + '<span class="topo-queen">♛ QUEEN</span>'
        + '  <span class="topo-solo">(solo mode — add nodes with bootstrap.sh)</span>'
        + '</div>';
      return;
    }

    var queenLabel = '<span class="topo-queen">♛ QUEEN</span>';
    var pad = '        ';
    var lines = [pad + queenLabel];

    if (workers.length === 1) {
      lines.push(pad + '    │');
      lines.push(pad + '    ' + nodeLabel(workers[0]));
    } else if (workers.length === 2) {
      lines.push(pad + '   ╱ ╲');
      lines.push(pad + nodeLabel(workers[0]) + '   ' + nodeLabel(workers[1]));
    } else {
      lines.push(pad + '  ╱  │  ╲');
      lines.push(workers.map(function (n) { return '  ' + nodeLabel(n); }).join('  '));
    }

    panel.innerHTML = '<div class="topology-pre">' + lines.join('<br>') + '</div>';
  }

  function nodeLabel(n) {
    var isOnline = n.status === 'online';
    var cls = isOnline ? 'topo-online' : 'topo-offline';
    var sym = isOnline ? '◈' : '○';
    var suffix = isOnline ? '' : '(offline)';
    return '<span class="' + cls + '">' + sym + ' ' + escHtml(n.node_id || '?') + suffix + '</span>';
  }

  // ══════════════════════════════════════════════════════
  // ── Sparkline (client-side, for live updates) ─────────
  // ══════════════════════════════════════════════════════
  function sparklineClient(values, width) {
    if (!values || values.length < 2) return '────────────────────';
    var blocks = '▁▂▃▄▅▆▇█';
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;
    var step = Math.max(1, Math.floor(values.length / width));
    var result = '';
    for (var i = 0; i < values.length && result.length < width; i += step) {
      var idx = Math.round(((values[i] - min) / range) * (blocks.length - 1));
      result += blocks[idx];
    }
    return result;
  }

  // ── Cost tracker: accumulate workflow_step_complete events ─
  var costAccumulator = 0.0;
  var AI_PROVIDERS = ['litellm', 'anthropic', 'openai'];

  function updateCostDisplay() {
    var el = document.getElementById('cost-value');
    if (el) {
      el.textContent = '$' + costAccumulator.toFixed(2);
      el.setAttribute('data-cost', costAccumulator.toFixed(2));
    }
  }

  function accumulateCost(evt) {
    if (evt.type !== 'workflow_step_complete') return;
    var provider = (evt.provider || evt.result && evt.result.provider || '').toLowerCase();
    var isAI = AI_PROVIDERS.some(function (p) { return provider.indexOf(p) !== -1; });
    if (!isAI) return;
    // Estimate from token counts if available; otherwise $0.001 per step as placeholder
    var tokens = (evt.tokens_used || evt.result && evt.result.tokens_used || 0);
    var estimate = tokens > 0 ? tokens * 0.000002 : 0.001;
    costAccumulator += estimate;
    updateCostDisplay();
  }

  // ── Queen Chat ─────────────────────────────────────────
  window.sendChat = function () {
    var input = document.getElementById('chat-input');
    var log = document.getElementById('chat-log');
    var msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    input.disabled = true;

    // Show user message
    log.innerHTML += '<div style="color:var(--cyan);margin-top:4px">▶ ' + escHtml(msg) + '</div>';
    log.innerHTML += '<div style="color:var(--muted)">⏳ Queen is thinking...</div>';
    log.scrollTop = log.scrollHeight;

    authFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: msg }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // Remove "thinking" indicator
        var thinking = log.querySelector('div:last-child');
        if (thinking && thinking.textContent.includes('thinking')) thinking.remove();

        // Show Queen response
        log.innerHTML += '<div style="color:var(--green);margin-top:2px">♛ ' + escHtml(data.response || data.error || 'No response') + '</div>';

        // Show actions taken
        if (data.actions_taken && data.actions_taken.length > 0) {
          data.actions_taken.forEach(function (a) {
            log.innerHTML += '<div style="color:var(--amber);font-size:10px">  ⚡ ' + escHtml(a.cmd) + ' ' + JSON.stringify(a.params) + '</div>';
          });
          // Refresh node display if actions changed state
          refreshNodes();
        }

        log.scrollTop = log.scrollHeight;
        input.disabled = false;
        input.focus();
      })
      .catch(function (err) {
        var thinking = log.querySelector('div:last-child');
        if (thinking && thinking.textContent.includes('thinking')) thinking.remove();
        log.innerHTML += '<div style="color:var(--red)">✗ ' + escHtml(err.message) + '</div>';
        log.scrollTop = log.scrollHeight;
        input.disabled = false;
        input.focus();
      });
  };

  // ── Event Delegation — handles all data-action clicks ──
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');
    var node = btn.getAttribute('data-node');
    var model = btn.getAttribute('data-model');
    var profile = btn.getAttribute('data-profile');

    switch (action) {
      case 'approve': doApprove(id); break;
      case 'reject':  doReject(id); break;
      case 'view':    doView(id); break;
      case 'pull':    pullModel(model, node); break;
      case 'modelswap': openModelSwap(node, profile); break;
    }
  });

  // ── Init ───────────────────────────────────────────────
  initSndBtn();
  connectSSE();

})();
</script>

<script>
// Standalone chat — works even if main script has issues
(function(){
  // Read secret from cookie (never embedded in HTML — Bug 1 fix).
  var SECRET=(document.cookie.match(/(?:^|; )bc_api_token=([^;]*)/)||[])[1];
  if(SECRET)SECRET=decodeURIComponent(SECRET);else SECRET='';
  var hdr={'Content-Type':'application/json'};
  if(SECRET)hdr['Authorization']='Bearer '+SECRET;

  // Event delegation for data-action buttons
  document.addEventListener('click',function(e){
    var btn=e.target.closest('[data-action]');
    if(!btn)return;
    var a=btn.getAttribute('data-action');
    var id=btn.getAttribute('data-id');
    var nd=btn.getAttribute('data-node');
    var md=btn.getAttribute('data-model');
    var pr=btn.getAttribute('data-profile');
    if(a==='approve')fetch('/api/approvals/'+id+'/approve',{method:'POST',headers:hdr}).then(function(){btn.closest('tr').style.opacity='0.3';btn.closest('tr').querySelector('.appr-type').textContent='APPROVED'});
    if(a==='reject')fetch('/api/approvals/'+id+'/reject',{method:'POST',headers:hdr}).then(function(){btn.closest('tr').style.opacity='0.3';btn.closest('tr').querySelector('.appr-type').textContent='REJECTED'});
    if(a==='view')fetch('/api/approvals/'+id,{headers:hdr}).then(function(r){return r.json()}).then(function(d){alert(JSON.stringify(d,null,2))});
    if(a==='pull'){btn.textContent='PULLING...';fetch('/api/models/pull',{method:'POST',headers:hdr,body:JSON.stringify({model:md,node_id:nd})}).then(function(){btn.textContent='DONE'}).catch(function(){btn.textContent='FAILED'})}
    if(a==='modelswap')fetch('/api/config/models'+(pr?'?profile='+pr:''),{headers:hdr}).then(function(r){return r.json()}).then(function(d){alert('Available models:\\\\n'+JSON.stringify(d.models||d,null,2))});
    if(a==='makedisk')makeDisk();
  });

  window.sendChat=function(){
    var inp=document.getElementById('chat-input');
    var log=document.getElementById('chat-log');
    var msg=inp.value.trim();
    if(!msg)return;
    inp.value='';inp.disabled=true;
    log.innerHTML+='<div style="color:#0cf;margin-top:4px">'+msg.replace(/</g,'&lt;')+'</div>';
    log.innerHTML+='<div style="color:#888">Queen is thinking...</div>';
    log.scrollTop=log.scrollHeight;
    fetch('/api/chat',{method:'POST',headers:hdr,body:JSON.stringify({message:msg})})
    .then(function(r){return r.json()})
    .then(function(d){
      var els=log.querySelectorAll('div');
      var last=els[els.length-1];
      if(last&&last.textContent.includes('thinking'))last.remove();
      log.innerHTML+='<div style="color:#0f8;margin-top:2px">'+((d.response||d.error||'').replace(/</g,'&lt;'))+'</div>';
      if(d.actions_taken&&d.actions_taken.length>0)d.actions_taken.forEach(function(a){
        log.innerHTML+='<div style="color:#fa0;font-size:10px">  > '+a.cmd+' '+JSON.stringify(a.params)+'</div>';
      });
      log.scrollTop=log.scrollHeight;inp.disabled=false;inp.focus();
    })
    .catch(function(e){
      log.innerHTML+='<div style="color:#f44">Error: '+e.message+'</div>';
      inp.disabled=false;inp.focus();
    });
  };
})();
</script>

<script>
// ════════════════════════════════════════════════════════
// MAKE DISK — Standalone block
// Writes the BorgClaw hive to a USB drive via:
//   POST /api/hive/make-disk { target_path }
// Standalone so it works even if main IIFE has issues.
// ════════════════════════════════════════════════════════
(function(){
  'use strict';
  // Read secret from cookie (never embedded in HTML — Bug 1 fix).
  var SECRET=(document.cookie.match(/(?:^|; )bc_api_token=([^;]*)/)||[])[1];
  if(SECRET)SECRET=decodeURIComponent(SECRET);else SECRET='';

  function authHdr(extra){
    var h={'Content-Type':'application/json'};
    if(SECRET)h['Authorization']='Bearer '+SECRET;
    return Object.assign(h,extra||{});
  }

  function setProgress(msg,state){
    var el=document.getElementById('makedisk-progress');
    if(!el)return;
    el.textContent=msg;
    el.className='disk-progress visible'+(state?' '+state:'');
    el.scrollTop=el.scrollHeight;
  }

  function setBtnState(loading){
    var btn=document.getElementById('makedisk-btn');
    if(!btn)return;
    btn.disabled=loading;
    btn.textContent=loading?'◈ WRITING…':'◈ CREATE DRONE';
  }

  window.makeDisk=function(){
    var pathEl=document.getElementById('makedisk-path');
    if(!pathEl)return;
    var targetPath=(pathEl.value||'').trim();

    if(!targetPath){
      setProgress('ERROR: Enter a drive path first (e.g. /Volumes/MYUSB)','err');
      return;
    }
    if(!targetPath.startsWith('/')){
      setProgress('ERROR: Path must be absolute (start with /)','err');
      return;
    }

    if(!confirm('This will write BorgClaw to '+targetPath+'.\\n\\nThe script will cross-compile the-claw binary, cache Ollama, and bake in this hive\'s secret key.\\n\\nContinue?')){
      return;
    }

    setBtnState(true);
    setProgress('▸ INITIATING ASSIMILATION SEQUENCE…\n▸ This may take 2-5 minutes if compiling or downloading models.\n▸ Stand by.','');

    fetch('/api/hive/make-disk',{
      method:'POST',
      headers:authHdr(),
      body:JSON.stringify({target_path:targetPath})
    })
    .then(function(r){return r.json()})
    .then(function(d){
      setBtnState(false);
      if(d.ok){
        var sizeLine=d.size_mb!=null?'\\n▸ SIZE ON DRIVE: '+d.size_mb+' MB':'';
        var out=d.output?'\\n\\n── SCRIPT OUTPUT ──\\n'+d.output:'';
        setProgress('✓ DISK READY — '+d.path+sizeLine+out,'ok');
      } else {
        setProgress('✗ FAILED: '+(d.error||'Unknown error'),'err');
      }
    })
    .catch(function(e){
      setBtnState(false);
      setProgress('✗ REQUEST FAILED: '+e.message,'err');
    });
  };

  // Wire up the button directly (redundant safety — event delegation handles it too)
  document.addEventListener('DOMContentLoaded',function(){
    var btn=document.getElementById('makedisk-btn');
    if(btn)btn.addEventListener('click',function(){window.makeDisk();});
  });
})();
</script>

<script>
// ════════════════════════════════════════════════════════
// SCAN MODELS — Standalone block
// Calls GET /api/models/available and renders results
// in the shared modal. Standalone so it survives any
// main IIFE failures.
// ════════════════════════════════════════════════════════
(function(){
  'use strict';
  var SECRET=(document.cookie.match(/(?:^|; )bc_api_token=([^;]*)/)||[])[1];
  if(SECRET)SECRET=decodeURIComponent(SECRET);else SECRET='';

  function authHdr(){
    var h={};
    if(SECRET)h['Authorization']='Bearer '+SECRET;
    return h;
  }

  function escH(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showModal(title,html){
    var overlay=document.getElementById('modal-overlay');
    var hdr=overlay&&overlay.querySelector('#modal-header span');
    var body=document.getElementById('modal-body');
    if(!overlay||!body)return;
    if(hdr)hdr.textContent=title;
    body.innerHTML=html;
    overlay.classList.add('show');
  }

  window.scanAvailableModels=function(){
    showModal('╠══ SCANNING MODEL LEADERBOARD… ══╣','<div style="color:var(--muted);padding:0.5rem">◈ Probing Ollama library — this may take 10-20s…</div>');
    fetch('/api/models/available',{headers:authHdr()})
      .then(function(r){return r.json();})
      .then(function(data){
        var candidates=data.candidates||[];
        if(candidates.length===0){
          showModal('╠══ MODEL LEADERBOARD ══╣','<div style="color:var(--muted);padding:0.75rem">── No candidates found. Check Ollama connectivity. ──</div>');
          return;
        }
        var rows=candidates.map(function(m){
          var tier=escH(m.tier||'—');
          var name=escH(m.name||m.model||'?');
          var size=m.size_gb?m.size_gb.toFixed(1)+' GB':'—';
          var pulls=m.pull_count!=null?Number(m.pull_count).toLocaleString():'—';
          var tierColor=tier==='nano'?'var(--green)':tier==='edge'?'var(--cyan)':tier==='worker'?'var(--amber)':'var(--grey)';
          return '<div class="model-swap-item">'
            +'<span class="model-swap-name">'+name+'</span>'
            +'<span style="color:'+tierColor+';font-size:10px;min-width:4rem;text-align:right">'+tier+'</span>'
            +'<span class="model-swap-size">'+escH(size)+'</span>'
            +'<span style="color:var(--muted);font-size:10px;min-width:5rem;text-align:right">▼ '+escH(pulls)+'</span>'
            +'<button class="btn btn-view" data-action="pull" data-model="'+name+'" data-node="">PULL</button>'
            +'</div>';
        }).join('');
        var header='<div style="color:var(--grey);font-size:10px;padding:0.4rem 1rem;border-bottom:1px solid var(--border)">'
          +'SCANNED '+escH(data.scanned_at?new Date(data.scanned_at).toISOString().slice(11,19):'?')
          +' · '+escH(String(candidates.length))+' CANDIDATES'
          +'</div>';
        showModal('╠══ MODEL LEADERBOARD ══╣',header+'<div class="model-swap-list">'+rows+'</div>');
      })
      .catch(function(e){
        showModal('╠══ MODEL LEADERBOARD ══╣','<div style="color:var(--red);padding:0.75rem">✗ Scan failed: '+escH(e.message)+'</div>');
      });
  };
})();
</script>
</body>
</html>`;
}
