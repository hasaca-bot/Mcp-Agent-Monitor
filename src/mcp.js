#!/usr/bin/env node
// MCP server (stdio). Every tool talks to the hub over HTTP; if no hub is
// running, this process hosts one, so the dashboard is always one URL away.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureHub } from './client.js';
import { STATUSES } from './store.js';

const err = (...a) => process.stderr.write(a.join(' ') + '\n');
const { client } = await ensureHub({ log: err });

const server = new McpServer({ name: 'agent-monitor', version: '1.0.0' });

const status = z.enum(STATUSES);
const limit = z.object({
  id: z.string().optional().describe('Stable id, e.g. "session-5h", "weekly", "tpm". Limits merge by id.'),
  label: z.string().optional().describe('Display label, e.g. "5h session", "weekly", "tokens/min"'),
  used: z.number().optional().describe('Amount used so far (in `unit`)'),
  limit: z.number().optional().describe('Cap (in `unit`). Ignored for unit "%" (always 100).'),
  unit: z.enum(['%', 'tok', 'req', '$']).optional().describe('Default "%"'),
  resetsAt: z.union([z.string(), z.number()]).nullable().optional().describe('ISO time or epoch ms when the window resets'),
  resetsInMs: z.number().optional().describe('Alternative to resetsAt: ms from now'),
  auto: z.boolean().optional().describe('unit "tok" only: add every agent tokensDelta to `used` automatically'),
});

const brief = (a) => ({
  id: a.id, name: a.name, status: a.status, progress: Math.round(a.progress * 10) / 10,
  step: a.steps[a.stepIndex]?.title ?? null, stepIndex: a.stepIndex, steps: a.steps.length,
  elapsedMs: a.elapsedMs + (a.runningSince ? Date.now() - a.runningSince : 0),
  limits: (a.limits || []).map((l) => ({ id: l.id, used: l.used, limit: l.limit, unit: l.unit, pct: +((l.unit === '%' ? l.used : (l.used / (l.limit || 1)) * 100)).toFixed(1) })),
});
const ok = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `agent-monitor: ${e.message}` }] });

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
    tokenBudget: z.number().optional().describe('Per-agent token budget; shown as its own meter in the pane and filled automatically from tokensDelta'),
    limits: z.array(limit).optional().describe('Per-agent usage limits shown in this agent\'s pane (e.g. the weekly cap of the model it runs on). Merge by id.'),
  },
}, guard(async (args) => ok({ ...brief(await client.register(args)), dashboard: client.base })));

server.registerTool('agent_update', {
  title: 'Update a sub-agent',
  description: 'Update status, progress %, current step, limits, metrics, and/or append a log line. The dashboard is read-only: it only displays what you report.',
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
    tokenBudget: z.number().optional().describe('Per-agent token budget; shown as its own meter in the pane and filled automatically from tokensDelta'),
    limits: z.array(limit).optional().describe('Per-agent usage limits shown in this agent\'s pane (e.g. the weekly cap of the model it runs on). Merge by id.'),
  },
}, guard(async ({ id, ...p }) => ok(brief(await client.update(id, p)))));

server.registerTool('agent_log', {
  title: 'Append a log line',
  description: 'Append one line to the sub-agent log tail shown in its pane.',
  inputSchema: { id: z.string(), message: z.string(), level: z.enum(['info', 'warn', 'error', 'success', 'tool']).optional() },
}, guard(async ({ id, message, level }) => ok(brief(await client.log(id, message, level)))));

server.registerTool('agent_complete', {
  title: 'Finish a sub-agent',
  description: 'Mark the sub-agent finished: success=true -> done (100%), success=false -> error.',
  inputSchema: { id: z.string(), success: z.boolean().default(true), message: z.string().optional() },
}, guard(async ({ id, success, message }) => ok(brief(await client.update(id, {
  status: success ? 'done' : 'error', message: message ?? (success ? 'completed' : 'failed'), level: success ? 'success' : 'error',
})))));

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


server.registerTool('provider_usage_set', {
  title: 'Report provider usage limits',
  description: 'Show usage / rate limits for one provider or agent harness on the dashboard. Every tool gets its own row: call once per harness/provider you know about (e.g. "Claude Code", "Codex", "OpenCode", "Antigravity", "OpenAI API"). Limits merge by id within that provider. Call at session start and whenever you learn new numbers.',
  inputSchema: {
    provider: z.string().describe('Display name; also the row key, e.g. "Claude Code", "Codex", "OpenCode", "Antigravity"'),
    id: z.string().optional().describe('Row key if different from provider'),
    source: z.string().optional().describe('Where the numbers came from, e.g. "/usage", "rate-limit headers", "~/.codex sessions"'),
    remove: z.boolean().optional().describe('Remove this provider row'),
    plan: z.string().optional().describe('e.g. "Max 20x", "API tier 4"'),
    limits: z.array(limit).optional(),
    rate: z.record(z.union([z.number(), z.string()])).optional().describe('Free-form current rates, e.g. {"rpm": 42}'),
    replace: z.boolean().optional().describe('Drop this provider\'s existing limits first'),
  },
}, guard(async (args) => ok(await client.usage(args))));

server.registerTool('provider_usage_get', {
  title: 'Read provider usage',
  description: 'Return the provider usage / limits currently shown on the dashboard (useful to throttle before hitting a limit).',
  inputSchema: {},
}, guard(async () => ok(await client.usage())));

server.registerTool('system_stats', {
  title: 'Host CPU / RAM',
  description: 'Current CPU % (total and per core), load average, RAM and GPU (NVIDIA via nvidia-smi) usage of the machine running the monitor hub.',
  inputSchema: {},
}, guard(async () => {
  const s = await client.system();
  if (!s) return ok({ note: 'no sample yet' });
  return ok({ cpu: +s.cpu.toFixed(1), cores: s.cores.map((c) => +c.toFixed(0)), load: s.load.map((l) => +l.toFixed(2)), memUsedGB: +(s.memUsed / 2 ** 30).toFixed(2), memTotalGB: +(s.memTotal / 2 ** 30).toFixed(2), memPct: +((s.memUsed / s.memTotal) * 100).toFixed(1), gpu: s.gpu ? { name: s.gpu.name, util: +s.gpu.util.toFixed(1), vramUsedGB: +(s.gpu.memUsed / 2 ** 30).toFixed(2), vramTotalGB: +(s.gpu.memTotal / 2 ** 30).toFixed(2) } : null });
}));

server.registerTool('monitor_reset', {
  title: 'Clear dashboard',
  description: 'Remove every agent from the dashboard.',
  inputSchema: {},
}, guard(async () => ok(await client.reset())));

await server.connect(new StdioServerTransport());
err(`agent-monitor MCP ready · dashboard ${client.base}`);
