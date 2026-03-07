const fs = require('fs');
const path = require('path');

const CACHE_DIR = '.apimap';

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

function readCache(rootDir) {
  const cacheDir = path.join(rootDir, CACHE_DIR);
  const graph = JSON.parse(fs.readFileSync(path.join(cacheDir, 'graph.json'), 'utf8'));
  const apiKnowledge = JSON.parse(fs.readFileSync(path.join(cacheDir, 'api_knowledge.json'), 'utf8'));
  const metadata = JSON.parse(fs.readFileSync(path.join(cacheDir, 'metadata.json'), 'utf8'));
  const scanState = JSON.parse(fs.readFileSync(path.join(cacheDir, 'scan_state.json'), 'utf8'));
  return { graph, apiKnowledge, metadata, scanState };
}

module.exports = { ensureCacheDir, writeCache, readCache, CACHE_DIR };
