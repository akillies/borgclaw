// ════════════════════════════════════════════════════════
// BorgClaw Queen Dashboard — Client JS
// Vanilla only. No frameworks. Every byte earned.
// ════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Auth — wrap all API calls with hive secret ────────
  var HIVE_SECRET = 'a717926b33b7ceb53210527a8b0ec823f80d39e95862fa5abced9274ed64ab45';
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
  var pendingCount = 0;

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
            body.textContent = 'SOURCE: ' + data.source + '\\n\\n' + data.models.map(function (m) {
              return '  ' + (m.name || m) + (m.size ? ' (' + Math.round(m.size / 1e9 * 10) / 10 + 'GB)' : '');
            }).join('\\n');
          } else {
            body.textContent = 'No models loaded.\\n\\nSource: ' + (data.source || 'none') + '\\nError: ' + (data.error || 'Ollama not running');
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