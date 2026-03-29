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

Point Routeweave at your project and everything happens in the browser:

```bash
npx routeweave /path/to/your/repo
```

Open **http://localhost:3789** — a guided setup wizard walks you through three steps:

| Step | What happens |
|---|---|
| **1. Choose Project** | Pick an already-scanned repo or point to a new directory |
| **2. Parse & AI Enrichment** | Static code analysis runs automatically, then an AI coding agent (Claude Code, Cursor, Copilot, etc.) enriches every endpoint with business-logic detail |
| **3. Explore** | Dashboard is ready — browse APIs, trace flows, run impact analysis |

That's it. No extra commands, no config files to edit.

---

## Supported Frameworks

| Framework | Detection |
|---|---|
| **Express** | `app.get`, `router.post`, method chains |
| **NestJS** | `@Get`, `@Post`, `@Controller` decorators |
| **Next.js App Router** | `app/api/**/route.ts\|js` with `export function GET\|POST…` |

---

## Cache Files

Routeweave stores scan data in `.routeweave/` inside your project:

| File | Required | Description |
|---|---|---|
| `api_knowledge.json` | ✅ Required | Full API metadata — drives all dashboard views |
| `metadata.json` | Optional | Raw route metadata / audit trail |
| `graph.json` | Auto-derived | Built from `api_knowledge.json` on first serve |
| `scan_state.json` | Auto-derived | Scan timestamp and API count |

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

Server runs at `http://localhost:3789`.

## TODO
- Feel free to contribute todo mentioned in `docs/TODO.md`
---

<div align="center">
  <sub>Built with ❤️ — scan once, explore forever.</sub>
</div>
