// Tiny REST client for the hub (used by the MCP server, the CLI and the demo).
import { DEFAULT_HOST, DEFAULT_PORT } from './hub.js';

export function hubUrl(port = DEFAULT_PORT, host = DEFAULT_HOST) {
  return process.env.AGENT_MONITOR_URL || `http://${host}:${port}`;
}

export function createClient(base = hubUrl()) {
  async function call(method, path, payload) {
    const res = await fetch(base + path, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  return {
    base,
    health: () => call('GET', '/api/health'),
    state: () => call('GET', '/api/state'),
    session: (p) => call('POST', '/api/session', p),
    register: (p) => call('POST', '/api/agents', p),
    update: (id, p) => call('PATCH', `/api/agents/${encodeURIComponent(id)}`, p),
    get: (id) => call('GET', `/api/agents/${encodeURIComponent(id)}`),
    log: (id, message, level) => call('POST', `/api/agents/${encodeURIComponent(id)}/log`, { message, level }),
    remove: (id) => call('DELETE', `/api/agents/${encodeURIComponent(id)}`),
    reset: () => call('DELETE', '/api/agents'),
    usage: (p) => (p ? call('POST', '/api/usage', p) : call('GET', '/api/usage')),
    system: () => call('GET', '/api/system'),
  };
}

// Make sure a hub is reachable; host one in this process if none is running.
export async function ensureHub({ log = () => {} } = {}) {
  const client = createClient();
  try { await client.health(); return { client, hosted: false }; } catch {}
  const { createHub } = await import('./hub.js');
  const hub = createHub({ log });
  try {
    const addr = await hub.listen();
    log(`agent-monitor hub listening on http://${addr.address}:${addr.port}`);
    return { client, hosted: true, hub };
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    await client.health(); // another process won the race
    return { client, hosted: false };
  }
}
