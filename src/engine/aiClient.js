const { buildPrompt } = require('./promptBuilder');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function resolveAiConfig(options = {}) {
  const rawProvider = firstDefined([
    options.aiProvider,
    process.env.APIMAP_AI_PROVIDER,
    process.env.AI_PROVIDER,
    process.env.OPENAI_API_PROVIDER,
    'mock',
  ]).toLowerCase();

  const providerAliases = {
    open: 'openai',
    'open-ai': 'openai',
    oai: 'openai',
    'open-code': 'opencode',
    oc: 'opencode',
  };
  const provider = providerAliases[rawProvider] || rawProvider;

  const token = firstDefined([
    options.aiToken,
    process.env.APIMAP_AI_TOKEN,
    process.env.OPENAI_API_KEY,
    process.env.AI_TOKEN,
    process.env.AI_API_KEY,
  ]);

  const model = firstDefined([
    options.aiModel,
    process.env.APIMAP_AI_MODEL,
    process.env.AI_MODEL,
    'gpt-4o-mini',
  ]);

  const baseUrl = firstDefined([
    options.aiBaseUrl,
    process.env.OPENAI_BASE_URL,
    process.env.AI_BASE_URL,
    'https://api.openai.com/v1/chat/completions',
  ]);

  return { provider, token, model, baseUrl };
}

function buildFallbackSummary(routeData) {
  const flow = [];
  for (const table of routeData.tables) {
    flow.push(`Reads ${table} table`);
  }
  for (const service of routeData.services) {
    flow.push(`Calls ${service}`);
  }
  for (const cache of routeData.caches) {
    flow.push(`Uses cache ${cache}`);
  }
  for (const queue of routeData.queues) {
    flow.push(`Publishes/Consumes queue ${queue}`);
  }
  if (!flow.length) {
    flow.push('Processes request and returns response');
  }

  return {
    apis: [
      {
        method: routeData.method,
        path: routeData.path,
        summary: `${routeData.method} ${routeData.path} endpoint`,
        flow,
        tables: routeData.tables,
        services: routeData.services,
        caches: routeData.caches,
        queues: routeData.queues,
      },
    ],
  };
}

async function callOpenAIChat(routeData, options) {
  const { token, model, baseUrl } = resolveAiConfig(options);
  if (!token) {
    throw new Error('Missing API key. Provide --ai-token or set APIMAP_AI_TOKEN / OPENAI_API_KEY');
  }

  const prompt = buildPrompt(routeData);

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI call failed (${response.status}) for model ${model}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenAI call returned empty response content for model ${model}`);
  }

  return JSON.parse(content);
}

function parseJsonFromText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('OpenCode CLI returned empty output');
  }

  const candidates = [trimmed];
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim());
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // Try next candidate.
    }
  }

  throw new Error(`OpenCode CLI output did not contain valid JSON: ${trimmed.slice(0, 200)}`);
}

function parseOpenCodeResponse(stdout) {
  const textParts = [];
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event?.type === 'text' && event?.part?.text) {
        textParts.push(event.part.text);
      }
    } catch (error) {
      // Not JSON events output; handled by fallback parser.
    }
  }

  if (textParts.length > 0) {
    return parseJsonFromText(textParts.join('\n'));
  }

  return parseJsonFromText(stdout);
}

async function callOpenCodeCli(routeData) {
  const prompt = buildPrompt(routeData);
  const mergedPrompt = [
    prompt.systemPrompt,
    prompt.userPrompt,
    'Return valid JSON only.',
  ].join('\n\n');

  const attempts = [
    ['run', '--format', 'json'],
    ['run'],
  ];
  const failures = [];

  for (const args of attempts) {
    try {
      const { stdout } = await execFileAsync('opencode', [...args, mergedPrompt], {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 240000,
      });
      return parseOpenCodeResponse(stdout);
    } catch (error) {
      failures.push(`opencode ${args.join(' ')}: ${error.message}`.trim());
    }
  }

  throw new Error(
    `OpenCode CLI invocation failed. Ensure 'opencode' is installed and configured. ${failures.join(' | ')}`,
  );
}

async function summarizeApi(routeData, options = {}) {
  const { provider } = resolveAiConfig(options);

  if (provider === 'mock') {
    return buildFallbackSummary(routeData);
  }

  if (provider === 'openai') {
    return callOpenAIChat(routeData, options);
  }

  if (provider === 'opencode') {
    return callOpenCodeCli(routeData);
  }

  throw new Error(`Unsupported ai provider: ${provider}. Supported providers: mock, openai, opencode`);
}

module.exports = { summarizeApi, buildFallbackSummary, resolveAiConfig };
