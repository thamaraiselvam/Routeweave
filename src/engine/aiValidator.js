function validateApiSummary(summary) {
  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.apis)) {
    throw new Error('Invalid AI output: missing apis array');
  }

  for (const api of summary.apis) {
    const required = ['method', 'path', 'summary', 'flow', 'tables', 'services', 'caches', 'queues'];
    for (const field of required) {
      if (!(field in api)) {
        throw new Error(`Invalid AI output: missing field ${field}`);
      }
    }

    const arrayFields = ['flow', 'tables', 'services', 'caches', 'queues'];
    for (const field of arrayFields) {
      if (!Array.isArray(api[field])) {
        throw new Error(`Invalid AI output: field ${field} must be array`);
      }
    }
  }

  return true;
}

module.exports = { validateApiSummary };
