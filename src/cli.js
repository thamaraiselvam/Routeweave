#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ensureCacheDir } = require('./engine/cache');
const { scanRepository, generateOpenCodeScanPrompt } = require('./engine/workflow');
const { createServer } = require('./server');

const OPTION_ALIASES = {
  'ai-provider': 'aiProvider',
  provider: 'aiProvider',
  'api-provider': 'aiProvider',
  'ai-token': 'aiToken',
  token: 'aiToken',
  'api-key': 'aiToken',
  'ai-model': 'aiModel',
  model: 'aiModel',
  'ai-base-url': 'aiBaseUrl',
  'base-url': 'aiBaseUrl',
};

function printUsage() {
  console.log(`Usage: apimap <init|scan|scan-prompt|serve> [path] [options]

Options (scan):
  --ai-provider <mock|openai|opencode>   AI provider (default: mock)
  --ai-token <token>            API token (for openai)
  --ai-model <model>            Model name (default: gpt-4o-mini)
  --ai-base-url <url>           Override chat completions endpoint

Also accepts aliases: --provider, --api-provider, --token, --api-key, --model, --base-url.

Environment fallbacks:
  APIMAP_AI_PROVIDER, APIMAP_AI_TOKEN, APIMAP_AI_MODEL, OPENAI_API_KEY, OPENAI_BASE_URL, AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_BASE_URL

Path behavior:
  If path is omitted (or points inside a git repo), apimap scans the repository root containing that location.
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
      + '(example: npm run scan -- --provider openai).',
    );
  }
  const argPath = positional[0];
  const targetPath = findRepositoryRoot(argPath || '.');

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

  if (command === 'scan-prompt') {
    const result = generateOpenCodeScanPrompt(targetPath);
    console.log('OpenCode prompt generated successfully.');
    console.log(JSON.stringify({ fileCount: result.fileCount, routeCount: result.routeCount }, null, 2));
    console.log('---BEGIN_APIMAP_OPENCODE_PROMPT---');
    console.log(result.prompt);
    console.log('---END_APIMAP_OPENCODE_PROMPT---');
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

if (require.main === module) {
  main().catch((error) => {
    console.error(`apimap failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main, OPTION_ALIASES, findRepositoryRoot };
