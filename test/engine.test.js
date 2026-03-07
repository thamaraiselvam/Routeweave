const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiSummary } = require('../src/engine/aiValidator');
const { buildGraph } = require('../src/engine/graphBuilder');

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
