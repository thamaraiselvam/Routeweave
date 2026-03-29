'use strict';

const path = require('path');
const { createBaseAdapter } = require('../base-adapter');
const {
  getLineNumber,
  walkImports,
  aggregateChainSignals,
  buildStepLabel,
} = require('./_helpers');

// Detection patterns
const EXPRESS_PKG_NAMES = new Set(['express', 'express-router', '@types/express']);

const EXPRESS_SOURCE_PATTERNS = [
  /(?:app|router)\.(get|post|put|delete|patch|options|head|all)\s*\(/i,
  /require\s*\(\s*['"`]express['"`]\s*\)/,
  /from\s+['"`]express['"`]/,
];

// Route extraction patterns
// Matches: app.get('/path', ...) | router.post('/path', ...) | server.put(...)
const ROUTE_DECL_RE = /(?:^|[;\n])\s*(?:app|router|server|api|v\d+Router?\b[\w]*)\s*\.\s*(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"`])([^'"`\n]+)\2/gim;

// Matches: router.route('/path').get(...).post(...)
const ROUTE_CHAIN_RE = /(?:app|router|server)\s*\.\s*route\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)\s*(?:\.\s*(get|post|put|delete|patch|options|head|all)\s*\([^)]*\)\s*)+/gim;
const CHAINED_METHOD_RE = /\.\s*(get|post|put|delete|patch|options|head|all)\s*\(/gi;

// Matches: router.use('/prefix', subRouter)
const ROUTER_USE_RE = /(?:app|router)\s*\.\s*use\s*\(\s*(['"`])([^'"`\n]+)\1\s*,/gim;

// Middleware in route: app.get('/path', authMiddleware, handler)
const MIDDLEWARE_IN_ROUTE_RE = /\.\s*(?:get|post|put|delete|patch|options|head|all)\s*\([^,]+,\s*([\w\s,]+?)(?:(?:async\s*)?\([^)]*\)\s*=>|function\s*\()/g;

const expressAdapter = {
  ...createBaseAdapter('express'),

  detect(files, pkgJson) {
    if (pkgJson) {
      const allDeps = {
        ...(pkgJson.dependencies || {}),
        ...(pkgJson.devDependencies || {}),
      };
      for (const dep of Object.keys(allDeps)) {
        if (EXPRESS_PKG_NAMES.has(dep)) return true;
      }
    }
    let checked = 0;
    for (const f of files) {
      if (checked >= 20) break;
      if (!/\.[jt]sx?$/.test(f)) continue;
      checked++;
      try {
        const content = require('fs').readFileSync(f, 'utf8');
        if (EXPRESS_SOURCE_PATTERNS.some(re => re.test(content))) return true;
      } catch { /* skip unreadable files */ }
    }
    return false;
  },

  extractRoutes(filePath, content) {
    const routes = [];

    // Standard route declarations: app.get('/path', ...)
    const re = new RegExp(ROUTE_DECL_RE.source, ROUTE_DECL_RE.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      const method  = m[1].toUpperCase();
      const rawPath = m[3];
      const lineNumber = getLineNumber(content, m.index);

      const middlewares = [];
      const afterDecl = content.slice(m.index, m.index + 300);
      const mwRe = new RegExp(MIDDLEWARE_IN_ROUTE_RE.source, 'g');
      const mwMatch = mwRe.exec(afterDecl);
      if (mwMatch && mwMatch[1]) {
        mwMatch[1].split(',').map(s => s.trim()).filter(Boolean).forEach(mw => {
          if (!/^\s*(?:async\s*)?\(/.test(mw)) middlewares.push(mw);
        });
      }

      routes.push({
        method,
        path:       rawPath,
        filePath,
        lineNumber,
        framework:  'express',
        middlewares,
      });
    }

    // Chained route declarations: router.route('/path').get(...).post(...)
    const chainRe = new RegExp(ROUTE_CHAIN_RE.source, ROUTE_CHAIN_RE.flags);
    while ((m = chainRe.exec(content)) !== null) {
      const routePath = m[2];
      const lineNumber = getLineNumber(content, m.index);
      const fragment = m[0];
      const methodRe = new RegExp(CHAINED_METHOD_RE.source, CHAINED_METHOD_RE.flags);
      let methodMatch;
      while ((methodMatch = methodRe.exec(fragment)) !== null) {
        const method = methodMatch[1].toUpperCase();
        const key = method + ':' + routePath;
        if (!routes.some(r => r.method === method && r.path === routePath)) {
          routes.push({
            method,
            path:       routePath,
            filePath,
            lineNumber,
            framework:  'express',
            middlewares: [],
          });
        }
      }
    }

    return routes;
  },

  extractHandlerChain(filePath, content, allFiles) {
    const routes = this.extractRoutes(filePath, content);
    if (routes.length === 0) return [];

    const chain = require('./_helpers').walkImports(filePath, content, allFiles, 3);
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

module.exports = expressAdapter;
