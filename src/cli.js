#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ensureCacheDir } = require('./engine/cache');
const { scanRepository, generateOpenCodeScanPrompt, runCodeParser } = require('./engine/workflow');
const { writeScanParseReport } = require('./engine/cache');
const { createServer } = require('./server');

const OPTION_ALIASES = {
  dir: 'dir',
  d: 'dir',
};

function printUsage() {
  console.log(`Usage: routeweave <init|scan|scan-prompt|parse|serve> [path]

Commands:
  init          Create .routeweave cache directory
  scan          Run local metadata scan (static regex analysis)
  scan-prompt   Generate AI scan instruction file (SCAN_INSTRUCTIONS.md)
  parse         Run full code parser on the repository — produces per-file
                statistics and an overall coverage score written to
                .routeweave/scan_parse_report.json
  serve         Start the dashboard HTTP server on port 3789

Path behavior:
  - Provide [path] (or --dir <path>) to target that exact directory.
  - If omitted for init/scan/scan-prompt/parse, routeweave uses the nearest git repository root.
  - If omitted for serve, routeweave serves the current working directory.
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
    console.log(`Initialized .routeweave cache at ${targetPath}`);
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

    // Write the instruction file into the target repo's .routeweave directory
    const routeweaveDir = path.join(targetPath, '.routeweave');
    fs.mkdirSync(routeweaveDir, { recursive: true });
    const instructionFile = path.join(routeweaveDir, 'SCAN_INSTRUCTIONS.md');
    fs.writeFileSync(instructionFile, result.prompt, 'utf8');

    // Also write the parse report produced during scan-prompt
    if (result.stats) {
      writeScanParseReport(targetPath, result.stats);
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║          Routeweave Scan Instructions Ready              ║');
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
    console.log('║    • .routeweave/api_knowledge.json  (required)             ║');
    console.log('║    • .routeweave/metadata.json       (audit trail)          ║');
    console.log('║                                                          ║');
    console.log('║  Then run:  npx routeweave serve .                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(JSON.stringify({ fileCount: result.fileCount, routeCount: result.routeCount, instructionFile }, null, 2));
    return;
  }

  if (command === 'parse') {
    console.log(`\nRunning code parser on: ${targetPath}\n`);
    const { root, stats } = runCodeParser(targetPath);
    writeScanParseReport(targetPath, stats);

    const s = stats.summary;
    const bar = (score) => {
      const filled = Math.round(score / 5);
      return '[' + '█'.repeat(filled) + '░'.repeat(20 - filled) + ']';
    };

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║             Routeweave Code Parser Report                ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Files scanned:      ${String(s.totalFiles).padEnd(36)}║`);
    console.log(`║  Total lines:        ${String(s.totalLines).padEnd(36)}║`);
    console.log(`║  Code lines:         ${String(s.totalCodeLines).padEnd(36)}║`);
    console.log(`║  Routes found:       ${String(s.totalRoutes).padEnd(36)}║`);
    console.log(`║  Files w/ routes:    ${String(s.filesWithRoutes).padEnd(36)}║`);
    console.log(`║  Files w/ SQL:       ${String(s.filesWithSql).padEnd(36)}║`);
    console.log(`║  Files w/ ORM:       ${String(s.filesWithOrm).padEnd(36)}║`);
    console.log(`║  Files w/ HTTP:      ${String(s.filesWithHttpCalls).padEnd(36)}║`);
    console.log(`║  DB tables found:    ${String(s.totalTables).padEnd(36)}║`);
    console.log(`║  Unique packages:    ${String(s.totalImports).padEnd(36)}║`);
    console.log(`║  Frameworks:         ${(stats.frameworks.join(', ') || 'none').padEnd(36)}║`);
    console.log(`║  ORMs:               ${(stats.orms.join(', ') || 'none').padEnd(36)}║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Coverage score:     ${String(s.overallCoverageScore + '%').padEnd(5)} ${bar(s.overallCoverageScore)} ${s.overallCoverageGrade}  ║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    const reportPath = path.join(targetPath, '.routeweave', 'scan_parse_report.json');
    console.log(`║  Report written to:                                      ║`);
    console.log(`║    ${reportPath.slice(-52).padEnd(54)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('View in the dashboard:  routeweave serve .\n');
    return;
  }

  if (command === 'serve') {
    const app = createServer(targetPath);
    const port = process.env.PORT || 3789;
    app.listen(port, () => {
      console.log(`Routeweave server listening at http://localhost:${port}`);
    });
    return;
  }

  printUsage();
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`routeweave failed: ${error.message}`);
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
