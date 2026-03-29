const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiSummary } = require('../src/engine/aiValidator');
const { buildGraph } = require('../src/engine/graphBuilder');
const { inferNextRoutePath, extractTableAccess } = require('../src/engine/metadataExtractor');
const { summarizeApi } = require('../src/engine/aiClient');
const { buildImpactPayload, buildDependencyCatalog, buildServiceCatalog, analyzeDependencyImpact, analyzeServiceImpact } = require('../src/engine/impactAnalysis');
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
  assert.match(output.prompt, /Scan the ENTIRE repository at REPOSITORY_ROOT recursively/);
  assert.match(output.prompt, /tableAccess is REQUIRED for every API/);
  assert.match(output.prompt, /STATIC ROUTE SCAN HINTS/);
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

const depApiA = {
  method: 'POST', path: '/api/users/registration',
  summary: 'Register a new user',
  flow: ['Validate input', 'Hash password with bcrypt', 'Insert into users table', 'Send welcome email via SendGrid'],
  tables: ['users'],
  services: ['SendGrid'],
  dependencies: ['bcrypt', 'express-validator'],
  caches: [],
  queues: [],
  tableAccess: [{ table: 'users', columns: ['id', 'email', 'password_hash'], operations: ['INSERT'], evidence: ['insert into users (id, email, password_hash) values (?, ?, ?)'] }],
};

const depApiB = {
  method: 'POST', path: '/api/users/login',
  summary: 'Login a user',
  flow: ['Validate credentials', 'Compare password with bcrypt', 'Issue JWT'],
  tables: ['users'],
  services: ['auth0'],
  dependencies: ['bcrypt', 'jsonwebtoken'],
  caches: [],
  queues: [],
  tableAccess: [{ table: 'users', columns: ['id', 'email', 'password_hash'], operations: ['SELECT'], evidence: ['select id, email, password_hash from users where email = ?'] }],
};

const depApiC = {
  method: 'GET', path: '/api/orders',
  summary: 'List orders',
  flow: ['Fetch orders from DB', 'Return orders list'],
  tables: ['orders'],
  services: ['Stripe'],
  dependencies: ['express-validator'],
  caches: [],
  queues: [],
};

const depApiKnowledge = [{ apis: [depApiA, depApiB, depApiC] }];

test('buildDependencyCatalog returns dependency catalog sorted alphabetically with correct apiCount', () => {
  const catalog = buildDependencyCatalog([depApiA, depApiB, depApiC]);

  assert.ok(Array.isArray(catalog));
  const bcrypt = catalog.find((entry) => entry.dependency === 'bcrypt');
  const expressValidator = catalog.find((entry) => entry.dependency === 'express-validator');
  const jsonwebtoken = catalog.find((entry) => entry.dependency === 'jsonwebtoken');

  assert.ok(bcrypt, 'bcrypt entry should exist');
  assert.equal(bcrypt.apiCount, 2);

  assert.ok(expressValidator, 'express-validator entry should exist');
  assert.equal(expressValidator.apiCount, 2);

  assert.ok(jsonwebtoken, 'jsonwebtoken entry should exist');
  assert.equal(jsonwebtoken.apiCount, 1);

  const names = catalog.map((e) => e.dependency);
  assert.deepEqual(names, [...names].sort());
});

test('buildServiceCatalog returns service catalog sorted alphabetically with correct apiCount', () => {
  const catalog = buildServiceCatalog([depApiA, depApiB, depApiC]);

  assert.ok(Array.isArray(catalog));
  const sendGrid = catalog.find((entry) => entry.service === 'SendGrid');
  const auth0 = catalog.find((entry) => entry.service === 'auth0');
  const stripe = catalog.find((entry) => entry.service === 'Stripe');

  assert.ok(sendGrid, 'SendGrid entry should exist');
  assert.equal(sendGrid.apiCount, 1);

  assert.ok(auth0, 'auth0 entry should exist');
  assert.equal(auth0.apiCount, 1);

  assert.ok(stripe, 'Stripe entry should exist');
  assert.equal(stripe.apiCount, 1);

  const names = catalog.map((e) => e.service);
  assert.deepEqual(names, [...names].sort());
});

test('analyzeDependencyImpact finds APIs using a specific dependency', () => {
  const results = analyzeDependencyImpact([depApiA, depApiB, depApiC], { dependency: 'bcrypt' });

  assert.ok(Array.isArray(results));
  assert.equal(results.length, 2);

  const paths = results.map((r) => r.path);
  assert.ok(paths.includes('/api/users/registration'));
  assert.ok(paths.includes('/api/users/login'));
  assert.ok(!paths.includes('/api/orders'));

  const first = results[0];
  assert.ok(first.method);
  assert.ok(first.path);
  assert.ok(first.summary);
  assert.equal(first.dependency, 'bcrypt');
  assert.equal(first.impact, 'uses');
  assert.equal(first.how, 'Uses dependency bcrypt');
});

test('analyzeServiceImpact finds APIs calling a specific external service', () => {
  const results = analyzeServiceImpact([depApiA, depApiB, depApiC], { service: 'SendGrid' });

  assert.ok(Array.isArray(results));
  assert.equal(results.length, 1);
  assert.equal(results[0].path, '/api/users/registration');
  assert.equal(results[0].method, 'POST');
  assert.ok(results[0].summary);
  assert.equal(results[0].service, 'SendGrid');
  assert.equal(results[0].impact, 'calls');
  assert.equal(results[0].how, 'Calls external service SendGrid');
});

test('analyzeDependencyImpact is case-insensitive', () => {
  const results = analyzeDependencyImpact([depApiA, depApiB, depApiC], { dependency: 'Bcrypt' });

  assert.ok(Array.isArray(results));
  assert.equal(results.length, 2);
  const paths = results.map((r) => r.path);
  assert.ok(paths.includes('/api/users/registration'));
  assert.ok(paths.includes('/api/users/login'));
});

test('analyzeServiceImpact is case-insensitive', () => {
  const results = analyzeServiceImpact([depApiA, depApiB, depApiC], { service: 'sendgrid' });

  assert.ok(Array.isArray(results));
  assert.equal(results.length, 1);
  assert.equal(results[0].path, '/api/users/registration');
});

test('buildImpactPayload with dependency filter returns catalog and filtered results', () => {
  const payload = buildImpactPayload(depApiKnowledge, { dependency: 'bcrypt' });

  assert.ok(Array.isArray(payload.dependencies), 'payload.dependencies should be an array');
  assert.ok(Array.isArray(payload.services), 'payload.services should be an array');
  assert.equal(payload.filters.dependency, 'bcrypt');

  assert.ok(Array.isArray(payload.results));
  assert.equal(payload.results.length, 2);
  const paths = payload.results.map((r) => r.path);
  assert.ok(paths.includes('/api/users/registration'));
  assert.ok(paths.includes('/api/users/login'));
});

test('buildImpactPayload with service filter returns catalog and filtered results', () => {
  const payload = buildImpactPayload(depApiKnowledge, { service: 'SendGrid' });

  assert.ok(Array.isArray(payload.dependencies), 'payload.dependencies should be an array');
  assert.ok(Array.isArray(payload.services), 'payload.services should be an array');
  assert.equal(payload.filters.service, 'SendGrid');

  assert.ok(Array.isArray(payload.results));
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].path, '/api/users/registration');
});
