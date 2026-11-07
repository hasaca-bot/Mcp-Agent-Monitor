---
name: agent-monitor
description: Report every sub-agent you launch to the ASCII Agent Monitor dashboard over MCP — register it, stream its status, progress %, current step, logs and token use, honour pause/stop/retry commands the operator clicks, and mark it done or failed. Use whenever you orchestrate, spawn, delegate to or fan out sub-agents / parallel workers / background tasks, or when the user asks to watch, monitor or see agents on a screen.
---

# Agent Monitor

A live, split-screen ASCII dashboard shows one rounded pane per **sub-agent**
(never the orchestrator itself). You keep it truthful through the
`agent-monitor` MCP server. The operator can press **PAUSE / STOP / RESUME /
RETRY** on a pane; those commands come back to you on your next call and you
must obey them.

Dashboard: `http://127.0.0.1:7420` (call `monitor_open` to get the exact URL
and give it to the user the first time).

## Tools

| tool | when |
| --- | --- |
| `monitor_open` | once, to get the URL for the user |
| `monitor_set_session {title}` | once, the overall goal ("ship auth v2") |
| `agent_register {id, name, role, task, steps[], model?}` | right **before** launching each sub-agent |
| `agent_update {id, status?, progress?, step?, stepLabel?, message?, level?, tokensDelta?, metrics?}` | every meaningful change |
| `agent_log {id, message, level?}` | a single notable line (tool call, result, warning) |
| `agent_complete {id, success, message?}` | when the sub-agent returns |
| `agent_check_control {id}` | poll for operator commands while waiting on a long sub-agent |
| `provider_usage_set {provider, plan, limits[]}` | at start and whenever you learn new limit numbers (bottom PROVIDER box) |
| `provider_usage_get`, `system_stats` | check headroom / host CPU+RAM before spawning more agents |
| `agent_list`, `agent_remove {id}`, `monitor_reset` | housekeeping |

A **limit** is `{id, label, used, limit, unit: "%"|"tok"|"req"|"$", resetsAt|resetsInMs, auto}`.
Limits merge by `id`; `unit:"tok"` + `auto:true` is advanced automatically by
every `tokensDelta`.

Statuses: `queued` · `running` · `thinking` · `waiting` · `paused` · `error` ·
`done` · `stopped`. The elapsed clock (`T+hh:mm:ss`) only ticks while the
agent is `running`, `thinking` or `waiting`.

Log levels: `tool` (a tool call), `info`, `success`, `warn`, `error`.

## Protocol

1. **Session.** At the start of a multi-agent job call `monitor_set_session`
   with a short title and `monitor_open`; tell the user the URL.
2. **Register before you spawn.** For each sub-agent:
   - `id`: short stable slug, unique in this session (`coder-api`, `tester-2`).
   - `name`: same as id or a friendlier label; `role`: researcher / planner /
     coder / qa / reviewer / writer …; `model` if known.
   - `task`: one line — what you asked it to do.
   - `steps`: 3–7 planned steps in order. Keep titles short (≤ 32 chars).
   - `tokenBudget`: the token budget you give this sub-agent — shown as its
     own meter in the pane and filled automatically from `tokensDelta`.
   - `limits`: caps that apply to *this* agent (e.g. the weekly cap of the
     model it runs on, its own rate limit). Each agent's pane shows its own
     limits; update them later with `agent_update {id, limits:[…]}`.
   - Use `status: "queued"` if it will start later (dependencies), otherwise
     the default `running`.
3. **Stream progress.** Whenever the sub-agent's state changes, call
   `agent_update`:
   - Moving to the next step → `step: <0-based index or title>`; progress is
     derived automatically unless you pass `progress` (0–100) explicitly.
   - Fine-grained detail inside a step → `stepLabel: "file 3/12"`.
   - Waiting on another agent, the user or an external system →
     `status: "waiting"`, `stepLabel: "blocked on coder-api"`.
   - Long reasoning without tool calls → `status: "thinking"`.
   - Add `message` + `level` for anything a human would want in the log tail
     (tool calls, test results, warnings). One line, ≤ 120 chars, no secrets.
   - Pass `tokensDelta` (tokens since the last update) when you know it — it
     drives the activity sparkline.
   Don't spam: one update per step change or notable event, roughly every
   few seconds at most per agent.
4. **Limits.** Report plan / rate limits you know about with
   `provider_usage_set` (e.g. from `anthropic-ratelimit-*` response headers,
   `/usage`, or the plan the user told you). If a limit shown on any pane or
   in the PROVIDER box is ≥ 90 %, or `system_stats` shows CPU/RAM ≥ 90 %,
   do not spawn new sub-agents; queue them (`status: "queued"`) instead.
5. **Obey the operator.** Every `agent_update` / `agent_log` response contains
   `control`. If it is not `null`:
   - `pause` → stop dispatching work to that sub-agent, keep its state, call
     `agent_check_control` periodically until you get `resume` or `stop`.
   - `stop` → cancel the sub-agent (stop its task), do not restart it.
   - `resume` → continue where it left off; send `status: "running"`.
   - `retry` → start that sub-agent's task again from step 0.
   When you are blocked waiting on a long-running sub-agent, poll
   `agent_check_control` between checks so the buttons stay responsive.
6. **Finish.** When a sub-agent returns, call
   `agent_complete {id, success: true}` (or `success: false` with a one-line
   reason). Never leave panes in `running` after the work ended.
7. **Parallel fan-out.** Register all parallel sub-agents first (so the grid
   appears at once), then launch them. Use `queued` for those waiting on
   dependencies and flip them to `running` when they start.

## Example

```text
monitor_set_session  { "title": "ship auth v2" }
agent_register       { "id": "tester", "name": "tester", "role": "qa", "model": "sonnet",
                       "task": "Integration tests for /v2/auth",
                       "steps": ["Read endpoints", "Fixtures", "Happy path", "Replay", "Report"] }
agent_update         { "id": "tester", "step": 1, "message": "fixtures: 6 users, frozen clock", "level": "info" }
agent_update         { "id": "tester", "status": "waiting", "stepLabel": "blocked on coder-api" }
agent_update         { "id": "tester", "status": "running", "step": "Happy path", "stepLabel": "case 3/14",
                       "tokensDelta": 1800, "message": "bash: npm test -- auth → 12 passed", "level": "success" }
   ← { ..., "control": "pause", "note": "Operator requested \"pause\". Honor it before continuing." }
agent_check_control  { "id": "tester" }   ← { "control": "resume" }
agent_complete       { "id": "tester", "success": true, "message": "31 tests, all green" }
```

## Rules

- Only sub-agents get panes. Do not register yourself (the orchestrator).
- Keep it honest: progress must reflect real work, not time passed.
- If the MCP server is unavailable, continue the task normally — monitoring
  must never block the actual work.
