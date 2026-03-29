'use strict';

/**
 * reporter.js
 *
 * Builds aggregate scan metrics from the per-file HandlerChain results
 * produced by the parser co-engine.
 *
 * Output shape (scan_parse_report.json addition — co-engine section):
 * {
 *   engine: {
 *     scannedAt: ISO string,
 *     durationMs: number,
 *     totalFilesScanned: number,
 *     totalRoutes: number,
 *     totalApiEntries: number,
 *     totalTables: number,
 *     filesWithRoutes: number,
 *     filesWithDb: number,
 *     filesWithServices: number,
 *     filesWithCaches: number,
 *     filesWithQueues: number,
 *     frameworks: string[],
 *     byFramework: { [name]: { routes, files } },
 *     coverageScore: number,   // 0-100
 *     coverageGrade: string,   // A-F
 *     topTables: { table, count }[],
 *     topServices: { service, count }[],
 *     perFile: PerFileRecord[],
 *   }
 * }
 *
 * PerFileRecord {
 *   filePath: string,
 *   routes: number,
 *   framework: string,
 *   tables: string[],
 *   services: string[],
 *   caches: string[],
 *   queues: string[],
 *   chainDepth: number,     // max import depth reached
 *   score: number,          // 0-100 per-file coverage score
 * }
 */

/**
 * Letter grade from 0-100 score.
 */
function scoreGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 55) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

/**
 * Compute a per-file coverage score 0–100.
 *
 * Scoring heuristic:
 *   +30   just having routes
 *   +20   has db tables
 *   +15   has explicit column info (not just *)
 *   +10   has services
 *   +10   has chain steps (non-trivial depth)
 *   +10   has caches or queues
 *   +5    has proper SQL operations (not just UNKNOWN)
 */
function computeFileScore(record) {
  let score = 0;
  if (record.routes > 0) score += 30;
  if (record.tables.length > 0) score += 20;
  if (record.hasExplicitColumns) score += 15;
  if (record.services.length > 0) score += 10;
  if (record.chainDepth > 1) score += 10;
  if (record.caches.length > 0 || record.queues.length > 0) score += 10;
  if (record.hasKnownOps) score += 5;
  return Math.min(100, score);
}

/**
 * Build the full reporter output from per-file HandlerChain results.
 *
 * @param {{
 *   filePath: string,
 *   chains: import('./adapters/express').HandlerChain[],
 *   durationMs: number,
 * }[]} fileResults  — array of { filePath, chains[] } per scanned file
 * @param {{ scannedAt: string, durationMs: number }} meta
 * @returns {object}
 */
function buildReport(fileResults, meta) {
  const { scannedAt, durationMs } = meta;

  let totalRoutes = 0;
  let totalApiEntries = 0;
  let filesWithRoutes = 0;
  let filesWithDb = 0;
  let filesWithServices = 0;
  let filesWithCaches = 0;
  let filesWithQueues = 0;
  let totalCoverageSum = 0;

  const allTables = new Map();    // table → count
  const allServices = new Map();  // service → count
  const allFrameworks = new Set();
  const byFramework = {};

  const perFile = [];

  for (const { filePath, chains } of fileResults) {
    if (!chains || chains.length === 0) continue;

    // Aggregate signals from all chains in this file
    const routeCount = chains.length;
    const tables = new Set();
    const services = new Set();
    const caches = new Set();
    const queues = new Set();
    const frameworks = new Set();
    let hasExplicitColumns = false;
    let hasKnownOps = false;
    let maxDepth = 0;

    for (const chain of chains) {
      const fw = chain.route && chain.route.framework ? chain.route.framework : 'unknown';
      frameworks.add(fw);
      allFrameworks.add(fw);

      (chain.tables || []).forEach(t => tables.add(t));
      (chain.services || []).forEach(s => services.add(s));
      (chain.caches || []).forEach(c => caches.add(c));
      (chain.queues || []).forEach(q => queues.add(q));

      // Check for explicit column info and known ops
      (chain.tableAccess || []).forEach(ta => {
        if ((ta.columns || []).some(c => c !== '*')) hasExplicitColumns = true;
        if ((ta.operations || []).some(o => o !== 'UNKNOWN')) hasKnownOps = true;
      });

      // Chain depth from steps
      const depth = (chain.steps || []).reduce((max, s) => Math.max(max, s.depth || 1), 1);
      if (depth > maxDepth) maxDepth = depth;
    }

    // Accumulate global tallies
    tables.forEach(t => allTables.set(t, (allTables.get(t) || 0) + 1));
    services.forEach(s => allServices.set(s, (allServices.get(s) || 0) + 1));

    // Per-framework breakdown
    frameworks.forEach(fw => {
      if (!byFramework[fw]) byFramework[fw] = { routes: 0, files: 0 };
      byFramework[fw].routes += routeCount;
      byFramework[fw].files++;
    });

    totalRoutes += routeCount;
    totalApiEntries += routeCount;
    if (routeCount > 0) filesWithRoutes++;
    if (tables.size > 0) filesWithDb++;
    if (services.size > 0) filesWithServices++;
    if (caches.size > 0) filesWithCaches++;
    if (queues.size > 0) filesWithQueues++;

    const record = {
      filePath,
      routes: routeCount,
      framework: [...frameworks][0] || 'unknown',
      tables: [...tables],
      services: [...services],
      caches: [...caches],
      queues: [...queues],
      chainDepth: maxDepth,
      hasExplicitColumns,
      hasKnownOps,
    };
    const fileScore = computeFileScore(record);
    delete record.hasExplicitColumns;
    delete record.hasKnownOps;

    totalCoverageSum += fileScore;
    perFile.push({ ...record, score: fileScore });
  }

  const fileCount = fileResults.length;
  const filesWithData = perFile.length;

  // Compute overall coverage score (0-100)
  //   40% = average per-file score
  //   30% = ratio of route files to total files scanned
  //   30% = ratio of db-signal files to route files
  const avgFileScore = filesWithData > 0 ? Math.round(totalCoverageSum / filesWithData) : 0;
  const routeRatio   = fileCount > 0 ? Math.min(100, (filesWithRoutes / fileCount) * 500) : 0;
  const dbRatio      = filesWithRoutes > 0 ? Math.min(100, (filesWithDb / filesWithRoutes) * 100) : 0;
  const coverageScore = Math.min(100, Math.round(avgFileScore * 0.4 + routeRatio * 0.3 + dbRatio * 0.3));

  // Top tables and services sorted by usage count
  const topTables = [...allTables.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([table, count]) => ({ table, count }));

  const topServices = [...allServices.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([service, count]) => ({ service, count }));

  return {
    engine: {
      scannedAt,
      durationMs,
      totalFilesScanned: fileCount,
      totalRoutes,
      totalApiEntries,
      totalTables: allTables.size,
      filesWithRoutes,
      filesWithDb,
      filesWithServices,
      filesWithCaches,
      filesWithQueues,
      frameworks: [...allFrameworks].sort(),
      byFramework,
      coverageScore,
      coverageGrade: scoreGrade(coverageScore),
      topTables,
      topServices,
      perFile,
    },
  };
}

module.exports = { buildReport, computeFileScore, scoreGrade };
