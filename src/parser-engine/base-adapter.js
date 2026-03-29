'use strict';

/**
 * base-adapter.js
 *
 * The contract every framework adapter must satisfy.
 *
 * An adapter is a plain object (or class instance) that exposes:
 *
 *   adapter.name          — unique lowercase string, e.g. 'express'
 *   adapter.detect(files, pkgJson) → boolean
 *     Return true when this adapter recognises the target repo.
 *     Receives the full file list and parsed package.json (or null).
 *
 *   adapter.extractRoutes(filePath, content) → RouteRecord[]
 *     Called once per source file.  Return all route declarations found.
 *
 *   adapter.extractHandlerChain(filePath, content, allFiles) → HandlerChain[]
 *     Trace the call-chain from each route declaration down through
 *     controllers → services → repositories.  allFiles is a Map of
 *     { relativePath → content } for the whole repo.
 *
 * Return types
 * ─────────────────────────────────────────────────────────────────────────
 * RouteRecord {
 *   method:     string          — uppercase HTTP verb
 *   path:       string          — route path with :param style
 *   filePath:   string          — relative path of the file
 *   lineNumber: number          — 1-indexed line where the declaration sits
 *   framework:  string          — adapter name
 *   middlewares: string[]       — inline middleware names detected
 * }
 *
 * HandlerChain {
 *   route:      RouteRecord
 *   steps:      ChainStep[]     — ordered call-chain steps
 *   tables:     string[]        — DB tables/collections touched
 *   tableAccess: TableAccess[]  — per-table column+operation detail
 *   services:   string[]        — outbound HTTP services
 *   caches:     string[]        — cache layers
 *   queues:     string[]        — message queues
 *   imports:    string[]        — npm packages used
 * }
 *
 * ChainStep {
 *   label:      string          — human description (e.g. "UserService.createUser")
 *   filePath:   string          — relative file path
 *   lineNumber: number          — approximate line
 *   role:       string          — 'handler'|'controller'|'service'|'repository'|'middleware'
 * }
 *
 * TableAccess {
 *   table:      string
 *   columns:    string[]
 *   operations: string[]        — SELECT|INSERT|UPDATE|DELETE|UPSERT|UNKNOWN
 *   evidence:   string[]        — short code snippets (max 2)
 * }
 */

/**
 * Validate that an adapter satisfies the base contract.
 * Throws if required properties are missing.
 *
 * @param {object} adapter
 */
function validateAdapter(adapter) {
  const required = ['name', 'detect', 'extractRoutes', 'extractHandlerChain'];
  for (const key of required) {
    if (typeof adapter[key] !== 'function' && typeof adapter[key] !== 'string') {
      throw new Error(
        `Adapter "${adapter.name || '(unnamed)'}" is missing required property: "${key}". ` +
        `All adapters must implement: ${required.join(', ')}.`
      );
    }
  }
  if (typeof adapter.name !== 'string' || !adapter.name.trim()) {
    throw new Error('Adapter must have a non-empty string "name".');
  }
}

/**
 * Create a no-op base adapter with all methods returning safe empty values.
 * Framework adapters can spread this and override only what they need.
 *
 * @param {string} name
 * @returns {object}
 */
function createBaseAdapter(name) {
  return {
    name,

    /**
     * @param {string[]} _files     — absolute file paths
     * @param {object|null} _pkgJson — parsed package.json or null
     * @returns {boolean}
     */
    detect(_files, _pkgJson) {
      return false;
    },

    /**
     * @param {string} _filePath
     * @param {string} _content
     * @returns {import('./index').RouteRecord[]}
     */
    extractRoutes(_filePath, _content) {
      return [];
    },

    /**
     * @param {string} _filePath
     * @param {string} _content
     * @param {Map<string,string>} _allFiles
     * @returns {import('./index').HandlerChain[]}
     */
    extractHandlerChain(_filePath, _content, _allFiles) {
      return [];
    },
  };
}

module.exports = { createBaseAdapter, validateAdapter };
