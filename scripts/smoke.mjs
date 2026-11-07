// End-to-end check: spawn the MCP server over stdio and drive one agent through its lifecycle.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.js'], env: { ...process.env } }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));
const a = await call('agent_register', { id: 'smoke', name: 'smoke-test', role: 'qa', task: 'MCP smoke test', steps: ['one', 'two', 'three'] });
console.log('registered:', a.id, a.status, a.dashboard);
console.log('update:', await call('agent_update', { id: 'smoke', step: 1, message: 'halfway', tokensDelta: 500 }));
const u = await call('agent_update', { id: 'smoke', status: 'waiting', stepLabel: 'blocked on review', tokensDelta: 300 });
console.log('status:', u.status);
console.log('complete:', await call('agent_complete', { id: 'smoke', success: true }));
await call('agent_remove', { id: 'smoke' });
console.log('list size:', (await call('agent_list')).length);
await client.close();
