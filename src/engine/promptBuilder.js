function buildPrompt(routeData) {
  const systemPrompt = [
    'You are a backend architecture analyzer.',
    'Return structured JSON describing API behavior.',
    'Return valid JSON only.',
    'Follow the provided schema exactly.',
  ].join('\n');

  const userPrompt = [
    `API Route:\n${routeData.method} ${routeData.path}`,
    `Detected Tables:\n${routeData.tables.join(', ') || 'none'}`,
    `Detected Services:\n${routeData.services.join(', ') || 'none'}`,
    `Code Snippet:\n${routeData.code}`,
    'Generate JSON summary.',
  ].join('\n\n');

  return { systemPrompt, userPrompt };
}

module.exports = { buildPrompt };
