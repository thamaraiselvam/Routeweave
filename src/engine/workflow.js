const path = require('path');
const { walkRepository } = require('./scanner');
const { extractMetadata } = require('./metadataExtractor');
const { summarizeApi, resolveAiConfig } = require('./aiClient');
const { validateApiSummary } = require('./aiValidator');
const { buildGraph } = require('./graphBuilder');
const { writeCache } = require('./cache');

function generateOpenCodeScanPrompt(repoPath) {
  const root = path.resolve(repoPath);
  const files = walkRepository(root);
  const metadata = extractMetadata(files);
  const metadataJson = JSON.stringify(metadata, null, 2);

  const prompt = [
    'You are preparing APIMap cache files for this repository.',
    `REPOSITORY_ROOT: ${root}`,
    '',
    'Execute these steps exactly:',
    '1) Scan the entire repository rooted at REPOSITORY_ROOT (recursive, all source folders). Do not limit yourself to sample snippets or only one subfolder.',
    '2) Find API linkages end-to-end: API handlers/routes, service calls, database tables, caches, queues, and upstream/downstream hops.',
    '3) Create `.apimap/metadata.json` as a JSON array of discovered API route entries. Each entry should include:',
    '{ "method": "GET", "path": "/users", "framework": "express|nestjs|nextjs-app-router|other", "filePath": "relative/path", "tables": [], "services": [], "caches": [], "queues": [], "code": "short relevant snippet" }',
    '4) Create `.apimap/api_knowledge.json` as a JSON array with one summary object per API route. Each object must look like:',
    '{ "apis": [{ "method": "GET", "path": "/users", "summary": "...", "flow": ["..."], "tables": [], "services": [], "caches": [], "queues": [] }] }',
    '5) Use HINT_ROUTE_METADATA_JSON below only as a bootstrap hint. It is not exhaustive and must not replace your full repository scan.',
    '6) After writing `.apimap/api_knowledge.json`, run this exact command to generate deterministic graph and scan state:',
    '',
    'node - <<\'NODE\'',
    'const fs = require(\'fs\');',
    'const { buildGraph } = require(\'./src/engine/graphBuilder\');',
    'const apiKnowledge = JSON.parse(fs.readFileSync(\'.apimap/api_knowledge.json\', \'utf8\'));',
    'const graph = buildGraph(apiKnowledge);',
    'fs.writeFileSync(\'.apimap/graph.json\', JSON.stringify(graph, null, 2));',
    'fs.writeFileSync(\'.apimap/scan_state.json\', JSON.stringify({ scannedAt: new Date().toISOString(), apiCount: apiKnowledge.length }, null, 2));',
    'NODE',
    '',
    '7) Validate all four files exist: `.apimap/metadata.json`, `.apimap/api_knowledge.json`, `.apimap/graph.json`, `.apimap/scan_state.json`.',
    '8) Return a short success message with route count and node count from graph.',
    '',
    'HINT_ROUTE_METADATA_JSON:',
    metadataJson,
  ].join('\n');

  return {
    fileCount: files.length,
    routeCount: metadata.length,
    prompt,
  };
}

async function scanRepository(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  const files = walkRepository(root);
  const metadata = extractMetadata(files);

  const apiKnowledge = [];
  for (const routeData of metadata) {
    const summary = await summarizeApi(routeData, options);
    validateApiSummary(summary);
    apiKnowledge.push(summary);
  }

  const graph = buildGraph(apiKnowledge);
  writeCache(root, { graph, apiKnowledge, metadata });

  return {
    fileCount: files.length,
    routeCount: metadata.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    aiProvider: resolveAiConfig(options).provider,
  };
}

module.exports = { scanRepository, generateOpenCodeScanPrompt };
