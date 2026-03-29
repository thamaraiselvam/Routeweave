'use strict';

const { createBaseAdapter } = require('../base-adapter');
const {
  getLineNumber,
  walkImports,
  aggregateChainSignals,
} = require('./_helpers');

const HTTPSERVER_PKG_NAMES = new Set(['http', 'https', 'node:http', 'node:https']);

const HTTPSERVER_SOURCE_PATTERNS = [
  /http\.createServer\s*\(/,
  /https\.createServer\s*\(/,
  /server\s*\.\s*on\s*\(\s*['"`]request['"`]/,
  /\.listen\s*\(\s*\d+/,
];

// req.method === 'GET' && req.url === '/path' (or startsWith, match, etc.)
const METHOD_CHECK_RE = /req(?:uest)?\.method\s*===?\s*['"`](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['"`]/gi;
const URL_CHECK_RE = /req(?:uest)?\.url\s*(?:===?\s*['"`]([^'"`\n]+)['"`]|\.startsWith\s*\(\s*['"`]([^'"`\n]+)['"`]\s*\)|\.match\s*\(\s*['"`/]([^'"`\n/]+))/gi;

// if (url === '/path') or case '/path':
const CASE_URL_RE = /case\s+['"`](\/[^'"`\n]+)['"`]\s*:/gi;
const IF_URL_RE = /(?:url|pathname|req\.url)\s*===?\s*['"`](\/[^'"`\n]+)['"`]/gi;

const httpserverAdapter = {
  ...createBaseAdapter('httpserver'),

  detect(files, pkgJson) {
    if (pkgJson) {
      const allDeps = {
        ...(pkgJson.dependencies || {}),
        ...(pkgJson.devDependencies || {}),
      };
      for (const dep of Object.keys(allDeps)) {
        if (HTTPSERVER_PKG_NAMES.has(dep)) return true;
      }
    }
    let checked = 0;
    for (const f of files) {
      if (checked >= 20) break;
      if (!/\.[jt]sx?$/.test(f)) continue;
      checked++;
      try {
        const content = require('fs').readFileSync(f, 'utf8');
        if (HTTPSERVER_SOURCE_PATTERNS.some(re => re.test(content))) return true;
      } catch { /* skip */ }
    }
    return false;
  },

  extractRoutes(filePath, content) {
    if (!HTTPSERVER_SOURCE_PATTERNS.some(re => re.test(content))) return [];

    const routes = [];
    const methods = new Map();
    const paths = new Set();

    // Collect method checks
    const methodRe = new RegExp(METHOD_CHECK_RE.source, METHOD_CHECK_RE.flags);
    let m;
    while ((m = methodRe.exec(content)) !== null) {
      methods.set(m.index, m[1].toUpperCase());
    }

    // Collect URL checks
    const urlRe = new RegExp(URL_CHECK_RE.source, URL_CHECK_RE.flags);
    while ((m = urlRe.exec(content)) !== null) {
      const urlPath = m[1] || m[2] || m[3];
      if (urlPath) paths.add({ path: urlPath, index: m.index });
    }

    // Collect case statements
    const caseRe = new RegExp(CASE_URL_RE.source, CASE_URL_RE.flags);
    while ((m = caseRe.exec(content)) !== null) {
      paths.add({ path: m[1], index: m.index });
    }

    // Collect if-url comparisons
    const ifRe = new RegExp(IF_URL_RE.source, IF_URL_RE.flags);
    while ((m = ifRe.exec(content)) !== null) {
      paths.add({ path: m[1], index: m.index });
    }

    // Associate methods with paths by proximity (within 500 chars)
    const methodEntries = [...methods.entries()].sort((a, b) => a[0] - b[0]);
    const pathEntries = [...paths].sort((a, b) => a.index - b.index);

    const seen = new Set();
    for (const { path: routePath, index: pathIdx } of pathEntries) {
      let closestMethod = 'ALL';
      let closestDist = Infinity;
      for (const [methodIdx, method] of methodEntries) {
        const dist = Math.abs(pathIdx - methodIdx);
        if (dist < closestDist && dist < 500) {
          closestDist = dist;
          closestMethod = method;
        }
      }
      const key = closestMethod + ':' + routePath;
      if (seen.has(key)) continue;
      seen.add(key);

      routes.push({
        method: closestMethod,
        path: routePath,
        filePath,
        lineNumber: getLineNumber(content, pathIdx),
        framework: 'httpserver',
        middlewares: [],
      });
    }

    // Fallback: if we found methods but no paths, register them without specific paths
    if (routes.length === 0 && methods.size > 0) {
      const seenMethods = new Set();
      for (const [idx, method] of methodEntries) {
        if (seenMethods.has(method)) continue;
        seenMethods.add(method);
        routes.push({
          method,
          path: '/',
          filePath,
          lineNumber: getLineNumber(content, idx),
          framework: 'httpserver',
          middlewares: [],
        });
      }
    }

    return routes;
  },

  extractHandlerChain(filePath, content, allFiles) {
    const routes = this.extractRoutes(filePath, content);
    if (routes.length === 0) return [];

    const chain = walkImports(filePath, content, allFiles, 3);
    const signals = aggregateChainSignals(chain);

    return routes.map(route => ({
      route,
      steps:       signals.steps,
      tables:      signals.tables,
      tableAccess: signals.tableAccess,
      services:    signals.services,
      caches:      signals.caches,
      queues:      signals.queues,
      imports:     signals.imports,
    }));
  },
};

module.exports = httpserverAdapter;
