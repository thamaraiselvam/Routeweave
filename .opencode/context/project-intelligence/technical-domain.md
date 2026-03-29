<!-- Context: project-intelligence/technical | Priority: critical | Version: 1.0 | Updated: 2026-03-28 -->

# Technical Domain

**Purpose**: Tech stack, architecture, and coding patterns for Routeweave — an AI-powered API knowledge graph tool.
**Last Updated**: 2026-03-28

## Quick Reference
**Update Triggers**: New adapters added | Runtime/dependency changes | New engine modules
**Audience**: Developers, AI agents contributing to Routeweave

## Primary Stack
| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js | No framework — native `http`, `fs`, `path` |
| Language | JavaScript (CommonJS) | `"type": "commonjs"` — use `require()` not `import` |
| AI Integration | LLM via aiClient.js | Calls external AI API for API summarisation |
| Cache/State | File-based JSON | `.routeweave/` directory; `cache.js` read/write helpers |
| Testing | Node.js built-in | `node --test` — no external test framework |

## Architecture

```
Type: CLI tool + local HTTP server
Pattern: Pipeline — scan → parse → cache → serve
```

```
routeweave/
├── src/
│   ├── cli.js               # Entry point — command routing
│   ├── server.js            # HTTP server (native http module)
│   ├── engine/              # Core scan/AI/graph pipeline
│   │   ├── scanner.js       # File walker (walkRepository)
│   │   ├── workflow.js      # Orchestration (runCodeParser, scanRepository)
│   │   ├── aiClient.js      # LLM API calls
│   │   ├── graphBuilder.js  # Builds nodes/edges from summaries
│   │   ├── cache.js         # Read/write .routeweave/ JSON files
│   │   └── impactAnalysis.js
│   └── parser-engine/       # Static code analysis
│       ├── index.js         # runParser() public API
│       ├── registry.js      # Adapter registry
│       ├── flow-builder.js  # API knowledge builder
│       ├── reporter.js      # Scan metrics
│       ├── base-adapter.js  # Shared adapter utilities
│       └── adapters/
│           └── express.js   # Express.js route extractor
├── public/                  # Dashboard static assets
└── test/                    # Tests (node --test)
```

## Code Patterns

### HTTP Route Handler (server.js style)
```js
if (pathname === '/api/graph') {
  try {
    const { graph } = readCache(rootDir);
    return sendJson(res, 200, graph);
  } catch {
    return sendJson(res, 500, { error: 'Failed to load graph cache. Run `routeweave scan .` first.' });
  }
}
```

### Module / Pure Function Pattern
```js
'use strict';
/**
 * walkRepository — recursively collect source files.
 * @param {string} rootDir
 * @returns {string[]} absolute file paths
 */
function walkRepository(rootDir) {
  // pure logic — no side effects except fs.readdirSync
  const discoveredFiles = [];
  // ... implementation
  return discoveredFiles;
}
module.exports = { walkRepository };
```

### Adapter Pattern (parser-engine)
```js
// Each adapter implements: detect(), extractRoutes(), extractHandlerChain()
const { createBaseAdapter } = require('../base-adapter');
// detect() checks package.json deps + source patterns
// extractHandlerChain() traces route → controller → service → DB
```

## Naming Conventions
| Type | Convention | Example |
|------|-----------|---------|
| Files | camelCase | `graphBuilder.js`, `aiClient.js` |
| Directories | camelCase or kebab | `parser-engine/`, `adapters/` |
| Functions | camelCase | `walkRepository`, `buildGraph`, `sendJson` |
| Classes | PascalCase (rare) | Not commonly used |
| JSON keys | camelCase | `apiKnowledge`, `tableAccess`, `routeCount` |
| CLI commands | kebab-case | `scan-prompt`, `--dir` |
| Constants/Sets | UPPER_SNAKE | `CODE_EXTENSIONS`, `SKIP_DIRS` |

## Code Standards
- `'use strict'` at top of every module
- CommonJS only — `require()` / `module.exports` — no ES module `import`
- Pure functions preferred; side effects isolated to `cache.js` and `workflow.js`
- JSDoc on all exported functions (param types + return type)
- Error handling: `try/catch` at server boundary; propagate errors up in pipeline modules
- Zero external runtime dependencies — Node.js stdlib only
- Adapter pattern for extensibility: new framework support → add file in `adapters/`

## Security Requirements
- Validate and `path.resolve()` all user-supplied paths before any `fs` operation
- No `eval()` or dynamic `require(path_variable)` — static requires only
- Cache files written to isolated `.routeweave/` directory — never to arbitrary paths
- AI prompt inputs sanitised before sending to LLM (no raw user code injection)
- `SKIP_DIRS` set prevents traversal into `.git`, `node_modules`, etc.

## 📂 Codebase References
- **Entry point**: `src/cli.js` — command routing and arg parsing
- **HTTP server**: `src/server.js` — all API routes, `sendJson` / `sendFile` helpers
- **Pipeline orchestration**: `src/engine/workflow.js` — `runCodeParser`, `scanRepository`
- **File traversal**: `src/engine/scanner.js` — `walkRepository`, `SKIP_DIRS`
- **Graph building**: `src/engine/graphBuilder.js` — `buildGraph`, `safeId`
- **Cache layer**: `src/engine/cache.js` — `readCache`, `writeCache`
- **Parser public API**: `src/parser-engine/index.js` — `runParser`
- **Express adapter**: `src/parser-engine/adapters/express.js` — route + handler extraction
- **Tests**: `test/cli.test.js`, `test/engine.test.js`
- **Config**: `package.json` — scripts, binary entry, `"type": "commonjs"`

## Related Files
- `business-domain.md` — Why this tool exists, target users
- `business-tech-bridge.md` — Business needs → technical solutions
- `decisions-log.md` — Architecture decision history
