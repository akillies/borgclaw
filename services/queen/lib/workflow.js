// ============================================================
// Workflow Executor — DAG engine for YAML-defined workflows
// ============================================================
// Reads workflow definitions from config/workflows/*.yaml and
// executes them as dependency-ordered DAGs.
//
// Design principles:
//   - Pure function core: the executor has no side effects of
//     its own. All I/O (LLM calls, approvals, logging) is
//     injected via the deps argument.
//   - No LLM client imports. callLLM is always passed in.
//   - Every step event is logged. Nothing is silent.
//   - Approval gates are hard stops, not suggestions.
//   - Timeouts are enforced via Promise.race.
//
// Exports:
//   loadWorkflows(configDir)   — parse all YAML files into a Map
//   buildDAG(steps)            — compute execution tiers (testable)
//   executeWorkflow(name, deps) — run a workflow
//   resumeWorkflow(state, deps) — continue after an approval gate
// ============================================================

import fs from 'fs/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// ============================================================
// YAML Loading
// ============================================================

/**
 * Load all workflow YAML files from a directory.
 *
 * @param {string} configDir - Absolute path to config/workflows/
 * @returns {Map<string, object>} Map of workflow name → parsed spec
 */
export function loadWorkflows(configDir) {
  const workflows = new Map();

  if (!existsSync(configDir)) {
    return workflows;
  }

  let files;
  try {
    files = readdirSync(configDir);
  } catch (err) {
    console.warn(`[WORKFLOW] Could not read workflow directory: ${err.message}`);
    return workflows;
  }

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

    const filePath = path.join(configDir, file);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const spec = yaml.load(raw);
      if (spec && spec.name) {
        workflows.set(spec.name, spec);
      } else {
        console.warn(`[WORKFLOW] Skipping ${file} — no 'name' field`);
      }
    } catch (err) {
      console.warn(`[WORKFLOW] Failed to parse ${file}: ${err.message}`);
    }
  }

  return workflows;
}

/**
 * Async variant of loadWorkflows for use in async contexts.
 * Reads files in parallel.
 *
 * @param {string} configDir
 * @returns {Promise<Map<string, object>>}
 */
export async function loadWorkflowsAsync(configDir) {
  const workflows = new Map();

  let entries;
  try {
    entries = await fs.readdir(configDir);
  } catch {
    return workflows; // Directory doesn't exist yet — not an error
  }

  const yamlFiles = entries.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

  await Promise.all(yamlFiles.map(async (file) => {
    const filePath = path.join(configDir, file);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const spec = yaml.load(raw);
      if (spec && spec.name) {
        workflows.set(spec.name, spec);
      } else {
        console.warn(`[WORKFLOW] Skipping ${file} — no 'name' field`);
      }
    } catch (err) {
      console.warn(`[WORKFLOW] Failed to parse ${file}: ${err.message}`);
    }
  }));

  return workflows;
}

// ============================================================
// DAG Builder
// ============================================================

/**
 * Build an execution plan from a list of step definitions.
 *
 * A "tier" is a set of steps that can run in parallel because
 * all of their dependencies have been satisfied by previous tiers.
 *
 * Steps with no depends_on (or an empty array) are tier 0.
 * Steps whose deps are all in tier N land in tier N+1.
 *
 * @param {Array<object>} steps - Raw step definitions from the YAML
 * @returns {object} { tiers: Array<Array<object>>, stepMap: Map<id, step> }
 * @throws {Error} if a circular dependency is detected
 */
export function buildDAG(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { tiers: [], stepMap: new Map() };
  }

  // Build a map for quick lookup
  const stepMap = new Map();
  for (const step of steps) {
    if (!step.id) throw new Error(`Step is missing required 'id' field: ${JSON.stringify(step)}`);
    stepMap.set(step.id, step);
  }

  // Normalise depends_on: treat missing/null as empty array
  const deps = new Map();
  for (const step of steps) {
    const raw = step.depends_on;
    if (!raw || (Array.isArray(raw) && raw.length === 0)) {
      deps.set(step.id, []);
    } else if (Array.isArray(raw)) {
      // Validate all dependencies exist
      for (const depId of raw) {
        if (!stepMap.has(depId)) {
          throw new Error(
            `Step '${step.id}' depends on '${depId}' which does not exist in this workflow`
          );
        }
      }
      deps.set(step.id, raw);
    } else {
      // Single string dependency (edge case)
      deps.set(step.id, [String(raw)]);
    }
  }

  // Kahn's algorithm — topological sort into tiers
  // in_degree tracks how many unresolved deps each step has
  const inDegree = new Map();
  for (const step of steps) inDegree.set(step.id, deps.get(step.id).length);

  const tiers = [];
  const resolved = new Set();

  let iterations = 0;
  const maxIterations = steps.length + 1; // Guard against infinite loops

  while (resolved.size < steps.length) {
    if (iterations++ > maxIterations) {
      const unresolved = steps.map(s => s.id).filter(id => !resolved.has(id));
      throw new Error(`Circular dependency detected in steps: ${unresolved.join(', ')}`);
    }

    // Collect all steps whose dependencies are fully resolved
    const tier = steps.filter(s => !resolved.has(s.id) && inDegree.get(s.id) === 0);

    if (tier.length === 0) {
      const unresolved = steps.map(s => s.id).filter(id => !resolved.has(id));
      throw new Error(`Circular dependency detected in steps: ${unresolved.join(', ')}`);
    }

    tiers.push(tier);

    // Mark this tier as resolved and decrement in-degrees of dependents
    for (const step of tier) {
      resolved.add(step.id);
      // Find all steps that depend on this one and decrement their in-degree
      for (const [otherId, otherDeps] of deps) {
        if (otherDeps.includes(step.id)) {
          inDegree.set(otherId, inDegree.get(otherId) - 1);
        }
      }
    }
  }

  return { tiers, stepMap };
}

// ============================================================
// Template Variable Resolution
// ============================================================

/**
 * Resolve template variables in a value.
 *
 * Supported patterns:
 *   {{step_id.output_name}}   — output from a previous step
 *   {{today}}                  — ISO date string (YYYY-MM-DD)
 *   {{today_formatted}}        — Human-readable date
 *   {{input.field}}            — Value from workflow input_vars
 *   {{step_id.output[0]}}      — Array index access (basic)
 *   {{variable | default: x}}  — Fallback if variable resolves to undefined
 *
 * @param {*} value - Any JSON-serialisable value (string, array, object)
 * @param {object} context - { results: Map<stepId, output>, today, today_formatted, input, ...custom }
 * @returns {*} - Value with all template strings resolved
 */
export function resolveTemplates(value, context) {
  if (typeof value === 'string') {
    return resolveTemplateString(value, context);
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveTemplates(item, context));
  }

  if (value !== null && typeof value === 'object') {
    const resolved = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveTemplates(v, context);
    }
    return resolved;
  }

  // Primitives (number, boolean, null) pass through unchanged
  return value;
}

function resolveTemplateString(str, context) {
  // Replace all {{...}} expressions
  return str.replace(/\{\{([^}]+)\}\}/g, (_match, expr) => {
    const trimmed = expr.trim();

    // Handle "expr | default: fallback" syntax
    const pipeIndex = trimmed.indexOf('|');
    let lookup = trimmed;
    let defaultValue = undefined;

    if (pipeIndex !== -1) {
      lookup = trimmed.slice(0, pipeIndex).trim();
      const afterPipe = trimmed.slice(pipeIndex + 1).trim();
      if (afterPipe.startsWith('default:')) {
        defaultValue = afterPipe.slice('default:'.length).trim();
      }
    }

    const resolved = resolveExpression(lookup, context);

    if (resolved === undefined || resolved === null) {
      return defaultValue !== undefined ? defaultValue : '';
    }

    // If resolved is an object/array, serialise it — the template will embed JSON
    if (typeof resolved === 'object') {
      return JSON.stringify(resolved);
    }

    return String(resolved);
  });
}

function resolveExpression(expr, context) {
  // Built-in variables
  if (expr === 'today') return context.today || new Date().toISOString().slice(0, 10);
  if (expr === 'today_formatted') {
    return context.today_formatted || formatDate(new Date());
  }

  // Array index: step_id.output[0]
  const arrayMatch = expr.match(/^([^.[]+)\.([^[]+)\[(\d+)\]$/);
  if (arrayMatch) {
    const [, stepId, outputName, indexStr] = arrayMatch;
    const stepOutput = lookupStepOutput(stepId, outputName, context);
    if (Array.isArray(stepOutput)) return stepOutput[parseInt(indexStr, 10)];
    return undefined;
  }

  // Dot notation: step_id.output_name or input.field
  const parts = expr.split('.');
  if (parts.length === 2) {
    const [ns, field] = parts;

    if (ns === 'input') {
      return context.input ? context.input[field] : undefined;
    }

    return lookupStepOutput(ns, field, context);
  }

  // Simple variable from context (e.g. {{today}}, {{some_custom_var}})
  return context[expr];
}

function lookupStepOutput(stepId, outputName, context) {
  const stepResult = context.results?.get(stepId);
  if (!stepResult) return undefined;
  return stepResult[outputName];
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ============================================================
// Timeout Parser
// ============================================================

/**
 * Parse a timeout string into milliseconds.
 *
 * Supported formats: "2m", "15m", "30s", "1h", "90s"
 * Returns a default of 5 minutes if the string is unparseable.
 *
 * @param {string|number|undefined} timeout
 * @returns {number} milliseconds
 */
export function parseTimeout(timeout) {
  if (typeof timeout === 'number') return timeout;
  if (!timeout) return 5 * 60 * 1000; // 5 minute default

  const str = String(timeout).trim().toLowerCase();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/);
  if (!match) {
    console.warn(`[WORKFLOW] Unparseable timeout '${timeout}', using 5m default`);
    return 5 * 60 * 1000;
  }

  const [, value, unit] = match;
  const n = parseFloat(value);

  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    default:  return 5 * 60 * 1000;
  }
}

// ============================================================
// Step Executor
// ============================================================

/**
 * Execute a single step, enforcing its timeout.
 *
 * @param {object} step - Step definition
 * @param {object} deps - { callLLM, logActivity, context }
 * @param {Map} results - Accumulated step results so far
 * @returns {Promise<object>} The step's output
 */
async function executeStep(step, deps, results) {
  const { callLLM, logActivity, context } = deps;
  const workflowName = context._workflowName || 'unknown';

  // Build the resolution context for template vars
  const templateContext = {
    ...context,
    results,
  };

  // Resolve all template variables in inputs
  const resolvedInputs = resolveTemplates(step.inputs || {}, templateContext);

  // Build a system prompt summarising the step's role and the agent
  const systemPrompt = buildSystemPrompt(step, context);

  const timeoutMs = parseTimeout(step.timeout);

  logActivity({
    type: 'workflow_step_start',
    workflow: workflowName,
    step: step.id,
    agent: step.agent,
    action: step.action,
    description: step.description || '',
  });

  // Race the LLM call against the timeout
  let result;
  try {
    result = await Promise.race([
      callLLM(step.agent, step.action, resolvedInputs, systemPrompt),
      rejectAfter(timeoutMs, `Step '${step.id}' timed out after ${step.timeout || '5m'}`),
    ]);
  } catch (err) {
    logActivity({
      type: 'workflow_step_failed',
      workflow: workflowName,
      step: step.id,
      agent: step.agent,
      action: step.action,
      error: err.message,
    });
    throw err;
  }

  logActivity({
    type: 'workflow_step_complete',
    workflow: workflowName,
    step: step.id,
    agent: step.agent,
    action: step.action,
    outputs: step.outputs || [],
  });

  return result;
}

/**
 * Build a system prompt for the LLM call from the step definition.
 * The callLLM function receives this so it can inject it as the
 * system message if working with chat-completion style APIs.
 */
function buildSystemPrompt(step, context) {
  const lines = [];

  if (step.agent) lines.push(`You are the '${step.agent}' agent.`);
  if (step.action) lines.push(`Your task is: ${step.action}.`);
  if (step.description) lines.push(step.description);

  if (step.outputs && step.outputs.length > 0) {
    lines.push(`\nReturn a JSON object with these keys: ${step.outputs.join(', ')}.`);
  }

  return lines.join('\n');
}

/**
 * Returns a promise that rejects after `ms` milliseconds.
 */
function rejectAfter(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

// ============================================================
// Main Workflow Executor
// ============================================================

/**
 * Execute a workflow by name.
 *
 * Steps run tier by tier (respecting depends_on). Within each tier,
 * steps run in parallel. If a step has requires_approval: true, the
 * workflow pauses, creates an approval item, and returns with
 * status: 'paused'. Use resumeWorkflow() to continue after approval.
 *
 * @param {string} name - Workflow name (must exist in `workflows` Map)
 * @param {object} deps
 * @param {Map}    deps.workflows         - Map from loadWorkflows()
 * @param {Function} deps.callLLM         - async (agent, action, inputs, systemPrompt) → result
 * @param {Function} deps.createApproval  - (approval) → approvalItem
 * @param {Function} deps.logActivity     - (event) → void
 * @param {Function} deps.getApprovalStatus - (id) → 'pending'|'approved'|'rejected'
 * @param {object}  deps.context          - { today, today_formatted, input, ...custom }
 * @returns {Promise<{
 *   status: 'completed'|'paused'|'failed',
 *   results: Map<string, object>,
 *   paused_at?: string,
 *   approval_id?: string,
 *   error?: string,
 *   _state?: object,  // internal — pass to resumeWorkflow
 * }>}
 */
export async function executeWorkflow(name, deps) {
  const { workflows, callLLM, createApproval, logActivity, getApprovalStatus, context = {} } = deps;

  const spec = workflows.get(name);
  if (!spec) {
    throw new Error(`Workflow '${name}' not found. Available: ${[...workflows.keys()].join(', ')}`);
  }

  // Validate required deps
  if (typeof callLLM !== 'function') throw new Error('deps.callLLM must be a function');
  if (typeof logActivity !== 'function') throw new Error('deps.logActivity must be a function');
  if (typeof createApproval !== 'function') throw new Error('deps.createApproval must be a function');

  // Inject workflow name into context for use in log events and template vars
  const enrichedContext = {
    today: new Date().toISOString().slice(0, 10),
    today_formatted: formatDate(new Date()),
    ...context,
    _workflowName: name,
  };

  logActivity({
    type: 'workflow_start',
    workflow: name,
    version: spec.version || 'unknown',
    description: spec.description || '',
  });

  const { tiers } = buildDAG(spec.steps || []);
  const results = new Map(); // stepId → output object

  for (const tier of tiers) {
    // Check each step in this tier for pending approval gates from a previous
    // (partial) execution. This handles the resume path naturally.
    for (const step of tier) {
      if (step.requires_approval) {
        // Check if there is an existing approval for this step
        // (set during a previous paused execution of this workflow)
        const existingApprovalId = enrichedContext._approvals?.[step.id];
        if (existingApprovalId) {
          const status = getApprovalStatus(existingApprovalId);
          if (status === 'pending') {
            // Still waiting — pause again
            return pausedResult(name, step.id, existingApprovalId, results, tiers, tier);
          }
          if (status === 'rejected') {
            logActivity({
              type: 'workflow_approval_rejected',
              workflow: name,
              step: step.id,
              approval_id: existingApprovalId,
            });
            return failedResult(name, `Step '${step.id}' was rejected`, results);
          }
          // status === 'approved' — fall through to execute
          logActivity({
            type: 'workflow_approval_granted',
            workflow: name,
            step: step.id,
            approval_id: existingApprovalId,
          });
        }
      }
    }

    // Run all steps in this tier concurrently.
    // Collect results; abort on first failure.
    const tierResults = await Promise.allSettled(
      tier.map(step => executeStep(step, { callLLM, logActivity, context: enrichedContext }, results))
    );

    // Process results in step order so we can handle approval gates in sequence
    for (let i = 0; i < tier.length; i++) {
      const step = tier[i];
      const outcome = tierResults[i];

      if (outcome.status === 'rejected') {
        logActivity({
          type: 'workflow_failed',
          workflow: name,
          step: step.id,
          error: outcome.reason?.message || String(outcome.reason),
        });
        return failedResult(name, outcome.reason?.message || String(outcome.reason), results);
      }

      const stepOutput = outcome.value;
      results.set(step.id, stepOutput);

      // Approval gate: pause the workflow after completing this step
      // (the output exists but downstream steps don't run until approved)
      if (step.requires_approval) {
        // Determine a sensible preview of the output for the approval UI
        const previewKey = step.outputs?.[0];
        const previewValue = previewKey ? stepOutput?.[previewKey] : stepOutput;
        const previewStr = typeof previewValue === 'string'
          ? previewValue.slice(0, 500)
          : JSON.stringify(previewValue)?.slice(0, 500);

        const approval = createApproval({
          type: 'workflow_step_approval',
          summary: `Approve step '${step.id}' in workflow '${name}'`,
          source_workflow: name,
          source_agent: step.agent,
          step_id: step.id,
          action: step.action,
          description: step.description || '',
          preview: previewStr,
          outputs: step.outputs || [],
        });

        logActivity({
          type: 'workflow_approval_needed',
          workflow: name,
          step: step.id,
          agent: step.agent,
          approval_id: approval.id,
        });

        return pausedResult(name, step.id, approval.id, results, tiers, tier);
      }
    }
  }

  logActivity({
    type: 'workflow_complete',
    workflow: name,
    steps_executed: results.size,
  });

  return {
    status: 'completed',
    results,
  };
}

// ============================================================
// Resume After Approval
// ============================================================

/**
 * Resume a paused workflow from the step after the approval gate.
 *
 * The caller must pass the `_state` object from the paused result
 * back in. The engine re-runs all remaining tiers (or the remaining
 * steps in the paused tier) from where it stopped.
 *
 * @param {object} state - The `_state` field from a paused result
 * @param {object} deps  - Same deps as executeWorkflow
 * @returns {Promise<same shape as executeWorkflow>}
 */
export async function resumeWorkflow(state, deps) {
  const { callLLM, createApproval, logActivity, getApprovalStatus, context = {} } = deps;

  if (!state) throw new Error('resumeWorkflow: state is required');
  if (!state.workflow) throw new Error('resumeWorkflow: state.workflow is required');
  if (!state.paused_at) throw new Error('resumeWorkflow: state.paused_at is required');
  if (!state.approval_id) throw new Error('resumeWorkflow: state.approval_id is required');
  if (!state.remaining_tiers) throw new Error('resumeWorkflow: state.remaining_tiers is required');
  if (!state.results_serialized) throw new Error('resumeWorkflow: state.results_serialized is required');

  // Check approval status
  const approvalStatus = getApprovalStatus(state.approval_id);

  if (approvalStatus === 'pending') {
    logActivity({
      type: 'workflow_resume_blocked',
      workflow: state.workflow,
      step: state.paused_at,
      approval_id: state.approval_id,
      reason: 'approval still pending',
    });
    // Return the same paused state
    return {
      status: 'paused',
      results: deserializeResults(state.results_serialized),
      paused_at: state.paused_at,
      approval_id: state.approval_id,
      _state: state,
    };
  }

  if (approvalStatus === 'rejected') {
    logActivity({
      type: 'workflow_approval_rejected',
      workflow: state.workflow,
      step: state.paused_at,
      approval_id: state.approval_id,
    });
    return failedResult(
      state.workflow,
      `Step '${state.paused_at}' was rejected`,
      deserializeResults(state.results_serialized)
    );
  }

  // Approved — continue from remaining tiers
  logActivity({
    type: 'workflow_resume',
    workflow: state.workflow,
    step: state.paused_at,
    approval_id: state.approval_id,
  });

  const results = deserializeResults(state.results_serialized);

  const enrichedContext = {
    today: new Date().toISOString().slice(0, 10),
    today_formatted: formatDate(new Date()),
    ...context,
    _workflowName: state.workflow,
    // Pass through any existing approval IDs so the gate check above
    // can find them if this resume itself pauses at a later gate
    _approvals: state._approvals || {},
  };

  // The remaining_tiers array tells us exactly which tiers still need to run.
  // The first tier might be partial (if we paused mid-tier), tracked by
  // remaining_in_current_tier.
  const remainingTiers = state.remaining_tiers;
  const remainingInCurrent = state.remaining_in_current_tier || [];

  // Execute remaining steps in the paused tier first
  if (remainingInCurrent.length > 0) {
    const tierResults = await Promise.allSettled(
      remainingInCurrent.map(step =>
        executeStep(step, { callLLM, logActivity, context: enrichedContext }, results)
      )
    );

    for (let i = 0; i < remainingInCurrent.length; i++) {
      const step = remainingInCurrent[i];
      const outcome = tierResults[i];

      if (outcome.status === 'rejected') {
        logActivity({
          type: 'workflow_failed',
          workflow: state.workflow,
          step: step.id,
          error: outcome.reason?.message || String(outcome.reason),
        });
        return failedResult(state.workflow, outcome.reason?.message, results);
      }

      results.set(step.id, outcome.value);

      // Another approval gate within the same tier
      if (step.requires_approval) {
        const previewKey = step.outputs?.[0];
        const previewValue = previewKey ? outcome.value?.[previewKey] : outcome.value;
        const previewStr = typeof previewValue === 'string'
          ? previewValue.slice(0, 500)
          : JSON.stringify(previewValue)?.slice(0, 500);

        const approval = createApproval({
          type: 'workflow_step_approval',
          summary: `Approve step '${step.id}' in workflow '${state.workflow}'`,
          source_workflow: state.workflow,
          source_agent: step.agent,
          step_id: step.id,
          action: step.action,
          description: step.description || '',
          preview: previewStr,
          outputs: step.outputs || [],
        });

        logActivity({
          type: 'workflow_approval_needed',
          workflow: state.workflow,
          step: step.id,
          agent: step.agent,
          approval_id: approval.id,
        });

        // Compute remaining steps after this approval
        const stepsAfterThis = remainingInCurrent.slice(i + 1);
        return pausedResultFromResume(state.workflow, step.id, approval.id, results, remainingTiers, stepsAfterThis, state._approvals || {});
      }
    }
  }

  // Now run each remaining full tier
  for (const tier of remainingTiers) {
    const tierResults = await Promise.allSettled(
      tier.map(step =>
        executeStep(step, { callLLM, logActivity, context: enrichedContext }, results)
      )
    );

    for (let i = 0; i < tier.length; i++) {
      const step = tier[i];
      const outcome = tierResults[i];

      if (outcome.status === 'rejected') {
        logActivity({
          type: 'workflow_failed',
          workflow: state.workflow,
          step: step.id,
          error: outcome.reason?.message || String(outcome.reason),
        });
        return failedResult(state.workflow, outcome.reason?.message, results);
      }

      results.set(step.id, outcome.value);

      if (step.requires_approval) {
        const previewKey = step.outputs?.[0];
        const previewValue = previewKey ? outcome.value?.[previewKey] : outcome.value;
        const previewStr = typeof previewValue === 'string'
          ? previewValue.slice(0, 500)
          : JSON.stringify(previewValue)?.slice(0, 500);

        const approval = createApproval({
          type: 'workflow_step_approval',
          summary: `Approve step '${step.id}' in workflow '${state.workflow}'`,
          source_workflow: state.workflow,
          source_agent: step.agent,
          step_id: step.id,
          action: step.action,
          description: step.description || '',
          preview: previewStr,
          outputs: step.outputs || [],
        });

        logActivity({
          type: 'workflow_approval_needed',
          workflow: state.workflow,
          step: step.id,
          agent: step.agent,
          approval_id: approval.id,
        });

        const stepsAfterThis = tier.slice(i + 1);
        const tiersAfterThis = remainingTiers.slice(remainingTiers.indexOf(tier) + 1);
        return pausedResultFromResume(state.workflow, step.id, approval.id, results, tiersAfterThis, stepsAfterThis, state._approvals || {});
      }
    }
  }

  logActivity({
    type: 'workflow_complete',
    workflow: state.workflow,
    steps_executed: results.size,
  });

  return {
    status: 'completed',
    results,
  };
}

// ============================================================
// Helper: Build Paused Result
// ============================================================

/**
 * Build the paused return value from executeWorkflow.
 *
 * The _state payload encodes everything needed to resume:
 * which tiers remain, which results are already available,
 * and which approval is being awaited.
 *
 * Note: Map is not JSON-serialisable, so we serialise results
 * as a plain object keyed by step ID.
 */
function pausedResult(workflowName, pausedAt, approvalId, results, allTiers, currentTier) {
  // Determine which tiers still need to run after this pause.
  // The current tier may have steps after the paused step that should
  // run once the gate is cleared (they don't depend on the paused step
  // — they're in the same tier so their deps are already resolved).
  const pausedStepIndex = currentTier.findIndex(s => s.id === pausedAt);
  const remainingInCurrentTier = currentTier.slice(pausedStepIndex + 1);

  const currentTierIndex = allTiers.indexOf(currentTier);
  const remainingTiers = currentTierIndex !== -1
    ? allTiers.slice(currentTierIndex + 1)
    : [];

  return {
    status: 'paused',
    results,
    paused_at: pausedAt,
    approval_id: approvalId,
    _state: {
      workflow: workflowName,
      paused_at: pausedAt,
      approval_id: approvalId,
      remaining_tiers: remainingTiers,
      remaining_in_current_tier: remainingInCurrentTier,
      results_serialized: serializeResults(results),
      _approvals: { [pausedAt]: approvalId },
    },
  };
}

function pausedResultFromResume(workflowName, pausedAt, approvalId, results, remainingTiers, remainingInCurrentTier, existingApprovals) {
  return {
    status: 'paused',
    results,
    paused_at: pausedAt,
    approval_id: approvalId,
    _state: {
      workflow: workflowName,
      paused_at: pausedAt,
      approval_id: approvalId,
      remaining_tiers: remainingTiers,
      remaining_in_current_tier: remainingInCurrentTier,
      results_serialized: serializeResults(results),
      _approvals: { ...existingApprovals, [pausedAt]: approvalId },
    },
  };
}

function failedResult(workflowName, error, results) {
  return {
    status: 'failed',
    results,
    error: error || 'Unknown error',
  };
}

// ============================================================
// Serialization Helpers
// ============================================================

/**
 * Serialise a Map<string, object> to a plain object for JSON storage.
 * Used in the _state payload so paused workflow state can be persisted.
 */
function serializeResults(resultsMap) {
  const obj = {};
  for (const [k, v] of resultsMap) obj[k] = v;
  return obj;
}

/**
 * Deserialise the plain object back to a Map.
 */
function deserializeResults(obj) {
  const map = new Map();
  if (!obj) return map;
  for (const [k, v] of Object.entries(obj)) map.set(k, v);
  return map;
}
