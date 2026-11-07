#!/usr/bin/env node
// agent-monitor serve  — run the dashboard hub
// agent-monitor demo   — run the hub + a fake workload (for screenshots / trying it out)
import { createHub, DEFAULT_PORT, DEFAULT_HOST } from './hub.js';
import { createClient } from './client.js';
import { seed, simulate, SESSION_TITLE } from '../public/shared/demo.js';

const cmd = process.argv[2] || 'serve';
const hub = createHub({ log: console.error });
const addr = await hub.listen(DEFAULT_PORT, DEFAULT_HOST).catch((e) => {
  console.error(e.code === 'EADDRINUSE' ? `port ${DEFAULT_PORT} busy — set AGENT_MONITOR_PORT` : e.message);
  process.exit(1);
});
const url = `http://${addr.address}:${addr.port}`;
console.log(`\n  ╭─ agent-monitor ─────────────────────────╮\n  │  dashboard  ${url.padEnd(28)}│\n  ╰─────────────────────────────────────────╯\n`);

if (cmd === 'demo') {
  const api = createClient(url);
  await api.session({ title: SESSION_TITLE, startedAt: Date.now() - 1_247_000 });
  await seed(api);
  simulate(api, async () => (await api.state()).agents);
  console.log('  demo workload running · ctrl+c to stop');
}
