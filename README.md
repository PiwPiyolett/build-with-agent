# Build With Agent (BWA)

**English** · [Bahasa Indonesia](README.id.md)

From a one-sentence idea to tasks that a coding agent builds and ticks off, or to a PRD you can share.

BWA runs three AI agents. Their brain is the coding agent you already use, **Claude Code or Codex**, connected over MCP and running on its own subscription or model, so you need no API key.

1. **Agent 1 · Idea Developer**: turns a raw idea into directions and clickable choice groups (users, platform, features, stack, MVP scope), then sums your picks up as a project brief.
2. **Agent 2 · Feature Architect**: maps the brief into a feature topology (product → modules → features, integrations, dependencies) that you edit like a network diagram.
3. **Agent 3**: once the topology is ready, pick a path:
   - **Build it with a coding agent**: Agent 3 splits the features into ordered tasks. Claude Code, Codex, Cursor, and other agents take them over MCP, implement them in your repository, and tick them off in BWA live.
   - **Write a PRD (.md)**: a complete Product Requirements Document for your team, client, lecturer, or investors.

> The app's interface is currently in Indonesian. The agents answer in the language of your idea.

```
Claude Code session, opened in your project folder → /bwa
  │ Idea and Topology: you work in BWA; the session answers each step in the background
  ▼
"Split into tasks" → the tasks are ready
  ▼
Handover: the same session becomes the project's coding agent
  ├─ "Wait for my instructions": it summarises the plan and asks "Start with T01?"
  └─ "Start right away": it takes, builds, and ticks off the tasks one by one
```

## Install

Download the installer for your system from [Releases](https://github.com/PiwPiyolett/build-with-agent/releases):

| System | File | First launch |
| --- | --- | --- |
| Windows | `BWA-Setup-<version>.exe` | SmartScreen may warn because the installer is unsigned: **More info → Run anyway** |
| macOS (Apple Silicon / Intel) | `BWA-<version>-mac-arm64.dmg` / `-mac-x64.dmg` | The app is unsigned. If macOS says it is damaged or cannot be opened, run `xattr -cr "/Applications/Build With Agent.app"` |
| Linux | `BWA-<version>-linux-x86_64.AppImage` | `chmod +x BWA-*.AppImage`, then run it |

The macOS and Linux builds are produced by CI and have not yet been tried on real machines. Reports are welcome.

The app keeps running in the tray when you close its window, so agents can keep answering and ticking off tasks. Your projects and settings live in the app's data folder (Windows `%APPDATA%\Build With Agent\data`, macOS `~/Library/Application Support/Build With Agent/data`, Linux `~/.config/Build With Agent/data`).

## Connect Claude Code or Codex

### Option A: one click in BWA (recommended)

Open **Settings** (the status light, top right) → **Sambungkan agent**, then click **Sambungkan** (Connect) on Claude Code and/or Codex. BWA first shows exactly what it will change:

- **Claude Code**: runs `claude mcp add bwa --scope user …` and installs the `/bwa` command. BWA also finds the `claude` that ships with the Claude desktop app, even when it is not on your PATH.
- **Codex**: writes a `[mcp_servers.bwa]` table into `~/.codex/config.toml`. The rest of the file is untouched, and the previous version is saved as `config.toml.bak-bwa`.

If you move or reinstall BWA, the card turns yellow ("menunjuk ke lokasi BWA lain") and **Perbarui** (Update) fixes it. **Hapus koneksi** (Remove connection) unregisters BWA from that agent. It is not how you stop brain mode: for that, press Esc in the agent session. The manual commands are under **Cara manual** below the cards.

### Option B: Claude Code plugin

In Claude Code:

```
/plugin marketplace add PiwPiyolett/build-with-agent
/plugin install bwa@build-with-agent
```

The plugin adds `/bwa:start`. With BWA running, it registers the `bwa` MCP server by itself the first time; then open a new session and run it again.

## Use it

1. Open a **new** agent session in **your project's repository folder** (where the code will be written).
2. Claude Code: type `/bwa` (or `/bwa:start` from the plugin). Codex: send the "jadi otak" prompt from BWA's settings.
3. The light in BWA turns green ("Agent MCP · claude-code"). Work through Idea and Topology in BWA; keep the session open.
4. Choose what happens after the tasks are split, in **Mau diapakan idenya?** (above "Bagi jadi task") or in Settings:

| Mode | What the session does |
| --- | --- |
| Tunggu perintahku (wait, default) | Summarises the project (phases, task counts, first task), asks "Start with T01?", and waits for you |
| Langsung kerjakan (start right away) | Gives a short summary, then takes, builds, and ticks off the tasks until none are left. You can steer it in chat at any time |

To continue a project later in a fresh session, type `/bwa task` (or `/bwa task p_xxxx`).

Good to know:

- If no agent is standby for about 45 seconds, the run stops with instructions. Jobs live in memory and are dropped when BWA closes.
- The Timeout setting limits how long an agent may take to answer one job after picking it up; time waiting in the queue does not count.
- One session answers one job at a time. A PRD is two jobs, so it is faster with two sessions standby.
- The agent's own model decides quality and speed. To switch models midway (for example Sonnet for ideas, Opus for topology and tasks): press Esc, run `/model`, then type `/bwa` or "continue". Jobs sent in the meantime wait in the queue for about two minutes.
- In brain mode the session never touches your files. Code is written only after the handover.

How it works: when you run an agent in the UI, BWA queues its prompt. The standby session long-polls `wait_for_brain_job` (about 40 seconds per call), answers exactly as the job instructs, and returns it with `submit_brain_result`. BWA turns the answer into ideas, a topology, or tasks.

## PRD path

From the topology, click **Lanjut: pilih jalur** (Next: choose a path), then **Tulis PRD** (Write PRD). Agent 3 writes the strategy and the detailed requirements in parallel, and BWA assembles them with your edited topology into one document: summary, background, goals and constraints, success metrics, personas, platforms and architecture, data entities, feature scope per module (MoSCoW priorities, FR-xx requirements), integrations, dependencies, user stories with acceptance criteria, user flows, non-functional requirements, release plan, risks, open questions, and a glossary. Mermaid diagrams render as images on GitHub and Notion. Preview, edit (autosaved), copy, or download the `.md`.

## Other coding agents

Agents that only build tasks (no brain mode) can connect from the Tasks page via **Hubungkan agent** (Connect agent), which gives ready-to-copy commands for Claude Code, Codex, Cursor, Gemini CLI, Windsurf, Cline, and Claude Desktop (all use the same `mcpServers` format).

MCP tools: `list_projects`, `get_project_context`, `get_prd`, `list_tasks`, `get_next_task`, `get_task`, `claim_task`, `add_task_note`, `complete_task`, `block_task`, `release_task`, `create_task`, the prompt `kerjakan_task`, and for brain mode `wait_for_brain_job`, `submit_brain_result`, `fail_brain_job`, and the prompt `jadi_otak`.

Agents without MCP can use the CLI (`node bridge/cli.mjs help`) or the REST API under `/api/agent/projects/:id/…` (`context`, `prd`, `tasks`, `tasks/next`, `tasks/:taskId/claim`, `note`, `complete`, `block`, `release`).

## Run from source

Requires Node.js 22.6 or newer.

```bash
npm install
npm run dev        # API on http://127.0.0.1:3900, UI on http://localhost:5173
```

Production mode on one port: `npm run build && npm start`, then open http://127.0.0.1:3900.

Desktop app: `npm run desktop` to try it, or build an installer with `npm run desktop:dist` (Windows), `desktop:dist:mac`, or `desktop:dist:linux`. Pushing a `v*` tag builds all three in [GitHub Actions](.github/workflows/release.yml) and attaches them to a draft release.

The web and desktop versions share the code and the port (3900), so run one at a time. Their data is separate (`data/` for the web version).

Tests (each uses a throwaway server, data folder, and Claude Code/Codex config folder, so your own setup is never touched):

```bash
node scripts/brain-smoke-test.mjs     # the MCP brain, end to end
node scripts/connect-smoke-test.mjs   # one-click connect (needs Claude Code installed)
```

## Optional: 9router

BWA can also use [9router](https://github.com/decolua/9router), an OpenAI-compatible API proxy, as the brain. It is hidden by default. Enable it with `BWA_ENABLE_9ROUTER=1` in `.env` (web) or `"enable9router": true` in the data folder's `settings.json` (desktop), then restart BWA. Settings then offers the choice of brain, with per-agent models. See `.env.example`.

## Project structure

```
server/app.ts          HTTP app (Hono): routes, agent bridge; server/index.ts starts it for the web version
server/agents/         prompts and normalisation for Agent 1 (idea), 2 (topology), 3 (tasks, PRD)
server/llm.ts          the brain's entry point: chat() → server/brainQueue.ts (MCP) or 9router (optional)
server/brainQueue.ts   job queue for the MCP brain (long-poll, timeouts, standby status, handover)
server/connect.ts      one-click connect for Claude Code and Codex
bridge/                MCP server (stdio) and CLI for coding agents
plugins/bwa/           Claude Code plugin (/bwa:start); also installed as /bwa by the Connect button
.claude-plugin/        plugin marketplace for this repository
electron/main.ts       desktop app: in-process server, window, tray
shared/types.ts        shared data model
src/                   React UI: home, Idea, Topology, Tasks, PRD
scripts/               desktop build, icons, tests
```

## Security

- The server listens on 127.0.0.1 only and rejects any Host or Origin other than localhost, so websites cannot call it.
- Connecting an agent changes its configuration only after you confirm, and only BWA's own entries.
- To reach BWA from another device, set `HOST=0.0.0.0` and `BWA_ALLOWED_HOSTS` deliberately.

## License

[MIT](LICENSE) © Ariqo Banyusila Abrar
