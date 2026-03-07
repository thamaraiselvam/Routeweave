
# Implementation Guide

## Engine Modules

engine/

scanner
metadata-extractor
ai-prompt-builder
ai-client
ai-validator
graph-builder
cache-writer
cache-reader

## Scanner

Walk repository and detect backend files.

Example directories

controllers/
routes/
services/

## Metadata Extractor

Detect

- API routes
- SQL queries
- HTTP service calls

## AI Summary Generation

AI receives structured prompt describing:

- API route
- detected tables
- detected services

AI returns JSON summary.

## Graph Builder

Convert summaries into nodes and edges.

## Cache Writer

Store results in .apimap folder.
