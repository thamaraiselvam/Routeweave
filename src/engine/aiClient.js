const { buildPrompt } = require('./promptBuilder');

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
  const token = options.aiToken || process.env.OPENAI_API_KEY;
  if (!token) {
    throw new Error('Missing OPENAI_API_KEY (or --ai-token) for ai-provider=openai');
  }

  const model = options.aiModel || process.env.APIMAP_AI_MODEL || 'gpt-4o-mini';
  const endpoint = options.aiBaseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const prompt = buildPrompt(routeData);

  const response = await fetch(endpoint, {
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
    throw new Error(`OpenAI call failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI call returned empty response content');
  }

  return JSON.parse(content);
}

async function summarizeApi(routeData, options = {}) {
  const provider = (options.aiProvider || process.env.APIMAP_AI_PROVIDER || 'mock').toLowerCase();

  if (provider === 'mock') {
    return buildFallbackSummary(routeData);
  }

  if (provider === 'openai') {
    return callOpenAIChat(routeData, options);
  }

  throw new Error(`Unsupported ai provider: ${provider}. Supported providers: mock, openai`);
}

module.exports = { summarizeApi, buildFallbackSummary };
