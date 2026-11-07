// Fake-but-plausible sub-agent workload used for the demo / screenshots.
// `api` is anything with register(p) / update(id, p) / log(id, msg, level)
// (a Store instance in the browser, the REST client in Node). All calls may be async.

export const SESSION_TITLE = 'ship auth v2 · orchestrator/main';

export const AGENTS = [
  {
    id: 'scout', name: 'scout', role: 'researcher', model: 'haiku',
    task: 'Map the current auth flow across api/, web/ and worker/ services',
    steps: ['Index repository', 'Trace call graph', 'Collect env + secrets usage', 'Summarize findings'],
    start: { status: 'done', step: 3 }, tokens: 61200, tools: 48,
    logs: [['read_file api/src/auth/session.ts', 'tool'], ['grep "refreshToken" → 14 hits in 6 files', 'tool'], ['call graph: 38 nodes, 3 entry points', 'info'], ['findings written to notes/auth-map.md', 'success']],
  },
  {
    id: 'architect', name: 'architect', role: 'planner', model: 'opus',
    task: 'Draft migration plan: opaque session tokens → short-lived JWT + rotation',
    steps: ['Read scout findings', 'Compare token strategies', 'Write ADR-014', 'Split into work items', 'Hand off to coders'],
    start: { status: 'running', step: 3, progress: 71 }, tokens: 38400, tools: 17,
    logs: [['read notes/auth-map.md (412 lines)', 'tool'], ['ADR-014 drafted: rotation window 15m / refresh 30d', 'info'], ['work item #3 depends on #1 (db migration)', 'warn']],
  },
  {
    id: 'coder-api', name: 'coder-api', role: 'coder', model: 'sonnet',
    task: 'Implement /v2/auth/{login,refresh,revoke} endpoints with key rotation',
    steps: ['Scaffold routes', 'JWT signer + JWKS', 'Refresh rotation', 'Revocation list', 'Wire middleware', 'Self-check'],
    start: { status: 'running', step: 2, progress: 44 }, tokens: 52800, tools: 63,
    logs: [['write_file api/src/auth/v2/routes.ts (+184)', 'tool'], ['write_file api/src/auth/v2/jwks.ts (+97)', 'tool'], ['bash: npm run typecheck → 0 errors', 'success'], ['edit refresh.ts: reuse-detection on rotated token', 'tool']],
  },
  {
    id: 'coder-web', name: 'coder-web', role: 'coder', model: 'sonnet',
    task: 'Build login + MFA screens and silent-refresh client for web/',
    steps: ['Login form', 'MFA challenge', 'Silent refresh hook', 'Error states', 'Storybook stories'],
    start: { status: 'thinking', step: 2, progress: 52 }, tokens: 41700, tools: 39,
    logs: [['write_file web/src/auth/LoginForm.tsx (+142)', 'tool'], ['write_file web/src/auth/MfaChallenge.tsx (+118)', 'tool'], ['planning retry/backoff for refresh races…', 'info']],
  },
  {
    id: 'tester', name: 'tester', role: 'qa', model: 'sonnet',
    task: 'Generate integration tests for auth v2 (happy path, replay, expiry)',
    steps: ['Read endpoints', 'Fixtures + clock mock', 'Happy-path suite', 'Replay attack suite', 'Expiry suite', 'Run + report'],
    start: { status: 'waiting', step: 2, progress: 38, label: 'blocked on coder-api' }, tokens: 22300, tools: 21,
    logs: [['fixtures: 6 users, 2 tenants, frozen clock', 'info'], ['bash: npm test -- auth → 12 passed', 'success'], ['waiting for /v2/auth/refresh to land', 'warn']],
  },
  {
    id: 'reviewer', name: 'reviewer', role: 'security', model: 'opus',
    task: 'Security review of token handling, storage and logging',
    steps: ['Threat model', 'Review signer', 'Review storage', 'Check logs for PII', 'Write report'],
    start: { status: 'paused', step: 1, progress: 24 }, tokens: 15900, tools: 9,
    logs: [['threat model: 7 assets, 11 threats (STRIDE)', 'info'], ['finding: kid header not validated against JWKS', 'warn'], ['operator → pause', 'control']],
  },
  {
    id: 'perf', name: 'perf', role: 'benchmark', model: 'haiku',
    task: 'Load-test login path at 2k rps, p99 budget 120 ms',
    steps: ['Provision k6 runner', 'Warm-up', 'Ramp to 2k rps', 'Collect p50/p99'],
    start: { status: 'error', step: 2, progress: 58 }, tokens: 9800, tools: 14,
    logs: [['k6: ramp 500 → 2000 rps over 60s', 'info'], ['p99 = 342 ms (budget 120 ms)', 'warn'], ['bcrypt cost 14 saturates CPU — aborting run', 'error']],
  },
  {
    id: 'docs', name: 'docs', role: 'writer', model: 'haiku',
    task: 'Update API reference, migration guide and CHANGELOG for v2 auth',
    steps: ['Wait for endpoints', 'API reference', 'Migration guide', 'Changelog'],
    start: { status: 'queued', step: 0, progress: 0 }, tokens: 0, tools: 0,
    logs: [['queued behind coder-api, tester', 'info']],
  },
];

const POOL = {
  scout: [['grep "session_id" → 9 hits', 'tool']],
  architect: [['comparing: PASETO vs JWT (ES256)', 'info'], ['work item #4: revoke on password change', 'info'], ['write_file docs/adr/014-token-rotation.md', 'tool'], ['risk: clock skew between regions', 'warn'], ['read_file api/src/auth/session.ts', 'tool'], ['decision: ES256, kid per region, 15m access ttl', 'success'], ['dispatching work item #2 → coder-web', 'info'], ['open question: refresh on websocket reconnect?', 'warn']],
  'coder-api': [['write_file api/src/auth/v2/rotate.ts (+73)', 'tool'], ['migration 0042_refresh_families.sql applied', 'success'], ['edit api/src/auth/v2/revoke.ts (+41 −3)', 'tool'], ['bash: npm run typecheck → 0 errors', 'success'], ['read_file api/src/middleware/auth.ts', 'tool'], ['redis: SETEX revoked:<jti> 900', 'tool'], ['bash: npm test -- v2 → 27 passed', 'success'], ['rotating signing key kid=2026-11-a', 'info']],
  'coder-web': [['write_file web/src/auth/useSilentRefresh.ts (+88)', 'tool'], ['edit web/src/api/client.ts (+22 −6)', 'tool'], ['storybook: 9 stories rendered', 'success'], ['handling 401 → refresh → replay once', 'info'], ['bash: pnpm lint web/src/auth → clean', 'success'], ['write_file web/src/auth/OtpInput.tsx (+64)', 'tool'], ['a11y: focus trap on MFA dialog', 'info'], ['bash: vitest auth → 18 passed', 'success']],
  tester: [['write_file tests/auth/replay.spec.ts (+120)', 'tool'], ['bash: npm test -- replay → 8 passed', 'success'], ['flaky: expiry test off by 1s, pinning clock', 'warn'], ['bash: npm test -- auth → 31 passed', 'success'], ['write_file tests/auth/expiry.spec.ts (+96)', 'tool'], ['coverage auth/v2: 87.4% lines', 'info'], ['bash: npm test -- expiry → 11 passed', 'success']],
  reviewer: [['read_file api/src/auth/v2/jwks.ts', 'tool'], ['ok: refresh tokens hashed at rest (sha-256)', 'success'], ['finding: email logged on failed MFA', 'warn']],
  perf: [['k6 rerun with bcrypt cost 12', 'info'], ['p99 = 96 ms ✓ under budget', 'success']],
  docs: [['write_file docs/api/auth-v2.md (+210)', 'tool'], ['migration guide: 6 sections drafted', 'info'], ['CHANGELOG: 1 breaking, 4 added', 'info'], ['read_file api/src/auth/v2/routes.ts', 'tool'], ['example curl for /v2/auth/refresh added', 'success'], ['link check: 42 links, 0 broken', 'success']],
};

const LABELS = {
  'coder-api': (i) => `file ${(i % 9) + 1}/9`,
  tester: (i) => `case ${(i % 14) + 1}/14`,
  'coder-web': (i) => `component ${(i % 5) + 1}/5`,
  architect: (i) => `item ${(i % 6) + 1}/6`,
};

const now = () => Date.now();
const ELAPSED = { scout: 252, architect: 663, 'coder-api': 1122, 'coder-web': 961, tester: 571, reviewer: 364, perf: 468, docs: 0 };

// Register the cast. Elapsed times are back-dated so the clocks look real.
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const BUDGET = { scout: 80_000, architect: 150_000, 'coder-api': 250_000, 'coder-web': 220_000, tester: 120_000, reviewer: 100_000, perf: 40_000, docs: 60_000 };
// each agent also shows the cap of the model tier it runs on
const MODEL_CAPS = {
  opus: { id: 'model-weekly', label: 'weekly · opus', unit: '%', used: 71.4, resetsInMs: 3 * DAY + 4 * HOUR },
  sonnet: { id: 'model-weekly', label: 'weekly · sonnet', unit: '%', used: 44.9, resetsInMs: 3 * DAY + 4 * HOUR },
  haiku: { id: 'model-rpm', label: 'rate req/min', unit: 'req', used: 22, limit: 50, resetsInMs: MIN },
};
const agentLimits = (a) => (MODEL_CAPS[a.model] ? [MODEL_CAPS[a.model]] : []);
export const USAGE = {
  provider: 'anthropic',
  plan: 'Max 20x',
  limits: [
    { id: 'session', label: '5h session', unit: 'tok', used: 1_312_000, limit: 2_200_000, resetsInMs: HOUR + 47 * MIN, auto: true },
    { id: 'weekly', label: 'weekly · all', unit: '%', used: 38.2, resetsInMs: 3 * DAY + 4 * HOUR },
    { id: 'weekly-opus', label: 'weekly · opus', unit: '%', used: 71.4, resetsInMs: 3 * DAY + 4 * HOUR },
    { id: 'tpm', label: 'rate tok/min', unit: 'tok', used: 182_000, limit: 400_000, resetsInMs: MIN },
  ],
  rate: { rpm: 38 },
};

// `api.usage(p)` is optional (Store.setUsage in the browser, REST client in Node).
export async function seed(api) {
  if (api.usage) await api.usage(USAGE);
  for (const a of AGENTS) {
    await api.register({ id: a.id, name: a.name, role: a.role, model: a.model, task: a.task, steps: a.steps, status: 'running', limits: agentLimits(a) });
    for (const [m, l] of a.logs) await api.log(a.id, m, l);
    await api.update(a.id, {
      step: a.start.step,
      progress: a.start.progress ?? (a.start.status === 'done' ? 100 : 0),
      stepLabel: a.start.label ?? null,
      metrics: { tokens: a.tokens, toolCalls: a.tools },
      status: a.start.status,
      elapsedMs: (ELAPSED[a.id] || 0) * 1000,
      tokenBudget: BUDGET[a.id],
    });
  }
}

// Endless gentle simulation driven by the *real* current state, so operator
// actions (pause / stop / retry from the dashboard) are respected.
// getAgents() -> agents array (may be async). Returns a stop() function.
export function simulate(api, getAgents, { interval = 650, rand = Math.random } = {}) {
  let n = 0;
  const seen = {}; // id -> { status, since }
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const timer = setInterval(async () => {
    n++;
    try {
      const agents = await getAgents();
      for (const a of agents) {
        const t = seen[a.id];
        if (!t || t.status !== a.status) seen[a.id] = { status: a.status, since: now() };
      }
      for (const a of agents) {
        const age = now() - seen[a.id].since;
        const go = (patch) => { seen[a.id] = { status: patch.status, since: now() }; return api.update(a.id, patch); };
        if (a.id === 'tester' && a.status === 'waiting' && age > 9000) await go({ status: 'running', stepLabel: null, message: 'coder-api landed refresh → resuming' });
        else if (a.id === 'coder-web' && a.status === 'thinking' && age > 5000) await go({ status: 'running' });
        else if (a.id === 'coder-web' && a.status === 'running' && age > 14000) await go({ status: 'thinking', message: 'reasoning about refresh races…' });
        else if (a.id === 'docs' && a.status === 'queued' && age > 15000) await go({ status: 'running', message: 'dependencies ready → starting' });
        else if (a.status === 'done' && age > 60000 && a.id !== 'scout') await go({ status: 'running', step: 0, progress: 0, message: 'new batch received' });
      }
      const live = agents.filter((a) => a.status === 'running' || a.status === 'thinking');
      if (!live.length) return;
      const a = pick(live);
      const steps = Math.max(1, a.steps.length);
      const inc = a.status === 'thinking' ? rand() * 0.6 : 0.6 + rand() * 2.4;
      const progress = Math.min(100, a.progress + inc);
      const step = Math.min(steps - 1, Math.floor((progress / 100) * steps));
      const patch = { progress, tokensDelta: Math.round(200 + rand() * 1800), metrics: { toolCalls: (a.metrics.toolCalls || 0) + (rand() < 0.5 ? 1 : 0) } };
      if (step !== a.stepIndex) Object.assign(patch, { step, message: `→ step ${step + 1}/${steps} · ${a.steps[step]?.title ?? ''}`, level: 'info' });
      else if (rand() < 0.55) {
        const last = a.logs[a.logs.length - 1]?.msg;
        const pool = (POOL[a.id] || [['working…', 'info']]).filter(([m]) => m !== last);
        const [m, l] = pick(pool.length ? pool : POOL[a.id]);
        Object.assign(patch, { message: m, level: l });
      }
      if (LABELS[a.id]) patch.stepLabel = LABELS[a.id](n);
      if (progress >= 100) Object.assign(patch, { status: 'done', message: 'completed ✓', level: 'success', stepLabel: null });
      await api.update(a.id, patch);
      if (rand() < 0.3) {
        const cap = MODEL_CAPS[a.model];
        const l = a.limits?.find((x) => x.id === cap?.id);
        if (cap && l) await api.update(a.id, { limits: [{ id: cap.id, used: cap.unit === 'req' ? Math.round(10 + rand() * 38) : Math.min(100, l.used + 0.02), resetsAt: l.resetsAt }] });
      }
      if (api.usage && n % 4 === 0) {
        await api.usage({ limits: [
          { id: 'tpm', used: Math.round(120_000 + rand() * 170_000), resetsInMs: MIN },
          { id: 'weekly', used: Math.min(100, 38.2 + n * 0.004) },
          { id: 'weekly-opus', used: Math.min(100, 71.4 + n * 0.006) },
        ], rate: { rpm: Math.round(30 + rand() * 20) } });
      }
    } catch { /* agent removed meanwhile */ }
  }, interval);
  return () => clearInterval(timer);
}
