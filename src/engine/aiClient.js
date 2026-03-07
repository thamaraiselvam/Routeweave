function summarizeApi(routeData) {
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

module.exports = { summarizeApi };
