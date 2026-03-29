'use strict';

/**
 * scanStats.js
 *
 * Aggregates the per-file parse results produced by codeParser.js into a
 * structured scan report with scores, counts, and breakdowns that the
 * dashboard can display.
 *
 * Output shape (scan_parse_report.json):
 * {
 *   scannedAt: ISO string,
 *   durationMs: number,
 *   summary: {
 *     totalFiles: number,
 *     totalLines: number,
 *     totalCodeLines: number,
 *     totalRoutes: number,
 *     totalTables: number,
 *     totalImports: number,
 *     filesWithRoutes: number,
 *     filesWithSql: number,
 *     filesWithOrm: number,
 *     filesWithHttpCalls: number,
 *     filesWithCaches: number,
 *     filesWithQueues: number,
 *     averageCoverageScore: number,       // 0-100
 *     overallCoverageScore: number,       // 0-100
 *     overallCoverageGrade: string,       // A / B / C / D / F
 *   },
 *   byRole: { [role]: { count, lines, routes, coverageAvg } },
 *   byExtension: { [ext]: { count, lines, coverageAvg } },
 *   frameworks: string[],                 // detected frameworks
 *   orms: string[],                       // detected ORMs
 *   caches: string[],                     // detected cache layers
 *   queues: string[],                     // detected queue systems
 *   topPackages: { name, count }[],       // top-20 most imported npm packages
 *   tables: string[],                     // all unique table names (from SQL literals)
 *   routes: { method, path, framework, filePath }[],  // all discovered routes
 *   files: object[],                      // per-file records (from codeParser)
 * }
 */

/**
 * Compute the letter grade for a 0-100 score.
 */
function scoreGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 55) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

/**
 * Build the full scan stats report from a parseRepository() result.
 *
 * @param {{ files: object[], scannedAt: string, durationMs: number }} parseResult
 * @returns {object} full scan report
 */
function buildScanStats(parseResult) {
  const { files, scannedAt, durationMs } = parseResult;

  // ---- Aggregate counters ------------------------------------------------
  let totalLines = 0;
  let totalCodeLines = 0;
  let totalRoutes = 0;
  let filesWithRoutes = 0;
  let filesWithSql = 0;
  let filesWithOrm = 0;
  let filesWithHttpCalls = 0;
  let filesWithCaches = 0;
  let filesWithQueues = 0;
  let coverageSum = 0;

  const allTables = new Set();
  const allRoutes = [];
  const allFrameworks = new Set();
  const allOrms = new Set();
  const allCaches = new Set();
  const allQueues = new Set();
  const packageCounts = new Map();

  const byRole = {};
  const byExt = {};

  for (const f of files) {
    totalLines += f.lines || 0;
    totalCodeLines += f.codeLines || 0;
    coverageSum += f.coverageScore || 0;

    // Routes
    if (f.routes && f.routes.length > 0) {
      filesWithRoutes++;
      totalRoutes += f.routes.length;
      for (const r of f.routes) {
        allRoutes.push({ method: r.method, path: r.path, framework: r.framework, filePath: f.filePath });
        if (r.framework) allFrameworks.add(r.framework);
      }
    }

    // SQL
    if (f.sqlInfo && f.sqlInfo.fragmentCount > 0) {
      filesWithSql++;
      for (const t of f.sqlInfo.tables || []) allTables.add(t);
    }

    // ORM
    if (f.ormUsage && Object.keys(f.ormUsage).length > 0) {
      filesWithOrm++;
      for (const orm of Object.keys(f.ormUsage)) allOrms.add(orm);
      // ORM calls may hint at table/collection usage via model names
    }

    // HTTP calls
    if ((f.httpCallCount || 0) > 0) filesWithHttpCalls++;

    // Caches
    if (f.caches && f.caches.length > 0) {
      filesWithCaches++;
      for (const c of f.caches) allCaches.add(c);
    }

    // Queues
    if (f.queues && f.queues.length > 0) {
      filesWithQueues++;
      for (const q of f.queues) allQueues.add(q);
    }

    // Imports / packages
    for (const pkg of f.imports || []) {
      packageCounts.set(pkg, (packageCounts.get(pkg) || 0) + 1);
    }

    // By role
    const role = f.role || 'other';
    if (!byRole[role]) byRole[role] = { count: 0, lines: 0, codeLines: 0, routes: 0, coverageSum: 0, coverageAvg: 0 };
    byRole[role].count++;
    byRole[role].lines += f.lines || 0;
    byRole[role].codeLines += f.codeLines || 0;
    byRole[role].routes += (f.routes || []).length;
    byRole[role].coverageSum += f.coverageScore || 0;

    // By extension
    const ext = f.ext || '.js';
    if (!byExt[ext]) byExt[ext] = { count: 0, lines: 0, codeLines: 0, coverageSum: 0, coverageAvg: 0 };
    byExt[ext].count++;
    byExt[ext].lines += f.lines || 0;
    byExt[ext].codeLines += f.codeLines || 0;
    byExt[ext].coverageSum += f.coverageScore || 0;
  }

  // Finalize averages
  const n = files.length || 1;
  for (const role of Object.keys(byRole)) {
    const r = byRole[role];
    r.coverageAvg = Math.round(r.coverageSum / (r.count || 1));
    delete r.coverageSum;
  }
  for (const ext of Object.keys(byExt)) {
    const e = byExt[ext];
    e.coverageAvg = Math.round(e.coverageSum / (e.count || 1));
    delete e.coverageSum;
  }

  const averageCoverageScore = Math.round(coverageSum / n);

  // Overall coverage score weights:
  //  - raw file coverage average: 40%
  //  - route completeness (routes found vs files that should have them): 30%
  //  - db signal completeness (sql/orm found vs route files): 30%
  const routeFileRatio = filesWithRoutes > 0 ? Math.min(100, (filesWithRoutes / Math.max(1, n)) * 500) : 0;
  const dbSignalRatio  = filesWithRoutes > 0
    ? Math.min(100, ((filesWithSql + filesWithOrm) / Math.max(1, filesWithRoutes)) * 100)
    : 0;

  const overallCoverageScore = Math.round(
    averageCoverageScore * 0.4 + routeFileRatio * 0.3 + dbSignalRatio * 0.3
  );

  // Top packages
  const topPackages = [...packageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));

  return {
    scannedAt,
    durationMs,
    summary: {
      totalFiles: files.length,
      totalLines,
      totalCodeLines,
      totalRoutes,
      totalTables: allTables.size,
      totalImports: packageCounts.size,
      filesWithRoutes,
      filesWithSql,
      filesWithOrm,
      filesWithHttpCalls,
      filesWithCaches,
      filesWithQueues,
      averageCoverageScore,
      overallCoverageScore: Math.min(100, overallCoverageScore),
      overallCoverageGrade: scoreGrade(Math.min(100, overallCoverageScore)),
    },
    byRole,
    byExtension: byExt,
    frameworks: [...allFrameworks].sort(),
    orms: [...allOrms].sort(),
    caches: [...allCaches].sort(),
    queues: [...allQueues].sort(),
    topPackages,
    tables: [...allTables].sort(),
    routes: allRoutes,
    files,
  };
}

module.exports = { buildScanStats, scoreGrade };
