// HTTP hub: serves the dashboard, a REST API and a Server-Sent Events stream.
// Zero external deps — node:http only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export const DEFAULT_PORT = Number(process.env.AGENT_MONITOR_PORT || 7420);
export const DEFAULT_HOST = process.env.AGENT_MONITOR_HOST || '127.0.0.1';

async function body(req) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 1e6) throw Object.assign(new Error('body too large'), { status: 413 }); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(data));
}

export function createHub({ store = new Store(), log = () => {} } = {}) {
  const clients = new Set();

  store.on('change', (evt) => {
    const line = `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const res of clients) res.write(line);
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE', 'access-control-allow-headers': 'content-type' });
        return res.end();
      }
      if (p === '/api/health') return send(res, 200, { ok: true, app: 'mcp-agent-monitor', agents: store.agents.size });
      if (p === '/api/state' && req.method === 'GET') return send(res, 200, store.snapshot());
      if (p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
        res.write(`event: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (p === '/api/session' && req.method === 'POST') { store.setSession(await body(req)); return send(res, 200, store.session); }
      if (p === '/api/agents' && req.method === 'POST') return send(res, 200, store.register(await body(req)));
      if (p === '/api/agents' && req.method === 'DELETE') { store.clear(); return send(res, 200, { ok: true }); }

      const m = p.match(/^\/api\/agents\/([^/]+)(?:\/(log|control|take-control))?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!m[2] && req.method === 'GET') return send(res, 200, store.get(id));
        if (!m[2] && req.method === 'PATCH') return send(res, 200, store.update(id, await body(req)));
        if (!m[2] && req.method === 'DELETE') { store.remove(id); return send(res, 200, { ok: true }); }
        if (m[2] === 'log' && req.method === 'POST') { const b = await body(req); return send(res, 200, store.log(id, b.message, b.level)); }
        if (m[2] === 'control' && req.method === 'POST') return send(res, 200, store.control(id, (await body(req)).action));
        if (m[2] === 'take-control' && req.method === 'POST') return send(res, 200, { control: store.takeControl(id) });
      }

      if (req.method === 'GET' && !p.startsWith('/api/')) {
        const file = normalize(join(PUBLIC, p === '/' ? 'index.html' : p));
        if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
        const data = await readFile(file).catch(() => null);
        if (!data) return send(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
        return res.end(data);
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      log(`hub error: ${e.message}`);
      send(res, e.status || 500, { error: e.message });
    }
  });

  return {
    store,
    server,
    listen(port = DEFAULT_PORT, host = DEFAULT_HOST) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
      });
    },
    close() { for (const r of clients) r.end(); return new Promise((r) => server.close(r)); },
  };
}
