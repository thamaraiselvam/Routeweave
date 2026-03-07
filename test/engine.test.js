const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiSummary } = require('../src/engine/aiValidator');
const { buildGraph } = require('../src/engine/graphBuilder');
const { inferNextRoutePath } = require('../src/engine/metadataExtractor');
const { summarizeApi } = require('../src/engine/aiClient');

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

test('summarizeApi supports mock provider without network calls', async () => {
  const summary = await summarizeApi(
    {
      method: 'POST',
      path: '/payments',
      tables: ['payments'],
      services: ['fetch'],
      caches: [],
      queues: ['kafka'],
    },
    { aiProvider: 'mock' },
  );

  assert.equal(summary.apis[0].method, 'POST');
  assert.ok(summary.apis[0].flow.length > 0);
});
