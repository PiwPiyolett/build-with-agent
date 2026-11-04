---
name: bwa
description: Connects this conversation to the BWA (Build With Agent) app on this computer. Use when the user types $bwa or asks to connect to BWA ("hubungkan ke BWA", "jadi otak BWA"), or asks to continue the tasks of a BWA project ("$bwa task").
---

# BWA: connect this conversation

BWA is a planning app running on this computer. It reaches you through the `bwa` MCP server.

Talk to the user in their language and in plain words. They may be a teacher who has never used a terminal, so say "BWA", "percakapan ini" and "folder ini", and avoid words like MCP, server, session, repository and job.

## 1. Check the connection

Done when the `bwa` tools answer and BWA is reachable. Call the `list_projects` tool.

- The tool is not available: ask the user to open BWA, click "Hubungkan asisten AI", press "Hubungkan" for Codex, then start a new conversation and type $bwa again. Then stop.
- It says BWA cannot be reached: ask the user to open the BWA app, then stop.

## 2a. No request about tasks: brain mode

1. Tell the user in one line that you are ready and they can continue in the BWA app. Remind them to keep this conversation open while they work, and to close it when they finish so their plan's usage is not spent on waiting.
2. Run the loop from the bwa server instructions: call `wait_for_brain_job`, answer each job exactly as its SYSTEM section asks, send it with `submit_brain_result`, and call `wait_for_brain_job` again with no chat between calls.

Done when a **BWA handover** arrives (follow it: it makes you this project's coding agent) or the user stops you.

## 2b. The user asked to continue tasks ("task", optionally with a project id)

1. Pick the project: the given id; otherwise the only project from `list_projects` with unfinished tasks; otherwise show that list and ask which one.
2. Call `get_project_context` once. If this folder clearly belongs to a different project, ask which folder to use before writing code.
3. Summarise for the user: progress, any task still in progress under your name (`get_next_task` resumes it first), and the next ready task. Ask whether to start.
4. Once they agree, follow the context's working agreement with that `project_id` and keep going until no task is left or the user steers you elsewhere.
