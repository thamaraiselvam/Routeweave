
# API Knowledge Graph Explorer

An open‑source developer tool that scans a backend codebase and generates a **visual API knowledge graph**.

The system uses **AI during the scan phase** to produce structured summaries of APIs and their dependencies.
The generated knowledge is stored in a cache folder so the system can run **offline without AI afterward**.

## Core Idea

Instead of low‑level call graphs, the tool provides **human‑readable explanations of APIs**.

Example:

GET /users/{id}

Flow:
1. Read users table
2. Read user_preferences table
3. Merge results
4. Return response

## Key Features

- AI‑generated API summaries
- Interactive architecture graph
- Offline runtime using cached knowledge
- Visual dependency exploration
- CLI driven workflow

## Commands

apimap init
apimap scan .
apimap serve
