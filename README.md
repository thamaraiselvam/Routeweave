# APIFlow / APIMap

API knowledge graph explorer for **Node.js JavaScript/TypeScript backends**.

Current scanning scope is intentionally limited to popular Node frameworks:
- Express (`app.get`, `router.post`, etc.)
- NestJS decorators (`@Get`, `@Post`, etc.)
- Next.js App Router route handlers (`app/api/**/route.ts|js` with `export function GET|POST...`)

## Commands

- `npm test`
- `npx apimap init [path]`
- `npx apimap scan [path]`
- `npx apimap scan-prompt [path]`
- `npx apimap serve [path]`

Server runs at `http://localhost:3789` by default.

## Simple npm usage

You can now pass target directories directly with simple npm commands:

- `npm run scan -- /path/to/project`
- `npm run scan:prompt -- /path/to/project`
- `npm run serve -- /path/to/project`
- `npm run apimap -- scan /path/to/project`

Path behavior:

- For `scan`, `scan-prompt`, and `init`: if no path is passed, APIMap uses the nearest git repository root.
- For `serve`: if no path is passed, APIMap serves the current working directory.
- `--dir /path/to/project` is also supported for all commands.

## Scan behavior

`scan` is now fully local and deterministic. It does not call external AI providers or require API keys.

### Generate a prompt for manual OpenCode execution

If you prefer running OpenCode yourself, generate a ready-to-run prompt:

```bash
npx apimap scan-prompt . > /tmp/apimap-opencode-prompt.txt
```

Copy the prompt block (`---BEGIN_APIMAP_OPENCODE_PROMPT---` to `---END_APIMAP_OPENCODE_PROMPT---`) and paste it into your `opencode run` session. It will instruct OpenCode to create:

- `.apimap/metadata.json`
- `.apimap/api_knowledge.json`
- `.apimap/graph.json`
- `.apimap/scan_state.json`

## Cache output

Scan writes the following files in `.apimap/`:

- `graph.json`
- `api_knowledge.json`
- `metadata.json`
- `scan_state.json`

## Impact analysis

APIFlow now includes table/column impact analysis on top of existing route flows.

- Open the UI and use the **Impact Analysis** card.
- Select a table, optionally enter a column, and run analysis.
- APIFlow returns impacted APIs and explains how each API is affected (read/write/wildcard inferred).

Server endpoint:

- `GET /api/impact` (table catalog)
- `GET /api/impact?table=<table>&column=<column>` (filtered impact results)
