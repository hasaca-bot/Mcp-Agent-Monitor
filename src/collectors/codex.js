// Best-effort: read Codex CLI rate-limit snapshots from its local session logs
// (~/.codex/sessions/**/rollout-*.jsonl, or $CODEX_HOME/sessions). Codex writes
// token_count events that carry `rate_limits.primary/secondary` with
// used_percent, window_minutes and a reset time. If the files or the fields
// are missing, this collector does nothing.
import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

const root = () => join(process.env.CODEX_HOME || join(os.homedir(), '.codex'), 'sessions');

async function newestRollout(dir, depth = 0) {
  let best = null;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return null; }
  // session dirs are YYYY/MM/DD — walk newest-first, stop at the first hit
  entries.sort((a, b) => b.name.localeCompare(a.name));
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && depth < 4) { const f = await newestRollout(p, depth + 1); if (f && (!best || f.mtime > best.mtime)) best = f; if (best) break; }
    else if (e.isFile() && e.name.endsWith('.jsonl')) { const st = await stat(p); if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs }; }
  }
  return best;
}

async function tail(path, bytes = 256 * 1024) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally { await fh.close(); }
}

const windowLabel = (min) => (!min ? null : min % 10080 === 0 ? 'weekly' : min % 1440 === 0 ? `${min / 1440}d window` : min % 60 === 0 ? `${min / 60}h window` : `${min}m window`);

export function parseRateLimits(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('rate_limits')) continue;
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    const rl = obj?.payload?.rate_limits ?? obj?.rate_limits ?? obj?.msg?.rate_limits;
    if (!rl) continue;
    const at = Date.parse(obj.timestamp) || Date.now();
    const limits = [];
    for (const key of ['primary', 'secondary']) {
      const w = rl[key];
      if (!w || typeof w.used_percent !== 'number') continue;
      let resetsAt = null;
      if (typeof w.resets_at === 'number') resetsAt = w.resets_at < 1e12 ? w.resets_at * 1000 : w.resets_at;
      else if (typeof w.resets_in_seconds === 'number') resetsAt = at + w.resets_in_seconds * 1000;
      limits.push({ id: key, label: windowLabel(w.window_minutes) || key, unit: '%', used: w.used_percent, resetsAt });
    }
    if (limits.length) return { limits, at };
  }
  return null;
}

export function startCodexCollector(store, { interval = 30_000, log = () => {} } = {}) {
  let last = 0;
  const run = async () => {
    try {
      const f = await newestRollout(root());
      if (!f || f.mtime === last) return;
      last = f.mtime;
      const r = parseRateLimits(await tail(f.path));
      if (r) store.setUsage({ provider: 'Codex', source: '~/.codex sessions (auto)', limits: r.limits });
    } catch (e) { log(`codex collector: ${e.message}`); }
  };
  run();
  const t = setInterval(run, interval);
  t.unref?.();
  return () => clearInterval(t);
}
