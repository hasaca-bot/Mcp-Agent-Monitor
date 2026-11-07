// In-memory state for every sub-agent the monitor knows about.
// Emits "change" with a {type, agent|id} payload so the hub can stream it.
// Isomorphic: used by the Node hub and by the in-browser demo mode.
class EventEmitter {
  #h = {};
  on(e, f) { (this.#h[e] ??= []).push(f); return this; }
  off(e, f) { this.#h[e] = (this.#h[e] || []).filter((x) => x !== f); return this; }
  emit(e, ...a) { (this.#h[e] || []).forEach((f) => f(...a)); }
}

export const STATUSES = ['queued', 'running', 'thinking', 'waiting', 'paused', 'error', 'done', 'stopped'];
export const ACTIVE = new Set(['running', 'thinking', 'waiting']);
export const CONTROLS = ['pause', 'resume', 'stop', 'retry'];

const MAX_LOG = 200;
const MAX_SPARK = 48;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Merge limit patches into a list (by id). Shape:
// { id, label, used, limit, unit: '%'|'tok'|'req'|'$', resetsAt, auto }
export function mergeLimits(list, patches = [], now = Date.now()) {
  for (const l of patches) {
    const id = l.id || slug(l.label || 'limit');
    let cur = list.find((x) => x.id === id);
    if (!cur) { cur = { id, label: l.label || id, used: 0, limit: 100, unit: '%', resetsAt: null, auto: false }; list.push(cur); }
    for (const k of ['label', 'used', 'limit', 'unit', 'auto']) if (l[k] !== undefined) cur[k] = l[k];
    if (l.resetsAt !== undefined) cur.resetsAt = l.resetsAt == null ? null : typeof l.resetsAt === 'number' ? l.resetsAt : Date.parse(l.resetsAt) || null;
    if (l.resetsInMs !== undefined) cur.resetsAt = now + Number(l.resetsInMs);
    if (cur.unit === '%') cur.limit = 100;
  }
  return list;
}

export class Store extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map();
    this.seq = 0;
    this.session = { title: 'agent-monitor', startedAt: Date.now() };
    this.usage = null; // provider usage / limits, reported by the orchestrator
    this.system = null; // host CPU / RAM, sampled by the hub
  }

  snapshot() {
    return {
      session: this.session,
      now: Date.now(),
      agents: [...this.agents.values()].sort((a, b) => a.order - b.order),
      usage: this.usage,
      system: this.system,
    };
  }

  get(id) {
    const a = this.agents.get(id);
    if (!a) throw Object.assign(new Error(`unknown agent "${id}"`), { status: 404 });
    return a;
  }

  // Tick the elapsed clock whenever an agent leaves / enters an active state.
  #setStatus(a, status, now = Date.now()) {
    if (!STATUSES.includes(status)) throw Object.assign(new Error(`invalid status "${status}" (use ${STATUSES.join(', ')})`), { status: 400 });
    const was = ACTIVE.has(a.status);
    const will = ACTIVE.has(status);
    if (was && !will && a.runningSince) {
      a.elapsedMs += now - a.runningSince;
      a.runningSince = null;
    }
    if (!was && will) {
      a.runningSince = now;
      a.startedAt ??= now;
    }
    if (status === 'done' || status === 'stopped' || status === 'error') a.endedAt = now;
    else a.endedAt = null;
    if (status === 'done') {
      a.progress = 100;
      a.steps.forEach((s) => (s.state = s.state === 'error' ? 'error' : 'done'));
    }
    if (status === 'error' && a.steps[a.stepIndex]) a.steps[a.stepIndex].state = 'error';
    a.status = status;
  }

  #syncSteps(a) {
    a.steps.forEach((s, i) => {
      if (s.state === 'error' && i === a.stepIndex) return;
      s.state = i < a.stepIndex ? 'done' : i === a.stepIndex ? (a.status === 'done' ? 'done' : 'active') : 'pending';
    });
  }

  register(input = {}) {
    const now = Date.now();
    const id = input.id ? slug(input.id) : `${slug(input.name || 'agent')}-${(++this.seq).toString(36)}`;
    if (this.agents.has(id)) return this.update(id, input);
    const a = {
      id,
      order: this.seq++,
      name: input.name || id,
      role: input.role || 'sub-agent',
      model: input.model || null,
      task: input.task || '',
      status: 'queued',
      progress: 0,
      steps: (input.steps || []).map((t) => ({ title: String(t), state: 'pending' })),
      stepIndex: 0,
      stepLabel: null,
      startedAt: null,
      runningSince: null,
      elapsedMs: 0,
      endedAt: null,
      updatedAt: now,
      metrics: { tokens: 0, toolCalls: 0, ...(input.metrics || {}) },
      spark: [],
      limits: [],
      logs: [],
      pendingControl: null,
    };
    this.agents.set(id, a);
    if (input.tokenBudget !== undefined) mergeLimits(a.limits, [{ id: 'budget', label: 'token budget', unit: 'tok', limit: Number(input.tokenBudget), used: a.metrics.tokens || 0, auto: true }], now);
    if (Array.isArray(input.limits)) mergeLimits(a.limits, input.limits, now);
    this.#setStatus(a, input.status || 'running', now);
    this.#syncSteps(a);
    if (input.message) this.#log(a, input.message, 'info', now);
    this.emit('change', { type: 'upsert', agent: a });
    return a;
  }

  update(id, p = {}) {
    const a = this.get(id);
    const now = Date.now();
    for (const k of ['name', 'role', 'model', 'task']) if (p[k] !== undefined) a[k] = p[k];
    if (Array.isArray(p.steps)) a.steps = p.steps.map((t) => ({ title: String(typeof t === 'string' ? t : t.title), state: 'pending' }));
    if (p.addStep) a.steps.push({ title: String(p.addStep), state: 'pending' });
    if (p.step !== undefined) {
      // step may be a 0-based index or a title (created if missing)
      if (typeof p.step === 'number') a.stepIndex = clamp(Math.round(p.step), 0, Math.max(0, a.steps.length - 1));
      else {
        let i = a.steps.findIndex((s) => s.title === p.step);
        if (i < 0) { a.steps.push({ title: String(p.step), state: 'pending' }); i = a.steps.length - 1; }
        a.stepIndex = i;
      }
    }
    if (p.stepLabel !== undefined) a.stepLabel = p.stepLabel;
    if (p.progress !== undefined) a.progress = clamp(Number(p.progress) || 0, 0, 100);
    else if (p.step !== undefined && a.steps.length) a.progress = Math.max(a.progress, (a.stepIndex / a.steps.length) * 100);
    if (p.metrics) {
      for (const [k, v] of Object.entries(p.metrics)) a.metrics[k] = v;
    }
    if (p.tokenBudget !== undefined) mergeLimits(a.limits, [{ id: 'budget', label: 'token budget', unit: 'tok', limit: Number(p.tokenBudget), used: a.metrics.tokens || 0, auto: true }], now);
    if (Array.isArray(p.limits)) mergeLimits(a.limits, p.limits, now);
    if (p.tokensDelta) {
      a.metrics.tokens = (a.metrics.tokens || 0) + p.tokensDelta;
      for (const l of a.limits) if (l.auto && l.unit === 'tok') l.used += p.tokensDelta;
      a.spark.push(p.tokensDelta);
      this.#autoUsage(p.tokensDelta);
      if (a.spark.length > MAX_SPARK) a.spark.shift();
    }
    if (p.status) this.#setStatus(a, p.status, now);
    if (p.elapsedMs !== undefined) { a.elapsedMs = Math.max(0, Number(p.elapsedMs) || 0); if (a.runningSince) a.runningSince = now; }
    this.#syncSteps(a);
    if (p.message) this.#log(a, p.message, p.level || (a.status === 'error' ? 'error' : 'info'), now);
    a.updatedAt = now;
    this.emit('change', { type: 'upsert', agent: a });
    return a;
  }

  #log(a, msg, level = 'info', now = Date.now()) {
    a.logs.push({ t: now, msg: String(msg).slice(0, 400), level });
    if (a.logs.length > MAX_LOG) a.logs.splice(0, a.logs.length - MAX_LOG);
  }

  log(id, msg, level) {
    const a = this.get(id);
    this.#log(a, msg, level);
    a.updatedAt = Date.now();
    this.emit('change', { type: 'upsert', agent: a });
    return a;
  }

  // A control coming from the dashboard (human) — applied to the display at
  // once and queued so the agent picks it up on its next MCP call.
  control(id, action) {
    const a = this.get(id);
    if (!CONTROLS.includes(action)) throw Object.assign(new Error(`invalid action "${action}"`), { status: 400 });
    const map = { pause: 'paused', resume: 'running', stop: 'stopped', retry: 'running' };
    if (action === 'retry') {
      a.elapsedMs = 0; a.startedAt = null; a.runningSince = null; a.progress = 0; a.stepIndex = 0;
      a.steps.forEach((s) => (s.state = 'pending'));
    }
    this.#setStatus(a, map[action]);
    this.#syncSteps(a);
    this.#log(a, `operator → ${action}`, 'control');
    a.pendingControl = action;
    a.updatedAt = Date.now();
    this.emit('change', { type: 'upsert', agent: a });
    return a;
  }

  takeControl(id) {
    const a = this.agents.get(id);
    if (!a || !a.pendingControl) return null;
    const c = a.pendingControl;
    a.pendingControl = null;
    return c;
  }

  remove(id) {
    this.get(id);
    this.agents.delete(id);
    this.emit('change', { type: 'remove', id });
  }

  clear() {
    this.agents.clear();
    this.emit('change', { type: 'reset' });
  }

  // Usage limits for any number of providers / harnesses (Claude Code,
  // Codex, OpenCode, Antigravity, raw APIs…), keyed by provider id.
  // Limits merge by id; `auto: true` token limits advance with agent tokensDelta.
  setUsage(p = {}) {
    const now = Date.now();
    const u = (this.usage ??= { providers: [] });
    const id = slug(p.id || p.provider || 'provider');
    if (p.remove) { u.providers = u.providers.filter((x) => x.id !== id); this.emit('change', { type: 'usage', usage: u }); return u; }
    let pr = u.providers.find((x) => x.id === id);
    if (!pr) { pr = { id, provider: p.provider || id, plan: null, source: null, limits: [], rate: {}, updatedAt: now }; u.providers.push(pr); }
    for (const k of ['provider', 'plan', 'source']) if (p[k] !== undefined) pr[k] = p[k];
    if (p.rate) Object.assign(pr.rate, p.rate);
    if (p.replace) pr.limits = [];
    mergeLimits(pr.limits, p.limits, now);
    pr.updatedAt = now;
    this.emit('change', { type: 'usage', usage: u });
    return pr;
  }

  #autoUsage(delta) {
    let hit = false;
    for (const pr of this.usage?.providers || []) for (const l of pr.limits) if (l.auto && l.unit === 'tok') { l.used += delta; pr.updatedAt = Date.now(); hit = true; }
    if (hit) this.emit('change', { type: 'usage', usage: this.usage });
  }

  setSystem(sys) {
    this.system = sys;
    this.emit('change', { type: 'system', system: sys });
  }

  setSession(p = {}) {
    Object.assign(this.session, p);
    this.emit('change', { type: 'session', session: this.session });
  }
}
