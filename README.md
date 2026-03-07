# APIFlow / APIMap

API knowledge graph explorer that scans backend repositories, extracts route metadata, creates AI-style summaries, builds graph cache, and serves an interactive UI.

## Commands

- `npm install`
- `npx apimap init`
- `npx apimap scan .`
- `npx apimap serve`

Server runs by default at `http://localhost:3789`.

## Cache output

Scan writes the following files in `.apimap/`:

- `graph.json`
- `api_knowledge.json`
- `metadata.json`
- `scan_state.json`
