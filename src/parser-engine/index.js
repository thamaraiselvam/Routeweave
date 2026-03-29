'use strict';

/**
 * parser-engine/index.js
 *
 * Public API for the Routeweave Parser Co-Engine.
 *
 * Usage:
 *   const { runParser } = require('./src/parser-engine');
 *   const result = await runParser('/path/to/repo', {
 *     onProgress: ({ file, index, total, routesFound }) => { ... }
 *   });
 *
 * runParser() returns:
 * {
 *   fileCount:       number,
 *   routeCount:      number,
 *   apiKnowledge:    { apis: object[] }[],   // written to api_knowledge.json
 *   report:          object,                  // written to scan_parse_report.json engine section
 *   durationMs:      number,
 * }
 */

const fs   = require('fs');
const path = require('path');

const { walkRepository }    = require('../engine/scanner');
const { buildGraph }        = require('../engine/graphBuilder');
const { ensureCacheDir }    = require('../engine/cache');
const { defaultRegistry }   = require('./registry');
const { buildApiKnowledge } = require('./flow-builder');
const { buildReport }       = require('./reporter');

/**
 * Run the full parser co-engine pipeline on a repository.
 *
 * Pipeline:
 *   1. Walk repository → collect all source file paths
 *   2. Load package.json (if present) and detect adapters
 *   3. For each source file:
 *      a. Read content
 *      b. extractHandlerChain() via detected adapter(s)
 *      c. Emit onProgress event
 *   4. flow-builder → produce api_knowledge entries from chains
 *   5. reporter → build aggregate metrics
 *   6. Write api_knowledge.json + scan_parse_report.json (engine section)
 *   7. Regenerate graph.json from new api_knowledge
 *
 * @param {string} repoPath — absolute or relative path to repository root
 * @param {{
 *   onProgress?: (event: {
 *     file: string,
 *     index: number,
 *     total: number,
 *     routesFound: number,
 *     score?: number,
 *   }) => void,
 *   adapters?: object[],    // override detected adapters (for testing)
 * }} [opts]
 * @returns {Promise<{
 *   fileCount: number,
 *   routeCount: number,
 *   apiKnowledge: object[],
 *   report: object,
 *   durationMs: number,
 * }>}
 */
async function runParser(repoPath, opts = {}) {
  const { onProgress } = opts;
  const root = path.resolve(repoPath);
  const startedAt = Date.now();
  const scannedAt = new Date().toISOString();

  // ── 1. Discover files ────────────────────────────────────────────────────
  const files = walkRepository(root);

  // ── 2. Detect adapters ───────────────────────────────────────────────────
  let pkgJson = null;
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try { pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { /* ignore */ }
  }

  let adapters;
  if (opts.adapters) {
    adapters = opts.adapters;
  } else {
    adapters = defaultRegistry.detect(files, pkgJson);
    if (adapters.length === 0) {
      // Fallback: use express adapter (best general coverage)
      const ea = defaultRegistry.get('express');
      if (ea) adapters = [ea];
    }
  }

  // ── 3. Build allFiles map (relativePath → content) ──────────────────────
  // The express adapter needs this for import-chain tracing.
  const allFiles = new Map();
  for (const fp of files) {
    const rel = path.relative(root, fp).replace(/\\/g, '/');
    try {
      allFiles.set(rel, fs.readFileSync(fp, 'utf8'));
    } catch { /* skip unreadable */ }
  }

  // ── 4. Per-file extraction ───────────────────────────────────────────────
  const fileResults = [];
  const total = files.length;
  let totalRoutes = 0;

  for (let i = 0; i < files.length; i++) {
    const fp = files[i];
    const rel = path.relative(root, fp).replace(/\\/g, '/');
    const content = allFiles.get(rel) || '';

    // Collect chains from all matching adapters
    let chains = [];
    for (const adapter of adapters) {
      try {
        const c = adapter.extractHandlerChain(rel, content, allFiles);
        if (Array.isArray(c)) chains = chains.concat(c);
      } catch { /* skip errors in individual files */ }
    }

    totalRoutes += chains.length;
    fileResults.push({ filePath: rel, chains });

    if (onProgress) {
      onProgress({
        file:        rel,
        index:       i + 1,
        total,
        routesFound: chains.length,
      });
    }
  }

  const durationMs = Date.now() - startedAt;

  // ── 5. Build api_knowledge ───────────────────────────────────────────────
  const allChains = fileResults.map(r => r.chains);
  const apiKnowledge = buildApiKnowledge(allChains);

  // ── 6. Build report ──────────────────────────────────────────────────────
  const report = buildReport(fileResults, { scannedAt, durationMs });

  // ── 7. Write cache files ─────────────────────────────────────────────────
  const cacheDir = ensureCacheDir(root);

  // api_knowledge.json
  fs.writeFileSync(
    path.join(cacheDir, 'api_knowledge.json'),
    JSON.stringify(apiKnowledge, null, 2),
  );

  // scan_parse_report.json — merge engine section into existing report if present
  const reportPath = path.join(cacheDir, 'scan_parse_report.json');
  let existingReport = {};
  if (fs.existsSync(reportPath)) {
    try { existingReport = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { /* ignore */ }
  }
  const mergedReport = { ...existingReport, ...report };
  fs.writeFileSync(reportPath, JSON.stringify(mergedReport, null, 2));

  // Regenerate graph.json
  const graph = buildGraph(apiKnowledge);
  fs.writeFileSync(path.join(cacheDir, 'graph.json'), JSON.stringify(graph, null, 2));

  // scan_state.json
  fs.writeFileSync(
    path.join(cacheDir, 'scan_state.json'),
    JSON.stringify({ scannedAt, apiCount: apiKnowledge.length, engine: 'parser-co-engine' }, null, 2),
  );

  return {
    fileCount:    files.length,
    routeCount:   totalRoutes,
    apiKnowledge,
    report,
    durationMs,
  };
}

module.exports = { runParser };
