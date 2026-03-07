#!/usr/bin/env node
const path = require('path');
const { ensureCacheDir } = require('./engine/cache');
const { scanRepository } = require('./engine/workflow');
const { createServer } = require('./server');

function printUsage() {
  console.log('Usage: apimap <init|scan|serve> [path]');
}

async function main() {
  const [, , command, argPath] = process.argv;
  const targetPath = path.resolve(argPath || '.');

  if (!command) {
    printUsage();
    process.exit(1);
  }

  if (command === 'init') {
    ensureCacheDir(targetPath);
    console.log(`Initialized .apimap cache at ${targetPath}`);
    return;
  }

  if (command === 'scan') {
    const result = scanRepository(targetPath);
    console.log('Scan completed successfully.');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'serve') {
    const app = createServer(targetPath);
    const port = process.env.PORT || 3789;
    app.listen(port, () => {
      console.log(`APIMap server listening at http://localhost:${port}`);
    });
    return;
  }

  printUsage();
  process.exit(1);
}

main();
