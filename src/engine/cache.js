const fs = require('fs');
const path = require('path');

const CACHE_DIR = '.apilens';

function ensureCacheDir(rootDir) {
  const cacheDir = path.join(rootDir, CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

function writeCache(rootDir, data) {
  const cacheDir = ensureCacheDir(rootDir);
  fs.writeFileSync(path.join(cacheDir, 'graph.json'), JSON.stringify(data.graph, null, 2));
  fs.writeFileSync(path.join(cacheDir, 'api_knowledge.json'), JSON.stringify(data.apiKnowledge, null, 2));
  fs.writeFileSync(path.join(cacheDir, 'metadata.json'), JSON.stringify(data.metadata, null, 2));
  fs.writeFileSync(
    path.join(cacheDir, 'scan_state.json'),
    JSON.stringify({ scannedAt: new Date().toISOString(), apiCount: data.apiKnowledge.length }, null, 2),
  );
}

/**
 * Reads the API knowledge cache from rootDir/.apilens/.
 *
 * Only api_knowledge.json is strictly required (it drives all dashboard views).
 * graph.json and scan_state.json are derived artifacts — they are auto-generated
 * from api_knowledge.json on first serve if absent, so the scan prompt no longer
 * needs to instruct the AI to run a separate build step.
 * metadata.json is optional; it falls back to an empty array if not present.
 */
function readCache(rootDir) {
  const cacheDir = path.join(rootDir, CACHE_DIR);

  // --- Required: api_knowledge.json drives every dashboard view ---
  const apiKnowledge = JSON.parse(fs.readFileSync(path.join(cacheDir, 'api_knowledge.json'), 'utf8'));

  // --- Optional: metadata.json (raw route metadata / audit trail) ---
  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(path.join(cacheDir, 'metadata.json'), 'utf8'));
  } catch { /* not present — safe to skip */ }

  // --- Derived: graph.json — auto-build from api_knowledge if missing ---
  const graphPath = path.join(cacheDir, 'graph.json');
  let graph;
  if (fs.existsSync(graphPath)) {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } else {
    const { buildGraph } = require('./graphBuilder');
    graph = buildGraph(apiKnowledge);
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  }

  // --- Derived: scan_state.json — auto-create from api_knowledge if missing ---
  const statePath = path.join(cacheDir, 'scan_state.json');
  let scanState;
  if (fs.existsSync(statePath)) {
    scanState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } else {
    scanState = { scannedAt: new Date().toISOString(), apiCount: apiKnowledge.length };
    fs.writeFileSync(statePath, JSON.stringify(scanState, null, 2));
  }

  return { graph, apiKnowledge, metadata, scanState };
}

module.exports = { ensureCacheDir, writeCache, readCache, CACHE_DIR };
