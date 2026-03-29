'use strict';

/**
 * flow-builder.js
 *
 * Synthesises a human-readable flow[] from HandlerChain static signals.
 *
 * Design goals
 * ────────────
 * - Deterministic: given the same HandlerChain, always produce the same flow[]
 * - Business-language: steps are written from the perspective of what the
 *   system *does*, not how Express routes requests
 * - Code references: each step carries an optional codeRef (filePath:line)
 * - AI-ready: the whole function can later be replaced or enhanced with an
 *   AI call using the same HandlerChain input and the same output contract
 *
 * Output contract per flow step:
 * {
 *   text:     string   — human-readable step description
 *   codeRef:  string   — "filePath:line" or "" if not available
 * }
 */

/**
 * Verb prefix for a DB operation array.
 * @param {string[]} ops
 * @returns {string}
 */
function dbVerb(ops) {
  const s = new Set((ops || []).map(o => String(o).toUpperCase()));
  const read = s.has('SELECT');
  const write = s.has('INSERT') || s.has('UPDATE') || s.has('DELETE') || s.has('UPSERT');
  if (read && write) return 'Read and write';
  if (write) {
    if (s.has('INSERT')) return 'Insert into';
    if (s.has('UPDATE') || s.has('UPSERT')) return 'Update';
    if (s.has('DELETE')) return 'Delete from';
    return 'Write to';
  }
  return 'Query';
}

/**
 * HTTP method → plain-English action.
 */
function httpAction(method) {
  const m = String(method || '').toUpperCase();
  if (m === 'GET')    return 'Retrieve';
  if (m === 'POST')   return 'Create';
  if (m === 'PUT')    return 'Replace';
  if (m === 'PATCH')  return 'Update';
  if (m === 'DELETE') return 'Delete';
  return 'Handle';
}

/**
 * Convert snake_case or camelCase identifier to readable words.
 * "user_accounts" → "user accounts"
 * "userAccounts"  → "user accounts"
 */
function humanize(str) {
  return String(str || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Build a human-readable summary of what a route does based on its method,
 * path, and the resources it touches.
 */
function buildSummary(route, chain) {
  const method = String(route.method || '').toUpperCase();
  const action = httpAction(method);
  const pathParts = (route.path || '')
    .replace(/^\//, '').split('/')
    .filter(p => p && !p.startsWith(':') && !['api', 'v1', 'v2', 'v3'].includes(p.toLowerCase()));
  const subject = pathParts.length > 0 ? humanize(pathParts[pathParts.length - 1]) : 'resource';

  const tableNames = (chain.tables || []).slice(0, 2).map(humanize).join(' and ');
  const svcNames   = (chain.services || []).slice(0, 2).join(', ');

  let summary = `${action} ${subject}`;
  if (tableNames) summary += ` (${tableNames})`;
  if (svcNames)   summary += `. Calls ${svcNames}.`;
  return summary;
}

/**
 * Build flow steps for a HandlerChain.
 *
 * Strategy:
 * 1. Validate request (always first if middlewares detected)
 * 2. One step per chain role (controller → service → repository)
 * 3. One step per DB table touched (with operation verb)
 * 4. One step per outbound HTTP service
 * 5. Cache read/write if present
 * 6. Queue publish if present
 * 7. Return response (always last)
 *
 * @param {import('./adapters/express').HandlerChain} chain
 * @returns {{ text: string, codeRef: string }[]}
 */
function buildFlowSteps(chain) {
  const steps = [];
  const route = chain.route || {};
  const routeRef = route.filePath ? `${route.filePath}:${route.lineNumber || 1}` : '';

  // ── Step 1: middleware / validation ──────────────────────────────────────
  if ((route.middlewares || []).length > 0) {
    const mwList = route.middlewares.slice(0, 3).join(', ');
    steps.push({ text: `Apply middleware: ${mwList}`, codeRef: routeRef });
  }

  // ── Step 2: chain role steps (controller → service → repository) ─────────
  const roleOrder = ['controller', 'service', 'repository', 'model', 'middleware'];
  const addedRoles = new Set();
  for (const roleKey of roleOrder) {
    const step = (chain.steps || []).find(s => s.role === roleKey && !addedRoles.has(s.filePath));
    if (!step) continue;
    addedRoles.add(step.filePath);
    steps.push({
      text: step.label,
      codeRef: `${step.filePath}:${step.lineNumber || 1}`,
    });
  }

  // ── Step 3: DB table access steps ────────────────────────────────────────
  for (const ta of (chain.tableAccess || []).slice(0, 4)) {
    const verb = dbVerb(ta.operations);
    const tableName = humanize(ta.table);
    const colHint = (ta.columns || []).filter(c => c !== '*').slice(0, 3).join(', ');
    let text = `${verb} ${tableName}`;
    if (colHint) text += ` (${colHint})`;
    const ref = ta.evidence && ta.evidence[0]
      ? String(ta.evidence[0]).split(' ')[0]  // "filePath:line snippet" → "filePath:line"
      : routeRef;
    steps.push({ text, codeRef: ref });
  }

  // ── Step 4: outbound HTTP service calls ───────────────────────────────────
  for (const svc of (chain.services || []).slice(0, 2)) {
    steps.push({ text: `Call external service: ${svc}`, codeRef: routeRef });
  }

  // ── Step 5: cache reads/writes ────────────────────────────────────────────
  for (const cache of (chain.caches || []).slice(0, 2)) {
    steps.push({ text: `Read/write ${cache} cache`, codeRef: routeRef });
  }

  // ── Step 6: queue publish ─────────────────────────────────────────────────
  for (const queue of (chain.queues || []).slice(0, 2)) {
    steps.push({ text: `Publish to ${queue} queue`, codeRef: routeRef });
  }

  // ── Step 7: final response ────────────────────────────────────────────────
  if (steps.length === 0) {
    steps.push({ text: 'Process request and return response', codeRef: routeRef });
  } else {
    steps.push({ text: 'Return response to caller', codeRef: routeRef });
  }

  return steps;
}

/**
 * Convert a HandlerChain into an api_knowledge entry compatible with
 * the Routeweave dashboard schema.
 *
 * @param {import('./adapters/express').HandlerChain} chain
 * @returns {object} api_knowledge entry
 */
function chainToApiEntry(chain) {
  const route = chain.route || {};
  const flowSteps = buildFlowSteps(chain);

  return {
    method: String(route.method || 'GET').toUpperCase(),
    path: route.path || '/',
    summary: buildSummary(route, chain),
    flow: flowSteps.map(s => s.text),
    flowWithRefs: flowSteps,           // extended data with codeRef (for future use)
    tables: chain.tables || [],
    services: chain.services || [],
    dependencies: chain.imports || [],
    caches: chain.caches || [],
    queues: chain.queues || [],
    tableAccess: (chain.tableAccess || []).map(ta => ({
      table: ta.table,
      columns: ta.columns || ['*'],
      operations: ta.operations || ['UNKNOWN'],
      evidence: ta.evidence || [],
    })),
    _framework: route.framework || 'unknown',
    _filePath: route.filePath || '',
    _lineNumber: route.lineNumber || 1,
  };
}

/**
 * Build the full api_knowledge payload (array of { apis: [...] } wrappers)
 * from an array of HandlerChain[] (one HandlerChains array per source file).
 *
 * The Routeweave server and cache.js expect api_knowledge.json to be an array
 * where each element has shape: { apis: [ApiEntry, ...] }
 *
 * @param {Array<import('./adapters/express').HandlerChain[]>} allChains
 * @returns {{ apis: object[] }[]}
 */
function buildApiKnowledge(allChains) {
  const flat = [].concat(...allChains);  // flatten HandlerChain[][]
  const seen = new Set();
  const wrappers = [];

  for (const chain of flat) {
    const entry = chainToApiEntry(chain);
    const key = entry.method + ' ' + entry.path;
    if (seen.has(key)) continue;
    seen.add(key);
    wrappers.push({ apis: [entry] });
  }

  return wrappers;
}

module.exports = { buildFlowSteps, chainToApiEntry, buildApiKnowledge, buildSummary };
