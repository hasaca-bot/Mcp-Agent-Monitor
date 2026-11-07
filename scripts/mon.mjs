#!/usr/bin/env node
// Tiny REST client for the Agent Monitor hub, usable by the orchestrator AND by sub-agents
// (agy / Codex / DeepSeek) that have shell access but no MCP connection.
//
//   node mon.mjs session "<title>"
//   node mon.mjs usage '<json {provider:"Claude Code"|"Codex"|"OpenCode"|"Antigravity", plan, source, limits:[{id,label,used,limit,unit,resetsAt}]}>'
//   node mon.mjs register '<json {id,name,role,model,task,steps[],tokenBudget,limits[],status}>'
//   node mon.mjs update <id> '<json {status,step,stepLabel,progress,message,level,tokensDelta,limits}>'
//   node mon.mjs log <id> "<message>" [level]
//   (dashboard is read-only: no control commands; report your own pause/stop/restart via update)
//   node mon.mjs complete <id> true|false "<message>"
//   node mon.mjs system | state
//
// Prints the hub's JSON response. Exits 0 even if the hub is down (monitoring must never block work).
const BASE = (process.env.AGENT_MONITOR_URL || `http://127.0.0.1:${process.env.AGENT_MONITOR_PORT || 7420}`).replace(/\/+$/, "");
const [cmd, a, b, c] = process.argv.slice(2);
const req = async (method, path, body) => {
  try {
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    const t = await r.text();
    console.log(t);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, monitor: "unreachable", error: e.message }));
  }
};
const json = (s) => { try { return JSON.parse(s); } catch { console.error("bad json: " + s); process.exit(0); } };
switch (cmd) {
  case "session": await req("POST", "/api/session", { title: a }); break;
  case "usage": await req("POST", "/api/usage", json(a)); break;
  case "register": await req("POST", "/api/agents", json(a)); break;
  case "update": await req("PATCH", `/api/agents/${encodeURIComponent(a)}`, json(b)); break;
  case "log": await req("POST", `/api/agents/${encodeURIComponent(a)}/log`, { message: b, level: c || "info" }); break;
  case "complete": await req("PATCH", `/api/agents/${encodeURIComponent(a)}`, { status: b === "true" ? "done" : "error", progress: b === "true" ? 100 : undefined, message: c || (b === "true" ? "done" : "failed"), level: b === "true" ? "success" : "error" }); break;
  case "system": await req("GET", "/api/system"); break;
  case "state": await req("GET", "/api/state"); break;
  default: console.log("usage: node mon.mjs session|usage|register|update|log|complete|system|state ...");
}
