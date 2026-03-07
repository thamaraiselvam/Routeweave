
# Architecture Design

## System Modes

### Scan Mode (AI Required)

Codebase
↓
Scanner
↓
Metadata Extractor
↓
AI Prompt Builder
↓
AI Model
↓
Structured API Summary
↓
Graph Builder
↓
Cache Storage (.apimap)

### Runtime Mode

.apimap cache
↓
Backend API
↓
React UI
↓
Graph Visualization

## Cache Folder

.apimap/

- graph.json
- api_knowledge.json
- metadata.json
- scan_state.json

## Graph Model

Nodes

- api
- database
- service
- cache
- queue

Edges

- api → database
- api → service
- api → cache
- api → queue

Example

GET /users
 ├ users table
 └ preferences table
