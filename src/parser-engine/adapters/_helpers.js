'use strict';

/**
 * _helpers.js
 *
 * Shared helper functions for all parser-engine adapters.
 *
 * Extracted from the Express adapter so that httpServer, Next.js, NestJS,
 * and any future adapters can reuse the same SQL/ORM/import/signal
 * extraction logic without duplicating code.
 */

const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Import detection patterns
// ─────────────────────────────────────────────────────────────────────────────

// require('./path') or require('../path')
const LOCAL_REQUIRE_RE = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"`](\.\.?\/[^'"`\n]+)['"`]\s*\)/g;
// import { X } from './path'  or  import X from './path'
const LOCAL_IMPORT_RE = /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"`](\.\.?\/[^'"`\n]+)['"`]/g;

// ─────────────────────────────────────────────────────────────────────────────
// SQL patterns
// ─────────────────────────────────────────────────────────────────────────────

const SQL_FRAGMENT_RE = /`([^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b[^`]*)`|'([^']{8,}\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^']*)'|"([^"]{8,}\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"]*)"/gi;
const SQL_TABLE_FROM_RE   = /\bFROM\s+([a-zA-Z0-9_.`"[\]]+)/gi;
const SQL_TABLE_JOIN_RE   = /\bJOIN\s+([a-zA-Z0-9_.`"[\]]+)/gi;
const SQL_TABLE_INTO_RE   = /\bINTO\s+([a-zA-Z0-9_.`"[\]]+)/gi;
const SQL_TABLE_UPDATE_RE = /\bUPDATE\s+([a-zA-Z0-9_.`"[\]]+)\s+SET/gi;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP client call patterns
// ─────────────────────────────────────────────────────────────────────────────

const HTTP_CLIENT_RE = [
  /\baxios\s*\.\s*(?:get|post|put|delete|patch|request)\s*\(\s*(?:['"`]([^'"`\n]+)['"`]|\w)/gi,
  /\bfetch\s*\(\s*['"`]([^'"`\n]+)['"`]/gi,
  /\bgot\s*\.\s*(?:get|post|put|delete|patch)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi,
  /\bundici\s*\.\s*(?:fetch|request)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi,
];

// ─────────────────────────────────────────────────────────────────────────────
// Cache and queue detection
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_RE = [
  { re: /\bredis\b|\bRedisClient\b|\bcreateClient\s*\(/i, name: 'redis' },
  { re: /\bMemcached\b|\bmemcached\b/i, name: 'memcached' },
  { re: /\bNodeCache\b/i, name: 'node-cache' },
  { re: /\bLRUCache\b|\blru-cache\b/i, name: 'lru-cache' },
  { re: /\bcache\s*\.\s*(?:get|set|del|flush)\s*\(/i, name: 'in-memory' },
];
const QUEUE_RE = [
  { re: /\bkafka\b|\bKafkaProducer\b|\bKafkaConsumer\b/i, name: 'kafka' },
  { re: /\bRabbitMQ\b|\bamqplib\b/i, name: 'rabbitmq' },
  { re: /\bSQS\b|\bsqs\s*\./i, name: 'sqs' },
  { re: /\bBullMQ\b|\bnew\s+Queue\s*\(|\bQueue\s*\(\s*['"`]|\bWorker\s*\(\s*['"`]/i, name: 'bullmq' },
  { re: /\bnats\s*\./i, name: 'nats' },
  { re: /\bpulsar\b/i, name: 'pulsar' },
];

// ─────────────────────────────────────────────────────────────────────────────
// npm package import detection
// ─────────────────────────────────────────────────────────────────────────────

const PKG_REQUIRE_RE = /\brequire\s*\(\s*['"`]([^./][^'"`\n]*)['"`]\s*\)/g;
const PKG_IMPORT_RE  = /\bimport\s+(?:[\w{},\s*]+\s+from\s+)?['"`]([^./][^'"`\n]*)['"`]/g;

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function cleanIdentifier(v) {
  return String(v || '').trim()
    .replace(/^[`"'[\s]+/, '').replace(/[`"'\]\s;,]+$/, '');
}

function dedupeArray(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all SQL table names touched in a block of content.
 * Returns { tables, operations, evidence }
 */
function extractSqlInfo(content) {
  const tables = new Set();
  const operations = new Set();
  const evidence = [];

  const fragRe = new RegExp(SQL_FRAGMENT_RE.source, 'gi');
  let fm;
  while ((fm = fragRe.exec(content)) !== null) {
    const fragment = fm[1] || fm[2] || fm[3] || '';
    if (!fragment) continue;

    const opMatch = fragment.match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/i);
    if (opMatch) operations.add(opMatch[1].toUpperCase());

    if (evidence.length < 2) evidence.push(fragment.slice(0, 120).replace(/\s+/g, ' '));

    for (const [tableRe] of [
      [SQL_TABLE_FROM_RE], [SQL_TABLE_JOIN_RE],
      [SQL_TABLE_INTO_RE], [SQL_TABLE_UPDATE_RE],
    ]) {
      const re = new RegExp(tableRe.source, tableRe.flags);
      let tm;
      while ((tm = re.exec(fragment)) !== null) {
        const t = cleanIdentifier(tm[1]);
        if (t && t.length > 1 && !/^(select|insert|update|delete|where|set|values|join|from|into|on|as)$/i.test(t)) {
          tables.add(t.toLowerCase());
        }
      }
    }
  }

  return {
    tables: [...tables],
    operations: [...operations],
    evidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORM extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract table names from ORM call-site patterns.
 * Returns model names inferred from variable names like `User.findOne(...)`.
 */
function extractOrmTableHints(content) {
  const hints = [];

  // Pattern: SomeModel.ormMethod(  →  infer table name from model
  const modelCallRe = /\b([A-Z][a-zA-Z0-9]*)(?:Model|Schema|Repository|Repo)?\s*\.\s*(?:find|create|save|update|delete|insert|upsert|remove|count|aggregate)\w*\s*\(/g;
  let m;
  while ((m = modelCallRe.exec(content)) !== null) {
    const modelName = m[1];
    const tableName = modelName
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
    hints.push({ model: modelName, table: tableName + 's' });
  }

  // Prisma: prisma.tableName.method(
  const prismaRe = /\bprisma\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*(?:findUnique|findFirst|findMany|create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/g;
  while ((m = prismaRe.exec(content)) !== null) {
    hints.push({ model: m[1], table: m[1] });
  }

  // Mongoose: new Model(
  const mongooseRe = /\bnew\s+([A-Z][a-zA-Z0-9]*)\s*\(/g;
  while ((m = mongooseRe.exec(content)) !== null) {
    const name = m[1];
    if (!/^(Error|Date|Map|Set|Promise|Array|Object|Buffer|RegExp)$/.test(name)) {
      hints.push({ model: name, table: name.toLowerCase() + 's' });
    }
  }

  return hints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal extraction (caches, queues, services, packages)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect cache layers used in content.
 * @returns {string[]}
 */
function extractCaches(content) {
  return dedupeArray(
    CACHE_RE.filter(({ re }) => re.test(content)).map(({ name }) => name)
  );
}

/**
 * Detect message queues used in content.
 * @returns {string[]}
 */
function extractQueues(content) {
  return dedupeArray(
    QUEUE_RE.filter(({ re }) => re.test(content)).map(({ name }) => name)
  );
}

/**
 * Detect outbound HTTP service calls and extract hostnames/paths.
 * @returns {string[]}
 */
function extractServices(content) {
  const found = new Set();
  for (const re of HTTP_CLIENT_RE) {
    const clone = new RegExp(re.source, re.flags);
    let m;
    while ((m = clone.exec(content)) !== null) {
      const url = m[1] || '';
      if (!url) { found.add('external-http'); continue; }
      try {
        const u = new URL(url.startsWith('http') ? url : 'https://x.com' + url);
        found.add(u.hostname !== 'x.com' ? u.hostname : url.split('/')[1] || 'external-http');
      } catch {
        found.add(url.split('/')[0] || 'external-http');
      }
    }
  }
  return [...found];
}

/**
 * Extract npm package names from require/import statements.
 * @returns {string[]}
 */
function extractPackages(content) {
  const pkgs = new Set();
  const reqRe = new RegExp(PKG_REQUIRE_RE.source, PKG_REQUIRE_RE.flags);
  const impRe = new RegExp(PKG_IMPORT_RE.source, PKG_IMPORT_RE.flags);
  let m;
  while ((m = reqRe.exec(content)) !== null) pkgs.add(m[1].split('/')[0]);
  while ((m = impRe.exec(content)) !== null) pkgs.add(m[1].split('/')[0]);
  return [...pkgs];
}

// ─────────────────────────────────────────────────────────────────────────────
// Import resolution + chain walking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a relative require/import path to an absolute path,
 * looking up in the allFiles map.
 *
 * Supports extensions: .js, .ts, .jsx, .tsx, .mjs, .cjs and index files.
 *
 * @param {string} fromFile   — relative path of the file doing the import
 * @param {string} importPath — the raw './relative' string
 * @param {Map<string,string>} allFiles — relativePath → content
 * @returns {string|null}     — matched relative path key or null
 */
function resolveLocalImport(fromFile, importPath, allFiles) {
  const base = path.dirname(fromFile);
  const resolved = path.join(base, importPath).replace(/\\/g, '/');
  const candidates = [
    resolved,
    resolved + '.js',
    resolved + '.ts',
    resolved + '.jsx',
    resolved + '.tsx',
    resolved + '.mjs',
    resolved + '.cjs',
    resolved + '/index.js',
    resolved + '/index.ts',
    resolved + '/index.jsx',
    resolved + '/index.tsx',
  ];
  for (const c of candidates) {
    if (allFiles.has(c)) return c;
  }
  return null;
}

/**
 * Walk the local imports of a file up to maxDepth levels, collecting
 * all referenced file contents into a flat array of { filePath, content, depth }.
 */
function walkImports(startFile, startContent, allFiles, maxDepth = 3) {
  const visited = new Set([startFile]);
  const chain = [{ filePath: startFile, content: startContent, depth: 0 }];
  const queue = [{ filePath: startFile, content: startContent, depth: 0 }];

  while (queue.length > 0) {
    const { filePath, content, depth } = queue.shift();
    if (depth >= maxDepth) continue;

    const allRe = [
      new RegExp(LOCAL_REQUIRE_RE.source, LOCAL_REQUIRE_RE.flags),
      new RegExp(LOCAL_IMPORT_RE.source, LOCAL_IMPORT_RE.flags),
    ];

    for (const re of allRe) {
      let m;
      while ((m = re.exec(content)) !== null) {
        const importPath = m[3];
        if (!importPath) continue;
        const resolved = resolveLocalImport(filePath, importPath, allFiles);
        if (!resolved || visited.has(resolved)) continue;
        visited.add(resolved);
        const childContent = allFiles.get(resolved) || '';
        chain.push({ filePath: resolved, content: childContent, depth: depth + 1 });
        queue.push({ filePath: resolved, content: childContent, depth: depth + 1 });
      }
    }
  }

  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// File role classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a file's role from its path.
 * Returns: 'router'|'controller'|'service'|'repository'|'middleware'|'model'|'other'
 */
function classifyRole(filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (/[./](test|spec)\.[jt]sx?$|__tests__|\/tests?\//i.test(p)) return 'test';
  if (/[./]router?s?\.[jt]sx?$|routes?\//i.test(p)) return 'router';
  if (/[./]controller?s?\.[jt]sx?$|controllers?\//i.test(p)) return 'controller';
  if (/[./]service?s?\.[jt]sx?$|services?\//i.test(p)) return 'service';
  if (/[./]repositor(?:y|ies)\.[jt]sx?$|repositor(?:y|ies)\//i.test(p)) return 'repository';
  if (/[./]middlewar(e)?\.[jt]sx?$|middleware\//i.test(p)) return 'middleware';
  if (/[./]model?s?\.[jt]sx?$|models?\//i.test(p)) return 'model';
  return 'other';
}

/**
 * Build a human-readable label for a chain step from its file path and role.
 * e.g. "src/services/userService.js" → "userService (service)"
 */
function buildStepLabel(filePath, role, content) {
  const base = path.basename(filePath, path.extname(filePath));
  const exportMatch = content.match(
    /(?:module\.exports\s*=\s*(?:async\s+)?function\s+(\w+)|exports\.(\w+)\s*=|export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)|class\s+(\w+))/
  );
  if (exportMatch) {
    const name = exportMatch[1] || exportMatch[2] || exportMatch[3] || exportMatch[4];
    if (name && name !== base) return `${name} (${role})`;
  }
  return `${base} (${role})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate signal collection helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate all signals from a walked import chain.
 * Used by all adapters to build the HandlerChain data from a set of traced files.
 *
 * @param {Array<{ filePath: string, content: string, depth: number }>} chain
 * @returns {{ tables, tableAccess, services, caches, queues, imports, steps }}
 */
function aggregateChainSignals(chain) {
  const allTables    = new Set();
  const allOps       = new Set();
  const allEvidence  = [];
  const allServices  = new Set();
  const allCaches    = new Set();
  const allQueues    = new Set();
  const allPackages  = new Set();
  const steps        = [];

  for (const { filePath: fp, content: c, depth } of chain) {
    const role = classifyRole(fp);
    const sqlInfo = extractSqlInfo(c);
    const ormHints = extractOrmTableHints(c);
    const services = extractServices(c);
    const caches   = extractCaches(c);
    const queues   = extractQueues(c);
    const pkgs     = extractPackages(c);

    sqlInfo.tables.forEach(t => allTables.add(t));
    sqlInfo.operations.forEach(o => allOps.add(o));
    if (sqlInfo.evidence.length) allEvidence.push(...sqlInfo.evidence.slice(0, 2));

    ormHints.forEach(h => {
      allTables.add(h.table);
      if (!allOps.size) allOps.add('UNKNOWN');
    });

    services.forEach(s => allServices.add(s));
    caches.forEach(c => allCaches.add(c));
    queues.forEach(q => allQueues.add(q));
    pkgs.forEach(p => allPackages.add(p));

    // Build a step for non-router files in the chain
    if (depth > 0 && role !== 'other') {
      const label = buildStepLabel(fp, role, c);
      steps.push({
        label,
        filePath:   fp,
        lineNumber: 1,
        role,
      });
    }
  }

  const tables = [...allTables];
  const tableAccess = tables.map(table => ({
    table,
    columns:    ['*'],
    operations: allOps.size ? [...allOps] : ['UNKNOWN'],
    evidence:   allEvidence.slice(0, 2),
  }));

  return {
    tables,
    tableAccess,
    services:  [...allServices],
    caches:    [...allCaches],
    queues:    [...allQueues],
    imports:   [...allPackages],
    steps,
  };
}

module.exports = {
  // Utilities
  cleanIdentifier,
  dedupeArray,
  getLineNumber,
  // SQL/ORM extraction
  extractSqlInfo,
  extractOrmTableHints,
  // Signal extraction
  extractCaches,
  extractQueues,
  extractServices,
  extractPackages,
  // Import resolution + walking
  resolveLocalImport,
  walkImports,
  // Role classification + labels
  classifyRole,
  buildStepLabel,
  // Aggregate helper
  aggregateChainSignals,
  // Re-exported patterns (for adapters that need to extend)
  LOCAL_REQUIRE_RE,
  LOCAL_IMPORT_RE,
};
