// The BWA HTTP app. Started by server/index.ts (web/dev) or by the desktop shell (electron/main.ts).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { stream, streamSSE } from "hono/streaming";
import type { AgentEvent, HandoverMode, Project, RouterStatus, Selections, Task } from "../shared/types.ts";
import * as ideaAgent from "./agents/idea.ts";
import * as topologyAgent from "./agents/topology.ts";
import * as tasksAgent from "./agents/tasks.ts";
import { prdFileName, writePrd } from "./agents/prd.ts";
import {
  agentsMd,
  contextMarkdown,
  handoverMarkdown,
  progressLine,
  taskListMarkdown,
  taskMarkdown,
  type BridgeInfo,
} from "./context.ts";
import { claudeStatus, codexStatus, connectClaude, connectCodex, disconnectClaude, disconnectCodex } from "./connect.ts";
import { failJob, MAX_WAIT_SEC, pendingCount, queueHandover, standbyWorkers, submitJob, waitForJob } from "./brainQueue.ts";
import { chat, diagnoseRouter, LlmError, listModels, normalizeBaseUrl } from "./llm.ts";
import { brainLabel, getSettings, publicSettings, updateSettings, type SettingsPatch } from "./settings.ts";
import {
  bus,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  mutateProject,
  pushActivity,
  ROOT_DIR,
  summarize,
  type ProjectEvent,
} from "./store.ts";
import * as ops from "./taskOps.ts";
import { HttpError, isRecord, pick, str, strList } from "./util.ts";

const PORT = Number(process.env.PORT || 3900);
const HOST = process.env.HOST || "127.0.0.1";
/** true when running inside the desktop app */
const DESKTOP = process.env.BWA_DESKTOP === "1";
const toPosix = (p: string) => p.split(path.sep).join("/");
const BRIDGE_DIR = process.env.BWA_BRIDGE_DIR || path.join(ROOT_DIR, "bridge");
const BRIDGE: BridgeInfo = {
  apiUrl: `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`,
  mcpServerPath: toPosix(path.join(BRIDGE_DIR, "mcp-server.mjs")),
  cliPath: toPosix(path.join(BRIDGE_DIR, "cli.mjs")),
  // The desktop app runs the bridge with its own executable in Node mode, so no separate Node install is needed.
  command: toPosix(process.env.BWA_BRIDGE_COMMAND || "node"),
  commandEnv: DESKTOP ? { ELECTRON_RUN_AS_NODE: "1" } : {},
};

const app = new Hono();

// ---------- guard: local-only API (blocks DNS rebinding and cross-site requests) ----------

const allowedHosts = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  ...(process.env.BWA_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
]);

function hostnameOf(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

app.use("/api/*", async (c, next) => {
  if (process.env.BWA_ALLOW_ANY_HOST !== "1") {
    const host = hostnameOf(c.req.header("host") ?? "");
    if (!allowedHosts.has(host)) return c.json({ error: `Host "${host}" tidak diizinkan.` }, 403);
    const origin = c.req.header("origin");
    if (origin && !allowedHosts.has(hostnameOf(origin))) return c.json({ error: "Origin tidak diizinkan." }, 403);
  }
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  if (mutating && !(c.req.header("content-type") ?? "").includes("application/json")) {
    return c.json({ error: "Content-Type harus application/json." }, 415);
  }
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, hint: err.hint }, err.status);
  if (err instanceof LlmError) return c.json({ error: err.message, hint: err.hint, code: err.code }, 502);
  console.error(err);
  return c.json({ error: (err as Error).message || "Terjadi kesalahan di server." }, 500);
});

const sourceOf = (c: Context) => c.req.header("x-bwa-client") || "api";

const HANDOVER_LABEL: Record<HandoverMode, string> = {
  wait: "lapor lalu tunggu perintah di chat",
  auto: "langsung mengerjakan task",
};

async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

// ---------- streaming agent runs (NDJSON: status / progress / done / error) ----------

interface RunContext {
  signal: AbortSignal;
  onStatus: (message: string) => void;
  onProgress: (p: { chars: number; reasoningChars: number }) => void;
}

function agentStream(c: Context, agent: "idea" | "topology" | "tasks", work: (run: RunContext) => Promise<unknown>) {
  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
  return stream(c, async (s) => {
    const controller = new AbortController();
    s.onAbort(() => controller.abort());
    const emit = (event: AgentEvent) => (s.aborted ? Promise.resolve() : s.write(`${JSON.stringify(event)}\n`));
    let lastProgress = 0;
    const run: RunContext = {
      signal: controller.signal,
      onStatus: (message) => void emit({ type: "status", message }),
      onProgress: (p) => {
        const now = Date.now();
        if (now - lastProgress < 200) return;
        lastProgress = now;
        void emit({ type: "progress", ...p });
      },
    };
    try {
      await emit({
        type: "status",
        message:
          getSettings().provider === "mcp"
            ? "Mengirim job ke agent MCP (Claude Code, Codex)…"
            : `Menghubungi 9router · model ${brainLabel(agent) || "(belum dipilih)"}`,
      });
      const result = await work(run);
      await emit({ type: "done", result });
    } catch (err) {
      const e = err as LlmError;
      if (!controller.signal.aborted) console.warn(`[agent:${agent}] ${e.message}`);
      if (e?.code === "unreachable" || e?.code === "timeout") {
        const d = await diagnoseRouter(err);
        await emit({ type: "error", message: d.state === "stalled" ? d.message : e.message, hint: d.hint ?? e.hint });
      } else {
        await emit({ type: "error", message: e.message || "Agent gagal.", hint: e.hint });
      }
    }
  });
}

// ---------- health, settings, 9router ----------

app.get("/api/health", (c) => c.json({ ok: true, name: "bwa", desktop: DESKTOP }));

/** Desktop only: opens a console window running the 9router CLI. */
app.post("/api/system/start-9router", (c) => {
  if (!DESKTOP) throw new HttpError(403, "Hanya tersedia di aplikasi desktop.");
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/c", "start", '"9router"', "cmd.exe", "/k", "9router"], {
          detached: true,
          stdio: "ignore",
          windowsVerbatimArguments: true,
        })
      : spawn("9router", [], { detached: true, stdio: "ignore" });
  child.on("error", (err) => console.warn(`[9router] gagal dijalankan: ${err.message}`));
  child.unref();
  return c.json({ ok: true });
});

app.get("/api/settings", (c) => c.json(publicSettings()));

app.put("/api/settings", async (c) => {
  updateSettings((await readBody(c)) as SettingsPatch);
  return c.json(publicSettings());
});

/** Checks the 9router endpoint with draft values (not saved yet) and lists its models. */
app.post("/api/settings/test", async (c) => {
  const body = await readBody(c);
  const draft = { ...getSettings() };
  if (typeof body.baseUrl === "string" && body.baseUrl.trim()) draft.baseUrl = body.baseUrl.trim();
  if (typeof body.apiKey === "string" && body.apiKey.trim()) draft.apiKey = body.apiKey.trim();
  if (body.apiKey === null) draft.apiKey = "";
  const started = Date.now();
  try {
    const models = await listModels(draft);
    return c.json({ ok: true, models, latencyMs: Date.now() - started, baseUrl: normalizeBaseUrl(draft.baseUrl) });
  } catch (err) {
    const d = await diagnoseRouter(err, draft);
    return c.json({ ok: false, error: d.message, hint: d.hint, code: d.state });
  }
});

/** Sends one tiny completion to prove the chosen model actually answers. */
app.post("/api/settings/test-model", async (c) => {
  const body = await readBody(c);
  const model = str(body.model, 200) || getSettings().model;
  const draft = { ...getSettings(), model, agentModels: { idea: "", topology: "", tasks: "" }, maxTokens: 64 };
  const started = Date.now();
  try {
    const res = await chat(
      { agent: "idea", system: "Reply with exactly: OK", user: "Ping from BWA.", temperature: 0 },
      draft,
    );
    return c.json({ ok: true, model, reply: res.text.trim().slice(0, 80), latencyMs: Date.now() - started });
  } catch (err) {
    const e = err as LlmError;
    return c.json({ ok: false, model, error: e.message, hint: e.hint });
  }
});

/** Sends one tiny job through the MCP brain to prove a standby agent answers. */
app.post("/api/settings/test-brain", async (c) => {
  const draft = { ...getSettings(), provider: "mcp" as const, timeoutSec: 120 };
  const started = Date.now();
  try {
    const res = await chat(
      { agent: "idea", system: "Reply with exactly: OK", user: "Ping from BWA settings. Reply with exactly: OK", signal: c.req.raw.signal },
      draft,
    );
    return c.json({ ok: true, model: res.model, reply: res.text.trim().slice(0, 80), latencyMs: Date.now() - started });
  } catch (err) {
    const e = err as LlmError;
    return c.json({ ok: false, model: "mcp", error: e.message, hint: e.hint });
  }
});

// ---------- "Sambungkan otomatis": register the bwa MCP bridge in Claude Code / Codex ----------

app.get("/api/connect", async (c) => c.json({ claude: await claudeStatus(BRIDGE), codex: codexStatus(BRIDGE) }));
app.post("/api/connect/claude", async (c) => c.json(await connectClaude(BRIDGE)));
app.delete("/api/connect/claude", async (c) => c.json(await disconnectClaude(BRIDGE)));
app.post("/api/connect/codex", (c) => c.json(connectCodex(BRIDGE)));
app.delete("/api/connect/codex", (c) => c.json(disconnectCodex(BRIDGE)));

/** Cheap and provider-independent, so Settings can show standby agents before switching to MCP. */
app.get("/api/brain/status", (c) => c.json({ workers: standbyWorkers(), pending: pendingCount() }));

app.get("/api/llm/status", async (c) => {
  const s = getSettings();
  if (s.provider === "mcp") {
    const workers = standbyWorkers();
    return c.json({
      provider: "mcp",
      state: workers.length ? "ok" : "off",
      reachable: workers.length > 0,
      configured: true,
      model: workers.map((w) => w.name).join(", "),
      modelCount: workers.length,
      workers,
      pending: pendingCount(),
      ...(workers.length
        ? {}
        : {
            error: "Belum ada agent MCP yang standby.",
            hint: "Di Claude Code yang terhubung ke MCP server bwa, jalankan /mcp__bwa__jadi_otak (Codex: kirim prompt jadi_otak). Biarkan sesinya terbuka.",
          }),
    } satisfies RouterStatus);
  }
  try {
    const models = await listModels(s, 5000);
    return c.json({
      provider: "9router",
      state: "ok",
      reachable: true,
      configured: !!s.model,
      model: s.model,
      modelCount: models.length,
    } satisfies RouterStatus);
  } catch (err) {
    const d = await diagnoseRouter(err, s);
    return c.json({
      provider: "9router",
      state: d.state,
      reachable: false,
      configured: !!s.model,
      model: s.model,
      modelCount: 0,
      error: d.message,
      hint: d.hint,
    } satisfies RouterStatus);
  }
});

app.get("/api/bridge", (c) => c.json({ ...BRIDGE, nodePath: toPosix(process.execPath) }));

// ---------- projects (web UI) ----------

function normalizeSelections(raw: unknown, project: Project): Selections {
  const r = isRecord(raw) ? raw : {};
  const src = isRecord(r.choices) ? r.choices : {};
  const choices: Record<string, string[]> = {};
  for (const dim of project.idea?.dimensions ?? []) {
    const ids = strList(src[dim.id], 30, 80).filter((id) => dim.options.some((o) => o.id === id));
    if (ids.length) choices[dim.id] = dim.multi ? ids : ids.slice(-1);
  }
  const directionId = str(r.directionId, 80);
  return {
    directionId: project.idea?.directions.some((d) => d.id === directionId) ? directionId : null,
    choices,
    notes: str(r.notes, 4000),
  };
}

app.get("/api/projects", (c) => c.json(listProjects().map(summarize)));

app.post("/api/projects", async (c) => {
  const body = await readBody(c);
  const prompt = str(body.prompt, 4000);
  if (!prompt) throw new HttpError(400, "Tulis dulu idenya.");
  return c.json(createProject(prompt, sourceOf(c)), 201);
});

app.get("/api/projects/:id", (c) => c.json(getProject(c.req.param("id"))));

app.patch("/api/projects/:id", async (c) => {
  const body = await readBody(c);
  const project = mutateProject(c.req.param("id"), sourceOf(c), (p) => {
    if (body.name !== undefined) p.name = str(body.name, 80) || p.name;
    if (body.prompt !== undefined) p.prompt = str(body.prompt, 4000) || p.prompt;
    if (body.stage !== undefined) p.stage = pick(body.stage, ["idea", "topology", "tasks", "prd"] as const, p.stage);
    if (body.idea !== undefined && body.idea !== null) p.idea = ideaAgent.normalizeExploration(body.idea, p.prompt);
    if (body.selections !== undefined) p.selections = normalizeSelections(body.selections, p);
    if (body.brief !== undefined && body.brief !== null) p.brief = ideaAgent.normalizeBrief(body.brief, p.brief?.name ?? p.name);
    return p;
  });
  return c.json(project);
});

app.delete("/api/projects/:id", (c) => {
  deleteProject(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/projects/:id/events", (c) => {
  const id = c.req.param("id");
  getProject(id);
  return streamSSE(c, async (s) => {
    const onEvent = (event: ProjectEvent) => {
      if (event.id === id) void s.writeSSE({ event: "project", data: JSON.stringify(event) });
    };
    bus.on("project", onEvent);
    const ping = setInterval(() => void s.writeSSE({ event: "ping", data: "{}" }), 20_000);
    await s.writeSSE({ event: "hello", data: JSON.stringify({ id }) });
    await new Promise<void>((resolve) => s.onAbort(resolve));
    clearInterval(ping);
    bus.off("project", onEvent);
  });
});

// ---------- the three agents ----------

app.post("/api/projects/:id/agents/idea/explore", async (c) => {
  const id = c.req.param("id");
  const body = await readBody(c);
  const source = sourceOf(c);
  getProject(id);
  return agentStream(c, "idea", async (run) => {
    const idea = await ideaAgent.explore(getProject(id), str(body.feedback, 2000), run);
    return mutateProject(id, source, (p) => {
      p.idea = idea;
      p.name = idea.title || p.name;
      p.selections = { directionId: null, choices: {}, notes: p.selections.notes };
      pushActivity(p, "agent-1", `mengembangkan ide menjadi ${idea.directions.length} arah dan ${idea.dimensions.length} kelompok pilihan`);
      return p;
    });
  });
});

app.post("/api/projects/:id/agents/idea/more", async (c) => {
  const id = c.req.param("id");
  const body = await readBody(c);
  const source = sourceOf(c);
  const dimensionId = str(body.dimensionId, 80);
  const dimension = getProject(id).idea?.dimensions.find((d) => d.id === dimensionId);
  if (!dimension) throw new HttpError(404, "Kelompok pilihan tidak ditemukan.");
  return agentStream(c, "idea", async (run) => {
    const options = await ideaAgent.moreOptions(getProject(id), dimension, str(body.hint, 300), run);
    return mutateProject(id, source, (p) => {
      const dim = p.idea?.dimensions.find((d) => d.id === dimensionId);
      if (dim) dim.options.push(...options);
      return { project: p, added: options.map((o) => o.id) };
    });
  });
});

app.post("/api/projects/:id/agents/idea/brief", async (c) => {
  const id = c.req.param("id");
  const source = sourceOf(c);
  if (!getProject(id).idea) throw new HttpError(400, "Kembangkan idenya dulu dengan Agent 1.");
  return agentStream(c, "idea", async (run) => {
    const brief = await ideaAgent.synthesizeBrief(getProject(id), run);
    return mutateProject(id, source, (p) => {
      p.brief = brief;
      p.name = brief.name || p.name;
      pushActivity(p, "agent-1", "menyusun brief proyek");
      return p;
    });
  });
});

app.post("/api/projects/:id/agents/topology/generate", async (c) => {
  const id = c.req.param("id");
  const source = sourceOf(c);
  if (!getProject(id).brief) throw new HttpError(400, "Brief proyek belum ada. Selesaikan tahap Ide dulu.");
  return agentStream(c, "topology", async (run) => {
    const topology = await topologyAgent.generate(getProject(id), run);
    return mutateProject(id, source, (p) => {
      p.topology = topology;
      p.stage = "topology";
      pushActivity(p, "agent-2", `memetakan ${topology.nodes.length} node fitur`);
      return p;
    });
  });
});

app.post("/api/projects/:id/agents/topology/grow", async (c) => {
  const id = c.req.param("id");
  const body = await readBody(c);
  const source = sourceOf(c);
  if (!getProject(id).topology) throw new HttpError(400, "Topologi belum ada.");
  const nodeId = str(body.nodeId, 80) || null;
  return agentStream(c, "topology", async (run) => {
    const { topology, added } = await topologyAgent.grow(getProject(id), nodeId, run);
    return mutateProject(id, source, (p) => {
      p.topology = topology;
      pushActivity(p, "agent-2", `menambah ${added.length} node fitur`);
      return { project: p, added: added.map((n) => n.id) };
    });
  });
});

app.post("/api/projects/:id/agents/tasks/generate", async (c) => {
  const id = c.req.param("id");
  const source = sourceOf(c);
  const project = getProject(id);
  if (!project.brief || !project.topology) throw new HttpError(400, "Butuh brief dan topologi fitur sebelum membagi task.");
  return agentStream(c, "tasks", async (run) => {
    const plan = await tasksAgent.generatePlan(getProject(id), run);
    const { provider, handover } = getSettings();
    const saved = mutateProject(id, source, (p) => {
      p.phases = plan.phases;
      p.tasks = plan.tasks;
      p.stage = "tasks";
      pushActivity(p, "agent-3", `membagi pekerjaan menjadi ${plan.tasks.length} task dalam ${plan.phases.length} fase`);
      if (provider === "mcp") {
        pushActivity(p, "agent-3", `menyerahkan proyek ke sesi agent MCP · ${HANDOVER_LABEL[handover]}`);
      }
      return p;
    });
    if (provider === "mcp") {
      run.onStatus("Menyerahkan proyek ke sesi agent MCP…");
      queueHandover(id, handoverMarkdown(saved, handover), (worker) => {
        try {
          mutateProject(id, `agent:${worker}`, (p) => {
            pushActivity(p, worker, `menerima serah-terima dan keluar dari mode otak · ${HANDOVER_LABEL[handover]}`);
          });
        } catch {
          /* project deleted in the meantime */
        }
      });
    }
    return saved;
  });
});

app.post("/api/projects/:id/agents/prd/generate", async (c) => {
  const id = c.req.param("id");
  const source = sourceOf(c);
  const project = getProject(id);
  if (!project.brief || !project.topology) throw new HttpError(400, "Butuh brief dan topologi fitur sebelum menulis PRD.");
  return agentStream(c, "tasks", async (run) => {
    const { markdown, model } = await writePrd(getProject(id), run);
    return mutateProject(id, source, (p) => {
      const now = new Date().toISOString();
      p.prd = { markdown, generatedAt: now, updatedAt: now, edited: false, model };
      p.stage = "prd";
      const words = markdown.split(/\s+/).filter(Boolean).length;
      pushActivity(p, "agent-3", `menulis PRD (${words.toLocaleString("id-ID")} kata)`);
      return p;
    });
  });
});

// ---------- topology & tasks edits (web UI) ----------

app.put("/api/projects/:id/topology", async (c) => {
  const body = await readBody(c);
  const project = mutateProject(c.req.param("id"), sourceOf(c), (p) => {
    p.topology = topologyAgent.normalizeTopology(body, { fallbackName: p.brief?.name ?? p.name });
    return p;
  });
  return c.json({ updatedAt: project.updatedAt, topology: project.topology });
});

app.put("/api/projects/:id/prd", async (c) => {
  const body = await readBody(c);
  const markdown = typeof body.markdown === "string" ? body.markdown.slice(0, 400_000) : "";
  if (!markdown.trim()) throw new HttpError(400, "Isi PRD kosong.");
  const project = mutateProject(c.req.param("id"), sourceOf(c), (p) => {
    const now = new Date().toISOString();
    p.prd = p.prd
      ? { ...p.prd, markdown, updatedAt: now, edited: true }
      : { markdown, generatedAt: now, updatedAt: now, edited: true, model: "manual" };
    return p;
  });
  return c.json({ prd: project.prd, updatedAt: project.updatedAt });
});

app.post("/api/projects/:id/tasks", async (c) => {
  const body = await readBody(c);
  const project = mutateProject(c.req.param("id"), sourceOf(c), (p) => {
    ops.createTask(p, body, "user");
    return p;
  });
  return c.json(project, 201);
});

app.patch("/api/projects/:id/tasks/:taskId", async (c) => {
  const body = await readBody(c);
  const project = mutateProject(c.req.param("id"), sourceOf(c), (p) => {
    ops.editTask(p, ops.findTask(p, c.req.param("taskId")), body, "user");
    return p;
  });
  return c.json(project);
});

app.delete("/api/projects/:id/tasks/:taskId", (c) => {
  const project = mutateProject(c.req.param("id"), sourceOf(c), (p) => {
    ops.deleteTask(p, ops.findTask(p, c.req.param("taskId")), "user");
    return p;
  });
  return c.json(project);
});

app.get("/api/projects/:id/export/agents-md", (c) => {
  const project = getProject(c.req.param("id"));
  return c.body(agentsMd(project, BRIDGE), 200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": 'attachment; filename="AGENTS.md"',
  });
});

app.get("/api/projects/:id/export/prd.md", (c) => {
  const project = getProject(c.req.param("id"));
  if (!project.prd) throw new HttpError(404, "Proyek ini belum punya PRD.");
  return c.body(project.prd.markdown, 200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${prdFileName(project)}"`,
  });
});

app.get("/api/projects/:id/export/json", (c) => {
  const project = getProject(c.req.param("id"));
  return c.body(JSON.stringify(project, null, 2), 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="bwa-${project.id}.json"`,
  });
});

// ---------- agent bridge: used by the MCP server, the CLI, or any HTTP client ----------

const agentName = (value: unknown) => str(value, 60).replace(/[^\w.@:+ -]/g, "") || "agent";

function compactTask(t: Task) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    phaseId: t.phaseId,
    type: t.type,
    priority: t.priority,
    estimate: t.estimate,
    dependsOn: t.dependsOn,
  };
}

function nothingNextMessage(project: Project): string {
  if (project.tasks.length === 0) {
    return "Proyek ini belum punya task. Minta pengguna menjalankan Agent 3 (Bagi jadi task) di BWA.";
  }
  const open = project.tasks.filter((t) => t.status !== "done");
  if (open.length === 0) return `Semua task selesai (${progressLine(project)}). Tidak ada lagi yang perlu dikerjakan.`;
  return [
    "Belum ada task yang siap diambil. Sisa task:",
    ...ops
      .orderedTasks(project)
      .filter((t) => t.status !== "done")
      .map((t) => {
        const waiting = ops.unmetDependencies(project, t).map((d) => d.id);
        const why =
          t.status === "in_progress"
            ? `sedang dikerjakan ${t.assignee ?? ""}`.trim()
            : t.status === "blocked"
              ? "terhambat"
              : `menunggu ${waiting.join(", ")}`;
        return `- ${t.id} ${t.title} (${why})`;
      }),
  ].join("\n");
}

const afterClaim = (project: Project, t: Task) =>
  `\n\n---\nWhen the acceptance criteria are met, call complete_task with project_id "${project.id}", task_id "${t.id}", a summary and the changed files.`;

app.get("/api/agent/projects", (c) => {
  const projects = listProjects().map(summarize);
  const markdown = projects.length
    ? projects
        .map((p) => {
          const total = Object.values(p.taskCounts).reduce((a, b) => a + b, 0);
          return `- ${p.id} · ${p.name} · tahap: ${p.stage} · task: ${p.taskCounts.done}/${total} selesai`;
        })
        .join("\n")
    : "Belum ada proyek di BWA. Buat dulu dari UI.";
  return c.json({ projects, markdown });
});

app.get("/api/agent/projects/:id/context", (c) => c.json({ markdown: contextMarkdown(getProject(c.req.param("id"))) }));

app.get("/api/agent/projects/:id/prd", (c) => {
  const project = getProject(c.req.param("id"));
  return c.json({
    markdown: project.prd?.markdown ?? "Proyek ini belum punya PRD. Pengguna bisa menulisnya dari BWA (pilih jalur PRD).",
  });
});

app.get("/api/agent/projects/:id/tasks", (c) => {
  const project = getProject(c.req.param("id"));
  const status = c.req.query("status") ?? "all";
  const tasks = ops
    .orderedTasks(project)
    .filter((t) => status === "all" || t.status === status || (status === "open" && t.status !== "done"));
  return c.json({ tasks: tasks.map(compactTask), markdown: taskListMarkdown(project, tasks) });
});

app.get("/api/agent/projects/:id/tasks/next", (c) => {
  const project = getProject(c.req.param("id"));
  const task = ops.nextTask(project, agentName(c.req.query("agent")));
  return c.json({ task, markdown: task ? taskMarkdown(project, task) : nothingNextMessage(project) });
});

app.post("/api/agent/projects/:id/tasks/next", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const id = c.req.param("id");
  const peek = ops.nextTask(getProject(id), agent);
  if (!peek) return c.json({ task: null, warnings: [], markdown: nothingNextMessage(getProject(id)) });
  const result = mutateProject(id, `agent:${agent}`, (p) => {
    const task = ops.findTask(p, peek.id);
    const warnings = ops.claimTask(p, task, agent);
    return { task, warnings, markdown: taskMarkdown(p, task) + afterClaim(p, task) };
  });
  return c.json(result);
});

app.post("/api/agent/projects/:id/tasks", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const result = mutateProject(c.req.param("id"), `agent:${agent}`, (p) => {
    const task = ops.createTask(p, body, agent);
    return { task, markdown: `Task ${task.id} dibuat.\n\n${taskMarkdown(p, task)}` };
  });
  return c.json(result, 201);
});

app.get("/api/agent/projects/:id/tasks/:taskId", (c) => {
  const project = getProject(c.req.param("id"));
  const task = ops.findTask(project, c.req.param("taskId"));
  return c.json({ task, markdown: taskMarkdown(project, task) });
});

app.post("/api/agent/projects/:id/tasks/:taskId/claim", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const result = mutateProject(c.req.param("id"), `agent:${agent}`, (p) => {
    const task = ops.findTask(p, c.req.param("taskId"));
    const warnings = ops.claimTask(p, task, agent, body.force === true);
    return { task, warnings, markdown: taskMarkdown(p, task) + afterClaim(p, task) };
  });
  return c.json(result);
});

app.post("/api/agent/projects/:id/tasks/:taskId/note", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const result = mutateProject(c.req.param("id"), `agent:${agent}`, (p) => {
    const task = ops.findTask(p, c.req.param("taskId"));
    ops.addNote(p, task, agent, str(body.text ?? body.note, 2000));
    return { task, markdown: `Catatan disimpan di ${task.id}.` };
  });
  return c.json(result);
});

app.post("/api/agent/projects/:id/tasks/:taskId/complete", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const result = mutateProject(c.req.param("id"), `agent:${agent}`, (p) => {
    const task = ops.findTask(p, c.req.param("taskId"));
    ops.completeTask(p, task, agent, str(body.summary, 4000), strList(body.files, 60, 300));
    const next = ops.nextTask(p, agent);
    return {
      task,
      progress: progressLine(p),
      next: next ? { id: next.id, title: next.title } : null,
      markdown: [
        `✓ ${task.id} ditandai selesai di BWA.`,
        `Progres: ${progressLine(p)}`,
        next ? `Task berikutnya yang siap: ${next.id} · ${next.title}. Panggil get_next_task dengan claim=true untuk lanjut.` : nothingNextMessage(p),
      ].join("\n"),
    };
  });
  return c.json(result);
});

app.post("/api/agent/projects/:id/tasks/:taskId/block", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const result = mutateProject(c.req.param("id"), `agent:${agent}`, (p) => {
    const task = ops.findTask(p, c.req.param("taskId"));
    ops.blockTask(p, task, agent, str(body.reason, 2000));
    return { task, markdown: `${task.id} ditandai terhambat. Pengguna akan melihat alasannya di BWA.` };
  });
  return c.json(result);
});

app.post("/api/agent/projects/:id/tasks/:taskId/release", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const result = mutateProject(c.req.param("id"), `agent:${agent}`, (p) => {
    const task = ops.findTask(p, c.req.param("taskId"));
    ops.releaseTask(p, task, agent, str(body.note, 1000));
    return { task, markdown: `${task.id} dikembalikan ke antrean.` };
  });
  return c.json(result);
});

// ---------- MCP brain: a standby agent answers the prompts of Agent 1, 2 and 3 ----------

app.post("/api/agent/brain/wait", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const waitSec = Math.min(MAX_WAIT_SEC, Math.max(1, Number(body.waitSec) || 40));
  const job = await waitForJob(agent, waitSec, c.req.raw.signal);
  const offMcp = getSettings().provider !== "mcp";
  const note = offMcp
    ? "\n\nNote: BWA is currently set to use 9router, so no jobs will arrive until the user switches the brain to MCP in Settings."
    : "";
  return c.json({
    job,
    markdown: job
      ? job.markdown
      : `No brain job yet. Call wait_for_brain_job again right away and keep looping until the user tells you to stop.${note}`,
  });
});

app.post("/api/agent/brain/jobs/:jobId/result", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  const output = typeof body.output === "string" ? body.output.slice(0, 400_000) : "";
  submitJob(agent, c.req.param("jobId"), output);
  return c.json({
    ok: true,
    markdown: `✓ Answer for job ${c.req.param("jobId")} delivered to BWA. Call wait_for_brain_job again for the next job.`,
  });
});

app.post("/api/agent/brain/jobs/:jobId/fail", async (c) => {
  const body = await readBody(c);
  const agent = agentName(body.agent);
  failJob(agent, c.req.param("jobId"), str(body.reason, 1000));
  return c.json({ ok: true, markdown: `Job ${c.req.param("jobId")} marked as failed. The user sees your reason in BWA.` });
});

app.all("/api/*",(c) => c.json({ error: `Endpoint ${c.req.method} ${c.req.path} tidak ada.` }, 404));

// ---------- built web UI (npm run build) ----------

const DIST_DIR = process.env.BWA_DIST_DIR || path.join(ROOT_DIR, "dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
};

app.get("*", (c) => {
  const indexFile = path.join(DIST_DIR, "index.html");
  if (!fs.existsSync(indexFile)) {
    return c.text(
      "UI belum di-build.\n- Mode pengembangan: jalankan `npm run dev`, lalu buka http://localhost:5173\n- Mode produksi: jalankan `npm run build` lalu `npm start`.",
      404,
    );
  }
  const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
  const file = path.normalize(path.join(DIST_DIR, urlPath));
  if (file.startsWith(DIST_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return new Response(fs.readFileSync(file), {
      headers: {
        "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": urlPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  }
  return c.html(fs.readFileSync(indexFile, "utf8"));
});

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

/** Starts listening; rejects with the socket error (e.g. EADDRINUSE) so the caller decides what to do. */
export function startServer(opts: { port?: number; host?: string } = {}): Promise<RunningServer> {
  const port = opts.port ?? PORT;
  const hostname = opts.host ?? HOST;
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, () => {
      server.off("error", reject);
      const s = getSettings();
      console.log(
        [
          "",
          `  BWA API     ${BRIDGE.apiUrl}${DESKTOP ? "  (desktop)" : ""}`,
          s.provider === "mcp"
            ? "  Otak AI       agent MCP (jalankan /mcp__bwa__jadi_otak di Claude Code)"
            : `  9router       ${normalizeBaseUrl(s.baseUrl)} · model ${s.model || "(belum dipilih, atur di Pengaturan)"}`,
          `  MCP bridge    ${BRIDGE.command} ${BRIDGE.mcpServerPath}`,
          fs.existsSync(path.join(DIST_DIR, "index.html")) ? `  UI            ${BRIDGE.apiUrl}` : "  UI (dev)      http://localhost:5173",
          "",
        ].join("\n"),
      );
      resolve({
        url: `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
    server.once("error", reject);
  });
}
