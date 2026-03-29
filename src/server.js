const http = require('http');
const fs = require('fs');
const path = require('path');
const { readCacheFrom, readScanParseReportFrom, hasCache, deleteCache, CACHE_DIR } = require('./engine/cache');
const { buildImpactPayload } = require('./engine/impactAnalysis');
const { scanWithProgress, generateOpenCodeScanPrompt } = require('./engine/workflow');
const { writeScanParseReport } = require('./engine/cache');

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

// ── AI enrichment status detection ───────────────────────────────────────────

/**
 * Detect the AI enrichment state for a given repo directory.
 *
 * Returns one of four states:
 *   'none'         — no cache at all, nothing scanned yet
 *   'parser_only'  — api_knowledge.json exists but contains parser-co-engine output
 *                    (identifiable by _framework / _filePath / _lineNumber fields)
 *   'prompt_ready' — SCAN_INSTRUCTIONS.md exists; user needs to feed it to an AI agent
 *   'ai_enriched'  — api_knowledge.json exists with no underscore private fields
 *
 * @param {string} repoDir  Resolved absolute path to the repo
 * @returns {{ state: string, promptPath: string|null, repoDir: string }}
 */
function detectAiStatus(repoDir) {
  const cacheDir = path.join(repoDir, CACHE_DIR);
  const knowledgePath = path.join(cacheDir, 'api_knowledge.json');
  const promptPath = path.join(cacheDir, 'SCAN_INSTRUCTIONS.md');
  const hasPrompt = fs.existsSync(promptPath);
  const hasKnowledge = fs.existsSync(knowledgePath);

  if (!hasKnowledge && !hasPrompt) {
    return { state: 'none', promptPath: null, repoDir };
  }

  if (hasPrompt && !hasKnowledge) {
    return { state: 'prompt_ready', promptPath, repoDir };
  }

  if (hasKnowledge) {
    const isParserOnly = checkIsParserOnly(knowledgePath);
    if (isParserOnly && hasPrompt) {
      // Prompt was generated but AI hasn't written back yet
      return { state: 'prompt_ready', promptPath, repoDir };
    }
    if (isParserOnly) {
      // Parser ran (via scan button) but scan-prompt not yet run
      return { state: 'parser_only', promptPath: null, repoDir };
    }
    return { state: 'ai_enriched', promptPath: null, repoDir };
  }

  return { state: 'none', promptPath: null, repoDir };
}

/**
 * Returns true if the api_knowledge.json at filePath was written by the parser
 * co-engine (identified by presence of _framework, _filePath, or _lineNumber
 * on any api entry).
 */
function checkIsParserOnly(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const entries = Array.isArray(raw) ? raw : [];
    return entries.some(wrapper =>
      Array.isArray(wrapper.apis) &&
      wrapper.apis.some(api =>
        '_framework' in api || '_filePath' in api || '_lineNumber' in api
      )
    );
  } catch {
    return false;
  }
}

// ── Repo registry helpers ─────────────────────────────────────────────────────

/**
 * Derive a short human-readable label from a repo path.
 * e.g. "/Users/tham/projects/my-app" → "my-app"
 */
function repoLabel(repoPath) {
  return path.basename(repoPath);
}

/**
 * Build a registry entry for a given resolved path.
 */
function buildRegistryEntry(repoPath) {
  const resolved = path.resolve(repoPath);
  const statePath = path.join(resolved, CACHE_DIR, 'scan_state.json');
  let scannedAt = null;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    scannedAt = state.scannedAt || null;
  } catch { /* cache may not exist yet */ }

  return { path: resolved, label: repoLabel(resolved), scannedAt };
}

/**
 * Persist the registry to {rootDir}/.routeweave/repos-registry.json.
 */
function saveRegistry(rootDir, registry) {
  try {
    const cacheDir = path.join(rootDir, CACHE_DIR);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'repos-registry.json'),
      JSON.stringify(registry, null, 2),
    );
  } catch { /* non-fatal */ }
}

/**
 * Load persisted registry from {rootDir}/.routeweave/repos-registry.json.
 */
function loadRegistry(rootDir) {
  try {
    const registryPath = path.join(rootDir, CACHE_DIR, 'repos-registry.json');
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Upsert a repo entry into the registry (by resolved path). Returns new registry.
 */
function upsertRegistry(registry, entry) {
  const existing = registry.findIndex(r => r.path === entry.path);
  if (existing >= 0) {
    return registry.map((r, i) => (i === existing ? { ...r, ...entry } : r));
  }
  return [...registry, entry];
}

// ── Server factory ────────────────────────────────────────────────────────────

function createServer(rootDir) {
  const publicDir = path.join(__dirname, '..', 'public');

  // ── Active repo (switchable) — starts as the server's rootDir ────────────
  let activeRepo = path.resolve(rootDir);

  // ── Repos registry — tracks every repo that has been scanned ─────────────
  let reposRegistry = loadRegistry(rootDir);

  // Seed with rootDir if it has a cache
  if (hasCache(rootDir)) {
    const seedEntry = buildRegistryEntry(rootDir);
    reposRegistry = upsertRegistry(reposRegistry, seedEntry);
    saveRegistry(rootDir, reposRegistry);
  }

  // ── Scan state (in-memory, single-process) ────────────────────────────────
  let scanState = { status: 'idle', startedAt: null, repoPath: null, lastError: null };

  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = requestUrl.pathname;

    if (pathname === '/api/graph') {
      try {
        const { graph } = readCacheFrom(activeRepo);
        return sendJson(res, 200, graph);
      } catch {
        return sendJson(res, 500, { error: 'Failed to load graph cache. Run `routeweave scan .` first.' });
      }
    }

    if (pathname === '/api/apis') {
      try {
        const { apiKnowledge } = readCacheFrom(activeRepo);
        const apis = apiKnowledge.flatMap((summary) => summary.apis);
        return sendJson(res, 200, { apis });
      } catch {
        return sendJson(res, 500, { error: 'Failed to load api knowledge cache. Run `routeweave scan .` first.' });
      }
    }

    if (pathname === '/api/impact') {
      try {
        const { apiKnowledge } = readCacheFrom(activeRepo);
        const table = requestUrl.searchParams.get('table') || '';
        const column = requestUrl.searchParams.get('column') || '';
        const dependency = requestUrl.searchParams.get('dependency') || '';
        const service = requestUrl.searchParams.get('service') || '';
        const impact = buildImpactPayload(apiKnowledge, { table, column, dependency, service });
        return sendJson(res, 200, impact);
      } catch {
        return sendJson(res, 500, { error: 'Failed to load impact data. Run `routeweave scan .` first.' });
      }
    }

    if (pathname === '/api/scan-stats') {
      try {
        const report = readScanParseReportFrom(activeRepo);
        if (!report) {
          return sendJson(res, 404, { error: 'No scan parse report found. Run `routeweave parse .` or `routeweave scan-prompt .` first.' });
        }
        return sendJson(res, 200, report);
      } catch {
        return sendJson(res, 500, { error: 'Failed to load scan stats.' });
      }
    }

    // ── GET /api/ai-status — detect AI enrichment state for activeRepo ────────
    if (pathname === '/api/ai-status') {
      const status = detectAiStatus(activeRepo);
      return sendJson(res, 200, status);
    }

    // ── GET /api/repos — list all known scanned repos ─────────────────────
    if (pathname === '/api/repos') {
      return sendJson(res, 200, {
        active: activeRepo,
        repos: reposRegistry,
      });
    }

    // ── POST /api/repos/switch — switch active repo ───────────────────────
    if (pathname === '/api/repos/switch' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { repoPath } = JSON.parse(body || '{}');
          const resolved = path.resolve(repoPath);
          if (!hasCache(resolved)) {
            return sendJson(res, 400, { error: `No scan cache found at ${resolved}. Scan this repo first.` });
          }
          activeRepo = resolved;
          // Ensure it's in the registry
          const entry = buildRegistryEntry(resolved);
          reposRegistry = upsertRegistry(reposRegistry, entry);
          saveRegistry(rootDir, reposRegistry);
          return sendJson(res, 200, { active: activeRepo, label: repoLabel(activeRepo) });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      });
      return;
    }

    // ── POST /api/scan/start — trigger a co-engine scan, stream SSE progress ──
    if (pathname === '/api/scan/start' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let repoPath = activeRepo;
        let rescan = false;
        try {
          const parsed = JSON.parse(body || '{}');
          if (parsed.repoPath) repoPath = path.resolve(parsed.repoPath);
          if (parsed.rescan) rescan = true;
        } catch { /* use activeRepo */ }

        if (scanState.status === 'scanning') {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Scan already in progress' }));
        }

        if (rescan) {
          try { deleteCache(repoPath); } catch { /* non-fatal — cache may not exist */ }
        }

        // Open SSE stream
        res.writeHead(200, {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection':    'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        function sendEvent(data) {
          if (!res.writableEnded) {
            res.write('data: ' + JSON.stringify(data) + '\n\n');
          }
        }

        scanState = { status: 'scanning', startedAt: new Date().toISOString(), repoPath, lastError: null };

        scanWithProgress(repoPath, (event) => {
          sendEvent(event);
        })
          .then(() => {
            scanState = { status: 'done', startedAt: scanState.startedAt, repoPath, lastError: null };
            // Auto-register and switch to the just-scanned repo
            const entry = buildRegistryEntry(repoPath);
            reposRegistry = upsertRegistry(reposRegistry, entry);
            saveRegistry(rootDir, reposRegistry);
            activeRepo = repoPath;
          })
          .catch((err) => {
            const msg = err && err.message ? err.message : String(err);
            scanState = { status: 'error', startedAt: scanState.startedAt, repoPath, lastError: msg };
            sendEvent({ type: 'error', message: msg });
          })
          .finally(() => {
            if (!res.writableEnded) res.end();
          });
      });
      return;
    }

    // ── GET /api/scan/status — return current scan state ─────────────────────
    if (pathname === '/api/scan/status') {
      return sendJson(res, 200, scanState);
    }

    // ── DELETE /api/scan/delete — remove all cache files for active repo ──────
    if (pathname === '/api/scan/delete' && req.method === 'DELETE') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let repoPath = activeRepo;
        try {
          const parsed = JSON.parse(body || '{}');
          if (parsed.repoPath) repoPath = path.resolve(parsed.repoPath);
        } catch { /* use activeRepo */ }

        if (scanState.status === 'scanning') {
          return sendJson(res, 409, { error: 'Cannot delete while a scan is in progress' });
        }

        try {
          const result = deleteCache(repoPath);
          reposRegistry = reposRegistry.filter(r => r.path !== repoPath);
          saveRegistry(rootDir, reposRegistry);
          scanState = { status: 'idle', startedAt: null, repoPath: null, lastError: null };
          return sendJson(res, 200, { deleted: result.deleted, repoPath });
        } catch (err) {
          return sendJson(res, 500, { error: err && err.message ? err.message : String(err) });
        }
      });
      return;
    }

    // ── POST /api/scan-prompt — generate SCAN_INSTRUCTIONS.md for active repo ──
    if (pathname === '/api/scan-prompt' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let repoPath = activeRepo;
        try {
          const parsed = JSON.parse(body || '{}');
          if (parsed.repoPath) repoPath = path.resolve(parsed.repoPath);
        } catch { /* use activeRepo */ }

        try {
          const result = generateOpenCodeScanPrompt(repoPath);

          // Write SCAN_INSTRUCTIONS.md into the repo's .routeweave directory
          const cacheDir = path.join(repoPath, CACHE_DIR);
          fs.mkdirSync(cacheDir, { recursive: true });
          const instructionFile = path.join(cacheDir, 'SCAN_INSTRUCTIONS.md');
          fs.writeFileSync(instructionFile, result.prompt, 'utf8');

          // Write the parse report produced during prompt generation
          if (result.stats) {
            writeScanParseReport(repoPath, result.stats);
          }

          return sendJson(res, 200, {
            fileCount: result.fileCount,
            routeCount: result.routeCount,
            instructionFile,
          });
        } catch (err) {
          return sendJson(res, 500, { error: err && err.message ? err.message : String(err) });
        }
      });
      return;
    }

    // ── GET /api/setup-status — report whether the app needs onboarding ────────
    if (pathname === '/api/setup-status') {
      const hasActiveCache = hasCache(activeRepo);
      const aiStatus = detectAiStatus(activeRepo);
      const knownRepos = reposRegistry.filter(r => hasCache(r.path));
      return sendJson(res, 200, {
        needsSetup: !hasActiveCache,
        activeRepo,
        hasData: hasActiveCache,
        aiState: aiStatus.state,
        knownRepos,
      });
    }

    // ── POST /api/repos/add — register a repo path (pre-scan) ───────────────
    if (pathname === '/api/repos/add' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { repoPath } = JSON.parse(body || '{}');
          if (!repoPath) return sendJson(res, 400, { error: 'repoPath required' });
          const resolved = path.resolve(repoPath);
          if (!fs.existsSync(resolved)) {
            return sendJson(res, 400, { error: `Path does not exist: ${resolved}` });
          }
          // Set as active repo even before scanning
          activeRepo = resolved;
          // Add to registry (scannedAt will be null until scan completes)
          const entry = { path: resolved, label: repoLabel(resolved), scannedAt: null };
          reposRegistry = upsertRegistry(reposRegistry, entry);
          saveRegistry(rootDir, reposRegistry);
          return sendJson(res, 200, { path: resolved, label: repoLabel(resolved) });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      });
      return;
    }

    // ── GET /api/dirs — list subdirectories for path autocomplete ────────────
    if (pathname === '/api/dirs') {
      const reqPath = requestUrl.searchParams.get('path') || rootDir;
      try {
        const resolved = path.resolve(reqPath);
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
          .map(e => path.join(resolved, e.name));
        return sendJson(res, 200, { dirs, current: resolved });
      } catch (err) {
        return sendJson(res, 400, { error: err.message, dirs: [] });
      }
    }

    if (pathname === '/' || pathname === '/index.html') {
      return sendFile(res, path.join(publicDir, 'index.html'), 'text/html');
    }

    return sendFile(res, path.join(publicDir, pathname.replace(/^\//, '')));
  });
}

module.exports = { createServer };
