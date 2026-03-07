const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiSummary } = require('../src/engine/aiValidator');
const { buildGraph } = require('../src/engine/graphBuilder');
const { inferNextRoutePath } = require('../src/engine/metadataExtractor');
const { summarizeApi, resolveAiConfig } = require('../src/engine/aiClient');
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


test('resolveAiConfig picks compatibility environment variables', () => {
  const previous = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_BASE_URL: process.env.AI_BASE_URL,
  };

  process.env.AI_PROVIDER = 'openai';
  process.env.AI_API_KEY = 'compat-token';
  process.env.AI_MODEL = 'gpt-test';
  process.env.AI_BASE_URL = 'https://example.com/v1/chat/completions';

  const config = resolveAiConfig({});

  assert.equal(config.provider, 'openai');
  assert.equal(config.token, 'compat-token');
  assert.equal(config.model, 'gpt-test');
  assert.equal(config.baseUrl, 'https://example.com/v1/chat/completions');

  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

test('resolveAiConfig favors APIMAP variables over compatibility aliases', () => {
  const previous = {
    APIMAP_AI_PROVIDER: process.env.APIMAP_AI_PROVIDER,
    AI_PROVIDER: process.env.AI_PROVIDER,
  };

  process.env.APIMAP_AI_PROVIDER = 'mock';
  process.env.AI_PROVIDER = 'openai';

  const config = resolveAiConfig({});
  assert.equal(config.provider, 'mock');

  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});


test('resolveAiConfig normalizes open provider aliases to openai', () => {
  const config = resolveAiConfig({ aiProvider: 'open' });
  assert.equal(config.provider, 'openai');
});

test('resolveAiConfig normalizes opencode aliases', () => {
  const config = resolveAiConfig({ aiProvider: 'open-code' });
  assert.equal(config.provider, 'opencode');
});

test('generateOpenCodeScanPrompt includes repository scan instructions', () => {
  const output = generateOpenCodeScanPrompt(process.cwd());
  assert.ok(output.fileCount > 0);
  assert.ok(output.routeCount >= 0);
  assert.match(output.prompt, /REPOSITORY_ROOT:/);
  assert.match(output.prompt, /Scan the entire repository rooted at REPOSITORY_ROOT/);
  assert.match(output.prompt, /HINT_ROUTE_METADATA_JSON:/);
});
