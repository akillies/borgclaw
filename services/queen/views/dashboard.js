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
    hiveSecretPrefix = '',
    clusters: clusterList = [],
    sandboxRoots = [],
    sandboxDomains = [],
    nasMountPath = null,
  } = data;
  const port = data.port || process.env.QUEEN_PORT || '9090';
  const queenHost = data.queenHost || 'localhost';

  // ── Helpers ───────────────────────────────────────────
  function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function formatSeconds(s) {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }
  function statusDot(status) {
    if (status === 'online')  return '<span class="dot-on">●</span>';
    if (status === 'offline') return '<span class="dot-off">○</span>';
    return '<span class="dot-warn">◐</span>';
  }
  function sparkline(values, width) {
    if (!values || values.length < 2) return '────────────────────';
    const blocks = '▁▂▃▄▅▆▇█';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = Math.max(1, Math.floor(values.length / width));
    let result = '';
    for (let i = 0; i < values.length && result.length < width; i += step) {
      result += blocks[Math.round(((values[i] - min) / range) * (blocks.length - 1))];
    }
    return result;
  }

  // ── Template helpers ──────────────────────────────────
  const sectionId = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  function section(title, badge, content) {
    const sid = sectionId(title);
    return `<div class="section" data-section="${sid}"><div class="sh" data-toggle="${sid}"><span class="sh-ind">[−]</span><span class="st">${title}</span><span class="sb">${badge}</span></div><div class="sbody">${content}</div></div>`;
  }
  function table(headers, rows, emptyMsg) {
    const ths = headers.map(h => `<th>${h}</th>`).join('');
    const body = rows.length === 0
      ? `<tr><td colspan="${headers.length}" class="empty-row">${emptyMsg}</td></tr>`
      : rows.join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table>`;
  }
  function tableWithId(headers, rows, emptyMsg, tbodyId) {
    const ths = headers.map(h => `<th>${h}</th>`).join('');
    const body = rows.length === 0
      ? `<tr><td colspan="${headers.length}" class="empty-row">${emptyMsg}</td></tr>`
      : rows.join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody id="${tbodyId}">${body}</tbody></table>`;
  }

  // ── Service status helpers (shared server+client) ─────
  function svcStatus(svc) {
    if (!svc) return 'offline';
    if (svc.status === 'online') return 'online';
    if (svc.status === 'degraded') return 'degraded';
    if (svc.installed === true) return 'online';
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

  // ── Node rows ──────────────────────────────────────────
  const nodeRows = nodes.map(n => {
    const domainTags = Array.isArray(n.knowledge_domains) && n.knowledge_domains.length > 0
      ? n.knowledge_domains.map(d => `<span class="cap-tag cap-green">${escHtml(d)}</span>`).join(' ')
      : '<span class="dim">—</span>';
    const hist = (n.metrics && n.metrics._history) || [];
    const cpuHist = hist.slice(-20).map(h => h.cpu_pct || 0);
    const cpuSpark = cpuHist.length >= 2 ? `<span class="spark">${sparkline(cpuHist, 20)}</span>` : '<span class="spark empty">────</span>';
    const tokHist = hist.slice(-20).map(h => h.tokens_per_sec || 0);
    const tokSpark = tokHist.length >= 2 ? `<span class="spark">${sparkline(tokHist, 20)}</span>` : '<span class="spark empty">────</span>';
    const nid = escHtml(n.node_id || 'unknown');
    return `<tr class="data-row" id="node-${nid}"><td>${statusDot(n.status)} <span class="node-id">${nid}</span>${n.hostname ? `<br><span class="dim sub">${escHtml(n.hostname)}</span>` : ''}</td><td>${escHtml(n.role || '—')}</td><td class="dim">${escHtml(n.profile || '—')}</td><td class="node-status">${statusDot(n.status)} ${escHtml(n.status)}</td><td class="dim sub">${n.ip ? escHtml(n.ip) : '—'}${n.connection_speed ? `<br><span class="c-cyan sub">${escHtml(n.connection_speed)}</span>` : ''}</td><td class="dim node-hb">${escHtml(n.age || n.last_heartbeat || 'never')}</td><td class="node-sparks">${cpuSpark}<br>${tokSpark}</td><td class="caps">${Array.isArray(n.capabilities) ? n.capabilities.map(c => `<span class="cap-tag">${escHtml(c)}</span>`).join(' ') : '—'}</td><td class="caps">${domainTags}</td></tr>`;
  });

  // ── Service tiles ──────────────────────────────────────
  const SVC_DEFS = [
    { key: 'queen',   label: 'QUEEN',   icon: '♛' },
    { key: 'ollama',  label: 'OLLAMA',  icon: '◈' },
    { key: 'nats',    label: 'NATS',    icon: '⟁' },
    { key: 'litellm', label: 'LITELLM', icon: '◭' },
    { key: 'ntfy',    label: 'NTFY',    icon: '▲' },
    { key: 'qmd',     label: 'QMD',     icon: '◇' },
    { key: 'docker',  label: 'DOCKER',  icon: '⬡' },
    { key: 'git',     label: 'GIT',     icon: '⬢' },
  ];
  const serviceTiles = SVC_DEFS.map(({ key, label, icon }) => {
    const svc = services[key];
    const st = svcStatus(svc);
    const dot = st === 'online' ? '●' : st === 'degraded' ? '◐' : '○';
    return `<div class="svc-tile svc-${st}"><div class="svc-hdr"><span class="svc-icon">${icon}</span> ${label}</div><div class="svc-dot">${dot}</div><div class="svc-sub">${escHtml(svcSubtext(key, svc))}</div></div>`;
  }).join('');

  // ── Approval rows ─────────────────────────────────────
  const pendingApprovalList = approvals.filter(a => a.status === 'pending');
  const approvalRows = pendingApprovalList.map((a, i) => {
    const id = escHtml(a.id);
    return `<tr class="data-row appr-row" id="appr-${id}"><td class="appr-num">${String(i + 1).padStart(2, '0')}</td><td class="appr-summary">${escHtml(a.summary || a.type || 'unknown')}<br><span class="dim appr-meta">TYPE:${escHtml(a.type || '?')} · SRC:${escHtml(a.source_agent || '?')} · ${escHtml(a.created_at ? new Date(a.created_at).toISOString().slice(11, 19) : '??:??:??')}</span></td><td class="appr-type">${escHtml(a.type || '—')}</td><td class="appr-actions"><button class="btn btn-approve" onclick="doApprove('${id}')">✓ APPROVE</button> <button class="btn btn-reject" onclick="doReject('${id}')">✗ REJECT</button> <button class="btn btn-view" onclick="doView('${id}')">⊞ VIEW</button></td></tr>`;
  });

  // ── Activity feed ─────────────────────────────────────
  function fmtActivityTime(ts) {
    try { return new Date(ts).toISOString().slice(11, 19); }
    catch { return '??:??:??'; }
  }
  function fmtActivityLine(evt) {
    const t = fmtActivityTime(evt.ts);
    const type = (evt.type || 'event').toUpperCase().padEnd(22, ' ');
    const desc = evt.summary || evt.message || evt.description || (evt.approval_id ? `[${evt.approval_id}]` : '') || JSON.stringify(evt).slice(0, 80);
    return `<div class="act-line"><span class="act-time">${t}</span> <span class="act-sep">░</span> <span class="act-type">${escHtml(type)}</span><span class="act-sep">──</span> <span class="act-desc">${escHtml(desc)}</span></div>`;
  }
  const activityLines = activity.length === 0
    ? '<div class="act-line empty-row">── AWAITING FIRST EVENT ──</div>'
    : activity.slice(0, 60).map(fmtActivityLine).join('');

  // ── Hive Topology ─────────────────────────────────────
  function renderTopology(nodeList) {
    const workers = nodeList.filter(n => n.role !== 'queen');
    if (workers.length === 0) return `<div class="topo-pre"><span class="topo-queen">♛ QUEEN</span>  <span class="topo-solo">(solo mode — add nodes with bootstrap.sh)</span></div>`;
    const q = '<span class="topo-queen">♛ QUEEN</span>';
    const pad = '        ';
    const nodeCol = n => {
      const on = n.status === 'online';
      return `<span class="${on ? 'topo-on' : 'topo-off'}">${on ? '◈' : '○'} ${escHtml(n.node_id)}${on ? '' : '(offline)'}</span>`;
    };
    const lines = [pad + q];
    if (workers.length === 1) { lines.push(`${pad}    │`, `${pad}    ${nodeCol(workers[0])}`); }
    else if (workers.length === 2) { lines.push(`${pad}   ╱ ╲`, `${pad}${nodeCol(workers[0])}   ${nodeCol(workers[1])}`); }
    else { lines.push(`${pad}  ╱  │  ╲`, workers.map(s => '  ' + nodeCol(s)).join('  ')); }
    return `<div class="topo-pre" id="topo-pre">${lines.join('\n')}</div>`;
  }

  // ── Metrics rows ──────────────────────────────────────
  function metricsRows() {
    const rows = nodes.map(n => {
      const m = n.metrics || {};
      const hasTelemetry = m.tokens_per_sec != null || m.cpu_pct != null || m.net_rx_mbps != null;
      if (!hasTelemetry && n.status === 'offline') return '';
      const tokC = (m.tokens_per_sec || 0) > 20 ? 'var(--green)' : (m.tokens_per_sec || 0) > 5 ? 'var(--amber)' : 'var(--muted)';
      const cpuC = (m.cpu_pct || 0) > 80 ? 'var(--red)' : (m.cpu_pct || 0) > 50 ? 'var(--amber)' : 'var(--green)';
      const gpuC = (m.gpu_util_pct || 0) > 80 ? 'var(--red)' : (m.gpu_util_pct || 0) > 50 ? 'var(--amber)' : 'var(--green)';
      const tC = t => !t ? 'var(--muted)' : t > 85 ? 'var(--red)' : t > 70 ? 'var(--amber)' : 'var(--green)';
      const history = m._history || [];
      const histVals = history.map(h => h.tokens_per_sec || 0);
      const sparkStr = sparkline(histVals, 20);
      const sparkCls = histVals.length < 2 ? 'spark empty' : 'spark';
      const contrib = n.config != null && n.config.contribution != null ? n.config.contribution : 100;
      const nid = escHtml(n.node_id || 'unknown');
      return `<tr class="data-row"><td>${statusDot(n.status)} ${nid}</td><td style="color:${tokC};font-weight:bold">${m.tokens_per_sec != null ? m.tokens_per_sec.toFixed(1) : '—'}</td><td><span class="${sparkCls}">${sparkStr}</span></td><td style="color:${cpuC}">${m.cpu_pct != null ? m.cpu_pct + '%' : '—'}</td><td class="dim">${m.ram_used_gb != null ? m.ram_used_gb.toFixed(1) + '/' + (m.ram_total_gb || '?') + 'G' : '—'}</td><td style="color:${gpuC}">${m.gpu_util_pct != null ? m.gpu_util_pct + '%' : '—'}</td><td class="dim">${m.gpu_vram_used_mb != null ? Math.round(m.gpu_vram_used_mb / 1024 * 10) / 10 + '/' + Math.round((m.gpu_vram_total_mb || 0) / 1024 * 10) / 10 + 'G' : '—'}</td><td class="dim">${m.net_rx_mbps != null ? m.net_rx_mbps.toFixed(1) + '/' + (m.net_tx_mbps || 0).toFixed(1) + ' Mb' : '—'}</td><td class="dim">${m.ping_ms != null ? m.ping_ms + 'ms' : m.queen_rtt_ms != null ? m.queen_rtt_ms + 'ms' : '—'}</td><td><span style="color:${tC(m.cpu_temp_c)}">${m.cpu_temp_c != null ? m.cpu_temp_c + '°' : '—'}</span>${m.gpu_temp_c != null ? '/<span style="color:' + tC(m.gpu_temp_c) + '">' + m.gpu_temp_c + '°</span>' : ''}</td><td class="model-cell" data-action="modelswap" data-node="${nid}" data-profile="${escHtml(n.profile || '')}" title="Click to swap model">${escHtml(m.active_model || '—')} <span class="dim">▾</span></td><td class="dial-cell"><div class="dial-wrap"><input type="range" class="dial" min="0" max="100" value="${contrib}" style="--dial-pct:${contrib}%" data-node="${nid}" oninput="updateDialPct(this)" onchange="patchContribution(this)"><span class="dial-pct" id="dial-pct-${nid}">${contrib}%</span></div></td></tr>`;
    }).filter(Boolean);
    if (rows.length === 0) return ['<tr><td colspan="12" class="empty-row">── AWAITING TELEMETRY ── heartbeat metrics not yet received</td></tr>'];
    return rows;
  }

  // ── Workflow rows ─────────────────────────────────────
  const wfRows = wfList.map(wf => `<tr class="data-row"><td class="c-cyan">${escHtml(wf.name)}</td><td class="dim">${wf.steps}</td><td class="dim">${escHtml(wf.trigger)}</td><td class="dim" style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${escHtml(wf.description)}</td><td><button class="btn btn-approve" onclick="runWorkflow('${escHtml(wf.name)}')">▶ RUN</button></td></tr>`);

  const runsHtml = runs.length > 0
    ? `<div style="margin-top:0.5rem;padding:0.5rem;border-top:1px solid var(--border)"><span class="c-amber sub ls1">ACTIVE RUNS</span>${runs.map(r => `<div class="sub dim" style="padding:2px 0"><span style="color:${r.status === 'running' ? 'var(--green)' : r.status === 'paused' ? 'var(--amber)' : 'var(--red)'}">●</span> ${escHtml(r.name)} — ${escHtml(r.status)} (${escHtml(r.id)})</div>`).join('')}</div>`
    : '';

  // ── Cluster section (conditional) ─────────────────────
  const clusterSection = clusterList.length === 0 ? '' : section(
    'CLUSTERS',
    `${clusterList.length} INFERENCE CLUSTER${clusterList.length !== 1 ? 'S' : ''} · RPC-WORKER SHARDS`,
    table(['CLUSTER', 'MEMBERS', 'RULE', 'NOTES', 'CREATED'],
      clusterList.map(c => `<tr class="data-row"><td class="c-cyan" style="font-weight:700">${escHtml(c.name)}</td><td class="caps">${(c.members || []).map(m => `<span class="cap-tag">${escHtml(m)}</span>`).join(' ')}</td><td class="dim">${escHtml(c.formation_rule || '—')}</td><td class="dim">${escHtml(c.notes || '—')}</td><td class="dim sub">${escHtml(c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : '—')}</td></tr>`),
      '')
  );

  // ── Security table ────────────────────────────────────
  const secRows = [
    `<tr><td style="width:200px">Queen API (:${port})</td><td class="c-green">● AUTHENTICATED</td><td class="dim">Bearer token required</td></tr>`,
    `<tr><td>LiteLLM (:4000)</td><td style="color:${services.litellm?.status === 'online' ? 'var(--amber)' : 'var(--muted)'}">● ${services.litellm?.status === 'online' ? 'SET LITELLM_MASTER_KEY' : 'OFFLINE'}</td><td class="dim">Set in .env</td></tr>`,
    `<tr><td>Drone endpoints (:9091)</td><td class="c-green">● AUTHENTICATED</td><td class="dim">Hive secret on all routes</td></tr>`,
    `<tr><td>NATS (:4222)</td><td class="c-cyan">● INTERNAL ONLY</td><td class="dim">Not exposed externally</td></tr>`,
    `<tr><td>ntfy (:2586)</td><td style="color:${services.ntfy?.status === 'online' ? 'var(--green)' : 'var(--muted)'}">● ${services.ntfy?.status === 'online' ? 'ONLINE' : 'OFFLINE'}</td><td class="dim">Push notifications</td></tr>`,
    `<tr><td>Dashboard</td><td class="c-green">● AUTHENTICATED</td><td class="dim">All API calls use Bearer token</td></tr>`,
    `<tr><td>Sandbox roots</td><td class="c-cyan">● ${sandboxRoots.length > 0 ? 'ACTIVE' : 'NONE'}</td><td class="dim sub">${sandboxRoots.length > 0 ? sandboxRoots.map(r => escHtml(r)).join(' · ') : 'no filesystem restrictions'}</td></tr>`,
    `<tr><td>Allowed domains</td><td class="c-cyan">● ${sandboxDomains.length > 0 ? 'FILTERED' : 'OPEN'}</td><td class="dim sub">${sandboxDomains.length > 0 ? sandboxDomains.map(d => escHtml(d)).join(' · ') : 'all domains permitted'}</td></tr>`,
    `<tr><td>NAS knowledge store</td><td id="nas-status-badge" style="color:var(--muted)">● ${nasMountPath ? 'CHECKING...' : 'NOT CONFIGURED'}</td><td id="nas-status-detail" class="dim sub">${nasMountPath ? escHtml(nasMountPath) : 'set NAS_MOUNT_PATH to enable shared hive knowledge'}</td></tr>`,
  ];

  // ── Render ────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30" id="meta-refresh">
<title>BORGCLAW//QUEEN v${escHtml(version)}</title>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--green:#00FF88;--cyan:#00CCFF;--red:#FF4444;--amber:#EAAB00;--void:#0A0A0A;--panel:#111;--border:#2A2A2A;--dimmer:#1A1A1A;--muted:#555;--grey:#888;--white:#CCC;--font:'JetBrains Mono','IBM Plex Mono','Fira Code','Cascadia Code','Courier New',monospace}
html,body{background:var(--void);color:var(--white);font-family:var(--font);font-size:13px;line-height:1.5;min-height:100vh;overflow-x:hidden;padding-bottom:2.5rem}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.055;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='52'%3E%3Cg stroke='%2300FF88' stroke-width='0.6' fill='none'%3E%3Cpolygon points='30,2 58,50 2,50'/%3E%3Cpolygon points='0,2 28,50 -28,50'/%3E%3Cpolygon points='60,2 88,50 32,50'/%3E%3Cpolygon points='30,52 58,4 2,4'/%3E%3C/g%3E%3C/svg%3E");background-repeat:repeat}
body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.04) 2px,rgba(0,0,0,.04) 4px)}
.page-wrap{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:0 1rem 2rem}
.box-chrome{color:var(--muted);display:block;letter-spacing:0;white-space:pre;overflow:hidden;line-height:1.2;font-size:12px}
.hdr-wrap{border-left:2px solid var(--green);border-right:2px solid var(--green);margin-top:1.5rem}
.hdr-inner{display:flex;align-items:flex-start;gap:1.5rem;padding:1rem 1.5rem .75rem;background:var(--panel);border-bottom:1px solid var(--border)}
.hdr-logo{color:var(--green);font-size:11px;line-height:1.3;white-space:pre;opacity:.9;flex-shrink:0}
.hdr-text{flex:1}
.hdr-title{color:var(--green);font-size:22px;font-weight:700;letter-spacing:3px;text-transform:uppercase}
.hdr-sub{color:var(--cyan);font-size:11px;letter-spacing:2px;margin-top:2px}
.hdr-tagline{color:var(--muted);font-size:10px;letter-spacing:1px;margin-top:4px}
.hdr-stats{background:var(--dimmer);border-top:1px solid var(--border);padding:.5rem 1.5rem;display:flex;align-items:center;flex-wrap:wrap}
.stat-item{display:flex;align-items:center;gap:.4rem;padding:0 1.2rem;font-size:12px;border-right:1px solid var(--border)}
.stat-item:first-child{padding-left:0}
.stat-item:last-child{border-right:none}
.stat-label{color:var(--grey)}
.stat-value{color:var(--green);font-weight:700}
.stat-value.warn{color:var(--amber)}
.stat-value.alert{color:var(--red)}
.section{margin-top:1.5rem}
.sh{background:var(--dimmer);border:1px solid var(--border);border-bottom:none;padding:.35rem .8rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.st{color:var(--cyan);font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase}
.st::before{content:'╠══ ';color:var(--muted)}
.st::after{content:' ══╣';color:var(--muted)}
.sb{font-size:10px;color:var(--grey);letter-spacing:1px}
.sbody{border:1px solid var(--border);background:var(--panel)}
table{width:100%;border-collapse:collapse}
thead tr{background:var(--dimmer);border-bottom:1px solid var(--border)}
th{color:var(--grey);font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:.5rem .75rem;text-align:left;border-right:1px solid var(--border);white-space:nowrap}
th:last-child{border-right:none}
td{padding:.5rem .75rem;border-bottom:1px solid var(--border);border-right:1px solid var(--border);vertical-align:top;font-size:12px}
td:last-child{border-right:none}
tr:last-child td{border-bottom:none}
.data-row:hover td{background:rgba(0,255,136,.03)}
.empty-row{color:var(--muted);font-size:11px;letter-spacing:1px;padding:1rem .75rem}
.dot-on{color:var(--green)}
.dot-off{color:var(--red)}
.dot-warn{color:var(--amber)}
.node-id{color:var(--cyan);font-weight:700}
.dim{color:var(--grey)}
.sub{font-size:10px}
.caps{font-size:11px}
.cap-tag{display:inline-block;background:rgba(0,204,255,.08);border:1px solid rgba(0,204,255,.25);color:var(--cyan);padding:0 4px;font-size:10px;margin:1px;letter-spacing:.5px}
.cap-green{border-color:rgba(0,255,136,.25);color:var(--green)}
.c-cyan{color:var(--cyan)}
.c-green{color:var(--green)}
.c-amber{color:var(--amber)}
.ls1{letter-spacing:1px}
.svc-grid{display:grid;grid-template-columns:repeat(4,1fr)}
@media(max-width:900px){.svc-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.svc-grid{grid-template-columns:1fr}}
.svc-tile{padding:.75rem 1rem;border-right:1px solid var(--border);border-bottom:1px solid var(--border)}
.svc-tile:nth-child(4n){border-right:none}
.svc-tile:nth-last-child(-n+4){border-bottom:none}
@media(max-width:900px){.svc-tile:nth-child(4n){border-right:1px solid var(--border)}.svc-tile:nth-child(2n){border-right:none}.svc-tile:nth-last-child(-n+4){border-bottom:1px solid var(--border)}.svc-tile:nth-last-child(-n+2){border-bottom:none}}
.svc-hdr{font-size:10px;letter-spacing:2px;font-weight:700;margin-bottom:.4rem;display:flex;align-items:center;gap:.4rem}
.svc-icon{font-size:12px}
.svc-dot{font-size:18px;line-height:1;margin-bottom:.25rem}
.svc-sub{font-size:10px;color:var(--grey);letter-spacing:.5px;word-break:break-all}
.svc-online .svc-hdr,.svc-online .svc-dot{color:var(--green)}
.svc-degraded .svc-hdr,.svc-degraded .svc-dot{color:var(--amber)}
.svc-offline .svc-hdr,.svc-offline .svc-dot{color:var(--muted)}
.appr-num{color:var(--muted);font-size:11px;width:2.5rem}
.appr-summary{color:var(--white)}
.appr-meta{font-size:10px;letter-spacing:.5px}
.appr-type{color:var(--cyan);font-size:11px;letter-spacing:1px;width:8rem}
.appr-actions{width:18rem;white-space:nowrap}
.appr-row.resolved td{opacity:.4}
.btn{font-family:var(--font);font-size:10px;font-weight:700;letter-spacing:1px;border:1px solid;background:transparent;padding:3px 8px;cursor:pointer;margin-right:4px;transition:background .1s,color .1s}
.btn-approve{color:var(--green);border-color:var(--green)}
.btn-approve:hover{background:var(--green);color:var(--void)}
.btn-reject{color:var(--red);border-color:var(--red)}
.btn-reject:hover{background:var(--red);color:var(--void)}
.btn-view{color:var(--grey);border-color:var(--muted)}
.btn-view:hover{background:var(--muted);color:var(--void)}
.btn:disabled{opacity:.35;cursor:not-allowed}
.act-feed{padding:.5rem 0;max-height:380px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
.act-feed::-webkit-scrollbar{width:4px}
.act-feed::-webkit-scrollbar-thumb{background:var(--border)}
.act-line{padding:2px .75rem;font-size:11px;line-height:1.6;border-bottom:1px solid rgba(42,42,42,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.act-line:last-child{border-bottom:none}
.act-line.act-new{animation:flash-in .4s ease-out}
.act-time{color:var(--cyan);font-size:10px}
.act-sep{color:var(--muted);margin:0 .3rem}
.act-type{color:var(--amber);font-size:10px;font-weight:700;letter-spacing:.5px}
.act-desc{color:var(--grey)}
@keyframes flash-in{from{background:rgba(0,255,136,.12);color:var(--green)}to{background:transparent}}
.footer-wrap{border-left:2px solid var(--green);border-right:2px solid var(--green);border-bottom:2px solid var(--green)}
.footer-inner{background:var(--dimmer);border-top:1px solid var(--border);padding:.4rem 1.5rem;display:flex;align-items:center;flex-wrap:wrap;font-size:10px;color:var(--grey);letter-spacing:.5px}
.footer-item{padding:0 1rem;border-right:1px solid var(--border)}
.footer-item:first-child{padding-left:0}
.footer-item:last-child{border-right:none}
.footer-link{color:var(--cyan);text-decoration:none}
.footer-link:hover{color:var(--green);text-decoration:underline}
.sse-indicator{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--muted);margin-right:4px;vertical-align:middle}
.sse-indicator.live{background:var(--green);box-shadow:0 0 4px var(--green)}
#sse-toast{position:fixed;top:1rem;right:1rem;background:var(--panel);border:1px solid var(--green);color:var(--green);font-size:10px;letter-spacing:1px;padding:.4rem .75rem;z-index:10000;display:none}
#sse-toast.show{display:block}
#modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:10001;display:none;align-items:center;justify-content:center}
#modal-overlay.show{display:flex}
#modal-box{background:var(--panel);border:2px solid var(--cyan);max-width:640px;width:90%;max-height:80vh;overflow-y:auto}
#modal-header{background:var(--dimmer);border-bottom:1px solid var(--border);padding:.5rem 1rem;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--cyan);letter-spacing:2px}
#modal-close{background:none;border:none;color:var(--red);cursor:pointer;font-family:var(--font);font-size:14px;padding:0 4px}
#modal-body{padding:1rem;font-size:12px;white-space:pre-wrap;color:var(--white)}
.queen-stats{padding:.75rem 1.5rem;display:grid;grid-template-columns:repeat(4,auto);gap:.3rem 2.5rem;align-items:center;justify-content:start;font-size:12px}
.qs-line{grid-column:1/-1;display:flex;align-items:center;gap:1.2rem;padding-bottom:.4rem;border-bottom:1px solid var(--border);margin-bottom:.3rem;font-size:12px}
.qs-label{color:var(--grey);letter-spacing:1px;font-size:11px;white-space:nowrap}
.qs-val{color:var(--green);font-weight:700;white-space:nowrap}
.qs-val.alert{color:var(--amber)}
.dial-cell{white-space:nowrap;min-width:130px}
.dial-wrap{display:flex;align-items:center;gap:6px}
.dial-pct{color:var(--green);font-size:10px;font-weight:700;min-width:32px;text-align:right}
input[type="range"].dial{-webkit-appearance:none;appearance:none;width:80px;height:3px;background:var(--border);outline:none;border:none;cursor:pointer;padding:0;margin:0}
input[type="range"].dial::-webkit-slider-runnable-track{height:3px;background:linear-gradient(to right,var(--green) 0%,var(--green) var(--dial-pct,100%),var(--border) var(--dial-pct,100%),var(--border) 100%);border:none}
input[type="range"].dial::-moz-range-track{height:3px;background:var(--border);border:none}
input[type="range"].dial::-moz-range-progress{height:3px;background:var(--green)}
input[type="range"].dial::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:9px;height:9px;background:var(--green);border:none;border-radius:0;cursor:pointer;margin-top:-3px}
input[type="range"].dial::-moz-range-thumb{width:9px;height:9px;background:var(--green);border:none;border-radius:0;cursor:pointer}
input[type="range"].dial:disabled{opacity:.3;cursor:not-allowed}
.spark{font-size:11px;letter-spacing:0;color:var(--amber);white-space:nowrap;font-family:var(--font)}
.spark.empty{color:var(--muted)}
.node-sparks{font-size:10px;white-space:nowrap;line-height:1.6}
.theme-borg{--green:#00FF88;--cyan:#00CCFF;--void:#0A0A0A;--panel:#111;--border:#2A2A2A;--dimmer:#1A1A1A;--amber:#EAAB00}
.theme-amber{--green:#fbbf24;--cyan:#f59e0b;--void:#0A0A0A;--panel:#111;--border:#2A2A2A;--dimmer:#1A1A1A;--amber:#fbbf24}
.theme-steel{--green:#00ccff;--cyan:#38bdf8;--void:#0A0A1A;--panel:#0d0d1e;--border:#1e2d3d;--dimmer:#0a0a18;--amber:#60a5fa}
.theme-select{background:var(--void);color:var(--green);border:1px solid var(--border);font:10px var(--font);padding:2px 4px;cursor:pointer;letter-spacing:1px}
.topo-pre{font-family:var(--font);font-size:11px;line-height:1.7;padding:1rem 1.5rem;color:var(--grey);white-space:pre;overflow-x:auto}
.topo-queen{color:var(--green);font-weight:700}
.topo-on{color:var(--green)}
.topo-off{color:var(--red)}
.topo-solo{color:var(--muted);font-style:italic}
.model-swap-list{padding:.5rem 0}
.model-swap-item{display:flex;align-items:center;justify-content:space-between;padding:.3rem 1rem;border-bottom:1px solid var(--border);font-size:11px;gap:1rem}
.model-swap-item:last-child{border-bottom:none}
.model-swap-name{color:var(--cyan);flex:1}
.model-swap-size{color:var(--muted);min-width:5rem;text-align:right}
.model-cell{cursor:pointer;color:var(--cyan);font-size:10px}
.model-cell:hover{color:var(--green);text-decoration:underline}
.snd-btn{font-family:var(--font);font-size:11px;background:none;border:none;cursor:pointer;color:var(--muted);padding:0;letter-spacing:1px}
.snd-btn.active{color:var(--green)}
.disk-body{padding:.75rem 1rem}
.disk-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;flex-wrap:wrap}
.disk-label{color:var(--grey);font-size:10px;letter-spacing:1px;white-space:nowrap;min-width:9rem}
.disk-input{flex:1;min-width:200px;background:var(--void);border:1px solid var(--border);color:var(--green);font-family:var(--font);font-size:12px;padding:4px 8px;outline:none}
.disk-input:focus{border-color:var(--green)}
.disk-progress{margin-top:.5rem;background:var(--void);border:1px solid var(--border);padding:.5rem .75rem;font-size:11px;color:var(--grey);min-height:2.5rem;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;display:none}
.disk-progress.visible{display:block}
.disk-progress.ok{color:var(--green);border-color:var(--green)}
.disk-progress.err{color:var(--red);border-color:var(--red)}
/* ── Collapsible sections ──────────────────────────── */
.sh{cursor:pointer;user-select:none}
.sh-ind{color:var(--muted);font-size:11px;margin-right:.4rem;font-weight:700;min-width:1.5ch;display:inline-block}
.section.collapsed .sbody{max-height:0;overflow:hidden;padding:0;border:none}
.section.collapsed .sh-ind::after{content:''}
/* ── Tab Bar ───────────────────────────────────────── */
.tab-bar{display:flex;gap:0;background:var(--dimmer);border:1px solid var(--border);position:sticky;top:0;z-index:100;margin-top:1rem;overflow-x:auto;scrollbar-width:none}
.tab-bar::-webkit-scrollbar{display:none}
.tab-btn{font-family:var(--font);font-size:10px;font-weight:700;letter-spacing:2px;color:var(--grey);background:transparent;border:none;border-bottom:2px solid transparent;padding:.5rem 1rem;cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s}
.tab-btn:hover{color:var(--cyan)}
.tab-btn.active{color:var(--green);border-bottom-color:var(--green)}
/* ── Two-Column Layout ─────────────────────────────── */
@media(min-width:1401px){
.page-wrap{max-width:1800px}
.grid-wrap{display:grid;grid-template-columns:1fr 1fr;gap:0 1.5rem}
.grid-col{min-width:0}
}
/* ── Fixed Status Bar ─────────────────────────────── */
#hive-status-bar{position:fixed;bottom:0;left:0;right:0;z-index:10000;background:var(--void);border-top:2px solid var(--green);padding:4px 1.5rem;font-family:var(--font);font-size:11px;letter-spacing:1px;color:var(--grey);display:flex;align-items:center;gap:1.5rem;white-space:nowrap}
#hive-status-bar .sb-live{color:var(--green)}
#hive-status-bar .sb-dead{color:var(--red)}
#hive-status-bar .sb-val{color:var(--green);font-weight:700}
#hive-status-bar .sb-clock{margin-left:auto;color:var(--cyan);font-weight:700}
</style>
</head>
<body>
<div class="page-wrap">
<span class="box-chrome">╔══════════════════════════════════════════════════════════════════════════════════════════╗</span>
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
<div class="stat-item"><span class="stat-label">UPTIME</span><span class="stat-value" id="stat-uptime">${escHtml(uptime)}</span></div>
<div class="stat-item"><span class="stat-label">NODES</span><span class="stat-value ${nodesOnline < nodesTotal ? 'warn' : ''}" id="stat-nodes-online">${nodesOnline}/${nodesTotal}</span></div>
<div class="stat-item"><span class="stat-label">APPROVALS</span><span class="stat-value ${pendingApprovals > 0 ? 'alert' : ''}" id="stat-approvals">${pendingApprovals}</span></div>
<div class="stat-item"><span class="stat-label">COST</span><span class="stat-value" id="cost-value" data-cost="0.00">$0.00</span></div>
<div class="stat-item" id="sse-stat"><span class="sse-indicator" id="sse-dot"></span><span class="stat-label" id="sse-label">STREAM</span><span class="stat-value" id="sse-value" style="color:var(--muted)">CONN…</span></div>
<div class="stat-item"><button class="snd-btn" id="snd-toggle" onclick="toggleSound()" title="Toggle chiptune sounds">♪ MUTE</button></div>
</div>
</div>
<span class="box-chrome">╚══════════════════════════════════════════════════════════════════════════════════════════╝</span>

<div class="tab-bar" id="tab-bar">
<button class="tab-btn active" data-tab="nodes">NODES</button>
<button class="tab-btn" data-tab="workflows">WORKFLOWS</button>
<button class="tab-btn" data-tab="approvals">APPROVALS</button>
<button class="tab-btn" data-tab="queen-chat">CHAT</button>
<button class="tab-btn" data-tab="security">SECURITY</button>
<button class="tab-btn" data-tab="services">TOOLS</button>
</div>

<div class="grid-wrap">
<div class="grid-col grid-left">
${section('QUEEN', 'HIVE COORDINATOR · THIS NODE', `<div class="queen-stats"><div class="qs-line"><span style="color:var(--green);font-size:14px">●</span><span style="color:var(--green);font-weight:700;letter-spacing:2px">ONLINE</span><span style="color:var(--grey);letter-spacing:1px">v${escHtml(version)}</span><span style="color:var(--cyan);letter-spacing:1px">UP: ${escHtml(uptime)}</span><span class="dim" style="font-size:11px;letter-spacing:.5px">SECRET: ${escHtml(hiveSecretPrefix || '(not set)')}${hiveSecretPrefix ? '...' : ''}</span></div><span class="qs-label">WORKFLOWS</span><span class="qs-val">${workflowsLoaded} loaded</span><span class="qs-label">RUNNING</span><span class="qs-val ${runningCount > 0 ? 'alert' : ''}">${runningCount} active</span><span class="qs-label">SCHEDULED</span><span class="qs-val">${(data.scheduledTasks || data.scheduled_tasks || []).length || '—'} tasks</span><span class="qs-label">APPROVALS</span><span class="qs-val ${pendingApprovals > 0 ? 'alert' : ''}">${pendingApprovals} pending</span></div>`)}

${section('NODES', 'REGISTERED WORKERS IN THE HIVE',
  tableWithId(['NODE', 'ROLE', 'PROFILE', 'STATUS', 'ADDRESS', 'LAST HB', 'CPU/TOK', 'CAPABILITIES', 'KNOWLEDGE'],
    nodeRows, '── NO NODES REGISTERED ── run bootstrap.sh on a machine to join the hive', 'nodes-tbody'))}

${section('TOPOLOGY', 'HIVE NETWORK MAP', `<div id="topology-panel">${renderTopology(nodes)}</div>`)}

${clusterSection}

${section('SERVICES', 'SUBSYSTEM HEALTH MATRIX', `<div class="svc-grid" id="svc-grid">${serviceTiles}</div>`)}

${section('TELEMETRY', 'NODE PERFORMANCE MATRIX',
  table(['NODE', 'TOK/S', 'TREND', 'CPU', 'RAM', 'GPU', 'VRAM', 'NET ↓/↑', 'LATENCY', 'TEMP', 'MODEL', 'DIAL'],
    metricsRows(), '── NO TELEMETRY ── nodes report metrics via heartbeat'))}

${section('ACTIONS', 'COMMAND CONSOLE',
  `<div style="display:flex;gap:8px;flex-wrap:wrap;padding:.75rem"><button class="btn btn-approve" onclick="refreshHealth()">⟳ REFRESH HEALTH</button><button class="btn btn-view" onclick="refreshApprovals()">⟳ RELOAD APPROVALS</button><button class="btn btn-view" onclick="fetchModels()">◈ LIST MODELS</button><button class="btn btn-view" onclick="scanAvailableModels()">◈ SCAN MODELS</button><button class="btn btn-view" onclick="showSearch()">◇ QMD SEARCH</button>${wfList.map(wf => `<button class="btn btn-approve" onclick="runWorkflow('${escHtml(wf.name)}')" title="${escHtml(wf.description)}">▶ ${escHtml(wf.name.toUpperCase())}</button>`).join('')}</div>`)}
</div>
<div class="grid-col grid-right">
${section('WORKFLOWS', `${workflowsLoaded} LOADED · ${runningCount} RUNNING`,
  table(['WORKFLOW', 'STEPS', 'TRIGGER', 'DESCRIPTION', 'ACTION'], wfRows, '── NO WORKFLOWS LOADED ── add YAML files to config/workflows/')
  + runsHtml)}

${section('APPROVALS', `LAW TWO ENFORCEMENT QUEUE · ${pendingApprovals} PENDING`,
  tableWithId(['#', 'ITEM', 'TYPE', 'ACTIONS'], approvalRows, '── QUEUE CLEAR ── no pending approvals', 'approvals-tbody'))}

${section('ACTIVITY', 'REAL-TIME EVENT STREAM · NEWEST FIRST',
  `<div class="act-feed" id="act-feed">${activityLines}</div>`)}
</div>
</div>

${section('QUEEN CHAT <a href="/chat" onclick="event.preventDefault();window.open(\'/chat\',\'borgclaw-chat\',\'width=500,height=600\')" style="color:var(--muted);font-size:10px;cursor:pointer;text-decoration:none;letter-spacing:1px" title="Pop out chat window">[POP OUT]</a>', 'NATURAL LANGUAGE GOVERNANCE · TALK TO THE HIVE',
  `<div id="chat-log" style="height:200px;overflow-y:auto;padding:.5rem;font-size:11px;border-bottom:1px solid var(--border)"><div class="dim">── QUEEN READY ── type a command or question below</div></div><div style="display:flex;border-top:1px solid var(--border)"><span style="padding:6px 8px;color:var(--green);font-size:12px">▶</span><input id="chat-input" type="text" placeholder="Talk to the Queen..." style="flex:1;background:transparent;border:none;color:var(--green);font:12px var(--font);padding:6px 8px;outline:none" onkeydown="if(event.key==='Enter')sendChat()"><button onclick="sendChat()" style="background:var(--green);color:var(--void);border:none;padding:6px 12px;font:11px var(--font);cursor:pointer">SEND</button></div>`)}

${section('CONNECT', 'SNAP YOUR AI INTO THE HIVE',
  `<div style="padding:.75rem;font-size:11px"><div class="dim" style="margin-bottom:8px">── Point any AI app at these URLs ──</div><table><tr><td class="c-cyan" style="width:180px">OpenAI-compatible</td><td><code class="c-green">OPENAI_BASE_URL=http://${queenHost}:4000</code></td></tr><tr><td class="c-cyan">Anthropic-compatible</td><td><code class="c-green">ANTHROPIC_BASE_URL=http://${queenHost}:4000</code></td></tr><tr><td class="c-cyan">Ollama-native</td><td><code class="c-green">OLLAMA_HOST=http://${queenHost}:11434</code></td></tr><tr><td class="c-cyan">Queen API</td><td><code class="c-green">http://${queenHost}:${port}</code></td></tr></table><div class="dim" style="margin-top:8px">Works with: OpenClaw · NanoClaw · DeerFlow · Cursor · Aider · Continue · CrewAI · LangChain · any OpenAI SDK</div></div>`)}

${section('SECURITY', 'HIVE DOORS · AUTH STATUS',
  `<div style="padding:.75rem;font-size:11px"><table>${secRows.join('')}</table><div style="margin-top:8px"><button class="btn btn-reject" onclick="if(confirm('HALT THE HIVE?')){authFetch('/api/hive/halt',{method:'POST'}).then(function(){this.textContent='HALTED'}.bind(this))}">⚠ HALT HIVE</button> <button class="btn btn-approve" onclick="authFetch('/api/hive/resume',{method:'POST'}).then(function(){this.textContent='RESUMED'}.bind(this))">▶ RESUME HIVE</button></div></div>`)}

${section('MAKE DISK', 'ASSIMILATE NEW DRONES · WRITE THE CLAW TO USB',
  `<div class="disk-body"><div class="dim sub ls1" style="margin-bottom:.6rem">── Insert USB drive, enter mount path, click CREATE DRONE ──</div><div class="disk-row"><span class="disk-label">▸ DRIVE PATH</span><input id="makedisk-path" class="disk-input" type="text" value="/Volumes/" placeholder="/Volumes/MYUSB" spellcheck="false" autocomplete="off"><button class="btn btn-approve" id="makedisk-btn" data-action="makedisk">◈ CREATE DRONE</button></div><div id="makedisk-progress" class="disk-progress"></div></div>`)}

<div class="footer-wrap"><div class="footer-inner">
<span class="footer-item">AUTO-REFRESH 30s</span>
<span class="footer-item"><a class="footer-link" href="/api/status">/api/status</a></span>
<span class="footer-item"><a class="footer-link" href="/api/nodes">/api/nodes</a></span>
<span class="footer-item"><a class="footer-link" href="/api/health">/api/health</a></span>
<span class="footer-item">v${escHtml(version)}</span>
<span class="footer-item"><select class="theme-select" id="theme-sel" onchange="setTheme(this.value)"><option value="borg">BORG</option><option value="amber">AMBER</option><option value="steel">BLUE STEEL</option></select></span>
<span class="footer-item" style="margin-left:auto;border-right:none">BORGCLAW//QUEEN · ${new Date().toISOString().slice(0, 10)}</span>
</div></div>
</div>
<div id="sse-toast"></div>
<div id="modal-overlay"><div id="modal-box"><div id="modal-header"><span>╠══ APPROVAL DETAIL ══╣</span><button id="modal-close" onclick="closeModal()">✕ CLOSE</button></div><div id="modal-body"></div></div></div>

<script>
// ── Theme Selector ───────────────────────────────────────
function setTheme(t){document.body.className=document.body.className.replace(/theme-\\S+/g,'').trim()+' theme-'+t;try{localStorage.setItem('bc-theme',t)}catch(e){};var s=document.getElementById('theme-sel');if(s)s.value=t}
(function(){var t;try{t=localStorage.getItem('bc-theme')}catch(e){}if(t&&['borg','amber','steel'].indexOf(t)!==-1)setTheme(t);else setTheme('borg')})();
window.setTheme=setTheme;
// ════════════════════════════════════════════════════════
// BorgClaw Queen Dashboard — Client JS (main IIFE)
// Vanilla only. No frameworks. Every byte earned.
// ════════════════════════════════════════════════════════
(function(){
'use strict';

// ── Auth ────────────────────────────────────────────────
function getCookieValue(name){
  var cookies=document.cookie.split('; ');
  for(var i=0;i<cookies.length;i++){var p=cookies[i].split('=');if(p[0]===name)return decodeURIComponent(p.slice(1).join('='))}
  return'';
}
var HIVE_SECRET=getCookieValue('bc_api_token');
function authFetch(url,opts){
  opts=opts||{};opts.headers=opts.headers||{};
  if(HIVE_SECRET)opts.headers['Authorization']='Bearer '+HIVE_SECRET;
  if(!opts.headers['Content-Type']&&opts.method&&opts.method!=='GET')opts.headers['Content-Type']='application/json';
  return fetch(url,opts);
}
window.authFetch=authFetch;

// ── Shared helpers ──────────────────────────────────────
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtTime(ts){try{return new Date(ts).toISOString().slice(11,19)}catch(e){return '??:??:??'}}
function formatSeconds(s){s=parseInt(s,10);if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m';return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'}
function svcStatus(svc){if(!svc)return'offline';if(svc.status==='online')return'online';if(svc.status==='degraded')return'degraded';if(svc.installed===true)return'online';return'offline'}
function svcSubtext(key,svc){if(!svc)return'NO SIGNAL';if(key==='ollama'&&svc.models&&svc.models.length>0)return svc.models.slice(0,2).join(' / ')+(svc.models.length>2?' +'+(svc.models.length-2):'');if(svc.version)return String(svc.version).slice(0,20);if(svc.uptime_seconds!=null)return'UP '+formatSeconds(svc.uptime_seconds);if(svc.status==='online')return'NOMINAL';if(svc.installed===true)return'INSTALLED';return'NO SIGNAL'}

// ── SSE Connection ──────────────────────────────────────
var sseDot=document.getElementById('sse-dot');
var sseValue=document.getElementById('sse-value');
var sseToast=document.getElementById('sse-toast');
var toastTimer=null;

function showToast(msg,ms){sseToast.textContent=msg;sseToast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(function(){sseToast.classList.remove('show')},ms||3000)}

function setSseStatus(status){
  if(status==='live'){sseDot.classList.add('live');sseValue.style.color='var(--green)';sseValue.textContent='LIVE';var mr=document.getElementById('meta-refresh');if(mr)mr.setAttribute('content','300')}
  else if(status==='error'){sseDot.classList.remove('live');sseValue.style.color='var(--red)';sseValue.textContent='DEAD'}
  else{sseDot.classList.remove('live');sseValue.style.color='var(--amber)';sseValue.textContent='CONN…'}
}

var sseRetryDelay=2000,sseMaxRetry=30000,sseSource=null;
function connectSSE(){
  if(sseSource){try{sseSource.close()}catch(e){}}
  setSseStatus('connecting');
  try{
    // Session cookie (bc_session) is sent automatically on same-origin requests.
    // No token query parameter needed — and doing so would expose it to logs.
    sseSource=new EventSource('/api/events');
    sseSource.onopen=function(){setSseStatus('live');sseRetryDelay=2000;showToast('▲ SSE STREAM CONNECTED',2000)};
    sseSource.onmessage=function(e){var evt;try{evt=JSON.parse(e.data)}catch(err){return}handleSSEEvent(evt)};
    sseSource.onerror=function(){setSseStatus('error');sseSource.close();sseSource=null;showToast('▼ SSE LOST — RETRYING IN '+Math.round(sseRetryDelay/1000)+'s',sseRetryDelay);setTimeout(connectSSE,sseRetryDelay);sseRetryDelay=Math.min(sseRetryDelay*2,sseMaxRetry)};
  }catch(err){setSseStatus('error')}
}

// ── SSE Event Dispatch ──────────────────────────────────
function handleSSEEvent(evt){
  if(!evt||!evt.type)return;
  prependActivity(evt);soundForEvent(evt);accumulateCost(evt);
  switch(evt.type){
    case'node_registered':case'node_heartbeat':case'node_offline':refreshNodes();break;
    case'health_update':if(evt.services)updateServices(evt.services);break;
    case'approval_created':refreshApprovals();updatePendingBadge(1);showToast('▲ NEW APPROVAL REQUEST: '+(evt.summary||evt.approval_id||''),4000);break;
    case'approval_approved':resolveApprovalRow(evt.approval_id,'approved');updatePendingBadge(-1);break;
    case'approval_rejected':resolveApprovalRow(evt.approval_id,'rejected');updatePendingBadge(-1);break;
    case'workflow_started':case'workflow_completed':updateWorkflowBadge(evt);break;
    case'queen_started':var ue=document.getElementById('stat-uptime');if(ue)ue.textContent='0s';break;
  }
}

// ── Workflow badge ────────────────────────────────────────
function updateWorkflowBadge(evt){var bs=document.querySelectorAll('.sb');bs.forEach(function(b){if(b.textContent.indexOf('RUNNING')!==-1){var m=b.textContent.match(/(\d+) LOADED/),loaded=m?m[1]:'?',rm=b.textContent.match(/(\d+) RUNNING/),cur=rm?parseInt(rm[1],10):0;if(evt.type==='workflow_started')b.textContent=loaded+' LOADED \xb7 '+(cur+1)+' RUNNING';if(evt.type==='workflow_completed')b.textContent=loaded+' LOADED \xb7 '+Math.max(0,cur-1)+' RUNNING'}})}
function updateStatusBar(d){if(window._updateStatusBar)window._updateStatusBar(d)}

// ── Activity Feed ───────────────────────────────────────
var actFeed=document.getElementById('act-feed');
function fmtActLine(evt){
  var t=fmtTime(evt.ts),type=(evt.type||'event').toUpperCase();
  var desc=evt.summary||evt.message||evt.description||(evt.approval_id?'['+evt.approval_id+']':'')||'';
  return'<div class="act-line act-new"><span class="act-time">'+escHtml(t)+'</span> <span class="act-sep">░</span> <span class="act-type">'+escHtml(type)+'</span><span class="act-sep">──</span> <span class="act-desc">'+escHtml(desc)+'</span></div>';
}
function prependActivity(evt){
  if(!actFeed)return;var empty=actFeed.querySelector('.empty-row');if(empty)empty.remove();
  actFeed.insertAdjacentHTML('afterbegin',fmtActLine(evt));
  var lines=actFeed.querySelectorAll('.act-line');for(var i=60;i<lines.length;i++)lines[i].remove();
}

// ── Node refresh ────────────────────────────────────────
var refreshNodesTimer=null;
function refreshNodes(){
  clearTimeout(refreshNodesTimer);
  refreshNodesTimer=setTimeout(function(){
    authFetch('/api/status').then(function(r){return r.json()}).then(function(data){
      if(!data||!data.nodes)return;
      rebuildNodesTable(data.nodes);rebuildTopology(data.nodes);
      var online=data.nodes.filter(function(n){return n.status==='online'}).length;
      var el=document.getElementById('stat-nodes-online');
      if(el){el.textContent=online+'/'+data.nodes.length;el.className='stat-value'+(online<data.nodes.length?' warn':'')}
      updateStatusBar({drones:online+'/'+data.nodes.length,approvals:pendingCount})
    }).catch(function(){});
  },300);
}

function dotHtml(status){
  if(status==='online')return'<span class="dot-on">●</span>';
  if(status==='offline')return'<span class="dot-off">○</span>';
  return'<span class="dot-warn">◐</span>';
}

function rebuildNodesTable(nodeList){
  var tbody=document.getElementById('nodes-tbody');if(!tbody)return;
  if(!nodeList||nodeList.length===0){tbody.innerHTML='<tr><td colspan="9" class="empty-row">── NO NODES REGISTERED ──</td></tr>';return}
  var bk='\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
  function miniSpark(arr){if(!arr||arr.length<2)return'<span class="spark empty">\u2500\u2500\u2500\u2500</span>';var mn=Math.min.apply(null,arr),mx=Math.max.apply(null,arr),rng=mx-mn||1,s='';for(var i=0;i<arr.length;i++)s+=bk[Math.round(((arr[i]-mn)/rng)*7)];return'<span class="spark">'+s+'</span>'}
  tbody.innerHTML=nodeList.map(function(n){
    var caps=Array.isArray(n.capabilities)?n.capabilities.map(function(c){return'<span class="cap-tag">'+escHtml(c)+'</span>'}).join(' '):'—';
    var hb=n.last_heartbeat?(n.seconds_since_heartbeat!=null?n.seconds_since_heartbeat+'s ago':n.last_heartbeat):'never';
    var h=(n.metrics&&n.metrics._history)||[];var ch=h.slice(-20).map(function(x){return x.cpu_pct||0});var th=h.slice(-20).map(function(x){return x.tokens_per_sec||0});
    return'<tr class="data-row" id="node-'+escHtml(n.node_id||'unknown')+'"><td>'+dotHtml(n.status)+' <span class="node-id">'+escHtml(n.node_id||'unknown')+'</span></td><td>'+escHtml(n.role||'—')+'</td><td class="dim">'+escHtml(n.profile||'—')+'</td><td class="node-status">'+dotHtml(n.status)+' '+escHtml(n.status)+'</td><td class="dim">'+escHtml(n.ip||'—')+'</td><td class="dim node-hb">'+escHtml(hb)+'</td><td class="node-sparks">'+miniSpark(ch)+'<br>'+miniSpark(th)+'</td><td class="caps">'+caps+'</td><td class="dim">\u2014</td></tr>';
  }).join('');
}

// ── Topology ────────────────────────────────────────────
function nodeLabel(n){var on=n.status==='online';return'<span class="'+(on?'topo-on':'topo-off')+'">'+(on?'◈':'○')+' '+escHtml(n.node_id||'?')+(on?'':'(offline)')+'</span>'}
function rebuildTopology(nodeList){
  var panel=document.getElementById('topology-panel');if(!panel||!nodeList)return;
  var workers=nodeList.filter(function(n){return n.role!=='queen'});
  if(workers.length===0){panel.innerHTML='<div class="topo-pre"><span class="topo-queen">♛ QUEEN</span>  <span class="topo-solo">(solo mode)</span></div>';return}
  var q='<span class="topo-queen">♛ QUEEN</span>',pad='        ',lines=[pad+q];
  if(workers.length===1){lines.push(pad+'    │');lines.push(pad+'    '+nodeLabel(workers[0]))}
  else if(workers.length===2){lines.push(pad+'   ╱ ╲');lines.push(pad+nodeLabel(workers[0])+'   '+nodeLabel(workers[1]))}
  else{lines.push(pad+'  ╱  │  ╲');lines.push(workers.map(function(n){return'  '+nodeLabel(n)}).join('  '))}
  panel.innerHTML='<div class="topo-pre">'+lines.join('<br>')+'</div>';
}

// ── Service tiles update ────────────────────────────────
var SVC_DEFS=[{key:'queen',label:'QUEEN',icon:'♛'},{key:'ollama',label:'OLLAMA',icon:'◈'},{key:'nats',label:'NATS',icon:'⟁'},{key:'litellm',label:'LITELLM',icon:'◭'},{key:'ntfy',label:'NTFY',icon:'▲'},{key:'qmd',label:'QMD',icon:'◇'},{key:'docker',label:'DOCKER',icon:'⬡'},{key:'git',label:'GIT',icon:'⬢'}];
function updateServices(services){
  var grid=document.getElementById('svc-grid');if(!grid||!services)return;
  grid.innerHTML=SVC_DEFS.map(function(d){
    var svc=services[d.key]||null,st=svcStatus(svc);
    return'<div class="svc-tile svc-'+st+'"><div class="svc-hdr"><span class="svc-icon">'+d.icon+'</span> '+d.label+'</div><div class="svc-dot">'+(st==='online'?'●':st==='degraded'?'◐':'○')+'</div><div class="svc-sub">'+escHtml(svcSubtext(d.key,svc))+'</div></div>';
  }).join('');
}

// ── Approvals ───────────────────────────────────────────
var pendingCount=${pendingApprovals};
function updatePendingBadge(delta){
  pendingCount=Math.max(0,pendingCount+delta);
  document.querySelectorAll('.sb').forEach(function(b){if(b.textContent.indexOf('PENDING')!==-1)b.textContent='LAW TWO ENFORCEMENT QUEUE · '+pendingCount+' PENDING'});
  var stat=document.getElementById('stat-approvals');
  if(stat){stat.textContent=pendingCount;stat.className='stat-value'+(pendingCount>0?' alert':'')}
  updateStatusBar({approvals:pendingCount})
}
function resolveApprovalRow(id,resolution){
  var row=document.getElementById('appr-'+id);if(!row)return;
  row.classList.add('resolved');
  var ac=row.querySelector('.appr-actions');
  if(ac){var c=resolution==='approved'?'var(--green)':'var(--red)';ac.innerHTML='<span style="color:'+c+';font-size:11px;letter-spacing:1px">'+(resolution==='approved'?'✓ APPROVED':'✗ REJECTED')+'</span>'}
  setTimeout(function(){if(row.parentNode)row.parentNode.removeChild(row);var tb=document.getElementById('approvals-tbody');if(tb&&tb.children.length===0)tb.innerHTML='<tr><td colspan="4" class="empty-row">── QUEUE CLEAR ──</td></tr>'},1500);
}
function refreshApprovals(){
  authFetch('/api/approvals').then(function(r){return r.json()}).then(function(data){
    if(!Array.isArray(data))return;
    var pending=data.filter(function(a){return a.status==='pending'}),tbody=document.getElementById('approvals-tbody');if(!tbody)return;
    if(pending.length===0){tbody.innerHTML='<tr><td colspan="4" class="empty-row">── QUEUE CLEAR ──</td></tr>';return}
    tbody.innerHTML=pending.map(function(a,i){
      var id=escHtml(a.id);
      return'<tr class="data-row appr-row" id="appr-'+id+'"><td class="appr-num">'+String(i+1).padStart(2,'0')+'</td><td class="appr-summary">'+escHtml(a.summary||a.type||'unknown')+'<br><span class="dim appr-meta">TYPE:'+escHtml(a.type||'?')+' · SRC:'+escHtml(a.source_agent||'?')+'</span></td><td class="appr-type">'+escHtml(a.type||'—')+'</td><td class="appr-actions"><button class="btn btn-approve" data-action="approve" data-id="'+id+'">✓ APPROVE</button> <button class="btn btn-reject" data-action="reject" data-id="'+id+'">✗ REJECT</button> <button class="btn btn-view" data-action="view" data-id="'+id+'">⊞ VIEW</button></td></tr>';
    }).join('');
  }).catch(function(){});
}
window.refreshApprovals=refreshApprovals;

// ── Approval actions ────────────────────────────────────
function approvalAction(id,action,label){
  var row=document.getElementById('appr-'+id);
  if(row){row.querySelectorAll('.btn').forEach(function(b){b.disabled=true})}
  authFetch('/api/approvals/'+encodeURIComponent(id)+'/'+action,{method:'POST'})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(){resolveApprovalRow(id,action==='approve'?'approved':'rejected');updatePendingBadge(-1);showToast((action==='approve'?'✓ APPROVED: ':'✗ REJECTED: ')+id,2500)})
    .catch(function(err){showToast('✗ '+label+' FAILED: '+err.message,4000);if(row)row.querySelectorAll('.btn').forEach(function(b){b.disabled=false})});
}
window.doApprove=function(id){approvalAction(id,'approve','APPROVE')};
window.doReject=function(id){approvalAction(id,'reject','REJECT')};
window.doView=function(id){
  authFetch('/api/approvals/'+encodeURIComponent(id)).then(function(r){return r.json()}).then(function(data){
    document.getElementById('modal-body').textContent=JSON.stringify(data,null,2);
    document.getElementById('modal-overlay').classList.add('show');
  }).catch(function(err){showToast('VIEW FAILED: '+err.message,3000)});
};
window.closeModal=function(){document.getElementById('modal-overlay').classList.remove('show')};
document.getElementById('modal-overlay').addEventListener('click',function(e){if(e.target===this)closeModal()});

// ── Interactive actions ─────────────────────────────────
window.runWorkflow=function(name){
  showToast('▶ EXECUTING: '+name+'...',2000);
  authFetch('/api/workflows/'+encodeURIComponent(name)+'/execute',{method:'POST',body:JSON.stringify({context:{}})})
    .then(function(r){return r.json()})
    .then(function(d){showToast(d.run_id?'▶ STARTED: '+name+' (run: '+d.run_id+')':'✗ FAILED: '+(d.error||'unknown'),3000)})
    .catch(function(err){showToast('✗ ERROR: '+err.message,4000)});
};
window.refreshHealth=function(){
  showToast('⟳ PROBING SERVICES...',1500);
  authFetch('/api/actions/refresh-health',{method:'POST'}).then(function(r){return r.json()})
    .then(function(d){updateServices(d);showToast('⟳ HEALTH: '+(d.overall||'unknown').toUpperCase(),2500)})
    .catch(function(err){showToast('✗ HEALTH CHECK FAILED: '+err.message,4000)});
};
window.fetchModels=function(){
  authFetch('/api/models').then(function(r){return r.json()}).then(function(data){
    var body=document.getElementById('modal-body');
    if(data.models&&data.models.length>0){body.textContent='SOURCE: '+data.source+'\\n\\n'+data.models.map(function(m){return'  '+(m.name||m)+(m.size?' ('+Math.round(m.size/1e9*10)/10+'GB)':'')}).join('\\n')}
    else{body.textContent='No models loaded.\\nSource: '+(data.source||'none')+'\\nError: '+(data.error||'Ollama not running')}
    document.getElementById('modal-overlay').classList.add('show');
  }).catch(function(err){showToast('✗ MODEL LIST FAILED: '+err.message,3000)});
};
window.showSearch=function(){
  var q=prompt('QMD Search Query:');if(!q)return;showToast('◇ SEARCHING: '+q,1500);
  authFetch('/api/search',{method:'POST',body:JSON.stringify({query:q,limit:5})})
    .then(function(r){return r.json()})
    .then(function(d){document.getElementById('modal-body').textContent=d.results||d.error||'No results';document.getElementById('modal-overlay').classList.add('show')})
    .catch(function(err){showToast('✗ SEARCH FAILED: '+err.message,3000)});
};

// ── Chiptune Sound System ───────────────────────────────
var audioCtx=null,muted=localStorage.getItem('borgclaw_mute')!=='false';
function initSndBtn(){var btn=document.getElementById('snd-toggle');if(!btn)return;btn.textContent=muted?'♪ MUTE':'♪ SND';btn.classList.toggle('active',!muted)}
function playTone(freq,dur,vol,type){
  if(muted)return;if(!window.AudioContext&&!window.webkitAudioContext)return;
  try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();var o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type||'sine';o.frequency.value=freq;g.gain.value=vol||.05;g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur)}catch(e){}
}
function playSeq(tones){tones.forEach(function(t){setTimeout(function(){playTone(t[0],t[1],t[2],t[3])},(t[4]||0)*1000)})}
function soundForEvent(evt){
  switch(evt.type){
    case'approval_created':playSeq([[600,.05,.08,'sine',0],[900,.05,.08,'sine',.05]]);break;
    case'approval_approved':playSeq([[400,.05,.08,'sine',0],[600,.05,.08,'sine',.05],[800,.05,.08,'sine',.10]]);break;
    case'approval_rejected':playSeq([[600,.05,.06,'sine',0],[300,.05,.06,'sine',.05]]);break;
    case'node_offline':playTone(200,.2,.06,'sine');break;
    default:playTone(800,.03,.05,'sine');break;
  }
}
window.toggleSound=function(){muted=!muted;localStorage.setItem('borgclaw_mute',muted?'true':'false');initSndBtn();if(!muted)playTone(800,.03,.05,'sine')};

// ── Contribution Dial ───────────────────────────────────
window.updateDialPct=function(input){var v=parseInt(input.value,10),nid=input.getAttribute('data-node'),lbl=document.getElementById('dial-pct-'+nid);if(lbl)lbl.textContent=v+'%';input.style.setProperty('--dial-pct',v+'%')};
window.patchContribution=function(input){
  var v=parseInt(input.value,10),nid=input.getAttribute('data-node');input.disabled=true;
  authFetch('/api/nodes/'+encodeURIComponent(nid),{method:'PATCH',body:JSON.stringify({contribution:v})})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(){showToast('◈ CONTRIBUTION SET: '+nid+' → '+v+'%',2500)})
    .catch(function(err){showToast('✗ DIAL PATCH FAILED: '+err.message,4000)})
    .finally(function(){input.disabled=false});
};

// ── Model Swap UI ───────────────────────────────────────
window.openModelSwap=function(nodeId,profile){
  var overlay=document.getElementById('modal-overlay'),hdr=document.getElementById('modal-header').querySelector('span'),body=document.getElementById('modal-body');
  if(!overlay||!body)return;hdr.textContent='╠══ MODEL SWAP ── '+nodeId+' ══╣';
  body.innerHTML='<div class="dim" style="padding:.5rem">Loading available models…</div>';overlay.classList.add('show');
  authFetch('/api/config/models'+(profile?'?profile='+encodeURIComponent(profile):''))
    .then(function(r){return r.json()})
    .then(function(data){
      var models=data.models||data||[];
      if(!Array.isArray(models)||models.length===0){body.innerHTML='<div class="dim" style="padding:.5rem">── No models available ──</div>';return}
      body.innerHTML='<div class="model-swap-list">'+models.map(function(m){
        var name=m.name||m,size=m.size?(Math.round(m.size/1e9*10)/10)+' GB':'';
        return'<div class="model-swap-item"><span class="model-swap-name">'+escHtml(name)+'</span><span class="model-swap-size">'+escHtml(size)+'</span><button class="btn btn-view" data-action="pull" data-model="'+escHtml(name)+'" data-node="'+escHtml(nodeId)+'">PULL</button></div>';
      }).join('')+'</div>';
    }).catch(function(err){body.innerHTML='<div style="color:var(--red);padding:.5rem">✗ Failed: '+escHtml(err.message)+'</div>'});
};
window.pullModel=function(modelName,nodeId){
  showToast('◈ PULLING: '+modelName+'…',3000);
  authFetch('/api/models/pull',{method:'POST',body:JSON.stringify({model:modelName,node_id:nodeId})})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(){showToast('✓ PULL STARTED: '+modelName,3000);closeModal()})
    .catch(function(err){showToast('✗ PULL FAILED: '+err.message,4000)});
};

// ── Cost tracker ────────────────────────────────────────
var costAccumulator=0.0;
function accumulateCost(evt){
  if(evt.type!=='workflow_step_complete')return;
  var provider=(evt.provider||evt.result&&evt.result.provider||'').toLowerCase();
  if(!['litellm','anthropic','openai'].some(function(p){return provider.indexOf(p)!==-1}))return;
  var tokens=evt.tokens_used||evt.result&&evt.result.tokens_used||0;
  costAccumulator+=tokens>0?tokens*0.000002:0.001;
  var el=document.getElementById('cost-value');if(el){el.textContent='$'+costAccumulator.toFixed(2);el.setAttribute('data-cost',costAccumulator.toFixed(2))}
}

// ── Queen Chat ──────────────────────────────────────────
window.sendChat=function(){
  var inp=document.getElementById('chat-input'),log=document.getElementById('chat-log'),msg=inp.value.trim();if(!msg)return;
  inp.value='';inp.disabled=true;
  log.innerHTML+='<div style="color:var(--cyan);margin-top:4px">▶ '+escHtml(msg)+'</div><div class="dim">Queen is thinking...</div>';
  log.scrollTop=log.scrollHeight;
  authFetch('/api/chat',{method:'POST',body:JSON.stringify({message:msg})})
    .then(function(r){return r.json()})
    .then(function(d){
      var last=log.querySelector('div:last-child');if(last&&last.textContent.includes('thinking'))last.remove();
      log.innerHTML+='<div style="color:var(--green);margin-top:2px">♛ '+escHtml(d.response||d.error||'No response')+'</div>';
      if(d.actions_taken&&d.actions_taken.length>0){d.actions_taken.forEach(function(a){log.innerHTML+='<div style="color:var(--amber);font-size:10px">  > '+escHtml(a.cmd)+' '+JSON.stringify(a.params)+'</div>'});refreshNodes()}
      log.scrollTop=log.scrollHeight;inp.disabled=false;inp.focus();
    }).catch(function(err){
      var last=log.querySelector('div:last-child');if(last&&last.textContent.includes('thinking'))last.remove();
      log.innerHTML+='<div style="color:var(--red)">✗ '+escHtml(err.message)+'</div>';log.scrollTop=log.scrollHeight;inp.disabled=false;inp.focus();
    });
};

// ── Event Delegation ────────────────────────────────────
document.addEventListener('click',function(e){
  var btn=e.target.closest('[data-action]');if(!btn)return;
  var action=btn.getAttribute('data-action'),id=btn.getAttribute('data-id'),node=btn.getAttribute('data-node'),model=btn.getAttribute('data-model'),profile=btn.getAttribute('data-profile');
  switch(action){
    case'approve':doApprove(id);break;case'reject':doReject(id);break;case'view':doView(id);break;
    case'pull':pullModel(model,node);break;case'modelswap':openModelSwap(node,profile);break;
  }
});

// ── Init ────────────────────────────────────────────────
initSndBtn();connectSSE();
})();
</script>

<script>
// ════════════════════════════════════════════════════════
// Standalone block — survives main IIFE parse errors.
// Make Disk + Model Scan + NAS Status + fallback chat.
// ════════════════════════════════════════════════════════
(function(){
'use strict';
var SECRET=(document.cookie.match(/(?:^|; )bc_api_token=([^;]*)/)||[])[1];
if(SECRET)SECRET=decodeURIComponent(SECRET);else SECRET='';
function authHdr(extra){var h={'Content-Type':'application/json'};if(SECRET)h['Authorization']='Bearer '+SECRET;return Object.assign(h,extra||{})}
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function showModal(title,html){var o=document.getElementById('modal-overlay'),h=o&&o.querySelector('#modal-header span'),b=document.getElementById('modal-body');if(!o||!b)return;if(h)h.textContent=title;b.innerHTML=html;o.classList.add('show')}

// ── Fallback event delegation (if main IIFE failed) ─────
if(!window.doApprove){
  document.addEventListener('click',function(e){
    var btn=e.target.closest('[data-action]');if(!btn)return;
    var a=btn.getAttribute('data-action'),id=btn.getAttribute('data-id'),nd=btn.getAttribute('data-node'),md=btn.getAttribute('data-model'),pr=btn.getAttribute('data-profile');
    if(a==='approve')fetch('/api/approvals/'+id+'/approve',{method:'POST',headers:authHdr()}).then(function(){btn.closest('tr').style.opacity='0.3'});
    if(a==='reject')fetch('/api/approvals/'+id+'/reject',{method:'POST',headers:authHdr()}).then(function(){btn.closest('tr').style.opacity='0.3'});
    if(a==='view')fetch('/api/approvals/'+id,{headers:authHdr()}).then(function(r){return r.json()}).then(function(d){alert(JSON.stringify(d,null,2))});
    if(a==='pull'){btn.textContent='PULLING...';fetch('/api/models/pull',{method:'POST',headers:authHdr(),body:JSON.stringify({model:md,node_id:nd})}).then(function(){btn.textContent='DONE'}).catch(function(){btn.textContent='FAILED'})}
    if(a==='modelswap')fetch('/api/config/models'+(pr?'?profile='+pr:''),{headers:authHdr()}).then(function(r){return r.json()}).then(function(d){alert('Available models:\\n'+JSON.stringify(d.models||d,null,2))});
    if(a==='makedisk'&&window.makeDisk)makeDisk();
  });
}

// ── Fallback chat (if main IIFE failed) ─────────────────
if(!window.sendChat){
  window.sendChat=function(){
    var inp=document.getElementById('chat-input'),log=document.getElementById('chat-log'),msg=inp.value.trim();if(!msg)return;
    inp.value='';inp.disabled=true;
    log.innerHTML+='<div style="color:#0cf;margin-top:4px">'+msg.replace(/</g,'&lt;')+'</div><div style="color:#888">Queen is thinking...</div>';
    log.scrollTop=log.scrollHeight;
    fetch('/api/chat',{method:'POST',headers:authHdr(),body:JSON.stringify({message:msg})})
      .then(function(r){return r.json()}).then(function(d){
        var els=log.querySelectorAll('div'),last=els[els.length-1];if(last&&last.textContent.includes('thinking'))last.remove();
        log.innerHTML+='<div style="color:#0f8;margin-top:2px">'+((d.response||d.error||'').replace(/</g,'&lt;'))+'</div>';
        if(d.actions_taken)d.actions_taken.forEach(function(a){log.innerHTML+='<div style="color:#fa0;font-size:10px">  > '+a.cmd+' '+JSON.stringify(a.params)+'</div>'});
        log.scrollTop=log.scrollHeight;inp.disabled=false;inp.focus();
      }).catch(function(e){log.innerHTML+='<div style="color:#f44">Error: '+e.message+'</div>';inp.disabled=false;inp.focus()});
  };
}

// ── Make Disk ───────────────────────────────────────────
function setProgress(msg,state){var el=document.getElementById('makedisk-progress');if(!el)return;el.textContent=msg;el.className='disk-progress visible'+(state?' '+state:'')}
function setBtnState(loading){var btn=document.getElementById('makedisk-btn');if(!btn)return;btn.disabled=loading;btn.textContent=loading?'◈ WRITING…':'◈ CREATE DRONE'}
window.makeDisk=function(){
  var pathEl=document.getElementById('makedisk-path');if(!pathEl)return;var tp=(pathEl.value||'').trim();
  if(!tp){setProgress('ERROR: Enter a drive path first','err');return}
  if(!tp.startsWith('/')){setProgress('ERROR: Path must be absolute','err');return}
  if(!confirm('Write BorgClaw to '+tp+'?\nCompiles the-claw, caches Ollama, bakes in hive secret.\nContinue?'))return;
  setBtnState(true);setProgress('▸ INITIATING ASSIMILATION SEQUENCE…\n▸ This may take 2-5 minutes.\n▸ Stand by.','');
  fetch('/api/hive/make-disk',{method:'POST',headers:authHdr(),body:JSON.stringify({target_path:tp})})
    .then(function(r){return r.json()}).then(function(d){
      setBtnState(false);
      if(d.ok){setProgress('✓ DISK READY — '+d.path+(d.size_mb!=null?'\n▸ SIZE: '+d.size_mb+' MB':'')+(d.output?'\n\n── OUTPUT ──\n'+d.output:''),'ok')}
      else{setProgress('✗ FAILED: '+(d.error||'Unknown'),'err')}
    }).catch(function(e){setBtnState(false);setProgress('✗ REQUEST FAILED: '+e.message,'err')});
};

// ── Scan Available Models ───────────────────────────────
if(!window.scanAvailableModels){
  window.scanAvailableModels=function(){
    showModal('╠══ SCANNING MODEL LEADERBOARD… ══╣','<div class="dim" style="padding:.5rem">◈ Probing Ollama library — this may take 10-20s…</div>');
    fetch('/api/models/available',{headers:authHdr()}).then(function(r){return r.json()}).then(function(data){
      var c=data.candidates||[];
      if(c.length===0){showModal('╠══ MODEL LEADERBOARD ══╣','<div class="dim" style="padding:.75rem">── No candidates found ──</div>');return}
      var rows=c.map(function(m){
        var tier=escH(m.tier||'—'),name=escH(m.name||m.model||'?'),size=m.size_gb?m.size_gb.toFixed(1)+' GB':'—',pulls=m.pull_count!=null?Number(m.pull_count).toLocaleString():'—';
        var tc=tier==='nano'?'var(--green)':tier==='edge'?'var(--cyan)':tier==='worker'?'var(--amber)':'var(--grey)';
        return'<div class="model-swap-item"><span class="model-swap-name">'+name+'</span><span style="color:'+tc+';font-size:10px;min-width:4rem;text-align:right">'+tier+'</span><span class="model-swap-size">'+escH(size)+'</span><span style="color:var(--muted);font-size:10px;min-width:5rem;text-align:right">▼ '+escH(pulls)+'</span><button class="btn btn-view" data-action="pull" data-model="'+name+'" data-node="">PULL</button></div>';
      }).join('');
      var hdr='<div style="color:var(--grey);font-size:10px;padding:.4rem 1rem;border-bottom:1px solid var(--border)">SCANNED '+escH(data.scanned_at?new Date(data.scanned_at).toISOString().slice(11,19):'?')+' · '+c.length+' CANDIDATES</div>';
      showModal('╠══ MODEL LEADERBOARD ══╣',hdr+'<div class="model-swap-list">'+rows+'</div>');
    }).catch(function(e){showModal('╠══ MODEL LEADERBOARD ══╣','<div style="color:var(--red);padding:.75rem">✗ Scan failed: '+escH(e.message)+'</div>')});
  };
}

// ── NAS Status ──────────────────────────────────────────
var nasBadge=document.getElementById('nas-status-badge'),nasDetail=document.getElementById('nas-status-detail');
if(nasBadge&&nasDetail){
  fetch('/api/nas/status',{headers:SECRET?{'Authorization':'Bearer '+SECRET}:{}})
    .then(function(r){return r.json()}).then(function(d){
      if(!d.configured){nasBadge.style.color='var(--muted)';nasBadge.textContent='● NOT CONFIGURED';nasDetail.textContent='set NAS_MOUNT_PATH to enable shared hive knowledge'}
      else if(d.accessible){nasBadge.style.color='var(--green)';nasBadge.textContent='● MOUNTED';nasDetail.textContent=d.path||''}
      else{nasBadge.style.color='var(--amber)';nasBadge.textContent='● NOT MOUNTED';nasDetail.textContent=(d.path||'')+(d.message?'  ('+d.message+')':'')}
    }).catch(function(){});
}

// ── GUI Phase 1: Collapsible Sections + Tab Bar ─────
document.querySelectorAll('.sh[data-toggle]').forEach(function(hdr){
  hdr.addEventListener('click',function(e){
    if(e.target.closest('a,button,input'))return;
    var sec=hdr.closest('.section');if(!sec)return;
    var sid=hdr.getAttribute('data-toggle'),collapsed=sec.classList.toggle('collapsed');
    var ind=hdr.querySelector('.sh-ind');if(ind)ind.textContent=collapsed?'[+]':'[-]';
    try{localStorage.setItem('borgclaw_collapsed_'+sid,collapsed?'1':'0')}catch(x){}
  });
});
document.querySelectorAll('.section[data-section]').forEach(function(sec){
  var sid=sec.getAttribute('data-section');
  try{if(localStorage.getItem('borgclaw_collapsed_'+sid)==='1'){sec.classList.add('collapsed');var ind=sec.querySelector('.sh-ind');if(ind)ind.textContent='[+]'}}catch(x){}
});
var tabBar=document.getElementById('tab-bar');
if(tabBar){
  tabBar.addEventListener('click',function(e){
    var btn=e.target.closest('.tab-btn');if(!btn)return;
    var target=btn.getAttribute('data-tab');
    tabBar.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active')});btn.classList.add('active');
    var sec=document.querySelector('[data-section="'+target+'"]');
    if(sec){if(sec.classList.contains('collapsed')){sec.classList.remove('collapsed');var ind=sec.querySelector('.sh-ind');if(ind)ind.textContent='[-]';try{localStorage.setItem('borgclaw_collapsed_'+target,'0')}catch(x){}}sec.scrollIntoView({behavior:'smooth',block:'start'})}
  });
  var tabSids=['nodes','workflows','approvals','queen-chat','security','services'],sTimer=null;
  window.addEventListener('scroll',function(){clearTimeout(sTimer);sTimer=setTimeout(function(){
    var best=null,bd=Infinity;tabSids.forEach(function(sid){var el=document.querySelector('[data-section="'+sid+'"]');if(!el)return;var d=Math.abs(el.getBoundingClientRect().top-60);if(d<bd){bd=d;best=sid}});
    if(best)tabBar.querySelectorAll('.tab-btn').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab')===best)});
  },80)},{passive:true});
}
})();
</script>

<div id="hive-status-bar">
<span>QUEEN v${escHtml(version)}</span>
<span><span id="sb-drones" class="sb-val">${nodesOnline}/${nodesTotal}</span> DRONES</span>
<span><span id="sb-approvals" class="sb-val">${pendingApprovals}</span> APPROVALS</span>
<span>SSE: <span id="sb-sse" class="sb-dead">[DOWN]</span></span>
<span class="sb-clock" id="sb-clock">--:--:--</span>
</div>

<script>
// ── Status Bar — fixed bottom bar, updates via SSE bridge ──
(function(){
'use strict';
var sse=document.getElementById('sb-sse'),clk=document.getElementById('sb-clock');
var dr=document.getElementById('sb-drones'),ap=document.getElementById('sb-approvals');
// Clock: tick every second
setInterval(function(){var d=new Date();clk.textContent=d.toTimeString().slice(0,8)},1000);
clk.textContent=new Date().toTimeString().slice(0,8);
// SSE status: hook into main IIFE's setSseStatus via MutationObserver on #sse-value
var sseVal=document.getElementById('sse-value');
if(sseVal){new MutationObserver(function(){
  var t=sseVal.textContent;
  if(t==='LIVE'){sse.textContent='[LIVE]';sse.className='sb-live'}
  else if(t==='DEAD'){sse.textContent='[DOWN]';sse.className='sb-dead'}
  else{sse.textContent='[CONN]';sse.className=''}
}).observe(sseVal,{childList:true,characterData:true,subtree:true})}
// Bridge: main IIFE calls updateStatusBar({drones,approvals})
window._updateStatusBar=function(d){
  if(d.drones!=null&&dr)dr.textContent=d.drones;
  if(d.approvals!=null&&ap)ap.textContent=d.approvals;
};
})();
</script>
</body>
</html>`;
}
