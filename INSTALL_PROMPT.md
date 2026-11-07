# Install prompt

Paste everything in the block below into your coding agent (Claude Code, Codex,
OpenCode, Antigravity, or any agent that can run shell commands and has MCP
support). It installs Agent Monitor, connects it over MCP, sets up the skill
and checks that it works.

```text
Set up "Agent Monitor" for me: a live, read-only ASCII dashboard where each of my
sub-agents reports its own status, task list, progress % and limits over MCP.
Repo: https://github.com/hasaca-bot/Mcp-Agent-Monitor

Do the following, show me each config change before you make it, and never
overwrite existing config: merge into it.

1. Requirements: check that Node.js 18+ and git are installed. If not, tell me how
   to install them and stop.

2. Install: clone the repo into a stable folder (e.g. ~/tools/Mcp-Agent-Monitor; on
   Windows %USERPROFILE%\tools\Mcp-Agent-Monitor), then run `npm install` inside it.
   Let ABS be the absolute path of src/mcp.js in that folder (use forward slashes or
   escaped backslashes on Windows).

3. Connect the MCP server "agent-monitor" (command: node, args: [ABS]) to every agent
   tool I use on this machine. Check which of these exist and configure each one:
   - Claude Code: `claude mcp add agent-monitor -s user -- node ABS`
   - Codex CLI: add to ~/.codex/config.toml
       [mcp_servers.agent-monitor]
       command = "node"
       args = ["ABS"]
   - OpenCode: add to ~/.config/opencode/opencode.json under "mcp":
       "agent-monitor": { "type": "local", "command": ["node", "ABS"], "enabled": true }
   - Antigravity, Cursor, or any other MCP client: add to its MCP settings file
     (mcpServers format):
       "agent-monitor": { "command": "node", "args": ["ABS"] }
   If you are unsure where a tool keeps its MCP config, ask me instead of guessing.

4. Install the skill (the rules agents follow):
   - Claude Code: copy the folder .claude/skills/agent-monitor from the repo to
     ~/.claude/skills/agent-monitor.
   - Other tools: add the contents of .claude/skills/agent-monitor/SKILL.md to that
     tool's global instructions (e.g. ~/.codex/AGENTS.md, OpenCode's AGENTS.md, or
     the tool's rules file).
   The short version of the rules: the orchestrator gives each sub-agent an id and
   pastes the "Self-report block" from SKILL.md into its prompt; each sub-agent
   registers, updates and completes its own pane, sends a heartbeat update at
   least every 60 seconds, and ALWAYS calls agent_complete before it stops
   (also on failure or an early exit). For one-shot CLI agents that go quiet the
   orchestrator can run `node scripts/watch-agents.mjs` to relay their log.

5. Verify:
   - In the repo folder run `node scripts/smoke.mjs`; it must list the tools and
     finish without errors.
   - Start the dashboard with `npm start` (keep it running in its own terminal), and
     open http://127.0.0.1:7420. For a quick look with fake data, run `npm run demo`
     instead.
   - Tell me if port 7420 was busy; then set AGENT_MONITOR_PORT to another port for
     both the dashboard and the MCP server.

6. Finish by telling me:
   - which tools you connected, and which you skipped and why;
   - the dashboard URL;
   - that I need to restart those tools so they load the new MCP server and skill;
   - the one sentence I should tell my orchestrator from now on:
     "Use the agent-monitor skill: give every sub-agent an id and paste the
      self-report block into its prompt; sub-agents report their own status."
```

Notes

- The dashboard only shows what agents report. It cannot start, stop or control them.
- GPU usage is read with `nvidia-smi` (NVIDIA cards). Codex limits are read
  automatically from `~/.codex/sessions`; other tools report their own limits.
- Everything runs locally on `127.0.0.1`; nothing is sent anywhere else.
