const path = require('path');
const { walkRepository } = require('./scanner');
const { extractMetadata } = require('./metadataExtractor');
const { summarizeApi } = require('./aiClient');
const { validateApiSummary } = require('./aiValidator');
const { buildGraph } = require('./graphBuilder');
const { writeCache } = require('./cache');

function generateOpenCodeScanPrompt(repoPath) {
  const root = path.resolve(repoPath);
  const files = walkRepository(root);
  const metadata = extractMetadata(files);
  const metadataJson = JSON.stringify(metadata, null, 2);

  const prompt = [
    '═══════════════════════════════════════════════════════════',
    'APILENS SCAN — PURPOSE',
    '═══════════════════════════════════════════════════════════',
    'You are generating scan cache files for the APILens dashboard.',
    'The dashboard renders these views from your output:',
    '  • Bubble chart   — one bubble per API, grouped by URL domain (users / admin / posts / …)',
    '  • Explorer       — searchable list of all endpoints with one-line summaries',
    '  • Flow overlay   — step-by-step business logic per API, with DB/service/cache nodes',
    '  • Impact Analysis — shows which APIs break when a specific DB table or column changes',
    '',
    'Everything the dashboard displays is derived exclusively from',
    '  .apilens/api_knowledge.json  ← PRIMARY OUTPUT (required)',
    '  .apilens/metadata.json       ← AUDIT TRAIL (required)',
    '',
    'graph.json and scan_state.json are derived automatically by the',
    'APILens server on first boot — you do NOT need to generate them.',
    '',
    `REPOSITORY_ROOT: ${root}`,
    '',
    '═══════════════════════════════════════════════════════════',
    'FIELD DEFINITIONS  (read every definition before writing JSON)',
    '═══════════════════════════════════════════════════════════',
    '',
    '"method"       → HTTP verb in UPPERCASE: GET | POST | PUT | PATCH | DELETE',
    '',
    '"path"         → Exact route path as registered (e.g. /api/users/:id).',
    '                 Use :param style for path parameters. Do NOT invent paths.',
    '',
    '"summary"      → ONE sentence, business-facing language describing what this endpoint does',
    '                 for an end-user or API consumer.',
    '                 ✓ Good: "Creates a new user account after validating email uniqueness and hashing the password."',
    '                 ✗ Bad:  "Handles POST /api/users/registration" or "This route processes user registration."',
    '',
    '"flow"         → Array of 3–7 short, ordered steps describing the BUSINESS LOGIC.',
    '                 • Write from the perspective of what the system does, not how Express handles it.',
    '                 • DO NOT use the word "node" generically.',
    '                 • DO NOT describe middleware wiring (e.g. "express-validator runs").',
    '                 • Each step should name a specific entity when possible.',
    '                 ✓ Good: ["Validate request body", "Check for duplicate email in users collection",',
    '                          "Hash password with bcrypt", "Insert new document into users", "Sign and return JWT"]',
    '                 ✗ Bad:  ["Receive request node", "Process data", "Send response node"]',
    '',
    '"tables"       → DB collections/tables directly read or written by this route.',
    '                 Must be consistent with tableAccess[].table values — no orphaned entries.',
    '',
    '"tableAccess"  → Required for every API. Per-table entry:',
    '                   table      : collection/table name',
    '                   columns    : exact column names accessed; use ["*"] if wildcard or ORM-inferred',
    '                   operations : one or more of SELECT | INSERT | UPDATE | DELETE | UPSERT | UNKNOWN',
    '                   evidence   : up to 2 short code snippets proving the access (file:line + snippet)',
    '                 If a route touches NO database, set tableAccess to [].',
    '',
    '"services"     → ONLY actual external microservices or third-party HTTP APIs called at runtime.',
    '                 Examples: Stripe API, SendGrid, Twilio, another internal service called via HTTP/gRPC.',
    '                 ✗ DO NOT include: npm packages, Express middleware, auth helpers, utility libs.',
    '                 If this route makes no outbound HTTP calls to external systems → []',
    '',
    '"dependencies" → npm packages and middleware used by this route at the code level.',
    '                 Examples: bcrypt, jsonwebtoken, multer, express-validator, cookie-parser, fs, path,',
    '                           mongoose aggregate helpers, passport strategies.',
    '                 These are code-level tools, NOT runtime external services.',
    '',
    '"caches"       → Redis keys, Memcached namespaces, or in-memory cache stores explicitly read/written.',
    '                 If none → []',
    '',
    '"queues"       → Message queues explicitly published to or consumed from',
    '                 (BullMQ jobs, SQS queues, RabbitMQ channels, Kafka topics).',
    '                 If none → []',
    '',
    '═══════════════════════════════════════════════════════════',
    'SCAN INSTRUCTIONS',
    '═══════════════════════════════════════════════════════════',
    '',
    '1) Scan the ENTIRE repository at REPOSITORY_ROOT recursively.',
    '   Read every source file — do not limit yourself to a sample or one subfolder.',
    '   The static hints at the bottom are a starting point only; your scan must be exhaustive.',
    '',
    '2) Discover all API routes end-to-end:',
    '   • Express/Koa/Fastify router files',
    '   • NestJS controllers (@Get/@Post/etc.)',
    '   • Next.js App Router (route.ts/route.js export functions)',
    '   • Any custom framework patterns in this codebase',
    '   Trace each route through its controller → service → repository layers.',
    '   Impact analysis quality depends on accurate table + column coverage; be thorough.',
    '',
    '3) Create `.apilens/metadata.json` — a JSON array, one entry per route:',
    '   { "method": "POST", "path": "/api/users", "framework": "express",',
    '     "filePath": "routes/users.js", "tables": ["users"],',
    '     "services": [], "dependencies": ["bcrypt","jsonwebtoken"],',
    '     "caches": [], "queues": [],',
    '     "tableAccess": [{ "table": "users", "columns": ["email","password"],',
    '                       "operations": ["SELECT","INSERT"], "evidence": ["controller/user.js:31"] }],',
    '     "code": "<30-word relevant handler snippet>" }',
    '',
    '4) Create `.apilens/api_knowledge.json` — a JSON array, one wrapper object per route:',
    '   { "apis": [{ "method": "POST", "path": "/api/users",',
    '                "summary": "Creates a new user after validating email uniqueness and hashing the password.",',
    '                "flow": ["Validate request body","Check for duplicate email in users",',
    '                         "Hash password with bcrypt","Insert document into users","Return JWT"],',
    '                "tables": ["users"], "services": [], "dependencies": ["bcrypt","jsonwebtoken"],',
    '                "caches": [], "queues": [],',
    '                "tableAccess": [{ "table": "users", "columns": ["email","password","fullName"],',
    '                                  "operations": ["SELECT","INSERT"],',
    '                                  "evidence": ["controller/user.js:22 UserModel.findOne({email})",',
    '                                               "controller/user.js:31 new UserModel({...}).save()"] }]',
    '              }] }',
    '',
    '   Rules for api_knowledge.json:',
    '   4a) tableAccess is REQUIRED for every API.',
    '       Use columns:["*"] only when the exact columns cannot be determined.',
    '   4b) tables[] must exactly match the table names in tableAccess[].',
    '   4c) Write one { "apis": [...] } wrapper object per route, not one big array.',
    '',
    '5) Confirm both files are valid JSON by reading them back after writing.',
    '',
    '6) Return a concise success report containing:',
    '   • Total routes discovered',
    '   • Tables covered (count + names)',
    '   • APIs with explicit column-level tableAccess vs wildcard-only',
    '   • Any routes where table/service data could not be determined (and why)',
    '',
    '═══════════════════════════════════════════════════════════',
    'STATIC ROUTE SCAN HINTS  (bootstrap reference — NOT exhaustive)',
    '═══════════════════════════════════════════════════════════',
    'The following was extracted by static regex analysis of the repository.',
    'It covers Express/NestJS/Next.js route declarations, SQL literals, and',
    'common ORM call-sites. Limitations: misses query-builder chains',
    '(Prisma, TypeORM, Sequelize), async handlers, and indirect service calls.',
    'Use this as a checklist — your full scan must go deeper.',
    '',
    metadataJson,
  ].join('\n');

  return {
    fileCount: files.length,
    routeCount: metadata.length,
    prompt,
  };
}

async function scanRepository(repoPath) {
  const root = path.resolve(repoPath);
  const files = walkRepository(root);
  const metadata = extractMetadata(files);

  const apiKnowledge = [];
  for (const routeData of metadata) {
    const summary = await summarizeApi(routeData);
    validateApiSummary(summary);
    apiKnowledge.push(summary);
  }

  const graph = buildGraph(apiKnowledge);
  writeCache(root, { graph, apiKnowledge, metadata });

  return {
    fileCount: files.length,
    routeCount: metadata.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}

module.exports = { scanRepository, generateOpenCodeScanPrompt };
