// BorgClaw QA Test Suite
// Runs all 16 test cases against Queen at localhost:9090

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';

const SECRET = 'a717926b33b7ceb53210527a8b0ec823f80d39e95862fa5abced9274ed64ab45';
const QUEEN = 'http://localhost:9090';
const AUTH = { 'Authorization': `Bearer ${SECRET}`, 'Content-Type': 'application/json' };

const results = [];

function pass(test, detail) {
  results.push({ test, status: 'PASS', detail });
  console.log(`[PASS] ${test}`);
  if (detail) console.log(`       ${JSON.stringify(detail).slice(0, 200)}`);
}

function fail(test, detail) {
  results.push({ test, status: 'FAIL', detail });
  console.log(`[FAIL] ${test}`);
  console.log(`       ${JSON.stringify(detail).slice(0, 400)}`);
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers });
  let body;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) body = await r.json();
  else body = await r.text();
  return { status: r.status, body };
}

async function post(url, data, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
  let body;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) body = await r.json();
  else body = await r.text();
  return { status: r.status, body };
}

// ============================================================
// TEST 1: Queen status API (no auth on root)
// ============================================================
async function test1_queen_root() {
  const name = 'Test 1: Queen status API GET /';
  try {
    const { status, body } = await get(`${QUEEN}/`);
    if (status !== 200) return fail(name, { status, body });
    if (body.service !== 'borgclaw-queen') return fail(name, { reason: 'missing service field', body });
    if (typeof body.version !== 'string') return fail(name, { reason: 'missing version', body });
    if (typeof body.nodes_registered !== 'number') return fail(name, { reason: 'missing nodes_registered', body });
    pass(name, { version: body.version, nodes_registered: body.nodes_registered, nodes_online: body.nodes_online, uptime_seconds: body.uptime_seconds });
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 2: Queen chat
// ============================================================
async function test2_queen_chat() {
  const name = 'Test 2: Queen chat POST /api/chat';
  try {
    const { status, body } = await post(`${QUEEN}/api/chat`, { message: 'How many drones are online?' }, AUTH);
    if (status !== 200) return fail(name, { status, body });
    if (!body.response) return fail(name, { reason: 'no response field', body });
    pass(name, {
      response_preview: body.response.slice(0, 120),
      actions_taken: body.actions_taken?.length || 0,
    });
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 3: Dashboard renders
// ============================================================
async function test3_dashboard() {
  const name = 'Test 3: Dashboard renders GET /dashboard';
  try {
    const { status, body } = await get(`${QUEEN}/dashboard`);
    if (status !== 200) return fail(name, { status, body: String(body).slice(0, 200) });
    const html = String(body);
    if (!html.includes('<html') && !html.includes('<!DOCTYPE')) return fail(name, { reason: 'not HTML', preview: html.slice(0, 200) });

    const checks = {
      has_borgclaw: html.includes('borgclaw') || html.includes('BorgClaw') || html.includes('BORGCLAW'),
      has_nodes: html.includes('node') || html.includes('NODE') || html.includes('Node'),
      has_queen: html.includes('Queen') || html.includes('QUEEN') || html.includes('queen'),
      is_html: html.toLowerCase().includes('<html'),
      char_count: html.length,
      has_status_panel: html.includes('status') || html.includes('Status') || html.includes('uptime'),
      has_connect_panel: html.includes('connect') || html.includes('Connect') || html.includes('drone') || html.includes('Drone'),
    };

    if (!checks.has_borgclaw || !checks.is_html) {
      return fail(name, { reason: 'missing key content', checks });
    }
    pass(name, checks);
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 4: Dashboard JS syntax
// ============================================================
async function test4_dashboard_js_syntax() {
  const name = 'Test 4: Dashboard JS syntax check';
  try {
    const { status, body } = await get(`${QUEEN}/dashboard`);
    const html = String(body);

    const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    if (scriptMatches.length === 0) {
      return pass(name, { detail: 'No inline script blocks found in dashboard HTML' });
    }

    let allOk = true;
    const errors = [];
    const scriptDir = '/Users/adminster/akos/db/ak-os/projects/borgclaw';
    for (const [i, match] of scriptMatches.entries()) {
      const code = match[1].trim();
      if (!code) continue;
      const tmpPath = `${scriptDir}/qa-script-check-${i}.js`;
      writeFileSync(tmpPath, code);
      const result = await new Promise((resolve) => {
        const proc = spawn('node', ['--check', tmpPath]);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => resolve({ code, stderr }));
        proc.on('error', err => resolve({ code: -1, stderr: err.message }));
      });
      // Cleanup temp file
      try { require('fs').unlinkSync(tmpPath); } catch {}
      if (result.code !== 0) {
        allOk = false;
        errors.push({ script_index: i, error: result.stderr.slice(0, 200) });
      }
    }

    if (allOk) {
      pass(name, { scripts_checked: scriptMatches.length, all_valid: true });
    } else {
      fail(name, { scripts_checked: scriptMatches.length, errors });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 5: MCP filesystem — read a file
// ============================================================
async function test5_mcp_filesystem() {
  const name = 'Test 5: MCP filesystem read_file';
  try {
    // Create test file in borgclaw dir (writable)
    const testPath = '/Users/adminster/akos/db/ak-os/projects/borgclaw/qa-mcp-test.txt';
    writeFileSync(testPath, 'hello from borgclaw');

    const { status, body } = await post(`${QUEEN}/api/mcp/invoke`, {
      server: 'filesystem',
      tool: 'read_file',
      args: { path: testPath },
    }, AUTH);

    if (status !== 200) return fail(name, { status, body });
    if (!body.ok) return fail(name, { reason: 'ok=false', error: body.error, body });

    const resultStr = JSON.stringify(body.result);
    if (!resultStr.includes('hello from borgclaw') && !resultStr.includes('borgclaw')) {
      return fail(name, { reason: 'file content not found in result', result: body.result, elapsed_ms: body.elapsed_ms });
    }
    pass(name, { elapsed_ms: body.elapsed_ms, result_preview: resultStr.slice(0, 150) });
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 6: MCP fetch — get a URL
// ============================================================
async function test6_mcp_fetch() {
  const name = 'Test 6: MCP fetch GET https://example.com';
  try {
    const { status, body } = await post(`${QUEEN}/api/mcp/invoke`, {
      server: 'fetch',
      tool: 'fetch',
      args: { url: 'https://example.com' },
    }, AUTH);

    if (status !== 200) return fail(name, { status, body });
    if (!body.ok) return fail(name, { reason: 'ok=false', error: body.error, elapsed_ms: body.elapsed_ms });

    const resultStr = JSON.stringify(body.result);
    if (!resultStr.includes('example') && !resultStr.includes('Example')) {
      return fail(name, { reason: 'expected content not in result', result_preview: resultStr.slice(0, 200) });
    }
    pass(name, { elapsed_ms: body.elapsed_ms, result_preview: resultStr.slice(0, 150) });
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 7: Auth enforcement
// ============================================================
async function test7_auth_enforcement() {
  const name = 'Test 7: Auth enforcement';
  try {
    // 7a: No auth → 401
    const r1 = await post(`${QUEEN}/api/chat`, { message: 'test' });
    const got401 = r1.status === 401;
    if (!got401) {
      fail(`${name} (no auth -> 401)`, { status: r1.status, body: r1.body });
    } else {
      pass(`${name} (no auth -> 401)`, { status: r1.status });
    }

    // 7b: Wrong token → 403
    const r2 = await post(`${QUEEN}/api/chat`, { message: 'test' }, {
      'Authorization': 'Bearer wrongtoken123',
    });
    const got403 = r2.status === 403;
    if (!got403) {
      fail(`${name} (wrong token -> 403)`, { status: r2.status, body: r2.body });
    } else {
      pass(`${name} (wrong token -> 403)`, { status: r2.status });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 8: Hive halt/resume
// ============================================================
async function test8_halt_resume() {
  const name = 'Test 8: Hive halt/resume';
  try {
    const haltRes = await post(`${QUEEN}/api/hive/halt`, {}, AUTH);
    if (haltRes.status !== 200 || !haltRes.body.halted) {
      fail(`${name} (halt)`, { status: haltRes.status, body: haltRes.body });
    } else {
      pass(`${name} (halt)`, { halted: haltRes.body.halted, nodes: haltRes.body.nodes });
    }

    const resumeRes = await post(`${QUEEN}/api/hive/resume`, {}, AUTH);
    if (resumeRes.status !== 200 || !resumeRes.body.resumed) {
      fail(`${name} (resume)`, { status: resumeRes.status, body: resumeRes.body });
    } else {
      pass(`${name} (resume)`, { resumed: resumeRes.body.resumed });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 9: Workflow list — 7 workflows including autoresearch
// ============================================================
async function test9_workflow_list() {
  const name = 'Test 9: Workflow list GET /api/workflows';
  try {
    const { status, body } = await get(`${QUEEN}/api/workflows`, AUTH);
    if (status !== 200) return fail(name, { status, body });
    if (!Array.isArray(body)) return fail(name, { reason: 'not an array', body });

    const names = body.map(w => w.name);
    const hasAutoresearch = names.some(n => n.includes('autoresearch') || n.includes('auto-research') || n.includes('auto_research'));
    const count = body.length;

    if (count < 7) {
      fail(name, { reason: `Expected 7+ workflows, got ${count}`, workflows: names });
    } else if (!hasAutoresearch) {
      fail(name, { reason: 'autoresearch workflow not found', workflows: names, count });
    } else {
      pass(name, { count, workflows: names, has_autoresearch: hasAutoresearch });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 10: Scheduled tasks — check via /api/status workflow count
// ============================================================
async function test10_scheduled_tasks() {
  const name = 'Test 10: Scheduled tasks loaded (7 expected)';
  try {
    const { status, body } = await get(`${QUEEN}/api/status`, AUTH);
    if (status !== 200) return fail(name, { status, body });
    const wfCount = body.workflows_loaded;
    if (wfCount >= 7) {
      pass(name, { workflows_loaded: wfCount });
    } else {
      fail(name, { reason: `Expected 7+ workflows/tasks, found ${wfCount}`, body });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 11: Node persistence
// ============================================================
async function test11_node_persistence() {
  const name = 'Test 11: Node persistence GET /api/nodes';
  try {
    const { status, body } = await get(`${QUEEN}/api/nodes`, AUTH);
    if (status !== 200) return fail(name, { status, body });
    if (!Array.isArray(body)) return fail(name, { reason: 'not an array', body });

    const queenNode = body.find(n => n.node_id === 'queen' || n.role === 'queen');
    if (!queenNode) {
      fail(name, { reason: 'Queen self-node not found', nodes: body });
    } else {
      pass(name, {
        total_nodes: body.length,
        nodes: body.map(n => ({ id: n.node_id, role: n.role, status: n.status })),
      });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 12: borgclaw connect CLI
// ============================================================
async function test12_borgclaw_connect() {
  const name = 'Test 12: borgclaw connect CLI';
  const borgclawPath = '/Users/adminster/akos/db/ak-os/projects/borgclaw/borgclaw';

  try {
    const result = await new Promise((resolve) => {
      const proc = spawn(borgclawPath, ['connect'], { timeout: 10000 });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', d => { stdout += d.toString(); });
      proc.stderr?.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => resolve({ code, stdout, stderr, output: stdout + stderr }));
      proc.on('error', err => resolve({ code: -1, stdout: '', stderr: err.message, output: err.message }));
    });

    const output = result.output;
    const hasLiteLLM = output.toLowerCase().includes('litellm') || output.toLowerCase().includes('lite');
    const hasOllama = output.toLowerCase().includes('ollama');
    const hasQueen = output.toLowerCase().includes('queen') || output.toLowerCase().includes('9090');

    if (!hasOllama && !hasQueen && !hasLiteLLM) {
      fail(name, { reason: 'missing expected URLs in connect output', output: output.slice(0, 400), exit_code: result.code });
    } else {
      pass(name, { has_litellm: hasLiteLLM, has_ollama: hasOllama, has_queen: hasQueen, preview: output.slice(0, 300) });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 13: borgclaw CLI status and nodes
// ============================================================
async function test13_borgclaw_cli() {
  const name = 'Test 13: borgclaw CLI commands';
  const borgclawPath = '/Users/adminster/akos/db/ak-os/projects/borgclaw/borgclaw';

  async function runCmd(args) {
    return new Promise((resolve) => {
      const proc = spawn(borgclawPath, args, { timeout: 10000 });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', d => { stdout += d.toString(); });
      proc.stderr?.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => resolve({ code, stdout, stderr, output: stdout + stderr }));
      proc.on('error', err => resolve({ code: -1, output: err.message }));
    });
  }

  try {
    const statusResult = await runCmd(['status']);
    const statusOk = statusResult.code === 0 ||
      statusResult.output.toLowerCase().includes('queen') ||
      statusResult.output.toLowerCase().includes('online') ||
      statusResult.output.toLowerCase().includes('node');

    if (statusOk) {
      pass(`${name} (./borgclaw status)`, { exit_code: statusResult.code, preview: statusResult.output.slice(0, 200) });
    } else {
      fail(`${name} (./borgclaw status)`, { exit_code: statusResult.code, output: statusResult.output.slice(0, 300) });
    }

    const nodesResult = await runCmd(['nodes']);
    const nodesOk = nodesResult.code === 0 ||
      nodesResult.output.toLowerCase().includes('node') ||
      nodesResult.output.toLowerCase().includes('queen') ||
      nodesResult.output.toLowerCase().includes('drone');

    if (nodesOk) {
      pass(`${name} (./borgclaw nodes)`, { exit_code: nodesResult.code, preview: nodesResult.output.slice(0, 200) });
    } else {
      fail(`${name} (./borgclaw nodes)`, { exit_code: nodesResult.code, output: nodesResult.output.slice(0, 300) });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 14: Drone heartbeat (via API simulation)
// ============================================================
async function test14_drone_heartbeat() {
  const name = 'Test 14: Drone register + heartbeat (API sim)';
  try {
    const regRes = await post(`${QUEEN}/api/nodes/register`, {
      node_id: 'qa-test-drone-0001',
      config: {
        role: 'drone',
        profile: 'mac-arm',
        addr: ':9099',
        capabilities: ['llm_inference'],
        models: ['phi4-mini'],
      },
    }, AUTH);

    if (regRes.status !== 200 || !regRes.body.ok) {
      return fail(name, { reason: 'registration failed', status: regRes.status, body: regRes.body });
    }

    const hbRes = await post(`${QUEEN}/api/nodes/qa-test-drone-0001/heartbeat`, {
      config: { role: 'drone', addr: ':9099' },
      models: ['phi4-mini'],
      addr: ':9099',
      sent_at: new Date().toISOString(),
      metrics: { cpu_pct: 12.5, ram_used_gb: 4.2, ram_total_gb: 16 },
    }, AUTH);

    if (hbRes.status !== 200 || !hbRes.body.ok) {
      return fail(name, { reason: 'heartbeat failed', status: hbRes.status, body: hbRes.body });
    }

    const nodesRes = await get(`${QUEEN}/api/nodes`, AUTH);
    const droneNode = nodesRes.body.find(n => n.node_id === 'qa-test-drone-0001');
    if (!droneNode) {
      return fail(name, { reason: 'drone not in node list after registration+heartbeat' });
    }

    pass(name, {
      registered: true,
      heartbeat_ok: true,
      node_status: droneNode.status,
      note: 'API simulation — live binary test requires running drone process',
    });
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// TEST 15: Drone chat (localhost:9091)
// ============================================================
async function test15_drone_chat() {
  const name = 'Test 15: Drone chat POST http://localhost:9091/chat';
  try {
    const r = await fetch('http://localhost:9091/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
      body: JSON.stringify({ message: 'what are you?' }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await r.json();
    if (r.status === 200 && body.response) {
      pass(name, { status: r.status, response_preview: body.response.slice(0, 120) });
    } else {
      fail(name, { reason: 'unexpected response', status: r.status, body });
    }
  } catch (err) {
    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed') || err.name === 'TimeoutError') {
      fail(name, {
        reason: 'Drone not running on :9091 — no live binary started for this test run',
        error: err.message,
      });
    } else {
      fail(name, { error: err.message });
    }
  }
}

// ============================================================
// TEST 16: Execute a workflow
// ============================================================
async function test16_workflow_execute() {
  const name = 'Test 16: Execute workflow morning-briefing';
  try {
    const listRes = await get(`${QUEEN}/api/workflows`, AUTH);
    const wfList = Array.isArray(listRes.body) ? listRes.body : [];
    const briefing = wfList.find(w => w.name === 'morning-briefing' || w.name.includes('morning'));

    if (!briefing) {
      const availableNames = wfList.map(w => w.name);
      return fail(name, { reason: 'morning-briefing workflow not found', available: availableNames });
    }

    const execRes = await post(`${QUEEN}/api/workflows/${briefing.name}/execute`, {}, AUTH);
    if (execRes.status !== 202) {
      return fail(name, { reason: `Expected 202 Accepted, got ${execRes.status}`, body: execRes.body });
    }

    const runId = execRes.body.run_id;
    if (!runId) return fail(name, { reason: 'no run_id in response', body: execRes.body });

    // Poll up to 90s for completion
    let finalStatus = null;
    let finalResults = null;
    for (let i = 0; i < 18; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const runRes = await get(`${QUEEN}/api/workflows/runs/${runId}`, AUTH);
      if (runRes.status !== 200) break;
      const run = runRes.body;
      if (run.status !== 'running') {
        finalStatus = run.status;
        finalResults = run.results;
        break;
      }
      console.log(`       [polling] ${runId} running... ${(i+1)*5}s`);
    }

    if (!finalStatus) {
      fail(name, { reason: 'workflow still running after 90s or poll failed', run_id: runId });
    } else if (finalStatus === 'completed') {
      const resultsStr = JSON.stringify(finalResults || {});
      const isStub = resultsStr.includes('[STUB]');
      pass(name, {
        run_id: runId,
        status: finalStatus,
        is_stub: isStub,
        provider: isStub ? 'stub (no LLM provider available)' : 'real LLM',
        results_preview: resultsStr.slice(0, 300),
      });
    } else {
      fail(name, {
        reason: `Workflow ended with status: ${finalStatus}`,
        run_id: runId,
        results: finalResults,
      });
    }
  } catch (err) {
    fail(name, { error: err.message });
  }
}

// ============================================================
// RUN ALL TESTS
// ============================================================
console.log('='.repeat(60));
console.log('BORGCLAW QA TEST SUITE v1.0');
console.log(`Queen: ${QUEEN}`);
console.log(`Time: ${new Date().toISOString()}`);
console.log('='.repeat(60) + '\n');

await test1_queen_root();
await test2_queen_chat();
await test3_dashboard();
await test4_dashboard_js_syntax();
await test5_mcp_filesystem();
await test6_mcp_fetch();
await test7_auth_enforcement();
await test8_halt_resume();
await test9_workflow_list();
await test10_scheduled_tasks();
await test11_node_persistence();
await test12_borgclaw_connect();
await test13_borgclaw_cli();
await test14_drone_heartbeat();
await test15_drone_chat();
await test16_workflow_execute();

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
const passed = results.filter(r => r.status === 'PASS').length;
const failedList = results.filter(r => r.status === 'FAIL');
for (const r of results) {
  const icon = r.status === 'PASS' ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${r.test}`);
}
console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failedList.length}`);
