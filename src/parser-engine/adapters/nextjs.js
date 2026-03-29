'use strict';

const path = require('path');
const { createBaseAdapter } = require('../base-adapter');
const {
  getLineNumber,
  walkImports,
  aggregateChainSignals,
} = require('./_helpers');

const NEXTJS_PKG_NAMES = new Set(['next', '@next/core']);

// App Router: export function GET|POST|... in app/api/**/route.ts|js
const APP_ROUTER_EXPORT_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(/g;

// Pages Router: export default function handler(req, res) or module.exports = (req, res)
const PAGES_HANDLER_RE = /(?:export\s+default\s+(?:async\s+)?function\s*\w*|module\.exports\s*=\s*(?:async\s+)?function\s*\w*|export\s+default\s+(?:async\s+)?\(|module\.exports\s*=\s*(?:async\s+)?\()\s*\(\s*(?:req(?:uest)?|ctx)\s*[,:]/g;

// Method checks inside Pages Router handlers
const PAGES_METHOD_RE = /req(?:uest)?\.method\s*===?\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/gi;

const nextjsAdapter = {
  ...createBaseAdapter('nextjs'),

  detect(files, pkgJson) {
    if (pkgJson) {
      const allDeps = {
        ...(pkgJson.dependencies || {}),
        ...(pkgJson.devDependencies || {}),
      };
      if (allDeps['next']) return true;
    }
    // Check for app/api or pages/api directory structure
    for (const f of files) {
      const norm = f.replace(/\\/g, '/');
      if (/\/app\/api\/.+\/route\.[jt]sx?$/.test(norm)) return true;
      if (/\/pages\/api\/.+\.[jt]sx?$/.test(norm)) return true;
    }
    return false;
  },

  extractRoutes(filePath, content) {
    const routes = [];
    const normalized = filePath.replace(/\\/g, '/');

    // ── App Router: app/api/**/route.ts|js ──
    const isAppRoute = /app\/api\/.+\/route\.[jt]sx?$/.test(normalized);
    if (isAppRoute) {
      const routePath = inferAppRouterPath(normalized);
      const re = new RegExp(APP_ROUTER_EXPORT_RE.source, APP_ROUTER_EXPORT_RE.flags);
      let m;
      while ((m = re.exec(content)) !== null) {
        routes.push({
          method: m[1].toUpperCase(),
          path: routePath,
          filePath,
          lineNumber: getLineNumber(content, m.index),
          framework: 'nextjs-app-router',
          middlewares: [],
        });
      }
    }

    // ── Pages Router: pages/api/**/*.ts|js ──
    const isPagesRoute = /pages\/api\/.+\.[jt]sx?$/.test(normalized);
    if (isPagesRoute && !isAppRoute) {
      const routePath = inferPagesRouterPath(normalized);
      const handlerRe = new RegExp(PAGES_HANDLER_RE.source, PAGES_HANDLER_RE.flags);

      if (handlerRe.test(content)) {
        // Check for explicit method checks
        const methodRe = new RegExp(PAGES_METHOD_RE.source, PAGES_METHOD_RE.flags);
        const foundMethods = new Set();
        let m;
        while ((m = methodRe.exec(content)) !== null) {
          foundMethods.add(m[1].toUpperCase());
        }

        if (foundMethods.size > 0) {
          for (const method of foundMethods) {
            routes.push({
              method,
              path: routePath,
              filePath,
              lineNumber: 1,
              framework: 'nextjs-pages-router',
              middlewares: [],
            });
          }
        } else {
          // Default: treat as ALL methods handler
          routes.push({
            method: 'ALL',
            path: routePath,
            filePath,
            lineNumber: 1,
            framework: 'nextjs-pages-router',
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

/**
 * Derive API route path from App Router file path.
 * e.g. "src/app/api/users/[id]/route.ts" → "/api/users/:id"
 */
function inferAppRouterPath(filePath) {
  const marker = '/app/api/';
  const idx = filePath.indexOf(marker);
  if (idx === -1) return '/api';

  const segment = filePath.slice(idx + marker.length, filePath.lastIndexOf('/route.'));
  if (!segment) return '/api';

  const converted = segment
    .split('/')
    .map(s => s.replace(/^\[\.{3}(.+)\]$/, ':$1*').replace(/^\[(.+)\]$/, ':$1'))
    .join('/');
  return '/api/' + converted;
}

/**
 * Derive API route path from Pages Router file path.
 * e.g. "pages/api/users/[id].ts" → "/api/users/:id"
 */
function inferPagesRouterPath(filePath) {
  const marker = '/pages/api/';
  const idx = filePath.indexOf(marker);
  if (idx === -1) return '/api';

  let segment = filePath.slice(idx + marker.length);
  // Remove file extension
  segment = segment.replace(/\.[jt]sx?$/, '');
  // Remove /index suffix
  segment = segment.replace(/\/index$/, '');

  if (!segment) return '/api';

  const converted = segment
    .split('/')
    .map(s => s.replace(/^\[\.{3}(.+)\]$/, ':$1*').replace(/^\[(.+)\]$/, ':$1'))
    .join('/');
  return '/api/' + converted;
}

module.exports = nextjsAdapter;
