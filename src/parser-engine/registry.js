'use strict';

/**
 * registry.js
 *
 * The adapter registry is the extension point of the parser co-engine.
 *
 * Usage
 * ─────
 *   const registry = createRegistry();
 *   registry.register(expressAdapter);
 *   registry.register(fastifyAdapter);   // future
 *   registry.register(nestjsAdapter);    // future
 *
 *   const active = registry.detect(files, pkgJson);
 *   // → [ expressAdapter ]  (only adapters that recognised this repo)
 *
 * Built-in adapters are auto-registered on first use via
 * registry.registerBuiltins().
 */

const { validateAdapter } = require('./base-adapter');

/**
 * @typedef {object} Registry
 * @property {(adapter: object) => void} register
 * @property {(files: string[], pkgJson: object|null) => object[]} detect
 * @property {() => object[]} all
 * @property {(name: string) => object|undefined} get
 * @property {() => void} registerBuiltins
 */

/**
 * Create a fresh, empty adapter registry.
 * @returns {Registry}
 */
function createRegistry() {
  /** @type {Map<string, object>} */
  const adapters = new Map();

  return {
    /**
     * Register an adapter.  Validates the adapter contract, then stores it.
     * Duplicate names overwrite the previous registration (allows hot-swap in tests).
     *
     * @param {object} adapter
     */
    register(adapter) {
      validateAdapter(adapter);
      adapters.set(adapter.name, adapter);
    },

    /**
     * Run detect() on every registered adapter and return those that
     * recognised the target repository.
     *
     * @param {string[]} files      — absolute file paths from walkRepository()
     * @param {object|null} pkgJson — parsed package.json or null
     * @returns {object[]}          — active adapters for this repo
     */
    detect(files, pkgJson) {
      const active = [];
      for (const adapter of adapters.values()) {
        try {
          if (adapter.detect(files, pkgJson)) {
            active.push(adapter);
          }
        } catch (err) {
          // Detection must never crash the pipeline
          console.warn(`[registry] detect() threw for adapter "${adapter.name}": ${err.message}`);
        }
      }
      // Fallback: if nothing detected, use the express adapter as a best-effort
      if (active.length === 0 && adapters.has('express')) {
        active.push(adapters.get('express'));
      }
      return active;
    },

    /**
     * Return all registered adapters.
     * @returns {object[]}
     */
    all() {
      return [...adapters.values()];
    },

    /**
     * Look up an adapter by name.
     * @param {string} name
     * @returns {object|undefined}
     */
    get(name) {
      return adapters.get(name);
    },

    /**
     * Auto-register all built-in adapters.
     * Call this once before running the engine.
     * Each adapter file must export a single adapter object.
     */
    registerBuiltins() {
      const builtins = [
        require('./adapters/express'),
        require('./adapters/httpserver'),
        require('./adapters/nextjs'),
        require('./adapters/nestjs'),
      ];
      for (const adapter of builtins) {
        this.register(adapter);
      }
    },
  };
}

// Export a singleton registry pre-loaded with builtins,
// plus the factory for test isolation.
const defaultRegistry = createRegistry();
defaultRegistry.registerBuiltins();

module.exports = { createRegistry, defaultRegistry };
