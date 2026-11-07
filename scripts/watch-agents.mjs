#!/usr/bin/env node
// Orchestrator-side relay: for sub-agents that run as one-shot CLIs (agy -p, opencode run, codex exec)
// and go quiet, tail their log files + watch the files they touch, and push live activity to their panes.
//   node watch-agents.mjs <paneId>=<logFile>[@<repoDir>] ...
// Stops a pane's relay when its log shows the process finished or the pane is done/error.
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
const BASE = (process.env.AGENT_MONITOR_URL || `http://127.0.0.1:${process.env.AGENT_MONITOR_PORT || 7420}`).replace(/\/+$/, "");
const specs = process.argv.slice(2).map((s) => { const [id, rest] = s.split("="); const [log, repo, paths] = rest.split("@"); return { id, log, repo, paths: (paths || "src,scripts").split(","), base: null, lastSize: 0, lastLine: "", lastDiff: "", done: false }; });
const api = async (method, path, body) => { try { const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000) }); return await r.json(); } catch { return null; } };
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
const tick = async () => {
  for (const a of specs) {
    if (a.done) continue;
    const pane = await api("GET", `/api/agents/${encodeURIComponent(a.id)}`);
    if (pane && ["done", "error", "stopped"].includes(pane.status)) { a.done = true; continue; }
    // 1) newest meaningful log line
    if (existsSync(a.log)) {
      const size = statSync(a.log).size;
      if (size !== a.lastSize) {
        a.lastSize = size;
        const lines = readFileSync(a.log, "utf8").split(/\r?\n/).map(clean).filter((l) => l && !/^\{|^\}|^"/.test(l));
        const interesting = lines.filter((l) => /⚙|execute|read|edit|write|bash|grep|glob|apply|npx|npm|node |tsc|build|test|PASS|FAIL|error|warn|done|fixed|step/i.test(l));
        const line = (interesting.at(-1) || lines.at(-1) || "").slice(0, 118);
        if (line && line !== a.lastLine) { a.lastLine = line; await api("POST", `/api/agents/${encodeURIComponent(a.id)}/log`, { message: "relay: " + line, level: /error|fail/i.test(line) ? "warn" : "tool" }); }
      }
      const txt = readFileSync(a.log, "utf8");
      if (/^exit=\d+/m.test(txt)) { /* process finished; leave completion to the orchestrator */ }
    }
    // 2) files changed since this relay started (per agent's own paths)
    if (a.repo) {
      try {
        const num = execFileSync("git", ["-C", a.repo, "diff", "--numstat", "--", ...a.paths], { encoding: "utf8" }).trim();
        const map = Object.fromEntries(num.split(/\r?\n/).filter(Boolean).map((l) => { const [ad, de, f] = l.split(/\t/); return [f, ad + "/" + de]; }));
        if (!a.base) a.base = map;
        const changed = Object.keys(map).filter((f) => a.base[f] !== map[f]).map((f) => f.split("/").pop());
        const label = changed.length ? `${changed.length} file(s): ${changed.slice(-3).join(", ")}` : "";
        if (label && label !== a.lastDiff) { a.lastDiff = label; await api("PATCH", `/api/agents/${encodeURIComponent(a.id)}`, { stepLabel: label.slice(0, 60), message: "relay: editing " + changed.slice(-4).join(", "), level: "tool" }); }
        else await api("PATCH", `/api/agents/${encodeURIComponent(a.id)}`, { status: "running" });
      } catch {}
    }
  }
  if (specs.every((a) => a.done)) process.exit(0);
};
await tick(); setInterval(tick, 20000);
