#!/usr/bin/env node
const path = require('path');
const { ensureCacheDir } = require('./engine/cache');
const { scanRepository } = require('./engine/workflow');
const { createServer } = require('./server');

function printUsage() {
  console.log(`Usage: apimap <init|scan|serve> [path] [options]

Options (scan):
  --ai-provider <mock|openai>   AI provider (default: mock)
  --ai-token <token>            API token (for openai)
  --ai-model <model>            Model name (default: gpt-4o-mini)
  --ai-base-url <url>           Override chat completions endpoint

Environment fallbacks:
  APIMAP_AI_PROVIDER, APIMAP_AI_MODEL, OPENAI_API_KEY, OPENAI_BASE_URL
`);
}

function parseArgs(argv) {
  const options = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === 'ai-provider') options.aiProvider = next;
    if (key === 'ai-token') options.aiToken = next;
    if (key === 'ai-model') options.aiModel = next;
    if (key === 'ai-base-url') options.aiBaseUrl = next;
    i += 1;
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
  const argPath = positional[0];
  const targetPath = path.resolve(argPath || '.');

  if (command === 'init') {
    ensureCacheDir(targetPath);
    console.log(`Initialized .apimap cache at ${targetPath}`);
    return;
  }

  if (command === 'scan') {
    const result = await scanRepository(targetPath, options);
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

main().catch((error) => {
  console.error(`apimap failed: ${error.message}`);
  process.exit(1);
});
