const http = require('http');
const fs = require('fs');
const path = require('path');
const { readCache } = require('./engine/cache');
const { buildImpactPayload } = require('./engine/impactAnalysis');

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, fallbackType = 'text/plain') {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = ext === '.html' ? 'text/html' : fallbackType;
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(filePath));
}

function createServer(rootDir) {
  const publicDir = path.join(__dirname, '..', 'public');

  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = requestUrl.pathname;

    if (pathname === '/api/graph') {
      try {
        const { graph } = readCache(rootDir);
        return sendJson(res, 200, graph);
      } catch {
        return sendJson(res, 500, { error: 'Failed to load graph cache. Run `apilens scan .` first.' });
      }
    }

    if (pathname === '/api/apis') {
      try {
        const { apiKnowledge } = readCache(rootDir);
        const apis = apiKnowledge.flatMap((summary) => summary.apis);
        return sendJson(res, 200, { apis });
      } catch {
        return sendJson(res, 500, { error: 'Failed to load api knowledge cache. Run `apilens scan .` first.' });
      }
    }

    if (pathname === '/api/impact') {
      try {
        const { apiKnowledge } = readCache(rootDir);
        const table = requestUrl.searchParams.get('table') || '';
        const column = requestUrl.searchParams.get('column') || '';
        const impact = buildImpactPayload(apiKnowledge, { table, column });
        return sendJson(res, 200, impact);
      } catch {
        return sendJson(res, 500, { error: 'Failed to load impact data. Run `apilens scan .` first.' });
      }
    }

    if (pathname === '/' || pathname === '/index.html') {
      return sendFile(res, path.join(publicDir, 'index.html'), 'text/html');
    }

    return sendFile(res, path.join(publicDir, pathname.replace(/^\//, '')));
  });
}

module.exports = { createServer };
