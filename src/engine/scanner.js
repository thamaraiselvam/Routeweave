const fs = require('fs');
const path = require('path');

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.apilens', 'dist', 'build', '.next', 'coverage']);

function walkRepository(rootDir) {
  const discoveredFiles = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      const ext = path.extname(entry.name);
      if (CODE_EXTENSIONS.has(ext)) {
        discoveredFiles.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return discoveredFiles;
}

module.exports = { walkRepository };
