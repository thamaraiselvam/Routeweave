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

const TABLE_PATTERNS = [
  /from\s+([a-zA-Z0-9_]+)/gi,
  /join\s+([a-zA-Z0-9_]+)/gi,
  /into\s+([a-zA-Z0-9_]+)/gi,
  /update\s+([a-zA-Z0-9_]+)/gi,
];

const SERVICE_PATTERN = /(axios|fetch|http\.get|http\.post|got\.|undici\.|request\()/g;
const CACHE_PATTERN = /(redis|memcached|cache\.)/gi;
const QUEUE_PATTERN = /(kafka|rabbitmq|sqs|bullmq|queue\.publish)/gi;

function normalizeMethod(frameworkMethod) {
  return frameworkMethod.toUpperCase();
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

  return routes;
}

function extractTables(content) {
  const tables = new Set();
  for (const regex of TABLE_PATTERNS) {
    const cloned = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = cloned.exec(content)) !== null) {
      tables.add(match[1]);
    }
  }
  return [...tables];
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

    const tables = extractTables(content);
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
        code: content.slice(0, 2500),
      });
    }
  }

  return routeMetadata;
}

module.exports = { extractMetadata, inferNextRoutePath };
