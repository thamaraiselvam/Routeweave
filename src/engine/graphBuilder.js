function safeId(raw) {
  return raw.replace(/[^a-zA-Z0-9_]/g, '_');
}

function buildGraph(summaries) {
  const nodes = [];
  const edges = [];
  const knownNodeIds = new Set();

  function pushNode(node) {
    if (!knownNodeIds.has(node.id)) {
      knownNodeIds.add(node.id);
      nodes.push(node);
    }
  }

  for (const summary of summaries) {
    for (const api of summary.apis) {
      const apiId = `api_${safeId(`${api.method}_${api.path}`)}`;
      pushNode({
        id: apiId,
        type: 'api',
        label: `${api.method} ${api.path}`,
        summary: api.summary,
        flow: api.flow,
      });

      for (const table of api.tables) {
        const id = `table_${safeId(table)}`;
        pushNode({ id, type: 'database', label: table });
        edges.push({ source: apiId, target: id, type: 'reads' });
      }
      for (const service of api.services) {
        const id = `service_${safeId(service)}`;
        pushNode({ id, type: 'service', label: service });
        edges.push({ source: apiId, target: id, type: 'calls' });
      }
      for (const cache of api.caches) {
        const id = `cache_${safeId(cache)}`;
        pushNode({ id, type: 'cache', label: cache });
        edges.push({ source: apiId, target: id, type: 'uses' });
      }
      for (const queue of api.queues) {
        const id = `queue_${safeId(queue)}`;
        pushNode({ id, type: 'queue', label: queue });
        edges.push({ source: apiId, target: id, type: 'streams' });
      }
    }
  }

  return { nodes, edges };
}

module.exports = { buildGraph };
