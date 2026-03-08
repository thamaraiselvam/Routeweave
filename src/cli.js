#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ensureCacheDir } = require('./engine/cache');
const { scanRepository, generateOpenCodeScanPrompt } = require('./engine/workflow');
const { createServer } = require('./server');

const OPTION_ALIASES = {
  dir: 'dir',
  d: 'dir',
};

function printUsage() {
  console.log(`Usage: apilens <init|scan|scan-prompt|serve> [path]

Path behavior:
  - Provide [path] (or --dir <path>) to target that exact directory.
  - If omitted for init/scan/scan-prompt, apilens uses the nearest git repository root.
  - If omitted for serve, apilens serves the current working directory.
`);
}

function findRepositoryRoot(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  let current = resolvedTarget;

  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return resolvedTarget;
    }

    current = parent;
  }
}

function resolveTargetPath(command, argPath, options) {
  const explicitPath = options.dir || argPath;
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  if (command === 'serve') {
    return path.resolve('.');
  }

  return findRepositoryRoot('.');
}

function assertDirectoryExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target path does not exist: ${targetPath}`);
  }

  const stats = fs.statSync(targetPath);
  if (!stats.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetPath}`);
  }
}

function parseArgs(argv) {
  const options = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const isOption = arg.startsWith('--') || (arg.startsWith('-') && arg.length > 1);
    if (!isOption) {
      positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.replace(/^--?/, '').split(/=(.*)/s, 2);
    const optionKey = OPTION_ALIASES[rawKey];
    if (!optionKey) {
      throw new Error(`Unknown option: --${rawKey}`);
    }

    let value = inlineValue;
    if (value === undefined) {
      const next = argv[i + 1];
      const nextIsOption = next && (next.startsWith('--') || (next.startsWith('-') && next.length > 1));
      if (!next || nextIsOption) {
        throw new Error(`Missing value for --${rawKey}`);
      }
      value = next;
      i += 1;
    }

    options[optionKey] = value;
  }

  return { positional, options };
}

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!command) {
    printUsage();
    process.exit(1);
  }

  const { positional, options } = parseArgs(rest);
  if (positional.length > 1) {
    throw new Error(
      `Too many positional arguments: ${positional.slice(1).join(' ')}. `
      + 'Expected at most one optional path argument. '
      + 'If you are running through npm scripts, pass CLI flags after `--` '
      + '(example: npm run scan -- .).',
    );
  }
  const argPath = positional[0];
  const targetPath = resolveTargetPath(command, argPath, options);
  assertDirectoryExists(targetPath);

  if (command === 'init') {
    ensureCacheDir(targetPath);
    console.log(`Initialized .apilens cache at ${targetPath}`);
    return;
  }

  if (command === 'scan') {
    const result = await scanRepository(targetPath, options);
    console.log('Scan completed successfully.');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'scan-prompt') {
    const result = generateOpenCodeScanPrompt(targetPath);

    // Write the instruction file into the target repo's .apilens directory
    const apilensDir = path.join(targetPath, '.apilens');
    fs.mkdirSync(apilensDir, { recursive: true });
    const instructionFile = path.join(apilensDir, 'SCAN_INSTRUCTIONS.md');
    fs.writeFileSync(instructionFile, result.prompt, 'utf8');

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║            APILens Scan Instructions Ready               ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  📄 Instruction file created at:                         ║`);
    console.log(`║     ${instructionFile.padEnd(54)}║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  Next step — open this file in your AI coding agent      ║');
    console.log('║  (Claude Code, Cursor, Copilot, etc.) and run:           ║');
    console.log('║                                                          ║');
    console.log('║    "Follow the instructions in SCAN_INSTRUCTIONS.md"    ║');
    console.log('║                                                          ║');
    console.log('║  The AI will scan your repo and create:                  ║');
    console.log('║    • .apilens/api_knowledge.json  (required)             ║');
    console.log('║    • .apilens/metadata.json       (audit trail)          ║');
    console.log('║                                                          ║');
    console.log('║  Then run:  npx apilens serve .                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(JSON.stringify({ fileCount: result.fileCount, routeCount: result.routeCount, instructionFile }, null, 2));
    return;
  }

  if (command === 'serve') {
    const app = createServer(targetPath);
    const port = process.env.PORT || 3789;
    app.listen(port, () => {
      console.log(`APILens server listening at http://localhost:${port}`);
    });
    return;
  }

  printUsage();
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`apilens failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
  OPTION_ALIASES,
  findRepositoryRoot,
  resolveTargetPath,
  assertDirectoryExists,
};
