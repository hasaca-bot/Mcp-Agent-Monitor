#!/usr/bin/env node
// MCP server (stdio). Every tool talks to the hub over HTTP; if no hub is
// running, this process hosts one, so the dashboard is always one URL away.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureHub } from './client.js';
import { STATUSES, CONTROLS } from './store.js';

const err = (...a) => process.stderr.write(a.join(' ') + '\n');
const { client } = await ensureHub({ log: err });

const server = new McpServer({ name: 'agent-monitor', version: '1.0.0' });

const status = z.enum(STATUSES);
const brief = (a) => ({
  id: a.id, name: a.name, status: a.status, progress: Math.round(a.progress * 10) / 10,
  step: a.steps[a.stepIndex]?.title ?? null, stepIndex: a.stepIndex, steps: a.steps.length,
  elapsedMs: a.elapsedMs + (a.runningSince ? Date.now() - a.runningSince : 0),
});
const ok = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `agent-monitor: ${e.message}` }] });

// Wrap agent-facing writes so any pending operator command rides back on the response.
async function withControl(id, fn) {
  const a = await fn();
  const control = await client.takeControl(id).catch(() => null);
  return ok({ ...brief(a), control, ...(control ? { note: `Operator requested "${control}". Honor it before continuing.` } : {}) });
}
const guard = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

server.registerTool('monitor_open', {
  title: 'Get dashboard URL',
  description: 'Return the URL of the ASCII agent dashboard so the user can open it in a browser.',
  inputSchema: {},
}, guard(async () => ok({ url: client.base, agents: (await client.health()).agents })));

server.registerTool('monitor_set_session', {
  title: 'Set session title',
  description: 'Set the title shown in the dashboard header (e.g. the overall goal the orchestrator is working on).',
  inputSchema: { title: z.string() },
}, guard(async ({ title }) => ok(await client.session({ title }))));

server.registerTool('agent_register', {
  title: 'Register a sub-agent',
  description: 'Add a sub-agent pane to the dashboard. Call once right before you launch the sub-agent. Returns its id; pass that id to every later call.',
  inputSchema: {
    id: z.string().optional().describe('Stable id (slug). Generated from name if omitted. Re-registering an id updates it.'),
    name: z.string().describe('Short display name, e.g. "test-writer"'),
    role: z.string().optional().describe('What kind of agent, e.g. "researcher", "coder", "reviewer"'),
    model: z.string().optional(),
    task: z.string().describe('One-line description of the task given to the sub-agent'),
    steps: z.array(z.string()).optional().describe('Planned steps, in order'),
    status: status.optional().describe('Initial status (default "running")'),
  },
}, guard(async (args) => ok({ ...brief(await client.register(args)), dashboard: client.base })));

server.registerTool('agent_update', {
  title: 'Update a sub-agent',
  description: 'Update status, progress %, current step, metrics, and/or append a log line. Any operator command (pause/stop/resume/retry) pending for this agent is returned in "control" — obey it.',
  inputSchema: {
    id: z.string(),
    status: status.optional(),
    progress: z.number().min(0).max(100).optional().describe('0-100. If omitted and step changes, derived from step position.'),
    step: z.union([z.number().int(), z.string()]).optional().describe('0-based step index, or step title (appended if new)'),
    stepLabel: z.string().optional().describe('Fine-grained detail for the current step, e.g. "file 3/12"'),
    message: z.string().optional().describe('Log line to append'),
    level: z.enum(['info', 'warn', 'error', 'success', 'tool']).optional(),
    tokensDelta: z.number().optional().describe('Tokens used since last update (feeds the activity sparkline)'),
    metrics: z.record(z.union([z.number(), z.string()])).optional().describe('Arbitrary counters, e.g. {toolCalls: 12, files: 4}'),
    task: z.string().optional(),
    addStep: z.string().optional(),
  },
}, guard(async ({ id, ...p }) => withControl(id, () => client.update(id, p))));

server.registerTool('agent_log', {
  title: 'Append a log line',
  description: 'Append one line to the sub-agent log tail shown in its pane.',
  inputSchema: { id: z.string(), message: z.string(), level: z.enum(['info', 'warn', 'error', 'success', 'tool']).optional() },
}, guard(async ({ id, message, level }) => withControl(id, () => client.log(id, message, level))));

server.registerTool('agent_complete', {
  title: 'Finish a sub-agent',
  description: 'Mark the sub-agent finished: success=true -> done (100%), success=false -> error.',
  inputSchema: { id: z.string(), success: z.boolean().default(true), message: z.string().optional() },
}, guard(async ({ id, success, message }) => ok(brief(await client.update(id, {
  status: success ? 'done' : 'error', message: message ?? (success ? 'completed' : 'failed'), level: success ? 'success' : 'error',
})))));

server.registerTool('agent_check_control', {
  title: 'Poll operator command',
  description: `Return (and consume) the pending operator command for an agent: one of ${CONTROLS.join(', ')}, or null.`,
  inputSchema: { id: z.string() },
}, guard(async ({ id }) => ok({ id, control: await client.takeControl(id) })));

server.registerTool('agent_list', {
  title: 'List sub-agents',
  description: 'List all agents with status, progress, step and elapsed time.',
  inputSchema: {},
}, guard(async () => ok((await client.state()).agents.map(brief))));

server.registerTool('agent_remove', {
  title: 'Remove a sub-agent pane',
  description: 'Remove one agent pane from the dashboard.',
  inputSchema: { id: z.string() },
}, guard(async ({ id }) => ok(await client.remove(id))));

server.registerTool('monitor_reset', {
  title: 'Clear dashboard',
  description: 'Remove every agent from the dashboard.',
  inputSchema: {},
}, guard(async () => ok(await client.reset())));

await server.connect(new StdioServerTransport());
err(`agent-monitor MCP ready · dashboard ${client.base}`);
