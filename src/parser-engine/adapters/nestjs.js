'use strict';

const { createBaseAdapter } = require('../base-adapter');
const {
  getLineNumber,
  walkImports,
  aggregateChainSignals,
} = require('./_helpers');

const NESTJS_PKG_NAMES = new Set(['@nestjs/core', '@nestjs/common']);

const NESTJS_SOURCE_PATTERNS = [
  /@Controller\s*\(/,
  /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(/,
  /@Module\s*\(/,
];

// @Controller('prefix') or @Controller() or @Controller
const CONTROLLER_PREFIX_RE = /@Controller\s*\(\s*(?:['"`]([^'"`\n]*)['"`])?\s*\)/g;

// @Get('path'), @Post('path'), etc. — path is optional (defaults to '/')
const ROUTE_DECORATOR_RE = /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*(?:['"`]([^'"`\n]*)['"`])?\s*\)/g;

const nestjsAdapter = {
  ...createBaseAdapter('nestjs'),

  detect(files, pkgJson) {
    if (pkgJson) {
      const allDeps = {
        ...(pkgJson.dependencies || {}),
        ...(pkgJson.devDependencies || {}),
      };
      for (const dep of Object.keys(allDeps)) {
        if (NESTJS_PKG_NAMES.has(dep)) return true;
      }
    }
    // Fallback: check for NestJS decorators in source files
    let checked = 0;
    for (const f of files) {
      if (checked >= 20) break;
      if (!/\.[jt]sx?$/.test(f)) continue;
      checked++;
      try {
        const content = require('fs').readFileSync(f, 'utf8');
        if (NESTJS_SOURCE_PATTERNS.some(re => re.test(content))) return true;
      } catch { /* skip */ }
    }
    return false;
  },

  extractRoutes(filePath, content) {
    // Only process files that contain NestJS decorators
    if (!NESTJS_SOURCE_PATTERNS.some(re => re.test(content))) return [];

    const routes = [];

    // 1. Extract controller prefix(es) from @Controller('prefix')
    //    A file may have multiple controllers (rare but possible)
    const prefixes = [];
    const ctrlRe = new RegExp(CONTROLLER_PREFIX_RE.source, CONTROLLER_PREFIX_RE.flags);
    let cm;
    while ((cm = ctrlRe.exec(content)) !== null) {
      const raw = cm[1] || '';
      // Normalize: strip leading/trailing slashes, prepend '/'
      const cleaned = raw.replace(/^\/+|\/+$/g, '');
      prefixes.push(cleaned ? '/' + cleaned : '');
    }

    // If no @Controller found, use empty prefix (could be a standalone provider with routes)
    if (prefixes.length === 0) {
      prefixes.push('');
    }

    // 2. Extract route decorators: @Get('path'), @Post('path'), etc.
    const decorRe = new RegExp(ROUTE_DECORATOR_RE.source, ROUTE_DECORATOR_RE.flags);
    let dm;
    while ((dm = decorRe.exec(content)) !== null) {
      const method = dm[1].toUpperCase();
      const rawPath = dm[2] || '';
      const cleanedPath = rawPath.replace(/^\/+|\/+$/g, '');
      const suffix = cleanedPath ? '/' + cleanedPath : '';

      // Combine each controller prefix with this route path
      for (const prefix of prefixes) {
        const fullPath = prefix + suffix || '/';
        // Convert NestJS :param style (already standard) — handle potential {param} style too
        const normalizedPath = fullPath.replace(/\{([^}]+)\}/g, ':$1');

        routes.push({
          method,
          path: normalizedPath,
          filePath,
          lineNumber: getLineNumber(content, dm.index),
          framework: 'nestjs',
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

module.exports = nestjsAdapter;
