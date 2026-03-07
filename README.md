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
- `npx apimap scan-prompt .`
- `npx apimap serve`

If you run via npm scripts and need to pass scan flags, forward them after `--`:

```bash
npm run scan -- --provider openai --ai-token "$OPENAI_API_KEY" --model gpt-4o-mini
```

Server runs at `http://localhost:3789` by default.

## AI scan configuration

`scan` supports three providers:

1. `mock` (default): no network calls, deterministic local summaries
2. `openai`: calls OpenAI-compatible Chat Completions API and validates JSON output before caching
3. `opencode`: invokes the locally installed `opencode` CLI and uses its configured credentials/session

### Option A: pass flags directly

```bash
npx apimap scan . --ai-provider openai --ai-token "$OPENAI_API_KEY" --ai-model gpt-4o-mini
npx apimap scan . --ai-provider opencode
# also valid:
npx apimap scan . --ai-provider=openai --ai-token="$OPENAI_API_KEY" --ai-model=gpt-4o-mini
npx apimap scan . --ai-provider=opencode
```

Both `--key value` and `--key=value` formats are supported.

### Option C: generate a prompt for manual OpenCode execution

If you prefer running OpenCode yourself, generate a ready-to-run prompt:

```bash
npx apimap scan-prompt . > /tmp/apimap-opencode-prompt.txt
```

Copy the prompt block (`---BEGIN_APIMAP_OPENCODE_PROMPT---` to `---END_APIMAP_OPENCODE_PROMPT---`) and paste it into your `opencode run` session. It will instruct OpenCode to create:

- `.apimap/metadata.json`
- `.apimap/api_knowledge.json`
- `.apimap/graph.json`
- `.apimap/scan_state.json`

### Option B: environment variables

```bash
export APIMAP_AI_PROVIDER=openai
export APIMAP_AI_TOKEN=your_token
# or OPENAI_API_KEY / AI_API_KEY
export APIMAP_AI_MODEL=gpt-4o-mini
npx apimap scan .
```


Additional compatibility environment variables are also supported: `AI_PROVIDER`, `AI_API_KEY`/`AI_TOKEN`, `AI_MODEL`, and `AI_BASE_URL`.

Common flag aliases are also supported: `--provider`, `--api-provider`, `--token`, `--api-key`, `--model`, `--base-url`.

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
