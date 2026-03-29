'use strict';

/**
 * codeParser.js
 *
 * Comprehensive per-file parser that walks every source file in the repo,
 * classifies it, and extracts detailed signals. Unlike metadataExtractor.js
 * (which only processes files that contain route declarations), this module
 * processes ALL discovered files and produces per-file records plus an
 * aggregate scan report with scores/counts.
 *
 * Signals extracted per file:
 *   - File type / role (router, controller, service, repository, middleware, config, util, test, model, other)
 *   - Route declarations (Express, NestJS, Next.js)
 *   - HTTP calls (fetch, axios, got, http.request, undici, request)
 *   - SQL fragments (table names, operations)
 *   - ORM calls (Mongoose, Prisma, Sequelize, TypeORM, Knex)
 *   - Cache usage (Redis, Memcached, in-memory cache)
 *   - Queue usage (BullMQ, Kafka, RabbitMQ, SQS, Amqplib)
 *   - NPM imports (require / import)
 *   - Export type (default export, named exports)
 *   - Line count / code density
 *   - Coverage score (0-100) measuring how much static info was extracted
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROUTE_PATTERNS = [
  // Express / Koa / Fastify
  { re: /(?:app|router|server)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi, framework: 'express' },
  // NestJS decorators
  { re: /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*(?:['"`]([^'"`\n]*)['"`])?\s*\)/gi, framework: 'nestjs' },
  // Next.js App Router exports
  { re: /export\s+(?:async\s+)?(?:const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>|function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD))\s*[({]/g, framework: 'nextjs' },
  // Fastify shorthand
  { re: /fastify\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi, framework: 'fastify' },
  // httpServer patterns
  { re: /http\.createServer\s*\(|https\.createServer\s*\(/gi, framework: 'httpserver' },
];

const HTTP_CLIENT_PATTERNS = [
  /\baxios\s*\.\s*(?:get|post|put|delete|patch|request|head)\s*\(/gi,
  /\bfetch\s*\(/gi,
  /\bhttp\s*\.\s*(?:get|post|request)\s*\(/gi,
  /\bhttps\s*\.\s*(?:get|post|request)\s*\(/gi,
  /\bgot\s*\.\s*(?:get|post|put|delete|patch)\s*\(/gi,
  /\bundici\s*\.\s*(?:fetch|request)\s*\(/gi,
  /\brequest\s*\(\s*['"`{]/gi,
  /\bsuperagent\s*\.\s*(?:get|post|put|delete|patch)\s*\(/gi,
];

const SQL_FRAGMENT_PATTERN = /`([^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b[^`]*)`|'([^']{10,}\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^']*)'|"([^"]{10,}\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"]*)"/gi;
const SQL_TABLE_FROM  = /\bFROM\s+([a-zA-Z0-9_.`"[\]]+)/gi;
const SQL_TABLE_JOIN  = /\bJOIN\s+([a-zA-Z0-9_.`"[\]]+)/gi;
const SQL_TABLE_INTO  = /\bINTO\s+([a-zA-Z0-9_.`"[\]]+)/gi;
const SQL_TABLE_UPDATE = /\bUPDATE\s+([a-zA-Z0-9_.`"[\]]+)/gi;

const ORM_PATTERNS = {
  mongoose: [
    /\bnew\s+\w+Model\s*\(/gi,
    /\w+\.(?:findOne|findById|find|findByIdAndUpdate|findOneAndUpdate|create|save|deleteOne|deleteMany|updateOne|updateMany|aggregate|countDocuments|estimatedDocumentCount)\s*\(/gi,
    /\bmongoose\s*\./gi,
    /\bSchema\s*\(/gi,
  ],
  prisma: [
    /\bprisma\s*\.\s*\w+\s*\.\s*(?:findUnique|findFirst|findMany|create|update|upsert|delete|createMany|updateMany|deleteMany|aggregate|count|groupBy)\s*\(/gi,
    /\b@prisma\/client\b/gi,
  ],
  sequelize: [
    /\bSequelize\b/gi,
    /\bDataTypes\b/gi,
    /\bModel\.(?:findOne|findAll|findByPk|create|update|destroy|bulkCreate|upsert|findOrCreate)\s*\(/gi,
  ],
  typeorm: [
    /\bgetRepository\s*\(/gi,
    /\b@Entity\b/gi,
    /\b@Column\b/gi,
    /\bRepository\b/gi,
    /\bDataSource\b/gi,
  ],
  knex: [
    /\bknex\s*\(/gi,
    /\b\.from\s*\(/gi,
    /\b\.where\s*\(/gi,
    /\b\.insert\s*\(/gi,
    /\b\.update\s*\(/gi,
    /\b\.delete\s*\(\)/gi,
    /\b\.select\s*\(/gi,
  ],
};

const CACHE_PATTERNS = [
  { re: /\bredis\b/gi, name: 'redis' },
  { re: /\bRedisClient\b/gi, name: 'redis' },
  { re: /\bcreateClient\s*\(/gi, name: 'redis' },
  { re: /\bMemcached\b/gi, name: 'memcached' },
  { re: /\bmemcached\b/gi, name: 'memcached' },
  { re: /\bcache\s*\.\s*(?:get|set|del|flush|exists)\s*\(/gi, name: 'in-memory' },
  { re: /\bNodeCache\b/gi, name: 'node-cache' },
  { re: /\blru-cache\b/gi, name: 'lru-cache' },
  { re: /\bLRUCache\b/gi, name: 'lru-cache' },
];

const QUEUE_PATTERNS = [
  { re: /\bkafka\b/gi, name: 'kafka' },
  { re: /\bKafkaProducer|KafkaConsumer\b/gi, name: 'kafka' },
  { re: /\bRabbitMQ\b|\bamqplib\b/gi, name: 'rabbitmq' },
  { re: /\bSQS\b|\bsqs\s*\./gi, name: 'sqs' },
  { re: /\bBullMQ\b|\bnew\s+Queue\s*\(/gi, name: 'bullmq' },
  { re: /\bQueue\s*\(\s*['"`]/gi, name: 'bullmq' },
  { re: /\bWorker\s*\(\s*['"`]/gi, name: 'bullmq' },
  { re: /\bnats\s*\./gi, name: 'nats' },
  { re: /\bpulsar\b/gi, name: 'pulsar' },
];

const REQUIRE_PATTERN  = /\brequire\s*\(\s*['"`]([^'"`\n]+)['"`]\s*\)/g;
const IMPORT_PATTERN   = /\bimport\s+(?:[\w{},\s*]+\s+from\s+)?['"`]([^'"`\n]+)['"`]/g;
const EXPORT_DEF_PATTERN = /\bmodule\.exports\s*=|export\s+default\b/g;
const EXPORT_NAME_PATTERN = /\bexports\s*\.\s*\w+\s*=|export\s+(?:const|function|class|async)/g;

const COMMENT_LINE_PATTERN = /^\s*\/\/|^\s*\*|^\s*\/\*/gm;

// File role classification rules (checked in order; first match wins)
const ROLE_RULES = [
  { role: 'test',        re: /[./](test|spec)\.[jt]sx?$|__tests__|\/test\/|\/tests\//i },
  { role: 'router',      re: /[./]router?s?\.[jt]sx?$|routes?\//i },
  { role: 'controller',  re: /[./]controller?s?\.[jt]sx?$|controllers?\//i },
  { role: 'service',     re: /[./]service?s?\.[jt]sx?$|services?\//i },
  { role: 'repository',  re: /[./]repositor(?:y|ies)\.[jt]sx?$|repositor(?:y|ies)\//i },
  { role: 'middleware',  re: /[./]middlewar(e)?\.[jt]sx?$|middleware\//i },
  { role: 'model',       re: /[./]model?s?\.[jt]sx?$|models?\//i },
  { role: 'config',      re: /[./]config\.[jt]sx?$|config(?:uration)?\//i },
  { role: 'util',        re: /[./]util(s|ity)?\.[jt]sx?$|util(s|ity)?\//i },
  { role: 'helper',      re: /[./]helper?s?\.[jt]sx?$|helper?s?\//i },
  { role: 'schema',      re: /[./]schema\.[jt]sx?$|schema\//i },
  { role: 'migration',   re: /[./]migration?s?\.[jt]sx?$|migration?s?\//i },
  { role: 'seeder',      re: /[./]seeder?s?\.[jt]sx?$|seed(ers?)?\//i },
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function cleanIdentifier(val) {
  return String(val || '')
    .trim()
    .replace(/^[`"'[]+/, '')
    .replace(/[`"'\]]+$/, '')
    .replace(/[;,]+$/, '');
}

function matchAll(content, regexTemplate) {
  const re = new RegExp(regexTemplate.source, regexTemplate.flags);
  const results = [];
  let m;
  while ((m = re.exec(content)) !== null) results.push(m);
  return results;
}

function countMatches(content, regexTemplate) {
  return matchAll(content, regexTemplate).length;
}

function dedupeArray(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Per-file parsing
// ---------------------------------------------------------------------------

/**
 * Classify the role of a file based on its path.
 * @param {string} filePath
 * @returns {string}
 */
function classifyRole(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const { role, re } of ROLE_RULES) {
    if (re.test(normalized)) return role;
  }
  return 'other';
}

/**
 * Extract all route declarations from a file's content.
 * @returns {{ method: string, path: string, framework: string }[]}
 */
function extractRoutes(content, filePath) {
  const routes = [];

  // Express / Fastify style
  for (const { re, framework } of ROUTE_PATTERNS.filter(p => p.framework !== 'nestjs' && p.framework !== 'nextjs')) {
    const cloned = new RegExp(re.source, re.flags);
    let m;
    while ((m = cloned.exec(content)) !== null) {
      routes.push({ method: (m[1] || '').toUpperCase(), path: m[2] || '/', framework });
    }
  }

  // NestJS decorators
  {
    const re = new RegExp(ROUTE_PATTERNS[1].re.source, ROUTE_PATTERNS[1].re.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      routes.push({ method: (m[1] || '').toUpperCase(), path: m[2] || '/', framework: 'nestjs' });
    }
  }

  // Next.js App Router — infer path from file path
  const isNextRoute = /app\/api\/.+\/route\.[jt]sx?$/.test(filePath.replace(/\\/g, '/'));
  if (isNextRoute) {
    const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      // Derive path from file location
      const normalized = filePath.replace(/\\/g, '/');
      const idx = normalized.indexOf('/app/api/');
      let routePath = '/';
      if (idx !== -1) {
        routePath = normalized.slice(idx + 8, normalized.lastIndexOf('/route.'));
        routePath = '/' + routePath.replace(/\[([^\]]+)\]/g, ':$1');
      }
      routes.push({ method: m[1].toUpperCase(), path: routePath || '/', framework: 'nextjs' });
    }
  }

  return routes;
}

/**
 * Extract SQL-related info: tables, operations found via literal SQL strings.
 * @returns {{ tables: string[], operations: string[], fragmentCount: number }}
 */
function extractSqlInfo(content) {
  const tables = new Set();
  const operations = new Set();
  let fragmentCount = 0;

  const fragmentRe = new RegExp(SQL_FRAGMENT_PATTERN.source, SQL_FRAGMENT_PATTERN.flags);
  let fm;
  while ((fm = fragmentRe.exec(content)) !== null) {
    const fragment = fm[1] || fm[2] || fm[3] || '';
    if (!fragment) continue;
    fragmentCount++;

    // Detect SQL operation
    const opMatch = fragment.match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/i);
    if (opMatch) operations.add(opMatch[1].toUpperCase());

    // Extract table names
    for (const tableRe of [SQL_TABLE_FROM, SQL_TABLE_JOIN, SQL_TABLE_INTO, SQL_TABLE_UPDATE]) {
      const re = new RegExp(tableRe.source, tableRe.flags);
      let tm;
      while ((tm = re.exec(fragment)) !== null) {
        const t = cleanIdentifier(tm[1]);
        if (t && t.length > 1 && !/^(select|insert|update|delete|where|set|values|join|from|into)$/i.test(t)) {
          tables.add(t.toLowerCase());
        }
      }
    }
  }

  return { tables: [...tables], operations: [...operations], fragmentCount };
}

/**
 * Detect ORM usage. Returns an object mapping orm name → number of call-sites found.
 */
function extractOrmUsage(content) {
  const usage = {};
  for (const [orm, patterns] of Object.entries(ORM_PATTERNS)) {
    let count = 0;
    for (const pat of patterns) {
      count += countMatches(content, pat);
    }
    if (count > 0) usage[orm] = count;
  }
  return usage;
}

/**
 * Detect cache usage. Returns array of cache names found.
 */
function extractCacheUsage(content) {
  const found = new Set();
  for (const { re, name } of CACHE_PATTERNS) {
    if (new RegExp(re.source, re.flags).test(content)) found.add(name);
  }
  return [...found];
}

/**
 * Detect queue/messaging usage. Returns array of queue tech names found.
 */
function extractQueueUsage(content) {
  const found = new Set();
  for (const { re, name } of QUEUE_PATTERNS) {
    if (new RegExp(re.source, re.flags).test(content)) found.add(name);
  }
  return [...found];
}

/**
 * Extract imported packages (require/import). Filters out relative imports.
 */
function extractImports(content) {
  const pkgs = new Set();

  const reqRe = new RegExp(REQUIRE_PATTERN.source, REQUIRE_PATTERN.flags);
  let m;
  while ((m = reqRe.exec(content)) !== null) {
    const pkg = m[1];
    if (!pkg.startsWith('.') && !pkg.startsWith('/')) pkgs.add(pkg.split('/')[0]);
  }

  const impRe = new RegExp(IMPORT_PATTERN.source, IMPORT_PATTERN.flags);
  while ((m = impRe.exec(content)) !== null) {
    const pkg = m[1];
    if (!pkg.startsWith('.') && !pkg.startsWith('/')) pkgs.add(pkg.split('/')[0]);
  }

  return [...pkgs];
}

/**
 * Count outbound HTTP calls in the file.
 */
function countHttpCalls(content) {
  let total = 0;
  for (const pat of HTTP_CLIENT_PATTERNS) {
    total += countMatches(content, pat);
  }
  return total;
}

/**
 * Compute a coverage score (0–100) for a parsed file record.
 *
 * Scoring heuristic:
 *   +25 if role is identified (not 'other')
 *   +25 if routes OR orm calls OR sql fragments found
 *   +20 if imports extracted
 *   +15 if tables/orm found for non-config/util/test files
 *   +15 if the file is a test/config/migration (already well-defined roles)
 */
function computeCoverageScore(record) {
  let score = 0;

  if (record.role !== 'other') score += 25;

  const hasSignals = record.routes.length > 0
    || record.sqlInfo.fragmentCount > 0
    || Object.keys(record.ormUsage).length > 0
    || record.httpCallCount > 0;
  if (hasSignals) score += 25;

  if (record.imports.length > 0) score += 20;

  const isAnalyzable = !['test', 'config', 'migration', 'seeder'].includes(record.role);
  const hasDbInfo = record.sqlInfo.tables.length > 0 || Object.keys(record.ormUsage).length > 0;
  if (isAnalyzable && hasDbInfo) score += 15;
  if (['test', 'config', 'migration', 'seeder'].includes(record.role)) score += 15;

  // Bonus: has both routes and DB info (well-traced controller/service)
  if (record.routes.length > 0 && hasDbInfo) score += 15;

  return Math.min(100, score);
}

/**
 * Parse a single source file and return a detailed record.
 * @param {string} filePath - absolute path
 * @param {string} repoRoot - repo root for computing relative paths
 * @returns {object} file parse record
 */
function parseFile(filePath, repoRoot) {
  let content = '';
  let readError = null;

  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    readError = err.message;
  }

  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const ext = path.extname(filePath);
  const lines = content ? content.split('\n') : [];
  const commentLines = content ? (content.match(COMMENT_LINE_PATTERN) || []).length : 0;
  const codeLines = Math.max(0, lines.length - commentLines);
  const role = classifyRole(filePath);

  if (readError) {
    return {
      filePath: relativePath,
      ext,
      role,
      lines: 0,
      codeLines: 0,
      routes: [],
      sqlInfo: { tables: [], operations: [], fragmentCount: 0 },
      ormUsage: {},
      caches: [],
      queues: [],
      httpCallCount: 0,
      imports: [],
      hasDefaultExport: false,
      hasNamedExports: false,
      coverageScore: 0,
      error: readError,
    };
  }

  const routes = extractRoutes(content, filePath);
  const sqlInfo = extractSqlInfo(content);
  const ormUsage = extractOrmUsage(content);
  const caches = extractCacheUsage(content);
  const queues = extractQueueUsage(content);
  const httpCallCount = countHttpCalls(content);
  const imports = extractImports(content);
  const hasDefaultExport = new RegExp(EXPORT_DEF_PATTERN.source, EXPORT_DEF_PATTERN.flags).test(content);
  const hasNamedExports = new RegExp(EXPORT_NAME_PATTERN.source, EXPORT_NAME_PATTERN.flags).test(content);

  const record = {
    filePath: relativePath,
    ext,
    role,
    lines: lines.length,
    codeLines,
    routes,
    sqlInfo,
    ormUsage,
    caches,
    queues,
    httpCallCount,
    imports,
    hasDefaultExport,
    hasNamedExports,
    coverageScore: 0,
  };

  record.coverageScore = computeCoverageScore(record);
  return record;
}

// ---------------------------------------------------------------------------
// Full-repo parse
// ---------------------------------------------------------------------------

/**
 * Parse every file in filePaths and return the full parse report.
 *
 * @param {string[]} filePaths   - absolute paths from walkRepository()
 * @param {string}   repoRoot    - absolute repo root for relative path computation
 * @param {{ onProgress?: (done: number, total: number, filePath: string) => void }} opts
 * @returns {{ files: object[], scannedAt: string, durationMs: number }}
 */
function parseRepository(filePaths, repoRoot, opts = {}) {
  const start = Date.now();
  const files = [];

  for (let i = 0; i < filePaths.length; i++) {
    const fp = filePaths[i];
    if (opts.onProgress) opts.onProgress(i + 1, filePaths.length, fp);
    files.push(parseFile(fp, repoRoot));
  }

  return {
    files,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}

module.exports = { parseRepository, parseFile, classifyRole, computeCoverageScore };
