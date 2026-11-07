// Agent Monitor — ASCII dashboard renderer.
// Everything is laid out on a character grid: the screen is measured in
// cells (CW × LH px) and every pane is a rect of whole cells. Each row is a
// string of exactly `w` monospace cells (with <span>s for colour and
// <button>s for actions), so the box-drawing frames always line up.
import { Store } from './shared/store.js';
import { seed, simulate, SESSION_TITLE } from './shared/demo.js';

/* ───────────────────────────── config ───────────────────────────── */
const THEMES = [
  { id: 'phosphor', name: 'Phosphor' },
  { id: 'amber', name: 'Amber CRT' },
  { id: 'glacier', name: 'Glacier' },
  { id: 'dusk', name: 'Neon Dusk' },
  { id: 'graphite', name: 'Graphite' },
  { id: 'paper', name: 'Paper' },
];
const ST = {
  running:  { label: 'RUNNING',  cls: 'c-run',   frames: ['▖', '▘', '▝', '▗'], fps: 8 },
  thinking: { label: 'THINKING', cls: 'c-think', frames: ['·', '∙', '•', '●', '•', '∙'], fps: 7 },
  waiting:  { label: 'WAITING',  cls: 'c-wait',  frames: ['◇', '◆'], fps: 1.5 },
  paused:   { label: 'PAUSED',   cls: 'c-pause', frames: ['‖'] },
  error:    { label: 'ERROR',    cls: 'c-err',   frames: ['✗'] },
  done:     { label: 'DONE',     cls: 'c-done',  frames: ['✓'] },
  stopped:  { label: 'STOPPED',  cls: 'c-stop',  frames: ['■'] },
  queued:   { label: 'QUEUED',   cls: 'c-queue', frames: ['○'] },
};
const ACTIVE = new Set(['running', 'thinking', 'waiting']);
const ICONS = new Set([...'●○◆◇▶■□‖✓✗✕▸›▖▘▝▗·∙•▒«']);
const LOGO = [
  ['▄▀█ █▀▀ █▀▀ █▚ █ ▀█▀', '█▚▞█ █▀█ █▚ █ █ ▀█▀ █▀█ █▀█'],
  ['█▀█ █▄█ ██▄ █ ▚█  █ ', '█  █ █▄█ █ ▚█ █  █  █▄█ █▀▄'],
];
const SPARK = '▁▂▃▄▅▆▇█';
const SCRAMBLE = '░▒▓█▚▞<>/\\=+*#';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────────────────────────── text helpers ───────────────────────────── */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const len = (s) => [...s].length;
const VERT = new Set([...'│├┤╭╮╰╯']);
// Rounded corners are drawn in CSS across two cells ("╭─", "─╮", "╰─", "─╯")
// so the radius can be larger than a single glyph allows; lines still meet
// the neighbouring box-drawing glyphs exactly (stroke metrics are measured).
const CORNERS = { '╭─': 'tl', '─╮': 'tr', '╰─': 'bl', '─╯': 'br' };
const iconize = (s) => {
  const cs = [...s];
  let out = '';
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i], pair = c + (cs[i + 1] || '');
    if (CORNERS[pair]) { out += `<i class="k k-${CORNERS[pair]}"></i>`; i++; continue; }
    out += ICONS.has(c) ? `<i class="g">${c}</i>` : VERT.has(c) ? `<i class="g v">${c}</i>` : esc(c);
  }
  return out;
};

// A row builder: parts carry a cell length so we can pad/truncate exactly.
class Line {
  constructor() { this.parts = []; this.n = 0; }
  t(text, cls = '', raw = false) {
    if (text == null || text === '') return this;
    text = String(text);
    this.parts.push({ text, cls, raw, n: len(text) });
    this.n += len(text);
    return this;
  }
  sp(n = 1) { return n > 0 ? this.t(' '.repeat(n)) : this; }
  // pre-rendered html of known cell width (buttons etc.)
  h(html, n) { this.parts.push({ html, n }); this.n += n; return this; }
  fill(width, ch = ' ', cls = '') { return this.t(ch.repeat(Math.max(0, width - this.n)), cls); }
  html(width) {
    let out = '', used = 0;
    for (const p of this.parts) {
      if (used >= width) break;
      if (p.html != null) {
        if (used + p.n > width) break;
        out += p.html; used += p.n; continue;
      }
      let text = p.text;
      if (used + p.n > width) text = [...text].slice(0, Math.max(0, width - used - 1)).join('') + '…';
      const body = p.raw ? text : iconize(text);
      const n = len(text);
      // runs are pinned to an exact cell width so sub-pixel glyph rounding can't drift the grid
      // every run is pinned to an exact cell width: even if a glyph falls back to another font the grid cannot drift
      out += `<span class="c ${p.cls}" style="--n:${n}">${body}</span>`;
      used += n;
    }
    if (used < width) out += ' '.repeat(width - used);
    return out;
  }
}
const L = () => new Line();
Line.prototype.merge = function (o) { for (const p of o.parts) { this.parts.push(p); this.n += p.n; } return this; };

const btn = (label, act, id, kind = '') => ({
  html: `<button class="btn ${kind}" data-act="${act}"${id ? ` data-id="${esc(id)}"` : ''}>${iconize(label)}</button>`,
  n: len(label),
});

const pad2 = (n) => String(n).padStart(2, '0');
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`; };
const clock = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const kfmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0)));
const ago = (ms) => (ms < 1500 ? 'now' : ms < 60000 ? `${Math.floor(ms / 1000)}s ago` : `${Math.floor(ms / 60000)}m ago`);

// Segmented meter: one segment per character cell, filled continuously.
function meter(width, pct, cls = '') {
  width = Math.max(1, width);
  const p = Math.max(0, Math.min(100, pct));
  return { html: `<span class="meter ${cls}" style="--n:${width}"><span class="fill" style="clip-path:inset(0 ${(100 - p).toFixed(3)}% 0 0)"></span></span>`, n: width };
}
function sparkline(values, width, fixedMax) {
  const v = values.slice(-width);
  if (!v.length) return '';
  const max = fixedMax || Math.max(...v, 1);
  return v.map((x) => SPARK[Math.min(7, Math.floor((x / max) * 7.999))]).join('');
}
function scramble(target, t) { // t: 0..1
  const keep = Math.floor(len(target) * t);
  return [...target].map((c, i) => (i < keep || c === ' ' ? c : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0])).join('');
}

/* ───────────────────────────── grid metrics ───────────────────────────── */
const screen = document.getElementById('screen');
let CW = 8, LH = 18, COLS = 120, ROWS = 40, OX = 0, OY = 0;
function measure() {
  const m = document.createElement('div');
  m.className = 'measure';
  m.textContent = 'M'.repeat(200);
  screen.append(m);
  const r = m.getBoundingClientRect();
  CW = r.width / 200; LH = r.height;
  m.remove();
  document.documentElement.style.setProperty('--cw', `${CW}px`);
  strokeMetrics();
  document.documentElement.style.setProperty('--lhpx', `${LH}px`);
  COLS = Math.floor(innerWidth / CW);
  ROWS = Math.floor(innerHeight / LH);
  OX = (innerWidth - COLS * CW) / 2;
  OY = (innerHeight - ROWS * LH) / 2;
}
// Where does the "─" stroke sit inside a row? Measure the real glyph ink.
function strokeMetrics() {
  const fs = parseFloat(getComputedStyle(document.body).fontSize);
  const S = 4, c = document.createElement('canvas');
  c.width = 40 * S; c.height = 80 * S;
  const x = c.getContext('2d');
  x.scale(S, S);
  x.font = `400 ${fs}px "AM Mono", monospace`;
  x.textBaseline = 'alphabetic';
  const by = 50;
  x.fillText('─', 5, by);
  const m = x.measureText('─');
  const col = Math.round((5 + m.width / 2) * S);
  const d = x.getImageData(col, 0, 1, c.height).data;
  let top = -1, bot = -1;
  for (let y = 0; y < c.height; y++) if (d[y * 4 + 3] > 110) { if (top < 0) top = y; bot = y; }
  if (top < 0) return;
  const center = by - (top + bot + 1) / 2 / S; // px above baseline
  const thick = Math.max(1, (bot - top + 1) / S);
  // baseline offset inside a real row, measured from the DOM
  const row = document.createElement('div');
  row.className = 'row measure';
  row.innerHTML = 'M<span style="display:inline-block;width:1px;height:0;vertical-align:baseline"></span>';
  screen.append(row);
  const baseY = row.lastChild.getBoundingClientRect().top - row.getBoundingClientRect().top;
  row.remove();
  const hy = baseY - center;
  const st = document.documentElement.style;
  st.setProperty('--hy', `${hy}px`);
  st.setProperty('--st', `${thick}px`);
  st.setProperty('--rad', `${Math.min(LH - hy, CW).toFixed(2)}px`);
}
const px = (col, row) => [OX + col * CW, OY + row * LH];

// A positioned block of `h` rows × `w` cells with per-row diffing.
class Block {
  constructor(cls = '') {
    this.el = document.createElement('div');
    this.el.className = `blk ${cls}`;
    this.rows = [];
    this.cache = [];
    this.w = 0; this.h = 0;
  }
  place(x, y, w, h) {
    const [l, t] = px(x, y);
    Object.assign(this.el.style, { left: `${l}px`, top: `${t}px`, width: `${w * CW}px`, height: `${h * LH}px` });
    this.x = x; this.y = y;
    if (h !== this.h) {
      while (this.rows.length < h) { const r = document.createElement('div'); r.className = 'row'; this.el.append(r); this.rows.push(r); this.cache.push(null); }
      while (this.rows.length > h) { this.rows.pop().remove(); this.cache.pop(); }
    }
    this.w = w; this.h = h;
  }
  set(i, html, cls) {
    if (i < 0 || i >= this.h) return;
    if (this.cache[i] !== html) { this.rows[i].innerHTML = html; this.cache[i] = html; }
    if (cls !== undefined && this.rows[i].dataset.k !== cls) {
      const r = this.rows[i];
      r.dataset.k = cls;
      r.classList.remove('enter');
      if (cls && cls.startsWith('new:')) { void r.offsetWidth; r.classList.add('enter'); }
    }
  }
}

/* ───────────────────────────── state ───────────────────────────── */
const params = new URLSearchParams(location.search);
const app = {
  agents: new Map(),
  session: { title: 'agent-monitor', startedAt: Date.now() },
  skew: 0,
  mode: 'connecting', // hub | demo | connecting | offline
  hub: location.host,
  focus: null,
  theme: params.get('theme') || safeGet('am.theme') || 'phosphor',
  basic: (params.get('mode') || safeGet('am.mode')) === 'basic',
  menu: null,
  dirty: true,
  usage: null,
  sys: null,
  cpuHist: [],
  memHist: [],
  gpuHist: [],
  tokHist: [], // [t, totalTokens] for burn rate
};
function pushSystem(sys) {
  app.sys = sys;
  app.cpuHist.push(sys.cpu); if (app.cpuHist.length > 120) app.cpuHist.shift();
  app.memHist.push((sys.memUsed / sys.memTotal) * 100); if (app.memHist.length > 120) app.memHist.shift();
  if (sys.gpu) { app.gpuHist.push(sys.gpu.util); if (app.gpuHist.length > 120) app.gpuHist.shift(); }
}
// Plausible host metrics for the in-browser demo (the real hub samples the OS).
function fakeSystem(store) {
  const n = 16, cores = Array.from({ length: n }, () => 20 + Math.random() * 30);
  let mem = 0.46, gpu = 35;
  const tick = () => {
    const busy = [...app.agents.values()].filter((a) => ACTIVE.has(a.status)).length;
    for (let i = 0; i < n; i++) cores[i] = Math.max(2, Math.min(100, cores[i] + (Math.random() - 0.5) * 22 + (busy * 6 - cores[i]) * 0.08));
    mem = Math.max(0.3, Math.min(0.92, mem + (Math.random() - 0.48) * 0.006));
    gpu = Math.max(3, Math.min(99, gpu + (Math.random() - 0.5) * 14 + (busy * 9 - gpu) * 0.05));
    store.setSystem({ t: Date.now(), host: 'workstation', platform: 'linux x64', cpu: cores.reduce((a, b) => a + b, 0) / n, cores: [...cores], model: 'x86_64 · 16 threads', load: [busy * 0.9 + 1.2, busy * 0.8 + 1, busy * 0.7 + 0.9], memUsed: mem * 32 * 2 ** 30, memTotal: 32 * 2 ** 30, rss: 84 * 2 ** 20, gpu: { name: 'discrete GPU · 16 GB', util: gpu, memUsed: (6 + gpu / 12) * 2 ** 30, memTotal: 16 * 2 ** 30 } });
  };
  tick();
  setInterval(tick, 1000);
}
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
document.documentElement.dataset.theme = app.theme;
document.documentElement.dataset.mode = app.basic ? 'basic' : 'full';

function onEvent(evt) {
  if (evt.type === 'snapshot') {
    app.agents = new Map(evt.agents.map((a) => [a.id, a]));
    app.session = evt.session;
    app.skew = Date.now() - evt.now;
  } else if (evt.type === 'upsert') app.agents.set(evt.agent.id, structuredClone(evt.agent));
  else if (evt.type === 'remove') app.agents.delete(evt.id);
  else if (evt.type === 'reset') app.agents.clear();
  else if (evt.type === 'session') app.session = { ...evt.session };
  else if (evt.type === 'usage') { app.usage = structuredClone(evt.usage); if (teleRows() !== app.teleN) layout(); return; }
  else if (evt.type === 'system') { pushSystem(evt.system); return; }
  if (evt.type === 'snapshot') { app.usage = evt.usage || null; if (evt.system) pushSystem(evt.system); if (teleRows() !== app.teleN) layout(); }
  if (app.focus && !app.agents.has(app.focus)) app.focus = null;
  app.dirty = true;
}

async function connect() {
  const wantDemo = params.has('demo') || location.protocol === 'file:';
  if (!wantDemo) {
    try {
      const h = await fetch('/api/health', { cache: 'no-store' });
      if (h.ok && (await h.json()).app === 'mcp-agent-monitor') return connectHub();
    } catch {}
  }
  startLocalDemo();
}

function connectHub() {
  app.mode = 'connecting';
  const es = new EventSource('/api/events');
  for (const t of ['snapshot', 'upsert', 'remove', 'reset', 'session', 'usage', 'system']) es.addEventListener(t, (e) => { app.mode = 'hub'; onEvent({ type: t, ...JSON.parse(e.data) }); });
  es.onerror = () => { app.mode = 'offline'; app.dirty = true; };
}

async function startLocalDemo() {
  app.mode = 'demo';
  app.hub = 'in-browser demo';
  const store = new Store();
  store.on('change', (e) => onEvent(e.type === 'upsert' ? { type: 'upsert', agent: e.agent } : e));
  store.setSession({ title: SESSION_TITLE, startedAt: Date.now() - 1_247_000 });
  const api = { register: (p) => store.register(p), update: (id, p) => store.update(id, p), log: (id, m, l) => store.log(id, m, l), usage: (p) => store.setUsage(p) };
  await seed(api);
  fakeSystem(store);
  onEvent({ type: 'snapshot', ...store.snapshot() });
  if (!params.has('still')) simulate(api, () => store.snapshot().agents, { interval: 600 });
  window.__store = store;
}

const now = () => Date.now() - app.skew;
const elapsed = (a) => a.elapsedMs + (a.runningSince ? Math.max(0, now() - a.runningSince) : 0);

/* ───────────────────────────── header / footer ───────────────────────────── */
const header = new Block('header');
const footer = new Block('footer');
screen.append(header.el, footer.el);
let overallShown = 0;

function renderHeader(t) {
  const w = header.w;
  const inner = w - 2;
  const list = [...app.agents.values()];
  const count = (s) => list.filter((a) => a.status === s).length;
  const overall = list.length ? list.reduce((s, a) => s + a.progress, 0) / list.length : 0;
  overallShown += (overall - overallShown) * 0.12;
  const tokens = list.reduce((s, a) => s + (a.metrics?.tokens || 0), 0);

  // top border
  const live = app.mode === 'hub' ? ['● LIVE', 'c-run'] : app.mode === 'demo' ? ['● DEMO', 'c-wait'] : app.mode === 'offline' ? ['✕ OFFLINE', 'c-err'] : ['○ CONNECTING', 'dim'];
  const blinkOn = Math.floor(t / 900) % 2 === 0 || app.mode !== 'hub';
  const top = L().t('╭─┤', 'fr').t(' agent·monitor ', 'b acc').t('├', 'fr').t('─'.repeat(2), 'fr').t(' v1.0 ', 'dim').t('─', 'fr');
  const topR = L().t('┤', 'fr').t(' ').t(blinkOn ? live[0] : '  ' + live[0].slice(2), live[1]).t(' · ', 'faint').t(app.hub, 'dim').t(' ').t('├─┤', 'fr').t(' ' + clock(t) + ' ', 'b').t('├─╮', 'fr');
  header.set(0, top.fill(w - topR.n, '─', 'fr').merge(topR).html(w));

  // logo rows + stats
  const logoW = len(LOGO[0][0]) + 2 + len(LOGO[0][1]);
  for (let i = 0; i < 2; i++) {
    const row = L().t('│', 'fr').sp(2);
    if (!app.basic && inner > logoW + 72) row.t(LOGO[i][0], 'logo xb').sp(2).t(LOGO[i][1], 'logo l2 xb').sp(4);
    if (i === 0) {
      row.t('session ', 'dim').t(app.session.title || '—', 'b');
      const r = L()
        .t('▸ ', 'dim').t(String(list.length), 'b').t(' agents  ', 'dim')
        .t('▶ ', 'c-run').t(String(count('running')), 'b').t(' run  ', 'dim')
        .t('● ', 'c-think').t(String(count('thinking')), 'b').t(' think  ', 'dim')
        .t('◇ ', 'c-wait').t(String(count('waiting')), 'b').t(' wait  ', 'dim')
        .t('‖ ', 'c-pause').t(String(count('paused')), 'b').t(' paused  ', 'dim')
        .t('✗ ', 'c-err').t(String(count('error')), 'b').t(' err  ', 'dim')
        .t('✓ ', 'c-done').t(String(count('done')), 'b').t(' done', 'dim').sp(2).t('│', 'fr');
      header.set(1, row.fill(w - r.n).merge(r).html(w));
    } else {
      const up = hms(t - (app.session.startedAt || t));
      if (!app.basic) row.t('uptime ', 'dim').t(up, 'b').t('   tokens ', 'dim').t(kfmt(tokens), 'b');
      const bw = Math.max(10, Math.min(40, Math.floor(inner * 0.18)));
      const b = meter(bw, overallShown, 'global');
      const r = L().t('overall ', 'dim').h(b.html, b.n).t(` ${overallShown.toFixed(1).padStart(5)}%`, 'b').sp(2).t('│', 'fr');
      header.set(2, row.fill(w - r.n).merge(r).html(w));
    }
  }

  // bottom border with global actions
  const theme = THEMES.find((x) => x.id === app.theme) || THEMES[0];
  const bl = L().t('╰─', 'fr');
  if (app.focus) { const b = btn(' « BACK TO GRID ', 'unfocus'); bl.t('┤', 'fr').h(b.html, b.n).t('├─', 'fr'); }
  const actions = [btn(app.basic ? ' ▣ FULL MODE ' : ' □ BASIC MODE ', 'basic', '', app.basic ? 'on' : ''), btn(` ▒ THEME · ${theme.name.toUpperCase()} `, 'theme-menu', '', app.menu ? 'on' : '')];
  const br = L();
  actions.forEach((a, i) => br.t('┤', 'fr').h(a.html, a.n).t(i < actions.length - 1 ? '├─' : '├', 'fr'));
  br.t('─╯', 'fr');
  header.set(3, bl.fill(w - br.n, '─', 'fr').merge(br).html(w));
}

function renderFooter() {
  const w = footer.w;
  const l = L().t(' T', 'acc b').t(' theme  ', 'dim').t('B', 'acc b').t(' basic  ', 'dim').t('1-9', 'acc b').t(' focus  ', 'dim').t('ESC', 'acc b').t(' grid', 'dim').t('   read-only · the orchestrator controls the agents', 'faint');
  const r = L();
  if (!app.basic) r.t('mcp ', 'dim').t('agent_register · agent_update · agent_complete', 'faint').t('   ', '');
  r.t('made by', 'faint').sp(1).h(`<a class="btn credit" href="https://x.com/realhasaca" target="_blank" rel="noopener">${iconize(' X @realhasaca ')}</a>`, len(' X @realhasaca '));
  footer.set(0, l.fill(w - r.n).merge(r).html(w));
}

/* ───────────────────────────── panes ───────────────────────────── */
const panes = new Map();

class Pane {
  constructor(agent, index, first) {
    this.id = agent.id;
    this.block = new Block('pane');
    this.el = this.block.el;
    this.el.dataset.id = agent.id;
    this.prog = agent.progress;
    this.status = agent.status;
    this.scr = null;
    this.lastLog = null;
    this.el.classList.add('enter');
    this.el.style.setProperty('--delay', `${first ? 80 + index * 55 : 0}ms`);
    this.el.addEventListener('animationend', (e) => { if (e.animationName === 'pane-in') this.el.classList.remove('enter'); });
    screen.append(this.el);
  }
  place(rect) {
    const had = this.block.w > 0;
    const old = had ? this.el.getBoundingClientRect() : null;
    this.block.place(rect.x, rect.y, rect.w, rect.h);
    if (had && !reduced && !this.el.classList.contains('enter')) {
      const nw = this.el.getBoundingClientRect();
      const dx = old.left - nw.left, dy = old.top - nw.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        this.el.style.transition = 'none';
        this.el.style.transform = `translate(${dx}px, ${dy}px)`;
        void this.el.offsetWidth;
        this.el.style.transition = 'transform 480ms var(--ease-out), opacity 240ms var(--ease-out), filter 240ms var(--ease-out)';
        this.el.style.transform = '';
      }
    }
  }
  render(a, t, index) {
    const { w, h } = this.block;
    if (!w) return;
    const W = w - 4; // content width inside "│ " … " │"
    const st = ST[a.status] || ST.queued;

    if (a.status !== this.status) {
      this.scr = { from: t, to: st.label };
      this.status = a.status;
      this.el.classList.remove('flash'); void this.el.offsetWidth; this.el.classList.add('flash');
    }
    this.el.dataset.status = a.status;
    this.prog += (a.progress - this.prog) * (reduced ? 1 : 0.14);
    if (Math.abs(a.progress - this.prog) < 0.05) this.prog = a.progress;

    const rows = [];
    const sep = (label) => ({ sep: label });
    const cell = (line) => rows.push(line);

    // ── fixed head
    const tE = elapsed(a);
    const basic = app.basic;
    if (basic) cell(L().t('◆ ', 'pc').t(a.name.toUpperCase(), 'b'));
    else {
      cell(L().t('◆ ', 'pc').t(a.name.toUpperCase(), 'b').t('  ').t(a.role || '', 'dim').t(a.model ? ` · ${a.model}` : '', 'faint')
        .fill(W - 10).t('T+', 'dim').t(hms(tE), ACTIVE.has(a.status) ? 'b' : 'dim'));
      cell(L().t('“' + (a.task || '—') + '”', 'dim'));
      cell(L());
    }
    const pctTxt = `${this.prog.toFixed(1).padStart(5)}%`;
    const b = meter(W - len(pctTxt) - 1, this.prog);
    cell(L().h(b.html, b.n).sp(1).t(pctTxt, 'b pc'));
    const n = a.steps.length;
    const cur = a.steps[a.stepIndex];
    const stepLine = L().t('step ', 'dim').t(n ? `${a.stepIndex + 1}/${n}` : '—', 'b').t('  › ', 'faint').t(cur ? cur.title : a.stepLabel || 'working', a.status === 'done' ? 'c-done' : ACTIVE.has(a.status) ? 'shimmer pc' : '');
    if (cur && a.stepLabel) stepLine.t(' · ' + a.stepLabel, a.status === 'waiting' ? 'c-wait' : 'dim');
    if (!basic) cell(stepLine);

    // ── this agent's own usage limits (token budget, model caps…)
    const maxLim = basic ? Math.max(0, Math.min(4, h - 9)) : h >= 24 ? 3 : h >= 17 ? 2 : h >= 13 ? 1 : 0;
    const lims = (a.limits || []).slice(0, maxLim);
    if (lims.length) {
      if (!basic) cell(L());
      for (const l of lims) cell(L().t('◇ ', limitPct(l) >= 90 ? 'lvl-crit' : 'faint').h(limitCell(l, W - 2, t, 15).html(W - 2), W - 2));
    }

    // ── flexible sections
    const fixedTail = basic ? 0 : 1; // metrics
    let free = h - 2 - rows.length - fixedTail;
    let stepRows = 0, logRows = 0;
    if (basic && n && free >= 2) { stepRows = Math.min(n, free - 1); free -= stepRows + 1; }
    else if (free >= 4 && n) {
      const want = Math.min(n, Math.max(2, Math.ceil((free - 2) * 0.42)));
      stepRows = Math.min(want, free - 1);
      free -= stepRows + 1;
    }
    if (basic) free = 0;
    else if (free >= 2) logRows = free - 1;
    else if (free > 0) { stepRows += free; free = 0; }

    if (stepRows) {
      rows.push(sep(`${basic ? 'TASKS' : 'STEPS'} ${a.steps.filter((s) => s.state === 'done').length}/${n}`));
      let start = Math.max(0, Math.min(a.stepIndex - Math.floor((stepRows - 1) / 2), n - stepRows));
      for (let i = start; i < start + stepRows; i++) {
        const s = a.steps[i];
        if (!s) { cell(L()); continue; }
        const icon = { done: ['✓', 'c-done'], active: [ACTIVE.has(a.status) ? '▸' : '‖', 'pc'], error: ['✗', 'c-err'], pending: ['○', 'faint'] }[s.state] || ['○', 'faint'];
        const line = L().t(icon[0], icon[1]).sp(1).t(pad2(i + 1), 'faint').sp(2);
        line.t(s.title, s.state === 'active' ? (ACTIVE.has(a.status) ? 'shimmer pc b' : 'b') : s.state === 'done' ? 'dim' : s.state === 'error' ? 'c-err' : 'faint');
        cell(line);
      }
    }
    const logKeys = [];
    if (logRows) {
      rows.push(sep(`LOG ${a.logs.length}`));
      const tail = a.logs.slice(-logRows);
      for (let i = 0; i < logRows; i++) {
        const lg = tail[i];
        if (!lg) { cell(L()); logKeys.push(null); continue; }
        const mark = { tool: '›', info: '·', warn: '!', error: '✗', success: '✓', control: '◆' }[lg.level] || '·';
        const line = L().h(`<span class="lg">${L().t(clock(lg.t), 'faint').sp(1).t(mark, `lv-${lg.level}`).sp(1).t(lg.msg, `lv-${lg.level}`).html(W)}</span>`, W);
        cell(line);
        logKeys.push(lg.t + '|' + lg.msg);
      }
    }
    // pad so metrics sit on the last inner row
    while (rows.length < h - 2 - fixedTail) cell(L());
    if (!basic) {
      const sw = Math.max(8, Math.min(28, Math.floor(W * 0.3)));
      const spark = sparkline(a.spark || [], sw);
      const m = L().t('tok ', 'dim').t(kfmt(a.metrics?.tokens || 0), 'b').t('  tools ', 'dim').t(String(a.metrics?.toolCalls ?? 0), 'b').t('  upd ', 'dim').t(ago(now() - a.updatedAt), 'dim');
      cell(m.fill(W - sw).t(spark.padStart(sw, ' '), 'spark'));
    }

    // ── frame: top
    const frames = st.frames;
    const ico = reduced ? frames[0] : frames[Math.floor((t / 1000) * (st.fps || 1)) % frames.length];
    let label = st.label;
    if (this.scr) { const k = (t - this.scr.from) / 420; if (k >= 1 || reduced) this.scr = null; else label = scramble(st.label, k); }
    const idx = L().t('╭─┤', 'fr').t(` ${pad2(index + 1)} `, 'b').t('├', 'fr');
    const stat = L().t('┤', 'fr').t(` ${ico} `, 'pc').t(` ${label} `, a.status === 'paused' ? 'badge paused-blink' : 'badge').t(' ').t('├─╮', 'fr');
    this.block.set(0, idx.fill(w - stat.n, '─', 'fr').merge(stat).html(w));

    // ── body rows
    let logI = 0, seenSep = 0;
    for (let i = 0; i < h - 2; i++) {
      const r = rows[i] || L();
      if (r.sep) {
        seenSep++;
        const lab = L().t('├─', 'fr').t(` ${r.sep} `, 'dim').fill(w - 1, '─', 'fr').t('┤', 'fr');
        this.block.set(i + 1, lab.html(w), '');
        continue;
      }
      const isLog = logRows && seenSep === (stepRows ? 2 : 1) && i < h - 3;
      let key = '';
      if (isLog) {
        const k = logKeys[logI++];
        const newest = k && logKeys[logI] == null; // last filled log row
        if (newest && k && k !== this.lastLog) { key = this.lastLog === null ? 'old:' + k : 'new:' + k; this.lastLog = k; }
        else if (newest && k) key = (this.block.rows[i + 1].dataset.k || '');
      }
      this.block.set(i + 1, L().t('│', 'fr').sp(1).h(r.html(W), W).sp(1).t('│', 'fr').html(w), key);
    }

    // ── frame: bottom (read-only monitor: the orchestrator owns control; only a view toggle here)
    const bl = L().t('╰─', 'fr');
    if (basic) bl.t('┤', 'fr').t(' T+', 'dim').t(hms(tE), ACTIVE.has(a.status) ? 'b' : 'dim').t(' ', '').t('├', 'fr');
    const f = btn(app.focus === a.id ? ' « GRID ' : ' □ FOCUS ', app.focus === a.id ? 'unfocus' : 'focus', a.id);
    const br = L().t('┤', 'fr').h(f.html, f.n).t('├─╯', 'fr');
    this.block.set(h - 1, bl.fill(w - br.n, '─', 'fr').merge(br).html(w));
  }
  leave() {
    this.el.classList.add('leave');
    setTimeout(() => this.el.remove(), 220);
  }
}

/* ───────────────────────────── layout ───────────────────────────── */
const GX = 2, GY = 1, MX = 2;
let gridArea = { x: 0, y: 0, w: 0, h: 0 };
let empty = null;

function computeRects(n, area) {
  if (!n) return [];
  let best = null;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const pw = (area.w - (c - 1) * GX) / c, ph = (area.h - (r - 1) * GY) / r;
    if (pw < 34 && c > 1) continue;
    const aspect = pw / ph;
    const score = Math.abs(Math.log(aspect / 3.1)) + (c * r - n) * 0.18 + (ph < 14 ? 2 : 0);
    if (!best || score < best.score) best = { c, r, score };
  }
  const { r } = best;
  const per = [];
  for (let i = 0; i < r; i++) per.push(Math.floor(n / r) + (i < n % r ? 1 : 0));
  const rects = [];
  let y = area.y;
  for (let i = 0; i < r; i++) {
    const rh = Math.floor((area.h - (r - 1) * GY) / r) + (i < (area.h - (r - 1) * GY) % r ? 1 : 0);
    const cols = per[i];
    let x = area.x;
    const avail = area.w - (cols - 1) * GX;
    for (let j = 0; j < cols; j++) {
      const cw = Math.floor(avail / cols) + (j < avail % cols ? 1 : 0);
      rects.push({ x, y, w: cw, h: rh });
      x += cw + GX;
    }
    y += rh + GY;
  }
  return rects;
}

let firstPaint = true;
function layout() {
  measure();
  header.place(MX, 0, COLS - MX * 2, 4);
  footer.place(MX, ROWS - 1, COLS - MX * 2, 1);
  header.cache.fill(null); footer.cache.fill(null);
  const TH = teleRows() + 2; // telemetry strip rows (one per provider, min 2)
  app.teleN = teleRows();
  gridArea = { x: MX, y: 5, w: COLS - MX * 2, h: ROWS - 5 - 2 - TH - 1 };
  const ty = gridArea.y + gridArea.h + 1;
  const sysW = Math.max(56, Math.min(84, Math.floor(gridArea.w * 0.32)));
  sysBox.place(MX, ty, sysW, TH);
  provBox.place(MX + sysW + GX, ty, gridArea.w - sysW - GX, TH);
  sysBox.cache.fill(null); provBox.cache.fill(null);
  syncPanes(true);
}

function syncPanes(force = false) {
  const list = [...app.agents.values()].sort((a, b) => a.order - b.order);
  const ids = new Set(list.map((a) => a.id));
  let changed = force;
  for (const [id, p] of panes) if (!ids.has(id)) { p.leave(); panes.delete(id); changed = true; }
  list.forEach((a, i) => { if (!panes.has(a.id)) { panes.set(a.id, new Pane(a, i, firstPaint)); changed = true; } });
  if (list.length) firstPaint = false;
  if (!changed && syncPanes.focus === app.focus) return;
  syncPanes.focus = app.focus;

  if (app.focus) {
    for (const a of list) {
      const p = panes.get(a.id);
      const on = a.id === app.focus;
      p.el.classList.toggle('is-hidden', !on);
      p.place(on ? gridArea : computeRects(list.length, gridArea)[list.indexOf(a)]);
      p.block.cache.fill(null);
    }
  } else {
    const rects = computeRects(list.length, gridArea);
    list.forEach((a, i) => { const p = panes.get(a.id); p.el.classList.remove('is-hidden'); p.place(rects[i]); p.block.cache.fill(null); });
  }
  renderEmpty(list.length === 0);
}

function renderEmpty(show) {
  if (!show) { empty?.el.remove(); empty = null; return; }
  if (!empty) { empty = new Block('empty'); screen.append(empty.el); }
  const w = Math.min(64, gridArea.w), h = 9;
  empty.place(gridArea.x + Math.floor((gridArea.w - w) / 2), gridArea.y + Math.floor((gridArea.h - h) / 2), w, h);
}
function paintEmpty(t) {
  if (!empty) return;
  const w = empty.w, W = w - 4;
  const cur = Math.floor(t / 530) % 2 ? ' ' : '█';
  const lines = [
    L(), L().t('NO SUB-AGENTS RUNNING', 'b acc'), L(),
    L().t('waiting for ', 'dim').t('agent_register', 'b').t(' over MCP', 'dim').t(cur, 'cursor'),
    L().t(app.mode === 'hub' ? `hub ${app.hub} · connected` : app.mode, 'faint'),
  ];
  empty.set(0, L().t('╭', 'fr').fill(w - 2, '─', 'fr').t('─╮', 'fr').html(w));
  for (let i = 0; i < 7; i++) empty.set(i + 1, L().t('│', 'fr').sp(1).h((lines[i] || L()).html(W), W).sp(1).t('│', 'fr').html(w));
  empty.set(8, L().t('╰', 'fr').fill(w - 2, '─', 'fr').t('─╯', 'fr').html(w));
}


/* ───────────────────────────── telemetry: system + provider ───────────────────────────── */
const sysBox = new Block('tele sys');
const provBox = new Block('tele prov');
screen.append(sysBox.el, provBox.el);
const lvl = (p) => (p >= 90 ? 'lvl-crit' : p >= 75 ? 'lvl-warn' : 'lvl-ok');
const gb = (b) => (b / 2 ** 30).toFixed(1);
const mb = (b) => Math.round(b / 2 ** 20);
const dur = (ms) => {
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${pad2(m % 60)}m` : m ? `${m}m` : `${Math.ceil(ms / 1000)}s`;
};
const amount = (v, unit) => (unit === '$' ? '$' + v.toFixed(v >= 10 ? 0 : 2) : unit === 'req' ? String(Math.round(v)) : kfmt(v));
const frameRow = (W, inner, w) => L().t('│', 'fr').sp(1).h(inner.html(W), W).sp(1).t('│', 'fr').html(w);
let cpuShown = 0, memShown = 0;

let gpuShown = 0;
function renderSystem(t) {
  const b = sysBox, w = b.w, W = w - 4, basic = app.basic;
  if (!w) return;
  const s = app.sys;
  const right = L().t('┤', 'fr').t(s ? ` ${s.cores.length} cores · ${s.platform} ` : ' sampling… ', 'dim').t('├─╮', 'fr');
  b.set(0, L().t('╭─┤', 'fr').t(' SYSTEM ', 'b acc').t('├─', 'fr').t(s && !basic ? ` ${s.host} ` : '', 'dim').fill(w - (basic ? 2 : right.n), '─', 'fr').merge(basic ? L().t('─╮', 'fr') : right).html(w));
  const rows = [];
  if (!s) rows.push(L().t('waiting for hub sample…', 'dim'));
  else {
    const mp = (s.memUsed / s.memTotal) * 100;
    cpuShown += (s.cpu - cpuShown) * 0.15; memShown += (mp - memShown) * 0.15;
    if (s.gpu) gpuShown += (s.gpu.util - gpuShown) * 0.15;
    const sw = basic ? 0 : Math.max(6, Math.min(24, W - 52));
    const tailW = basic ? 0 : sw + 2 + 21;
    const mw = Math.max(8, W - 4 - 7 - 2 - tailW);
    const metric = (label, pct, hist, info) => {
      const m = meter(mw, pct, lvl(pct));
      const line = L().t(label, 'dim b').h(m.html, m.n).t(` ${pct.toFixed(1).padStart(5)}%`, `b ${lvl(pct)}`);
      if (!basic) line.sp(2).t(sparkline(hist, sw, 100).padStart(sw), `spark ${lvl(pct)}`).sp(2).t(info, 'b');
      return line;
    };
    rows.push(metric('CPU ', cpuShown, app.cpuHist, `load ${s.load.map((x) => x.toFixed(2)).join(' ')}`));
    if (!basic) rows.push(metric('RAM ', memShown, app.memHist, `${gb(s.memUsed)}/${gb(s.memTotal)} GB`));
    if (s.gpu) rows.push(metric('GPU ', gpuShown, app.gpuHist, s.gpu.memTotal ? `vram ${gb(s.gpu.memUsed)}/${gb(s.gpu.memTotal)} GB` : ''));
    else rows.push(L().t('GPU ', 'dim b').t('no GPU data (needs nvidia-smi)', 'faint'));
    if (!basic) rows.push(L().t('cpu ', 'dim').t(s.model, 'faint'), L().t('gpu ', 'dim').t(s.gpu?.name || '—', 'faint'));
  }
  for (let i = 1; i < b.h - 1; i++) b.set(i, frameRow(W, rows[i - 1] || L(), w));
  // per-core heat strip in the bottom border
  const bl = L().t('╰─', 'fr');
  if (s && !basic) {
    const k = Math.min(s.cores.length, Math.max(4, w - 30));
    const bars = s.cores.slice(0, k).map((v) => `<span class="${lvl(v)}">${SPARK[Math.min(7, Math.floor((v / 100) * 7.999))]}</span>`).join('');
    bl.t('┤', 'fr').t(' cores ', 'dim').h(`<span class="c spark" style="--n:${k}">${bars}</span>`, k).sp(1).t('├', 'fr');
  }
  const br = basic ? L().t('─╯', 'fr') : L().t('┤', 'fr').t(s ? ` hub ${mb(s.rss)} MB ` : ' — ', 'faint').t('├─╯', 'fr');
  b.set(b.h - 1, bl.fill(w - br.n, '─', 'fr').merge(br).html(w));
}

const limitPct = (l) => (l.unit === '%' ? l.used : l.limit ? (l.used / l.limit) * 100 : 0);
function limitCell(l, cw, t, labW = 15) {
  const pct = limitPct(l);
  const amt = l.unit === '%' ? '' : `${amount(l.used, l.unit)}/${amount(l.limit, l.unit)}`;
  const rs = l.resetsAt ? `rst ${dur(l.resetsAt - t)}` : '';
  let tail = `${amt ? ' ' + amt.padStart(11) : ''}${rs ? ' ' + rs.padStart(9) : ''}`;
  if (cw - labW - 8 - len(tail) < 8) tail = amt ? ' ' + amt : '';
  const lab = (l.label || l.id).slice(0, labW).padEnd(labW);
  const m = meter(Math.max(6, cw - labW - 1 - 7 - len(tail)), pct, lvl(pct));
  return L().t(lab, 'dim').sp(1).h(m.html, m.n).t(` ${Math.min(999, pct).toFixed(1).padStart(5)}%`, `b ${lvl(pct)}`).t(tail, 'dim');
}

function burnRate(t) {
  const total = [...app.agents.values()].reduce((a, x) => a + (x.metrics?.tokens || 0), 0);
  const h = app.tokHist;
  if (!app.agents.size) return 0; // no baseline until the first snapshot arrives
  if (!h.length || t - h[h.length - 1][0] >= 1000) { h.push([t, total]); while (h.length > 2 && t - h[0][0] > 60000) h.shift(); }
  if (h.length < 2) return 0;
  const [t0, v0] = h[0], [t1, v1] = h[h.length - 1];
  return t1 - t0 >= 5000 ? Math.max(0, ((v1 - v0) / (t1 - t0)) * 60000) : 0; // need ≥5 s of history
}

const providers = () => app.usage?.providers || [];
const teleRows = () => Math.max(app.basic ? 2 : 3, Math.min(5, providers().length));

function renderProvider(t) {
  const b = provBox, w = b.w, W = w - 4, rows = b.h - 2;
  if (!w) return;
  const list = providers();
  const burn = burnRate(t);
  const right = app.basic ? L().t('─╮', 'fr') : L().t('┤', 'fr').t(' burn ', 'dim').t(`${kfmt(burn)} tok/min`, 'b').t(' ').t('├─╮', 'fr');
  b.set(0, L().t('╭─┤', 'fr').t(' LIMITS ', 'b acc').t('├─', 'fr').t(` ${list.length} provider${list.length === 1 ? '' : 's'} `, 'dim').fill(w - right.n, '─', 'fr').merge(right).html(w));
  if (!list.length) {
    b.set(1, frameRow(W, L().t('no limits reported yet · each harness calls ', 'dim').t('provider_usage_set', 'b'), w));
    b.set(2, frameRow(W, L().t('Claude Code · Codex · OpenCode · Antigravity · any API — one row each', 'faint'), w));
    for (let i = 3; i <= rows; i++) b.set(i, frameRow(W, L(), w));
  } else {
    const nameW = Math.min(32, Math.max(...list.map((p) => len(p.provider) + (p.plan ? len(p.plan) + 1 : 0))) + 4);
    const maxN = Math.max(...list.map((p) => p.limits.length), 1);
    const per = Math.max(1, Math.min(maxN, Math.floor((W - nameW) / 40)));
    const cw = Math.floor((W - nameW - (per - 1) * 3) / per);
    for (let r = 0; r < rows; r++) {
      const pr = list[r];
      if (!pr) { b.set(1 + r, frameRow(W, L(), w)); continue; }
      const worst = Math.max(0, ...pr.limits.map(limitPct));
      const stale = t - pr.updatedAt > 15 * 60000;
      const name = L().t('● ', stale ? 'faint' : lvl(worst)).t(pr.provider, 'b').t(pr.plan && !app.basic ? ' ' + pr.plan : '', 'dim');
      const line = L().h(name.html(nameW), nameW);
      const shown = [...pr.limits].sort((x, y) => limitPct(y) - limitPct(x)).slice(0, per);
      shown.forEach((l, i) => { if (i) line.t(' │ ', 'faint'); line.h(limitCell(l, cw, t, 13).html(cw), cw); });
      if (pr.limits.length > per) line.t(` +${pr.limits.length - per}`, 'faint');
      b.set(1 + r, frameRow(W, line, w));
    }
  }
  // forecast: first auto-tracked token window at the current burn rate
  const bl = L().t('╰─', 'fr');
  const all = list.flatMap((p) => p.limits.map((l) => ({ ...l, who: p.provider })));
  const tokLimit = all.find((l) => l.unit === 'tok' && l.auto);
  if (tokLimit && burn > 0 && !app.basic) {
    const eta = (Math.max(0, tokLimit.limit - tokLimit.used) / burn) * 60000;
    const before = tokLimit.resetsAt && eta < tokLimit.resetsAt - t;
    bl.t('┤', 'fr').t(` ${tokLimit.label} full in `, 'dim').t(dur(eta), `b ${before ? 'lvl-warn' : 'lvl-ok'}`).t(' at this burn ', 'dim').t('├', 'fr');
  }
  const over = all.filter((l) => limitPct(l) >= 90);
  const br = L().t('┤', 'fr').t(over.length ? ` ✗ ${over.map((l) => l.who).filter((v, i, a) => a.indexOf(v) === i).join(', ')} ≥90% ` : ' ✓ all within limits ', over.length ? 'lvl-crit b' : 'faint').t('├─╯', 'fr');
  b.set(b.h - 1, bl.fill(w - br.n, '─', 'fr').merge(br).html(w));
}

/* ───────────────────────────── theme menu ───────────────────────────── */
function toggleMenu(force) {
  const open = force ?? !app.menu;
  if (!open) {
    if (app.menu) { const m = app.menu; m.el.classList.add('out'); setTimeout(() => m.el.remove(), 150); app.menu = null; }
    return;
  }
  if (app.menu) return;
  const w = 34, h = THEMES.length + 2;
  const m = new Block('menu');
  screen.append(m.el);
  m.place(header.x + header.w - w - 1, header.y + 4, w, h);
  app.menu = m;
  paintMenu();
}
function paintMenu() {
  const m = app.menu; if (!m) return;
  const w = m.w;
  m.set(0, L().t('╭─┤', 'fr').t(' THEME ', 'b acc').t('├', 'fr').fill(w - 2, '─', 'fr').t('─╮', 'fr').html(w));
  THEMES.forEach((th, i) => {
    const on = th.id === app.theme;
    const label = ` ${on ? '●' : '○'} ${th.name.padEnd(12)}`;
    const sw = `<span class="sw" style="color:${swatch(th.id, 0)}">██</span><span class="sw" style="color:${swatch(th.id, 1)}">██</span><span class="sw" style="color:${swatch(th.id, 2)}">██</span><span class="sw" style="color:${swatch(th.id, 3)}">██</span> `;
    const inner = `${iconize(label)}${' '.repeat(w - 2 - len(label) - 9)}${sw}`;
    const b = `<button class="btn${on ? ' on' : ''}" data-act="theme" data-id="${th.id}">${inner}</button>`;
    m.set(i + 1, L().t('│', 'fr').h(b, w - 2).t('│', 'fr').html(w));
    m.rows[i + 1].style.setProperty('--i', i);
  });
  m.set(h0(m), L().t('╰', 'fr').fill(w - 2, '─', 'fr').t('─╯', 'fr').html(w));
}
const h0 = (m) => m.h - 1;
const SW = {
  phosphor: ['#3dff8f', '#00b862', '#7cf3ff', '#ffd166'],
  amber: ['#ffb000', '#ff7a00', '#ffe2a6', '#a47933'],
  glacier: ['#88c0d0', '#a3be8c', '#b48ead', '#ebcb8b'],
  dusk: ['#ff4fd8', '#7a5cff', '#3cf2ff', '#ffb86b'],
  graphite: ['#ff6a00', '#ededed', '#c9a7ff', '#56d27c'],
  paper: ['#f3efe6', '#1d1c1a', '#c8341b', '#1f4fd1'],
};
const swatch = (id, i) => SW[id][i];

function setBasic(on) {
  const apply = () => {
    app.basic = on;
    safeSet('am.mode', on ? 'basic' : 'full');
    document.documentElement.dataset.mode = on ? 'basic' : 'full';
    layout();
  };
  if (document.startViewTransition && !reduced) document.startViewTransition(apply); else apply();
}

function setTheme(id) {
  if (id === app.theme) return;
  const apply = () => { app.theme = id; document.documentElement.dataset.theme = id; safeSet('am.theme', id); app.dirty = true; header.cache.fill(null); paintMenu(); };
  if (document.startViewTransition && !reduced) document.startViewTransition(apply); else apply();
}

/* ───────────────────────────── interaction ───────────────────────────── */
screen.addEventListener('click', async (e) => {
  const b = e.target.closest('.btn');
  if (!b) { if (app.menu && !e.target.closest('.menu')) toggleMenu(false); return; }
  b.classList.remove('ack'); void b.offsetWidth; b.classList.add('ack');
  if (!b.dataset.act) return; // plain links (credit) just navigate
  const { act, id } = b.dataset;
  if (act === 'focus') { app.focus = id; syncPanes(); }
  else if (act === 'unfocus') { app.focus = null; syncPanes(); }
  else if (act === 'theme-menu') toggleMenu();
  else if (act === 'basic') setBasic(!app.basic);
  else if (act === 'theme') { setTheme(id); setTimeout(() => toggleMenu(false), 160); }
});

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const list = [...app.agents.values()].sort((a, b) => a.order - b.order);
  if (e.key === 'Escape') { if (app.menu) toggleMenu(false); else { app.focus = null; syncPanes(); } }
  else if (e.key === 'b' || e.key === 'B') setBasic(!app.basic);
  else if (e.key === 't' || e.key === 'T') { const i = THEMES.findIndex((x) => x.id === app.theme); setTheme(THEMES[(i + 1) % THEMES.length].id); }
  else if (/^[1-9]$/.test(e.key) && list[+e.key - 1]) { const id = list[+e.key - 1].id; app.focus = app.focus === id ? null : id; syncPanes(); }
});

let rz;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { layout(); if (app.menu) { toggleMenu(false); } }, 60); });

/* ───────────────────────────── loop ───────────────────────────── */
function frame() {
  const t = now();
  if (app.dirty) { syncPanes(); app.dirty = false; }
  renderHeader(t);
  renderFooter();
  const list = [...app.agents.values()].sort((a, b) => a.order - b.order);
  list.forEach((a, i) => { const p = panes.get(a.id); if (p && !p.el.classList.contains('is-hidden')) p.render(a, t, i); });
  paintEmpty(t);
  renderSystem(t);
  renderProvider(t);
  requestAnimationFrame(frame);
}

await document.fonts.ready.catch(() => {});
await Promise.all(['400', '700', '800'].map((w) => document.fonts.load(`${w} 13px "AM Mono"`, '─│█').catch(() => {})));
layout();
await connect();
requestAnimationFrame(frame);
window.__app = app;
