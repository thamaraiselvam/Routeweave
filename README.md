# APIFlow / APIMap

API knowledge graph explorer for **Node.js JavaScript/TypeScript backends**.

Current scanning scope is intentionally limited to popular Node frameworks:
- Express (`app.get`, `router.post`, etc.)
- NestJS decorators (`@Get`, `@Post`, etc.)
- Next.js App Router route handlers (`app/api/**/route.ts|js` with `export function GET|POST...`)

## Commands

- `npm test`
- `npx apimap init`
- `npx apimap scan .`
- `npx apimap serve`

Server runs at `http://localhost:3789` by default.

## AI scan configuration

`scan` supports two providers:

1. `mock` (default): no network calls, deterministic local summaries
2. `openai`: calls OpenAI-compatible Chat Completions API and validates JSON output before caching

### Option A: pass flags directly

```bash
npx apimap scan . --ai-provider openai --ai-token "$OPENAI_API_KEY" --ai-model gpt-4o-mini
```

### Option B: environment variables

```bash
export APIMAP_AI_PROVIDER=openai
export OPENAI_API_KEY=your_token
export APIMAP_AI_MODEL=gpt-4o-mini
npx apimap scan .
```

Optional endpoint override (OpenAI-compatible gateways):

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1/chat/completions
# or --ai-base-url <url>
```

## Cache output

Scan writes the following files in `.apimap/`:

- `graph.json`
- `api_knowledge.json`
- `metadata.json`
- `scan_state.json`
