<div align="center">

# Routeweave

**AI-powered API knowledge graph for Node.js backends**

> Visualise every endpoint, trace business logic step-by-step, and instantly see what breaks when a database column, dependency, or external service changes.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![npm](https://img.shields.io/badge/npx-routeweave-red.svg)](https://npmjs.com/package/routeweave)

</div>

---

## What is Routeweave?

Routeweave scans your Node.js/TypeScript backend with an AI coding agent and builds a rich, interactive knowledge graph. No manual documentation. No API keys required for serving.

| Feature | Description |
|---|---|
| **Bubble Graph** | One bubble per endpoint, clustered by route domain (users / tasks / products / …) |
| **API Explorer** | Searchable list with one-line summaries, flow steps, DB tables, and dependencies |
| **Flow Overlay** | Step-by-step business logic for each endpoint — with DB, service, and cache nodes |
| **Impact Analysis** | Select any DB table, dependency, or external service to instantly see every API affected by a change |

---

## Demo

![Routeweave demo](docs/demo.gif)

---

## Quick Start

### 1. Generate scan instructions

```bash
npx routeweave scan-prompt /path/to/your/repo
```

This creates `.routeweave/SCAN_INSTRUCTIONS.md` inside your target repo and prints:

```
╔══════════════════════════════════════════════════════════╗
║           Routeweave Scan Instructions Ready                ║
╠══════════════════════════════════════════════════════════╣
║  📄 Instruction file created at:                         ║
║     /your/repo/.routeweave/SCAN_INSTRUCTIONS.md              ║
╠══════════════════════════════════════════════════════════╣
║  Next step — open this file in your AI coding agent      ║
║  (Claude Code, Cursor, Copilot, etc.) and run:           ║
║                                                          ║
║    "Follow the instructions in SCAN_INSTRUCTIONS.md"    ║
║                                                          ║
║  The AI will scan your repo and create:                  ║
║    • .routeweave/api_knowledge.json  (required)              ║
║    • .routeweave/metadata.json       (audit trail)           ║
║                                                          ║
║  Then run:  npx routeweave serve .                           ║
╚══════════════════════════════════════════════════════════╝
```

### 2. Run the AI scan

Open `.routeweave/SCAN_INSTRUCTIONS.md` in your AI coding agent (Claude Code, Cursor, GitHub Copilot, etc.) and say:

> **"Follow the instructions in SCAN_INSTRUCTIONS.md"**

The agent will scan every route, trace through controllers → services → repositories, and write:
- `.routeweave/api_knowledge.json` — full API knowledge (required by dashboard)
- `.routeweave/metadata.json` — raw route metadata and audit trail

`graph.json` and `scan_state.json` are derived automatically by the server on first boot — no extra steps needed.

### 3. Launch the dashboard

```bash
npx routeweave serve /path/to/your/repo
```

Open **http://localhost:3789** — the full dashboard is ready.

---

## All Commands

| Command | Description |
|---|---|
| `npx routeweave init [path]` | Create the `.routeweave/` cache directory |
| `npx routeweave scan-prompt [path]` | Generate AI scan instructions → writes `.routeweave/SCAN_INSTRUCTIONS.md` |
| `npx routeweave scan [path]` | Run a local (non-AI) metadata-only scan |
| `npx routeweave serve [path]` | Launch the dashboard server on port 3789 |

**Path behaviour:**
- For `init`, `scan`, `scan-prompt`: defaults to the nearest git repository root if no path is given.
- For `serve`: defaults to the current working directory.
- `--dir /path` is accepted by all commands.

**npm script shortcuts:**
```bash
npm run scan:prompt -- /path/to/project
npm run serve       -- /path/to/project
```

---

## Supported Frameworks

| Framework | Detection |
|---|---|
| **Express** | `app.get`, `router.post`, method chains |
| **NestJS** | `@Get`, `@Post`, `@Controller` decorators |
| **Next.js App Router** | `app/api/**/route.ts\|js` with `export function GET\|POST…` |

---

## Cache Files

The AI scan writes to `.routeweave/` inside your project:

| File | Required | Description |
|---|---|---|
| `api_knowledge.json` | ✅ Required | Full API metadata — drives all dashboard views |
| `metadata.json` | Optional | Raw route metadata / audit trail |
| `graph.json` | Auto-derived | Built from `api_knowledge.json` on first serve |
| `scan_state.json` | Auto-derived | Scan timestamp and API count |
| `SCAN_INSTRUCTIONS.md` | Generated | AI prompt — open in your coding agent |

---

## Impact Analysis API

```
GET /api/impact                            # full catalog (tables, dependencies, services)
GET /api/impact?table=users                # all APIs touching `users`
GET /api/impact?table=users&column=email   # APIs that access the `email` column
GET /api/impact?dependency=bcrypt          # all APIs using `bcrypt`
GET /api/impact?service=SendGrid           # all APIs calling `SendGrid`
```

The dashboard provides a **category switcher** (Tables / Dependencies / Ext. Services) so you can explore impact across all three dimensions interactively.

---

## Development

```bash
npm test          # run test suite
npm run serve -- ../your-repo   # dev server with real data
```

Server runs at `http://localhost:3789`.

## TODO
- Feel free to contribute todo mentioned in `docs/TODO.md`
---

<div align="center">
  <sub>Built with ❤️ — scan once, explore forever.</sub>
</div>
