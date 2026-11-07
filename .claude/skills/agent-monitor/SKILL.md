---
name: agent-monitor
description: Live ASCII dashboard for sub-agents over MCP. Sub-agents report THEMSELVES (register, status, task list, progress %, limits, logs, done/failed); the orchestrator only hands each sub-agent an id plus the self-report instructions. The dashboard is read-only. Use whenever you orchestrate, spawn, delegate to or fan out sub-agents / parallel workers, when you ARE a sub-agent that was given an agent-monitor id, or when the user asks to watch agents on a screen.
---

# Agent Monitor

A live, split-screen ASCII dashboard shows one rounded pane per **sub-agent**.
It is **read-only**: nobody controls agents from it. Each **sub-agent keeps
its own pane up to date** through the `agent-monitor` MCP server. The
orchestrator does not report on the sub-agents' behalf.

Dashboard: `http://127.0.0.1:7420` (`monitor_open` returns the exact URL).

Which part applies to you:
- You spawn other agents → **Orchestrator** section.
- Your prompt contains an `agent-monitor id` → **Sub-agent** section.

---

## Orchestrator

Your job is small; the sub-agents do the reporting.

1. Once per job: `monitor_set_session {title}` and `monitor_open`; tell the
   user the URL. Optionally `provider_usage_set` for the harness *you* run in
   (see Limits).
2. For every sub-agent you launch:
   - pick a short unique id (`coder-api`, `tester-2`);
   - append the **self-report block** below to its prompt, filled in with
     that id, its role, model and a one-line task. Nothing else.
3. Do **not** call `agent_register` / `agent_update` / `agent_complete` for
   sub-agents yourself. Exception: if a sub-agent crashes or is killed before
   it could report, close its pane once with
   `agent_complete {id, success: false, message: "<why>"}`.
4. Before spawning more agents you may read `agent_list`,
   `provider_usage_get` and `system_stats`; if a limit or CPU/RAM/GPU is
   ≥ 90 %, hold off.

### Self-report block (paste into each sub-agent prompt)

```text
## Live status (agent-monitor)
You are sub-agent "<ID>". Report your own progress to the agent-monitor MCP
server; the user is watching it live. Do this yourself; nobody else will.
1. First action: agent_register {id:"<ID>", name:"<ID>", role:"<ROLE>",
   model:"<MODEL>", task:"<ONE-LINE TASK>", steps:[your 3-7 planned steps],
   tokenBudget:<N if you have one>}.
2. On every step change: agent_update {id:"<ID>", step:<index or title>,
   message:"<short line>"}. Use stepLabel for detail ("file 3/12"),
   status:"waiting" when blocked, status:"thinking" for long reasoning,
   tokensDelta when you know tokens used since the last update.
   During a long step, send a short update at least every 2 minutes.
3. If you know your own limits (model cap, rate limit), send them as
   limits:[{id,label,used,limit,unit,resetsAt}] in agent_update.
4. Last action: agent_complete {id:"<ID>", success:true|false, message:"<result>"}.
Keep updates short and honest. If agent-monitor is unavailable, just do the task.
```

---

## Sub-agent

If your prompt gives you an agent-monitor id, you own that pane.

1. **Register first.** Call `agent_register` with your id, a one-line task
   and 3–7 short step titles (≤ 32 chars). Re-registering the same id only
   updates it.
2. **Report as you go** with `agent_update {id, ...}`:
   - next step → `step: <0-based index or title>` (progress % is derived;
     pass `progress` 0–100 to override);
   - detail inside a step → `stepLabel`;
   - blocked → `status: "waiting"` + `stepLabel: "blocked on …"`;
   - long reasoning → `status: "thinking"`; back to work → `"running"`;
   - a notable event → `message` + `level` (`tool` · `info` · `success` ·
     `warn` · `error`), one line ≤ 120 chars, no secrets;
   - `tokensDelta` when you know it (fills your token budget meter).
   One update per step change or notable event.
3. **Your limits.** Send `limits: [{id, label, used, limit, unit, resetsAt}]`
   in `agent_update` for caps that apply to you, and `tokenBudget` for your
   budget.
4. **Finish** with `agent_complete {id, success, message}`. Never leave your
   pane in `running`.
5. A pane that stays `running` / `thinking` / `waiting` with no update for
   3 minutes is flagged **SILENT** on the dashboard. During long steps send
   a short update (a new `stepLabel` is enough) at least every 2 minutes.

---

## Limits (any role)

`provider_usage_set {provider, plan?, limits[], source?}` fills one row per
harness in the LIMITS box. Use the product name as `provider` ("Claude Code",
"Codex", "OpenCode", "Antigravity", or the API name) and say where the numbers
came from in `source` (`/usage`, `/status`, `*-ratelimit-*` headers). Codex
rows are also read automatically from `~/.codex/sessions`.

A **limit** is `{id, label, used, limit, unit: "%"|"tok"|"req"|"$",
resetsAt|resetsInMs, auto}`; limits merge by `id`.

## Reference

| tool | who calls it |
| --- | --- |
| `monitor_open`, `monitor_set_session {title}` | orchestrator |
| `agent_register {id, name, role, model, task, steps[], tokenBudget?, limits?}` | sub-agent, about itself |
| `agent_update {id, status?, step?, progress?, stepLabel?, message?, level?, tokensDelta?, limits?, metrics?}` | sub-agent, about itself |
| `agent_log {id, message, level?}` | sub-agent, about itself |
| `agent_complete {id, success, message?}` | sub-agent, about itself |
| `provider_usage_set`, `provider_usage_get`, `system_stats`, `agent_list` | anyone |
| `agent_remove {id}`, `monitor_reset` | orchestrator housekeeping |

Statuses: `queued` · `running` · `thinking` · `waiting` · `paused` · `error` ·
`done` · `stopped`. `T+hh:mm:ss` ticks only while running / thinking / waiting.

## Example (sub-agent "tester")

```text
agent_register  {"id":"tester","name":"tester","role":"qa","model":"sonnet",
                 "task":"Integration tests for /v2/auth","tokenBudget":120000,
                 "steps":["Read endpoints","Fixtures","Happy path","Replay","Report"]}
agent_update    {"id":"tester","step":1,"message":"fixtures: 6 users, frozen clock"}
agent_update    {"id":"tester","status":"waiting","stepLabel":"blocked on coder-api"}
agent_update    {"id":"tester","status":"running","step":"Happy path","stepLabel":"case 3/14",
                 "tokensDelta":1800,"message":"npm test -- auth → 12 passed","level":"success"}
agent_complete  {"id":"tester","success":true,"message":"31 tests, all green"}
```

If the MCP server is unavailable, carry on with the task; monitoring must
never block real work.
