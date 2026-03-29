const fs = require('fs');
const path = require('path');

const EXPRESS_ROUTE_PATTERNS = [
  /app\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g,
  /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g,
];

const NEST_ROUTE_PATTERNS = [
  /@(Get|Post|Put|Delete|Patch)\(\s*['"`]([^'"`]+)['"`]/g,
];

const NEXT_APP_ROUTE_PATTERN = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/g;

const HTTPSERVER_ROUTE_PATTERNS = [
  /http\.createServer\s*\(/g,
  /https\.createServer\s*\(/g,
];

const PAGES_ROUTER_HANDLER_RE = /(?:export\s+default\s+(?:async\s+)?function|module\.exports\s*=\s*(?:async\s+)?function)\s*\w*\s*\(\s*(?:req|ctx)\s*[,:]/g;

const TABLE_PATTERNS = [
  /from\s+([a-zA-Z0-9_]+)/gi,
  /join\s+([a-zA-Z0-9_]+)/gi,
  /into\s+([a-zA-Z0-9_]+)/gi,
  /update\s+([a-zA-Z0-9_]+)/gi,
];

const SQL_LITERAL_PATTERNS = [
  /`([\s\S]*?\b(?:select|insert|update|delete)\b[\s\S]*?)`/gi,
  /'([^'\n]*\b(?:select|insert|update|delete)\b[^'\n]*)'/gi,
  /"([^"\n]*\b(?:select|insert|update|delete)\b[^"\n]*)"/gi,
];

const FROM_OR_JOIN_PATTERN = /\b(?:from|join)\s+([a-zA-Z0-9_.`"[\]]+)(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
const INSERT_PATTERN = /\binsert\s+into\s+([a-zA-Z0-9_.`"[\]]+)(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
const UPDATE_PATTERN = /\bupdate\s+([a-zA-Z0-9_.`"[\]]+)(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
const DELETE_PATTERN = /\bdelete\s+from\s+([a-zA-Z0-9_.`"[\]]+)(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
const SELECT_CLAUSE_PATTERN = /\bselect\s+([\s\S]+?)\s+\bfrom\b/i;
const INSERT_COLUMNS_PATTERN = /\binsert\s+into\s+([a-zA-Z0-9_.`"[\]]+)\s*\(([^)]+)\)/i;
const UPDATE_SET_PATTERN = /\bupdate\s+([a-zA-Z0-9_.`"[\]]+)(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+set\s+([\s\S]+?)(?:\bwhere\b|$)/i;
const QUALIFIED_COLUMN_PATTERN = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

const RESERVED_ALIAS_WORDS = new Set([
  'on',
  'where',
  'set',
  'values',
  'left',
  'right',
  'inner',
  'outer',
  'group',
  'order',
  'limit',
  'offset',
]);

const RESERVED_COLUMN_WORDS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'case',
  'when',
  'then',
  'else',
  'end',
  'distinct',
  'count',
  'sum',
  'min',
  'max',
  'avg',
  'as',
  'on',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'null',
  'true',
  'false',
]);

const SERVICE_PATTERN = /(axios|fetch|http\.get|http\.post|got\.|undici\.|request\()/g;
const CACHE_PATTERN = /(redis|memcached|cache\.)/gi;
const QUEUE_PATTERN = /(kafka|rabbitmq|sqs|bullmq|queue\.publish)/gi;

function normalizeMethod(frameworkMethod) {
  return frameworkMethod.toUpperCase();
}

function normalizeSqlWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanIdentifier(value) {
  return String(value || '')
    .trim()
    .replace(/^[`"'\[]+/, '')
    .replace(/[`"'\]]+$/, '')
    .replace(/[;,]+$/, '');
}

function splitSqlList(value) {
  const list = [];
  let current = '';
  let depth = 0;

  for (const char of String(value || '')) {
    if (char === '(') depth += 1;
    if (char === ')' && depth > 0) depth -= 1;

    if (char === ',' && depth === 0) {
      list.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    list.push(current.trim());
  }

  return list;
}

function extractTablesFromPatterns(content) {
  const tables = new Set();
  for (const regex of TABLE_PATTERNS) {
    const cloned = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = cloned.exec(content)) !== null) {
      const table = cleanIdentifier(match[1]);
      if (table) tables.add(table);
    }
  }
  return [...tables];
}

function ensureTableUsage(usageMap, table) {
  const key = table.toLowerCase();
  if (!usageMap.has(key)) {
    usageMap.set(key, {
      table,
      columns: new Set(),
      operations: new Set(),
      evidence: new Set(),
    });
  }
  return usageMap.get(key);
}

function addColumn(entry, column) {
  const normalized = cleanIdentifier(column);
  if (!normalized) return;
  entry.columns.add(normalized);
}

function extractSqlFragments(content) {
  const fragments = [];

  for (const pattern of SQL_LITERAL_PATTERNS) {
    const cloned = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = cloned.exec(content)) !== null) {
      const fragment = normalizeSqlWhitespace(match[1]);
      if (fragment) {
        fragments.push(fragment);
      }
    }
  }

  return [...new Set(fragments)];
}

function detectOperation(statement) {
  const match = statement.match(/\b(select|insert|update|delete)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function registerTables(pattern, statement, usageMap, aliasMap, operation, evidence) {
  const cloned = new RegExp(pattern.source, pattern.flags);
  let match;

  while ((match = cloned.exec(statement)) !== null) {
    const table = cleanIdentifier(match[1]);
    if (!table) continue;

    const alias = cleanIdentifier(match[2]);
    const aliasKey = alias.toLowerCase();

    const usage = ensureTableUsage(usageMap, table);
    usage.operations.add(operation || 'UNKNOWN');
    if (evidence) usage.evidence.add(evidence);

    aliasMap.set(table.toLowerCase(), table);
    if (alias && !RESERVED_ALIAS_WORDS.has(aliasKey)) {
      aliasMap.set(aliasKey, table);
    }
  }
}

function registerTableReferences(statement, usageMap, aliasMap, operation, evidence) {
  registerTables(FROM_OR_JOIN_PATTERN, statement, usageMap, aliasMap, operation, evidence);
  registerTables(INSERT_PATTERN, statement, usageMap, aliasMap, operation, evidence);
  registerTables(UPDATE_PATTERN, statement, usageMap, aliasMap, operation, evidence);
  registerTables(DELETE_PATTERN, statement, usageMap, aliasMap, operation, evidence);
}

function allTablesFromAliasMap(aliasMap) {
  return [...new Set(aliasMap.values())];
}

function resolveTableByQualifier(aliasMap, qualifier) {
  const key = cleanIdentifier(qualifier).toLowerCase();
  return aliasMap.get(key) || null;
}

function parseColumnToken(rawToken) {
  const token = normalizeSqlWhitespace(rawToken.replace(/\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*$/i, ''));
  if (!token) return null;

  if (token === '*') {
    return { qualifier: null, column: '*' };
  }

  const wildcardMatch = token.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.\*/);
  if (wildcardMatch) {
    return { qualifier: cleanIdentifier(wildcardMatch[1]), column: '*' };
  }

  const qualifiedMatch = token.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b/);
  if (qualifiedMatch) {
    return {
      qualifier: cleanIdentifier(qualifiedMatch[1]),
      column: cleanIdentifier(qualifiedMatch[2]),
    };
  }

  if (token.includes('(')) {
    return null;
  }

  const first = cleanIdentifier(token.split(/\s+/)[0]);
  if (!first || RESERVED_COLUMN_WORDS.has(first.toLowerCase())) {
    return null;
  }

  return { qualifier: null, column: first };
}

function addColumnsFromSelectClause(statement, usageMap, aliasMap) {
  const match = SELECT_CLAUSE_PATTERN.exec(statement);
  if (!match) return;

  const columns = splitSqlList(match[1]);
  const knownTables = allTablesFromAliasMap(aliasMap);

  for (const rawColumn of columns) {
    const parsed = parseColumnToken(rawColumn);
    if (!parsed) continue;

    if (parsed.column === '*') {
      if (parsed.qualifier) {
        const table = resolveTableByQualifier(aliasMap, parsed.qualifier);
        if (table) addColumn(ensureTableUsage(usageMap, table), '*');
        continue;
      }

      for (const table of knownTables) {
        addColumn(ensureTableUsage(usageMap, table), '*');
      }
      continue;
    }

    if (parsed.qualifier) {
      const table = resolveTableByQualifier(aliasMap, parsed.qualifier);
      if (table) addColumn(ensureTableUsage(usageMap, table), parsed.column);
      continue;
    }

    if (knownTables.length === 1) {
      addColumn(ensureTableUsage(usageMap, knownTables[0]), parsed.column);
    }
  }
}

function addColumnsFromInsert(statement, usageMap) {
  const match = INSERT_COLUMNS_PATTERN.exec(statement);
  if (!match) return;

  const table = cleanIdentifier(match[1]);
  if (!table) return;

  const usage = ensureTableUsage(usageMap, table);
  for (const column of splitSqlList(match[2])) {
    addColumn(usage, column);
  }
}

function addColumnsFromUpdate(statement, usageMap, aliasMap) {
  const match = UPDATE_SET_PATTERN.exec(statement);
  if (!match) return;

  const table = cleanIdentifier(match[1]);
  const alias = cleanIdentifier(match[2]);
  const setClause = match[3] || '';
  const usage = ensureTableUsage(usageMap, table);

  if (alias) {
    aliasMap.set(alias.toLowerCase(), table);
  }

  for (const assignment of splitSqlList(setClause)) {
    const assignmentMatch = assignment.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?\s*=/);
    if (!assignmentMatch) continue;

    if (assignmentMatch[2]) {
      const resolved = resolveTableByQualifier(aliasMap, assignmentMatch[1]);
      if (resolved) addColumn(ensureTableUsage(usageMap, resolved), assignmentMatch[2]);
      continue;
    }

    addColumn(usage, assignmentMatch[1]);
  }
}

function addColumnsFromQualifiedReferences(statement, usageMap, aliasMap) {
  const cloned = new RegExp(QUALIFIED_COLUMN_PATTERN.source, QUALIFIED_COLUMN_PATTERN.flags);
  let match;
  while ((match = cloned.exec(statement)) !== null) {
    const table = resolveTableByQualifier(aliasMap, match[1]);
    if (!table) continue;
    addColumn(ensureTableUsage(usageMap, table), match[2]);
  }
}

function parseSqlStatement(statement, usageMap) {
  const normalized = normalizeSqlWhitespace(statement);
  if (!normalized) return;

  const operation = detectOperation(normalized);
  if (!operation) return;

  const evidence = normalized.slice(0, 240);
  const aliasMap = new Map();

  registerTableReferences(normalized, usageMap, aliasMap, operation, evidence);
  if (!aliasMap.size) return;

  addColumnsFromInsert(normalized, usageMap);
  addColumnsFromUpdate(normalized, usageMap, aliasMap);
  addColumnsFromSelectClause(normalized, usageMap, aliasMap);
  addColumnsFromQualifiedReferences(normalized, usageMap, aliasMap);
}

function extractTableAccess(content) {
  const usageMap = new Map();

  for (const fragment of extractSqlFragments(content)) {
    for (const statement of fragment.split(';')) {
      parseSqlStatement(statement, usageMap);
    }
  }

  for (const table of extractTablesFromPatterns(content)) {
    const usage = ensureTableUsage(usageMap, table);
    if (!usage.operations.size) usage.operations.add('UNKNOWN');
  }

  const tableAccess = [...usageMap.values()].map((usage) => ({
    table: usage.table,
    columns: [...usage.columns].sort((a, b) => {
      if (a === '*') return -1;
      if (b === '*') return 1;
      return a.localeCompare(b);
    }),
    operations: [...usage.operations],
    evidence: [...usage.evidence].slice(0, 2),
  }));

  tableAccess.sort((a, b) => a.table.localeCompare(b.table));
  return tableAccess;
}

function inferNextRoutePath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  const marker = '/app/api/';
  const index = normalized.indexOf(marker);
  if (index === -1 || !normalized.endsWith('/route.ts') && !normalized.endsWith('/route.js')) {
    return null;
  }

  const routePath = normalized.slice(index + marker.length, normalized.lastIndexOf('/route.'));
  if (!routePath) {
    return '/api';
  }

  return `/${routePath.split('/').map((segment) => segment.replace(/^\[(.+)\]$/, ':$1')).join('/')}`;
}

function extractRoutes(content, filePath) {
  const routes = [];

  for (const regex of EXPRESS_ROUTE_PATTERNS) {
    const cloned = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = cloned.exec(content)) !== null) {
      routes.push({ method: normalizeMethod(match[1]), path: match[2], framework: 'express', filePath });
    }
  }

  for (const regex of NEST_ROUTE_PATTERNS) {
    const cloned = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = cloned.exec(content)) !== null) {
      routes.push({ method: normalizeMethod(match[1]), path: match[2], framework: 'nestjs', filePath });
    }
  }

  const nextPath = inferNextRoutePath(filePath);
  if (nextPath) {
    const cloned = new RegExp(NEXT_APP_ROUTE_PATTERN.source, NEXT_APP_ROUTE_PATTERN.flags);
    let match;
    while ((match = cloned.exec(content)) !== null) {
      routes.push({ method: normalizeMethod(match[1]), path: nextPath, framework: 'nextjs-app-router', filePath });
    }
  }

  // Next.js Pages Router: pages/api/**/*.ts|js with default export handler
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  if (/\/pages\/api\/.+\.[jt]sx?$/.test(normalizedFilePath)) {
    const pagesHandlerRe = new RegExp(PAGES_ROUTER_HANDLER_RE.source, PAGES_ROUTER_HANDLER_RE.flags);
    if (pagesHandlerRe.test(content)) {
      const pagesPath = inferPagesRouterPath(filePath);
      if (pagesPath) {
        const methodRe = /req(?:uest)?\.method\s*===?\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/gi;
        const foundMethods = new Set();
        let mm;
        while ((mm = methodRe.exec(content)) !== null) {
          foundMethods.add(mm[1].toUpperCase());
        }
        if (foundMethods.size > 0) {
          for (const method of foundMethods) {
            routes.push({ method, path: pagesPath, framework: 'nextjs-pages-router', filePath });
          }
        } else {
          routes.push({ method: 'ALL', path: pagesPath, framework: 'nextjs-pages-router', filePath });
        }
      }
    }
  }

  // httpServer: detect http.createServer / https.createServer
  for (const regex of HTTPSERVER_ROUTE_PATTERNS) {
    const clonedHttp = new RegExp(regex.source, regex.flags);
    if (clonedHttp.test(content)) {
      routes.push({ method: 'ALL', path: '/', framework: 'httpserver', filePath });
      break;
    }
  }

  return routes;
}

function extractTables(content) {
  return extractTableAccess(content).map((entry) => entry.table);
}

function extractByPattern(content, pattern, transform = (x) => x) {
  const values = new Set();
  const cloned = new RegExp(pattern.source, pattern.flags);
  let match;
  while ((match = cloned.exec(content)) !== null) {
    values.add(transform(match[1]));
  }
  return [...values];
}

function extractMetadata(filePaths) {
  const routeMetadata = [];

  for (const filePath of filePaths) {
    const content = fs.readFileSync(filePath, 'utf8');
    const routes = extractRoutes(content, filePath);
    if (!routes.length) {
      continue;
    }

    const tableAccess = extractTableAccess(content);
    const tables = tableAccess.map((entry) => entry.table);
    const services = extractByPattern(content, SERVICE_PATTERN);
    const caches = extractByPattern(content, CACHE_PATTERN, (x) => x.toLowerCase());
    const queues = extractByPattern(content, QUEUE_PATTERN, (x) => x.toLowerCase());

    for (const route of routes) {
      routeMetadata.push({
        ...route,
        tables,
        services,
        caches,
        queues,
        tableAccess,
        code: content.slice(0, 2500),
      });
    }
  }

  return routeMetadata;
}

function inferPagesRouterPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  const marker = '/pages/api/';
  const index = normalized.indexOf(marker);
  if (index === -1) return null;

  let segment = normalized.slice(index + marker.length);
  segment = segment.replace(/\.[jt]sx?$/, '');
  segment = segment.replace(/\/index$/, '');

  if (!segment) return '/api';
  return '/api/' + segment.split('/').map(s => s.replace(/^\[(.+)\]$/, ':$1')).join('/');
}

module.exports = { extractMetadata, inferNextRoutePath, inferPagesRouterPath, extractTableAccess };
