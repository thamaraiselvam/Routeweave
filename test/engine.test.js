const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiSummary } = require('../src/engine/aiValidator');
const { buildGraph } = require('../src/engine/graphBuilder');
const { inferNextRoutePath, extractTableAccess } = require('../src/engine/metadataExtractor');
const { summarizeApi } = require('../src/engine/aiClient');
const { buildImpactPayload } = require('../src/engine/impactAnalysis');
const { generateOpenCodeScanPrompt } = require('../src/engine/workflow');

test('validateApiSummary accepts schema-conform data', () => {
  const payload = {
    apis: [{
      method: 'GET',
      path: '/users',
      summary: 'Get users',
      flow: ['Read users'],
      tables: ['users'],
      services: ['axios'],
      caches: ['redis'],
      queues: ['kafka'],
    }],
  };

  assert.equal(validateApiSummary(payload), true);
});

test('validateApiSummary accepts optional tableAccess lineage', () => {
  const payload = {
    apis: [{
      method: 'GET',
      path: '/accounts/:id',
      summary: 'Get account',
      flow: ['Read accounts.id'],
      tables: ['accounts'],
      services: [],
      caches: [],
      queues: [],
      tableAccess: [{
        table: 'accounts',
        columns: ['id'],
        operations: ['SELECT'],
        evidence: ['select id from accounts where id = ?'],
      }],
    }],
  };

  assert.equal(validateApiSummary(payload), true);
});

test('buildGraph creates nodes and edges for dependencies', () => {
  const graph = buildGraph([{
    apis: [{
      method: 'GET',
      path: '/users',
      summary: 'Get users',
      flow: ['Read users'],
      tables: ['users'],
      services: ['axios'],
      caches: ['redis'],
      queues: ['kafka'],
    }],
  }]);

  assert.ok(graph.nodes.find((n) => n.type === 'api'));
  assert.ok(graph.nodes.find((n) => n.type === 'database'));
  assert.ok(graph.nodes.find((n) => n.type === 'service'));
  assert.ok(graph.nodes.find((n) => n.type === 'cache'));
  assert.ok(graph.nodes.find((n) => n.type === 'queue'));
  assert.equal(graph.edges.length, 4);
});

test('inferNextRoutePath converts app router route file to API path', () => {
  const routePath = inferNextRoutePath('/repo/src/app/api/users/[id]/route.ts');
  assert.equal(routePath, '/users/:id');
});

test('summarizeApi returns deterministic local summary', async () => {
  const summary = await summarizeApi({
    method: 'POST',
    path: '/payments',
    tables: ['payments'],
    services: ['fetch'],
    caches: [],
    queues: ['kafka'],
  });

  assert.equal(summary.apis[0].method, 'POST');
  assert.ok(summary.apis[0].flow.length > 0);
});

test('generateOpenCodeScanPrompt includes repository scan instructions', () => {
  const output = generateOpenCodeScanPrompt(process.cwd());
  assert.ok(output.fileCount > 0);
  assert.ok(output.routeCount >= 0);
  assert.match(output.prompt, /REPOSITORY_ROOT:/);
  assert.match(output.prompt, /Scan the entire repository rooted at REPOSITORY_ROOT/);
   assert.match(output.prompt, /Impact analysis completeness is mandatory/);
  assert.match(output.prompt, /tableAccess.*required for every API object/);
  assert.match(output.prompt, /HINT_ROUTE_METADATA_JSON:/);
});

test('extractTableAccess captures table operations and columns from SQL snippets', () => {
  const code = [
    "const sql = `select u.id, u.email from users u join user_preferences p on p.user_id = u.id where u.id = ?`;",
    "const updateSql = `update user_preferences set last_seen_at = now() where user_id = ?`;",
  ].join('\n');

  const tableAccess = extractTableAccess(code);
  const users = tableAccess.find((entry) => entry.table === 'users');
  const preferences = tableAccess.find((entry) => entry.table === 'user_preferences');

  assert.ok(users);
  assert.ok(users.operations.includes('SELECT'));
  assert.ok(users.columns.includes('id'));
  assert.ok(users.columns.includes('email'));

  assert.ok(preferences);
  assert.ok(preferences.operations.includes('UPDATE'));
  assert.ok(preferences.columns.includes('last_seen_at'));
});

test('buildImpactPayload resolves impacted APIs for table and explicit column', () => {
  const payload = buildImpactPayload([
    {
      apis: [
        {
          method: 'GET',
          path: '/users/:id',
          summary: 'Read user profile',
          flow: ['Read users.email for response'],
          tables: ['users'],
          services: [],
          caches: [],
          queues: [],
          tableAccess: [
            {
              table: 'users',
              columns: ['id', 'email'],
              operations: ['SELECT'],
              evidence: ['select id, email from users where id = ?'],
            },
          ],
        },
      ],
    },
  ], { table: 'users', column: 'email' });

  assert.equal(payload.filters.table, 'users');
  assert.equal(payload.filters.column, 'email');
  assert.ok(payload.tables.find((table) => table.table === 'users'));
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].path, '/users/:id');
  assert.equal(payload.results[0].columnMatch, 'explicit');
  assert.match(payload.results[0].how, /column email/i);
});

test('buildImpactPayload falls back to table-level metadata when columns are unknown', () => {
  const payload = buildImpactPayload([
    {
      apis: [
        {
          method: 'GET',
          path: '/orders',
          summary: 'List orders',
          flow: ['Reads orders table'],
          tables: ['orders'],
          services: [],
          caches: [],
          queues: [],
        },
      ],
    },
  ], { table: 'orders', column: 'status' });

  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].columnMatch, 'wildcard');
});
