const fs = require('fs');

const FRAMEWORK_PATTERNS = [
  {
    framework: 'express',
    regexes: [
      /app\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g,
      /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g,
    ],
  },
  {
    framework: 'fastapi',
    regexes: [/@app\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g],
  },
  {
    framework: 'spring',
    regexes: [/@(Get|Post|Put|Delete|Patch)Mapping\(\s*['"`]([^'"`]+)['"`]/g],
  },
  {
    framework: 'nestjs',
    regexes: [/@(Get|Post|Put|Delete|Patch)\(\s*['"`]([^'"`]+)['"`]/g],
  },
];

const TABLE_PATTERNS = [
  /from\s+([a-zA-Z0-9_]+)/gi,
  /join\s+([a-zA-Z0-9_]+)/gi,
  /into\s+([a-zA-Z0-9_]+)/gi,
  /update\s+([a-zA-Z0-9_]+)/gi,
];

const SERVICE_PATTERN = /(axios|fetch|http\.get|http\.post|requests\.(get|post)|RestTemplate)/g;
const CACHE_PATTERN = /(redis|memcached|cache\.)/gi;
const QUEUE_PATTERN = /(kafka|rabbitmq|sqs|bullmq|queue\.publish)/gi;

function normalizeMethod(frameworkMethod) {
  return frameworkMethod.toUpperCase();
}

function extractRoutes(content, filePath) {
  const routes = [];
  for (const framework of FRAMEWORK_PATTERNS) {
    for (const regex of framework.regexes) {
      const cloned = new RegExp(regex.source, regex.flags);
      let match;
      while ((match = cloned.exec(content)) !== null) {
        const rawMethod = match[1];
        const method = normalizeMethod(rawMethod);
        const endpoint = match[2];
        routes.push({
          method,
          path: endpoint,
          framework: framework.framework,
          filePath,
        });
      }
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

function extractServices(content) {
  const services = new Set();
  const cloned = new RegExp(SERVICE_PATTERN.source, SERVICE_PATTERN.flags);
  let match;
  while ((match = cloned.exec(content)) !== null) {
    services.add(match[1]);
  }
  return [...services];
}

function extractCaches(content) {
  const caches = new Set();
  const cloned = new RegExp(CACHE_PATTERN.source, CACHE_PATTERN.flags);
  let match;
  while ((match = cloned.exec(content)) !== null) {
    caches.add(match[1].toLowerCase());
  }
  return [...caches];
}

function extractQueues(content) {
  const queues = new Set();
  const cloned = new RegExp(QUEUE_PATTERN.source, QUEUE_PATTERN.flags);
  let match;
  while ((match = cloned.exec(content)) !== null) {
    queues.add(match[1].toLowerCase());
  }
  return [...queues];
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
    const services = extractServices(content);
    const caches = extractCaches(content);
    const queues = extractQueues(content);

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

module.exports = { extractMetadata };
