---
name: start
description: Sambungkan sesi ini ke BWA. Tanpa argumen = jadi otak AI BWA sampai serah-terima; "task [project_id]" = lanjut mengerjakan task proyek yang sudah ada.
disable-model-invocation: true
argument-hint: "[task [project_id]]"
allowed-tools: mcp__bwa__wait_for_brain_job, mcp__bwa__submit_brain_result, mcp__bwa__fail_brain_job, mcp__bwa__list_projects, mcp__bwa__get_project_context, mcp__bwa__get_prd, mcp__bwa__list_tasks, mcp__bwa__get_next_task, mcp__bwa__get_task, mcp__bwa__claim_task, mcp__bwa__add_task_note, mcp__bwa__complete_task, mcp__bwa__block_task, mcp__bwa__release_task, mcp__bwa__create_task
---

# BWA: connect this session

Connects this session to BWA (Build With Agent) through the `bwa` MCP server. Arguments: `$ARGUMENTS`.
Talk to the user in their language.

## 1. Check the connection

Done when the `mcp__bwa__*` tools answer and BWA is reachable.

1. Load the `mcp__bwa__*` tools (through ToolSearch if they are deferred) and call `list_projects`.
2. Tools missing: the server is unregistered, or registered after this session started.
   - Run `claude mcp get bwa`. When `claude` is not on PATH (Claude Code installed with the Claude desktop app), use the newest `claude` binary under the desktop app's data folder: `%APPDATA%\Claude\claude-code\` on Windows, `~/Library/Application Support/Claude/claude-code/` on macOS.
   - Registered: tell the user to open a new session and run this command again (`/bwa`, or `/bwa:start` from the plugin), then stop.
   - Not registered: read the live paths from the running BWA with `GET http://127.0.0.1:3900/api/bridge` (BWA's default port; `command`, `mcpServerPath`, `commandEnv`, `apiUrl`), then register for every folder. The name goes **before** `--env`, because `--env` takes several values and swallows whatever follows it:
     `claude mcp add bwa --scope user --transport stdio --env <each commandEnv KEY=VALUE> --env BWA_URL=<apiUrl> -- "<command>" "<mcpServerPath>"`
     Confirm with `claude mcp get bwa` (status Connected), then tell the user to open a new session and run this command again (`/bwa`, or `/bwa:start` from the plugin), and stop.
3. `list_projects` says BWA cannot be reached: ask the user to open the BWA app (or run `npm run dev` for the web version), then stop.

## 2a. No argument: brain mode

1. Tell the user in one line that this session is now standby as BWA's brain and they can continue in the BWA app.
2. Run the brain loop from the bwa server instructions: `wait_for_brain_job`, answer each job exactly as its SYSTEM section asks, `submit_brain_result`, and poll again with no chat between calls.
   - A reply noting that BWA uses 9router: tell the user once to switch to the MCP brain in BWA's settings, then keep polling.

Done when a **BWA handover** arrives (follow it: it makes you this project's coding agent) or the user stops you.

## 2b. `task [project_id]`: continue a project's tasks

1. Pick the project: the given id; otherwise the only project from `list_projects` with unfinished tasks; otherwise show that list and ask which one.
2. Call `get_project_context` once. If the working directory clearly belongs to a different project, ask which folder to use before writing code.
3. Summarise for the user: progress, any task still in progress under your name (`get_next_task` resumes it first), and the next ready task. Ask whether to start.
4. Once they agree, follow the context's working agreement with that `project_id` and keep going until no task is left or the user steers you elsewhere.
