#!/usr/bin/env node
// BWA MCP server (stdio).
// Lets Claude Code, Codex, Cursor, Gemini CLI and other MCP clients take tasks from BWA,
// implement them, and tick them off. Requires the BWA app to be running.
// The same clients can also act as BWA's AI brain (instead of 9router): see the "brain" tools below.
//
//   claude mcp add bwa -e BWA_PROJECT_ID=p_xxx -- node /path/to/BWA/bridge/mcp-server.mjs
//
// Env: BWA_URL (default http://127.0.0.1:3900), BWA_PROJECT_ID, BWA_AGENT_NAME.
// stdout is the MCP channel: log only to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { call, resolveProjectId, withWarnings } from "./client.mjs";

const INSTRUCTIONS = `BWA is the planning app for the software project you are working on. It holds the brief, the feature topology and an ordered task backlog.
Workflow: call get_project_context once, then get_next_task (claim=true), implement the task in the current repository until its acceptance criteria are met, verify it, then call complete_task with a summary and the changed files. Repeat until no task is left.
Use block_task when you need a human decision, add_task_note for progress on long tasks, and create_task for necessary work that is not planned. Never mark a task done unless its acceptance criteria are met.
Brain mode (only when the user asks you to be BWA's brain, e.g. via the jadi_otak prompt): loop on wait_for_brain_job, answer each job exactly as its SYSTEM section asks, send it with submit_brain_result, and call wait_for_brain_job again. Brain jobs never involve files or other tools.
When wait_for_brain_job returns a "BWA handover", brain mode is over: stop polling and follow the handover, which makes you the project's coding agent.
Changing models: BWA cannot choose your model; whatever model this session runs answers the jobs. You cannot switch it yourself either. If the user interrupts brain mode to change models (or asks how), tell them to switch with /model (or the app's model picker), then resume calling wait_for_brain_job when they say to continue. Jobs sent meanwhile wait in BWA's queue for about two minutes, so nothing is lost.`;

const server = new McpServer({ name: "bwa", version: "0.1.0" }, { instructions: INSTRUCTIONS });

function agentName() {
  if (process.env.BWA_AGENT_NAME) return process.env.BWA_AGENT_NAME.trim();
  const name = String(server.server.getClientVersion()?.name ?? "").toLowerCase();
  if (name.includes("claude")) return "claude-code";
  if (name.includes("codex")) return "codex";
  if (name.includes("cursor")) return "cursor";
  if (name.includes("gemini")) return "gemini-cli";
  if (name.includes("windsurf") || name.includes("codeium")) return "windsurf";
  if (name.includes("cline")) return "cline";
  if (name.includes("copilot") || name.includes("vscode")) return "copilot";
  return name.slice(0, 40) || "mcp-agent";
}

function tool(name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return { content: [{ type: "text", text: await handler(args ?? {}) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err?.message ?? err}` }], isError: true };
    }
  });
}

const project = {
  project_id: z
    .string()
    .optional()
    .describe("BWA project id (p_…). Optional when BWA_PROJECT_ID is set or only one project exists."),
};
const task = { task_id: z.string().describe('Task id, e.g. "T03".') };

tool(
  "list_projects",
  {
    title: "List BWA projects",
    description: "List the projects planned in BWA with their stage and task progress.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => (await call("GET", "/projects", undefined, agentName())).markdown,
);

tool(
  "get_project_context",
  {
    title: "Get project context",
    description:
      "Read the project brief (problem, users, tech stack, MVP scope), the feature topology, phases, progress and the working agreement. Call this once before starting work.",
    inputSchema: { ...project },
    annotations: { readOnlyHint: true },
  },
  async ({ project_id }) => {
    const id = await resolveProjectId(project_id);
    return (await call("GET", `/projects/${id}/context`, undefined, agentName())).markdown;
  },
);

tool(
  "get_prd",
  {
    title: "Read the PRD",
    description:
      "Read the project's Product Requirements Document (user stories, functional and non-functional requirements, release plan) when one exists.",
    inputSchema: { ...project },
    annotations: { readOnlyHint: true },
  },
  async ({ project_id }) => {
    const id = await resolveProjectId(project_id);
    return (await call("GET", `/projects/${id}/prd`, undefined, agentName())).markdown;
  },
);

tool(
  "list_tasks",
  {
    title: "List tasks",
    description: "List tasks in plan order with their status, assignee and unmet dependencies.",
    inputSchema: {
      ...project,
      status: z
        .enum(["all", "open", "todo", "in_progress", "blocked", "done"])
        .optional()
        .describe('Filter. "open" = everything not done. Default "all".'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ project_id, status }) => {
    const id = await resolveProjectId(project_id);
    return (await call("GET", `/projects/${id}/tasks?status=${status ?? "all"}`, undefined, agentName())).markdown;
  },
);

tool(
  "get_next_task",
  {
    title: "Get next task",
    description:
      "Get the task to work on now: your own unfinished task first, otherwise the first todo task whose dependencies are done. With claim=true (default) the task is marked in progress and assigned to you, so other agents skip it.",
    inputSchema: {
      ...project,
      claim: z.boolean().optional().describe("Claim the task for yourself. Default true."),
    },
  },
  async ({ project_id, claim }) => {
    const id = await resolveProjectId(project_id);
    const agent = agentName();
    if (claim === false) return (await call("GET", `/projects/${id}/tasks/next?agent=${encodeURIComponent(agent)}`, undefined, agent)).markdown;
    return withWarnings(await call("POST", `/projects/${id}/tasks/next`, { agent }, agent));
  },
);

tool(
  "get_task",
  {
    title: "Get task details",
    description: "Read one task: description, acceptance criteria, implementation hint, dependencies, notes.",
    inputSchema: { ...project, ...task },
    annotations: { readOnlyHint: true },
  },
  async ({ project_id, task_id }) => {
    const id = await resolveProjectId(project_id);
    return (await call("GET", `/projects/${id}/tasks/${encodeURIComponent(task_id)}`, undefined, agentName())).markdown;
  },
);

tool(
  "claim_task",
  {
    title: "Claim a task",
    description: "Mark a specific task as in progress and assigned to you. Prefer get_next_task unless the user asked for a specific task.",
    inputSchema: {
      ...project,
      ...task,
      force: z.boolean().optional().describe("Take over a task another agent claimed (only if that agent stopped)."),
    },
  },
  async ({ project_id, task_id, force }) => {
    const id = await resolveProjectId(project_id);
    const agent = agentName();
    return withWarnings(await call("POST", `/projects/${id}/tasks/${encodeURIComponent(task_id)}/claim`, { agent, force: force === true }, agent));
  },
);

tool(
  "add_task_note",
  {
    title: "Add a progress note",
    description: "Post a short progress note or decision on a task. The user sees it live in BWA.",
    inputSchema: { ...project, ...task, note: z.string().describe("The note, 1-3 sentences.") },
  },
  async ({ project_id, task_id, note }) => {
    const id = await resolveProjectId(project_id);
    const agent = agentName();
    return (await call("POST", `/projects/${id}/tasks/${encodeURIComponent(task_id)}/note`, { agent, text: note }, agent)).markdown;
  },
);

tool(
  "complete_task",
  {
    title: "Complete a task",
    description:
      "Tick a task off as done in BWA. Only call this when every acceptance criterion is met and you verified the work. Include what you did and which files changed.",
    inputSchema: {
      ...project,
      ...task,
      summary: z.string().describe("What you implemented and how you verified it, 2-6 sentences."),
      files_changed: z.array(z.string()).optional().describe("Paths of files you created or changed."),
    },
  },
  async ({ project_id, task_id, summary, files_changed }) => {
    const id = await resolveProjectId(project_id);
    const agent = agentName();
    return (
      await call(
        "POST",
        `/projects/${id}/tasks/${encodeURIComponent(task_id)}/complete`,
        { agent, summary, files: files_changed ?? [] },
        agent,
      )
    ).markdown;
  },
);

tool(
  "block_task",
  {
    title: "Mark a task blocked",
    description: "Flag that you cannot finish a task without a human decision or an external dependency. Explain exactly what is needed.",
    inputSchema: { ...project, ...task, reason: z.string().describe("What blocks you and what you need from the user.") },
  },
  async ({ project_id, task_id, reason }) => {
    const id = await resolveProjectId(project_id);
    const agent = agentName();
    return (await call("POST", `/projects/${id}/tasks/${encodeURIComponent(task_id)}/block`, { agent, reason }, agent)).markdown;
  },
);

tool(
  "release_task",
  {
    title: "Release a task",
    description: "Give a claimed task back to the queue without finishing it.",
    inputSchema: { ...project, ...task, note: z.string().optional().describe("Why you release it.") },
  },
  async ({ project_id, task_id, note }) => {
    const id = await resolveProjectId(project_id);
    const agent = agentName();
    return (await call("POST", `/projects/${id}/tasks/${encodeURIComponent(task_id)}/release`, { agent, note: note ?? "" }, agent)).markdown;
  },
);

tool(
  "create_task",
  {
    title: "Create a task",
    description: "Add necessary work you discovered that is not in the plan yet. It is appended to the backlog.",
    inputSchema: {
      ...project,
      title: z.string().describe("Imperative title, max 10 words."),
      description: z.string().describe("What needs to be built and why."),
      acceptance: z.array(z.string()).optional().describe("Testable acceptance criteria."),
      depends_on: z.array(z.string()).optional().describe('Task ids that must be done first, e.g. ["T03"].'),
      priority: z.enum(["high", "medium", "low"]).optional(),
      type: z.string().optional().describe("setup | frontend | backend | database | integration | testing | devops | design | docs"),
    },
  },
  async ({ project_id, title, description, acceptance, depends_on, priority, type }) => {
    const id = await resolveProjectId(project_id);
    const agent = agentName();
    return (
      await call(
        "POST",
        `/projects/${id}/tasks`,
        { agent, title, description, acceptance: acceptance ?? [], dependsOn: depends_on ?? [], priority, type },
        agent,
      )
    ).markdown;
  },
);

// ---------- brain mode: answer the prompts of BWA's Agent 1, 2 and 3 instead of 9router ----------

const job = { job_id: z.string().describe('Brain job id from wait_for_brain_job, e.g. "b1a2b3c".') };

tool(
  "wait_for_brain_job",
  {
    title: "Wait for a BWA brain job",
    description:
      "Brain mode: wait up to wait_seconds for the next prompt BWA wants you to answer (idea development, feature topology, task plan, PRD). " +
      "Returns the job with its SYSTEM instructions and INPUT, or says no job arrived yet. Call it again in a loop. " +
      'When it returns a "BWA handover" instead, planning is finished: stop calling it and follow the handover instructions.',
    inputSchema: {
      wait_seconds: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("How long to wait for a job. Default 40; keep it under your client's tool timeout."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ wait_seconds }) => {
    const waitSec = wait_seconds ?? 40;
    const agent = agentName();
    return (await call("POST", "/brain/wait", { agent, waitSec }, agent, (waitSec + 15) * 1000)).markdown;
  },
);

tool(
  "submit_brain_result",
  {
    title: "Submit a brain job answer",
    description:
      "Brain mode: send your complete answer for a job. The output must be exactly what the job's SYSTEM section asks for (usually one JSON object, no fences, no commentary).",
    inputSchema: { ...job, output: z.string().describe("Your complete answer.") },
  },
  async ({ job_id, output }) => {
    const agent = agentName();
    return (await call("POST", `/brain/jobs/${encodeURIComponent(job_id)}/result`, { agent, output }, agent)).markdown;
  },
);

tool(
  "fail_brain_job",
  {
    title: "Fail a brain job",
    description: "Brain mode: give up on a job you cannot answer. BWA shows the reason to the user.",
    inputSchema: { ...job, reason: z.string().describe("Why you cannot answer.") },
  },
  async ({ job_id, reason }) => {
    const agent = agentName();
    return (await call("POST", `/brain/jobs/${encodeURIComponent(job_id)}/fail`, { agent, reason }, agent)).markdown;
  },
);

server.registerPrompt(
  "jadi_otak",
  {
    title: "Jadi otak AI BWA",
    description:
      "Standby sebagai otak AI BWA (pengganti 9router): jawab job Agent 1, 2, dan 3, lalu lanjut sebagai agent coding setelah task terbentuk.",
    argsSchema: {},
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Jadilah otak AI untuk aplikasi BWA (pengganti 9router). Ulangi terus:\n" +
            "1. Panggil wait_for_brain_job.\n" +
            "2. Kalau belum ada job, langsung panggil wait_for_brain_job lagi. Jangan menulis apa pun di antara panggilan.\n" +
            "3. Kalau ada job, kerjakan persis sesuai bagian SYSTEM dengan data di bagian INPUT. Biasanya jawabannya satu objek JSON tanpa markdown fence dan tanpa komentar.\n" +
            "4. Kirim jawaban lengkap dengan submit_brain_result (job_id dan output), lalu kembali ke langkah 1.\n" +
            "Untuk job otak, jangan membaca atau mengubah file, menjalankan perintah, atau memakai tool lain. " +
            "Kalau sebuah job benar-benar tidak bisa dijawab, panggil fail_brain_job dengan alasannya.\n" +
            'Kalau wait_for_brain_job mengirim "BWA handover", mode otak selesai: berhenti memanggil wait_for_brain_job dan ikuti instruksi di pesan itu (kamu menjadi agent coding untuk proyek tersebut). ' +
            "Selain itu, berhenti hanya kalau saya minta.\n" +
            "Ganti model: job dijawab oleh model yang sedang aktif di sesi ini, dan kamu tidak bisa menggantinya sendiri. " +
            "Kalau saya menyela untuk ganti model, ingatkan caranya (/model atau pemilih model di aplikasi). " +
            "Setelah saya bilang lanjut, kembali ke langkah 1. Job yang masuk selama jeda tetap menunggu di antrean BWA sekitar 2 menit.",
        },
      },
    ],
  }),
);

server.registerPrompt(
  "kerjakan_task",
  {
    title: "Kerjakan backlog BWA",
    description: "Ambil task dari BWA satu per satu, kerjakan, lalu centang sampai habis.",
    argsSchema: { project_id: z.string().optional().describe("ID proyek BWA (opsional).") },
  },
  ({ project_id }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Kerjakan backlog proyek BWA${project_id ? ` ${project_id}` : ""} di repository ini.\n` +
            "1. Panggil get_project_context sekali untuk membaca brief, peta fitur, dan aturan kerja.\n" +
            "2. Panggil get_next_task (claim=true).\n" +
            "3. Kerjakan task itu sampai semua acceptance criteria terpenuhi, lalu verifikasi (build/test/jalankan).\n" +
            "4. Panggil complete_task dengan ringkasan dan daftar file yang diubah.\n" +
            "5. Ulangi dari langkah 2 sampai tidak ada task tersisa.\n" +
            "Jika butuh keputusan dari saya, panggil block_task dengan alasannya lalu lanjut ke task lain.",
        },
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
console.error(`[bwa-mcp] siap · BWA_URL=${process.env.BWA_URL || "http://127.0.0.1:3900"}`);
