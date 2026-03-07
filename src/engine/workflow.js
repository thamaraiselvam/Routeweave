const path = require('path');
const { walkRepository } = require('./scanner');
const { extractMetadata } = require('./metadataExtractor');
const { summarizeApi } = require('./aiClient');
const { validateApiSummary } = require('./aiValidator');
const { buildGraph } = require('./graphBuilder');
const { writeCache } = require('./cache');

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
    aiProvider: (options.aiProvider || process.env.APIMAP_AI_PROVIDER || 'mock').toLowerCase(),
  };
}

module.exports = { scanRepository };
