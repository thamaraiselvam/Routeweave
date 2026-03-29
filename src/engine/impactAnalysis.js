const READ_OPERATIONS = new Set(['SELECT']);
const WRITE_OPERATIONS = new Set(['INSERT', 'UPDATE', 'DELETE', 'UPSERT']);

function normalizeString(value) {
  return String(value || '').trim();
}

function toKey(value) {
  return normalizeString(value).toLowerCase();
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeOperation(value) {
  const upper = normalizeString(value).toUpperCase();
  if (!upper) return null;
  if (upper === 'READ' || upper === 'FETCH' || upper === 'GET') return 'SELECT';
  if (upper === 'WRITE' || upper === 'CREATE' || upper === 'SAVE') return 'INSERT';
  if (upper === 'MODIFY') return 'UPDATE';
  if (upper === 'REMOVE') return 'DELETE';
  if (READ_OPERATIONS.has(upper) || WRITE_OPERATIONS.has(upper) || upper === 'UNKNOWN') return upper;
  return 'UNKNOWN';
}

function inferOperationsFromFlow(flow) {
  const text = Array.isArray(flow) ? flow.join(' ').toLowerCase() : '';
  const operations = [];
  if (/(\bread\b|\bfetch\b|\bselect\b|\bload\b|\blookup\b|\bget\b)/.test(text)) operations.push('SELECT');
  if (/(\binsert\b|\bcreate\b|\bwrite\b|\bsave\b|\bupsert\b)/.test(text)) operations.push('INSERT');
  if (/(\bupdate\b|\bmodify\b|\bpatch\b)/.test(text)) operations.push('UPDATE');
  if (/(\bdelete\b|\bremove\b|\bpurge\b)/.test(text)) operations.push('DELETE');
  return operations.length ? operations : ['UNKNOWN'];
}

function normalizeTableAccessEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const table = normalizeString(entry.table);
  if (!table) return null;

  const rawColumns = Array.isArray(entry.columns) ? entry.columns : [];
  const rawOperations = Array.isArray(entry.operations) ? entry.operations : [];
  const rawEvidence = Array.isArray(entry.evidence)
    ? entry.evidence
    : entry.evidence
      ? [entry.evidence]
      : [];

  const columns = unique(rawColumns);
  const operations = unique(rawOperations.map(normalizeOperation).filter(Boolean));
  const evidence = unique(rawEvidence);

  return {
    table,
    columns,
    operations: operations.length ? operations : ['UNKNOWN'],
    evidence,
  };
}

function fallbackTableAccess(api) {
  const tables = unique(Array.isArray(api.tables) ? api.tables : []);
  if (!tables.length) return [];

  const operations = inferOperationsFromFlow(api.flow);
  return tables.map((table) => ({
    table,
    columns: ['*'],
    operations,
    evidence: ['Inferred from table-level metadata'],
  }));
}

function getTableAccessEntries(api) {
  const explicit = Array.isArray(api.tableAccess)
    ? api.tableAccess.map(normalizeTableAccessEntry).filter(Boolean)
    : [];
  return explicit.length ? explicit : fallbackTableAccess(api);
}

function flattenApis(apiKnowledge) {
  if (!Array.isArray(apiKnowledge)) return [];

  const apis = [];
  for (const item of apiKnowledge) {
    if (!item) continue;
    if (Array.isArray(item.apis)) {
      for (const api of item.apis) {
        if (api && api.method && api.path) apis.push(api);
      }
      continue;
    }

    if (item.method && item.path) {
      apis.push(item);
    }
  }

  return apis;
}

function resolveImpactType(operations) {
  const operationSet = new Set(operations);
  const reads = [...READ_OPERATIONS].some((operation) => operationSet.has(operation));
  const writes = [...WRITE_OPERATIONS].some((operation) => operationSet.has(operation));

  if (reads && writes) return 'reads and writes';
  if (reads) return 'reads';
  if (writes) return 'writes';
  return 'touches';
}

function columnMatchType(entry, columnFilter) {
  if (!columnFilter) return 'table';

  const key = toKey(columnFilter);
  const columnKeys = new Set(entry.columns.map(toKey));

  if (columnKeys.has(key)) return 'explicit';
  if (columnKeys.has('*')) return 'wildcard';
  if (!entry.columns.length) return 'inferred-table';
  return null;
}

function buildImpactHow(impactType, table, column, matchType) {
  const prefix = `${impactType.charAt(0).toUpperCase()}${impactType.slice(1)}`;

  if (!column) {
    return `${prefix} table ${table}`;
  }

  if (matchType === 'explicit') {
    return `${prefix} column ${column} in table ${table}`;
  }

  if (matchType === 'wildcard') {
    return `${prefix} table ${table} via wildcard access; ${column} may be impacted`;
  }

  return `${prefix} table ${table}; column impact inferred from table-level metadata`;
}

function findFlowMatches(flow, table, column) {
  if (!Array.isArray(flow)) return [];

  const tableKey = toKey(table);
  const columnKey = toKey(column);
  return flow.filter((step) => {
    const text = toKey(step);
    if (text.includes(tableKey)) return true;
    return columnKey ? text.includes(columnKey) : false;
  });
}

function analyzeImpact(apis, filters = {}) {
  const tableFilter = normalizeString(filters.table);
  const columnFilter = normalizeString(filters.column);

  if (!tableFilter) return [];

  const results = [];
  const tableKey = toKey(tableFilter);
  const rank = { explicit: 3, wildcard: 2, 'inferred-table': 1, table: 1 };

  for (const api of apis) {
    const entries = getTableAccessEntries(api).filter((entry) => toKey(entry.table) === tableKey);
    if (!entries.length) continue;

    const operations = new Set();
    const columns = new Set();
    const evidence = new Set();
    let bestMatch = 'table';
    let matched = false;

    for (const entry of entries) {
      const matchType = columnMatchType(entry, columnFilter);
      if (!matchType) continue;

      matched = true;
      if (rank[matchType] > rank[bestMatch]) bestMatch = matchType;

      for (const operation of entry.operations) operations.add(operation);
      for (const column of entry.columns) columns.add(column);
      for (const item of entry.evidence) evidence.add(item);
    }

    if (!matched) continue;

    const operationList = [...operations];
    const impactType = resolveImpactType(operationList);
    const method = normalizeString(api.method).toUpperCase();
    const path = normalizeString(api.path);

    results.push({
      method,
      path,
      summary: normalizeString(api.summary) || `${method} ${path} endpoint`,
      table: entries[0].table,
      operations: operationList,
      columns: [...columns],
      columnMatch: bestMatch,
      impact: impactType,
      how: buildImpactHow(impactType, entries[0].table, columnFilter, bestMatch),
      flowMatches: findFlowMatches(api.flow, entries[0].table, columnFilter),
      evidence: [...evidence].slice(0, 3),
    });
  }

  results.sort((a, b) => {
    if (a.path === b.path) {
      return a.method.localeCompare(b.method);
    }
    return a.path.localeCompare(b.path);
  });

  return results;
}

function buildTableCatalog(apis) {
  const tableMap = new Map();

  for (const api of apis) {
    const apiId = `${normalizeString(api.method).toUpperCase()} ${normalizeString(api.path)}`;
    for (const entry of getTableAccessEntries(api)) {
      const key = toKey(entry.table);
      if (!tableMap.has(key)) {
        tableMap.set(key, { table: entry.table, columns: new Set(), apiIds: new Set() });
      }

      const current = tableMap.get(key);
      current.apiIds.add(apiId);
      for (const column of entry.columns) {
        current.columns.add(column);
      }
    }
  }

  const tables = [...tableMap.values()].map((entry) => ({
    table: entry.table,
    columns: [...entry.columns].sort((a, b) => {
      if (a === '*') return -1;
      if (b === '*') return 1;
      return a.localeCompare(b);
    }),
    apiCount: entry.apiIds.size,
  }));

  tables.sort((a, b) => a.table.localeCompare(b.table));
  return tables;
}

function buildDependencyCatalog(apis) {
  const depMap = new Map();

  for (const api of apis) {
    const apiId = `${normalizeString(api.method).toUpperCase()} ${normalizeString(api.path)}`;
    const deps = Array.isArray(api.dependencies) ? api.dependencies : [];
    for (const dep of deps) {
      const name = normalizeString(dep);
      if (!name) continue;
      const key = toKey(dep);
      if (!depMap.has(key)) {
        depMap.set(key, { dependency: name, apiIds: new Set() });
      }
      depMap.get(key).apiIds.add(apiId);
    }
  }

  const catalog = [...depMap.values()].map((entry) => ({
    dependency: entry.dependency,
    apiCount: entry.apiIds.size,
  }));

  catalog.sort((a, b) => (a.dependency < b.dependency ? -1 : a.dependency > b.dependency ? 1 : 0));
  return catalog;
}

function buildServiceCatalog(apis) {
  const svcMap = new Map();

  for (const api of apis) {
    const apiId = `${normalizeString(api.method).toUpperCase()} ${normalizeString(api.path)}`;
    const svcs = Array.isArray(api.services) ? api.services : [];
    for (const svc of svcs) {
      const name = normalizeString(svc);
      if (!name) continue;
      const key = toKey(svc);
      if (!svcMap.has(key)) {
        svcMap.set(key, { service: name, apiIds: new Set() });
      }
      svcMap.get(key).apiIds.add(apiId);
    }
  }

  const catalog = [...svcMap.values()].map((entry) => ({
    service: entry.service,
    apiCount: entry.apiIds.size,
  }));

  catalog.sort((a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : 0));
  return catalog;
}

function analyzeDependencyImpact(apis, filters = {}) {
  const depFilter = normalizeString(filters.dependency);
  if (!depFilter) return [];

  const depKey = toKey(depFilter);
  const results = [];

  for (const api of apis) {
    const deps = Array.isArray(api.dependencies) ? api.dependencies : [];
    const match = deps.find((d) => toKey(d) === depKey);
    if (!match) continue;

    const method = normalizeString(api.method).toUpperCase();
    const path = normalizeString(api.path);

    results.push({
      method,
      path,
      summary: normalizeString(api.summary) || `${method} ${path} endpoint`,
      dependency: normalizeString(match),
      impact: 'uses',
      how: `Uses dependency ${normalizeString(match)}`,
    });
  }

  results.sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });

  return results;
}

function analyzeServiceImpact(apis, filters = {}) {
  const svcFilter = normalizeString(filters.service);
  if (!svcFilter) return [];

  const svcKey = toKey(svcFilter);
  const results = [];

  for (const api of apis) {
    const svcs = Array.isArray(api.services) ? api.services : [];
    const match = svcs.find((s) => toKey(s) === svcKey);
    if (!match) continue;

    const method = normalizeString(api.method).toUpperCase();
    const path = normalizeString(api.path);

    results.push({
      method,
      path,
      summary: normalizeString(api.summary) || `${method} ${path} endpoint`,
      service: normalizeString(match),
      impact: 'calls',
      how: `Calls external service ${normalizeString(match)}`,
    });
  }

  results.sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });

  return results;
}

function buildImpactPayload(apiKnowledge, filters = {}) {
  const apis = flattenApis(apiKnowledge);
  const table = normalizeString(filters.table);
  const column = normalizeString(filters.column);
  const dependency = normalizeString(filters.dependency);
  const service = normalizeString(filters.service);

  let results;
  if (dependency) {
    results = analyzeDependencyImpact(apis, { dependency });
  } else if (service) {
    results = analyzeServiceImpact(apis, { service });
  } else {
    results = analyzeImpact(apis, { table, column });
  }

  return {
    totalApis: apis.length,
    tables: buildTableCatalog(apis),
    dependencies: buildDependencyCatalog(apis),
    services: buildServiceCatalog(apis),
    filters: { table, column, dependency, service },
    results,
  };
}

module.exports = {
  flattenApis,
  analyzeImpact,
  buildImpactPayload,
  buildDependencyCatalog,
  buildServiceCatalog,
  analyzeDependencyImpact,
  analyzeServiceImpact,
};
