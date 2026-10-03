// Smoke test for the MCP brain: starts its own BWA server (provider "mcp", throwaway data folder),
// connects to the bridge over stdio like Claude Code would, and plays the standby agent.
//   node scripts/brain-smoke-test.mjs
// Your real projects and settings are never touched.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.SMOKE_PORT || 3911);
const BWA_URL = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-brain-smoke-"));

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

// ---------- 1. a private BWA server in MCP mode ----------

const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), BWA_DATA_DIR: dataDir, BWA_PROVIDER: "mcp" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function api(method, p, body) {
  const res = await fetch(`${BWA_URL}/api${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

/** Starts a streaming agent run and resolves with its final NDJSON event plus the status lines. */
function runAgent(p, body = {}) {
  return (async () => {
    const res = await fetch(`${BWA_URL}/api${p}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    return { last: events.at(-1), statuses: events.filter((e) => e.type === "status").map((e) => e.message) };
  })();
}

const cleanup = async (client) => {
  await client?.close().catch(() => {});
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
};

let client;
try {
  for (let i = 0; ; i++) {
    try {
      if ((await api("GET", "/health")).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 60) throw new Error(`BWA server tidak menyala:\n${serverLog}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`BWA test server ${BWA_URL} · data ${dataDir}`);

  // ---------- 2. no agent standby yet ----------

  const before = await api("GET", "/llm/status");
  check(before.provider === "mcp" && before.state === "off" && !before.reachable, "status: mcp, belum ada agent standby");

  // ---------- 3. connect the bridge like Claude Code ----------

  client = new Client({ name: "claude-code", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "bridge", "mcp-server.mjs")],
      env: { ...process.env, BWA_URL, BWA_AGENT_NAME: "" },
    }),
  );
  const text = (res) => res.content.map((c) => c.text).join("\n");
  const tool = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 90_000 });
    return { text: text(res), isError: !!res.isError };
  };

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  check(["wait_for_brain_job", "submit_brain_result", "fail_brain_job"].every((n) => names.includes(n)), "tool brain terdaftar");
  const { prompts } = await client.listPrompts();
  check(prompts.some((p) => p.name === "jadi_otak"), "prompt jadi_otak terdaftar");

  // An empty poll registers the agent as standby.
  const idle = await tool("wait_for_brain_job", { wait_seconds: 1 });
  check(/No brain job yet/.test(idle.text), "wait tanpa job menjawab 'No brain job yet'");
  const standby = await api("GET", "/llm/status");
  check(standby.state === "ok" && standby.model === "claude-code", `status: standby sebagai "${standby.model}"`);

  // ---------- 4. happy path: Agent 1 explore answered by the "agent" ----------

  const project = await api("POST", "/projects", { prompt: "aplikasi kas kelas dengan pengingat WhatsApp" });
  const explore = runAgent(`/projects/${project.id}/agents/idea/explore`);

  const job = await tool("wait_for_brain_job", { wait_seconds: 20 });
  const jobId = /job (b[0-9a-f]+)/.exec(job.text)?.[1];
  check(!!jobId, `job diterima (${jobId})`);
  check(job.text.includes("## SYSTEM") && job.text.includes("idea.explore"), "job berisi SYSTEM prompt Agent 1");
  check(job.text.includes("aplikasi kas kelas"), "job berisi INPUT ide pengguna");

  const answer = {
    title: "KasKelas",
    tagline: "Kas kelas rapi tanpa tagih manual",
    summary: "Bendahara mencatat iuran, orang tua menerima pengingat otomatis.",
    problem: "Bendahara repot menagih iuran satu per satu.",
    directions: [{ id: "d1", title: "Fokus bendahara", pitch: "Alat catat paling cepat.", why: "Pengguna utama." }],
    dimensions: [
      {
        id: "platform",
        label: "Platform",
        question: "Di mana dipakai?",
        multi: true,
        options: [
          { id: "o1", label: "Web", detail: "Bisa dibuka di HP." },
          { id: "o2", label: "Android", detail: "Aplikasi native." },
        ],
      },
    ],
  };
  // Agents sometimes wrap JSON in prose; BWA's extractJson must still find it.
  const submitted = await tool("submit_brain_result", { job_id: jobId, output: `Berikut hasilnya:\n${JSON.stringify(answer)}` });
  check(!submitted.isError && /delivered/.test(submitted.text), "submit_brain_result diterima");

  const exploreResult = await explore;
  check(exploreResult.last.type === "done", `run Agent 1 selesai (${exploreResult.last.type})`);
  check(exploreResult.statuses.some((s) => s.includes("claude-code mengambil job")), "UI melihat status 'claude-code mengambil job'");
  const saved = await api("GET", `/projects/${project.id}`);
  check(saved.idea?.title === "KasKelas" && saved.idea.dimensions[0].options.length === 2, "hasil tersimpan di proyek");

  const late = await tool("submit_brain_result", { job_id: jobId, output: "{}" });
  check(late.isError && /sudah tidak menunggu/.test(late.text), "submit ganda ditolak dengan pesan jelas");

  // ---------- 5. failure path: the agent gives up ----------

  const more = runAgent(`/projects/${project.id}/agents/idea/more`, { dimensionId: "platform" });
  const job2 = await tool("wait_for_brain_job", { wait_seconds: 20 });
  const job2Id = /job (b[0-9a-f]+)/.exec(job2.text)?.[1];
  check(job2.text.includes("idea.more"), "job kedua: Agent 1 'more options'");
  await tool("fail_brain_job", { job_id: job2Id, reason: "uji jalur gagal" });
  const moreResult = await more;
  check(moreResult.last.type === "error" && moreResult.last.message.includes("uji jalur gagal"), "UI menerima alasan kegagalan dari agent");

  // ---------- 6. the Settings round-trip test ----------

  const ping = api("POST", "/settings/test-brain", {});
  const job3 = await tool("wait_for_brain_job", { wait_seconds: 20 });
  await tool("submit_brain_result", { job_id: /job (b[0-9a-f]+)/.exec(job3.text)?.[1], output: "OK" });
  const pingResult = await ping;
  check(pingResult.ok && pingResult.reply === "OK" && pingResult.model === "mcp:claude-code", "Tes otak MCP di Pengaturan berhasil");

  // ---------- 7. handover: Agent 3 splits the tasks, then the brain session becomes the coding agent ----------

  await api("PATCH", `/projects/${project.id}`, {
    brief: { name: "KasKelas", oneLiner: "Kas kelas rapi", techStack: ["Next.js"], keyCapabilities: ["Catat iuran"] },
  });
  await api("PUT", `/projects/${project.id}/topology`, {
    direction: "LR",
    nodes: [
      { id: "app", label: "KasKelas", kind: "product" },
      { id: "iuran", label: "Catat iuran", kind: "feature", parentId: "app", priority: "must" },
    ],
    links: [],
  });
  const plan = {
    phases: [{ id: "P1", name: "Fondasi", goal: "Kerangka aplikasi" }],
    tasks: [
      { id: "T01", title: "Siapkan repository Next.js", description: "Inisialisasi proyek.", phaseId: "P1", featureIds: ["app"], type: "setup", acceptance: ["npm run dev jalan"] },
      { id: "T02", title: "Form catat iuran", description: "Form iuran.", phaseId: "P1", featureIds: ["iuran"], type: "frontend", dependsOn: ["T01"], acceptance: ["Iuran tersimpan"] },
    ],
  };

  /** Runs Agent 3 with the brain answering, and returns what the brain session receives next. */
  const splitTasks = async () => {
    const run = runAgent(`/projects/${project.id}/agents/tasks/generate`);
    const job = await tool("wait_for_brain_job", { wait_seconds: 20 });
    check(job.text.includes("tasks.generate"), "job Agent 3 'tasks.generate' diterima");
    // Another standby session polls meanwhile: it must not steal the handover meant for claude-code.
    const other = api("POST", "/agent/brain/wait", { agent: "codex", waitSec: 3 });
    await tool("submit_brain_result", { job_id: /job (b[0-9a-f]+)/.exec(job.text)?.[1], output: JSON.stringify(plan) });
    const result = await run;
    check(result.last.type === "done" && result.last.result.tasks.length === 2, "task terbentuk (2 task)");
    check(!(await other).job, "sesi lain (codex) tidak mengambil serah-terima milik claude-code");
    return (await tool("wait_for_brain_job", { wait_seconds: 10 })).text;
  };

  const waitHandover = await splitTasks();
  check(waitHandover.startsWith("# BWA handover") && waitHandover.includes(project.id), "claude-code menerima serah-terima berisi project_id");
  check(/Mulai dari T01\?/.test(waitHandover) && /Do not start coding/.test(waitHandover), "mode 'tunggu perintah': lapor lalu tanya");
  check(/First ready task: T01/.test(waitHandover), "serah-terima menyebut task pertama yang siap");
  const afterHandover = await api("GET", `/projects/${project.id}`);
  check(afterHandover.activity.some((a) => a.by === "claude-code" && /menerima serah-terima/.test(a.text)), "feed aktivitas mencatat serah-terima diterima");
  const retired = await api("GET", "/brain/status");
  check(!retired.workers.some((w) => w.name === "claude-code"), "claude-code tidak lagi dihitung standby setelah serah-terima");

  await api("PUT", "/settings", { handover: "auto" });
  const autoHandover = await splitTasks();
  check(/Start right away/.test(autoHandover) && !/Do not start coding/.test(autoHandover), "mode 'langsung kerjakan': mulai tanpa menunggu");
} catch (err) {
  failures++;
  console.error("✗ error:", err?.message ?? err);
} finally {
  await cleanup(client);
}

console.log(failures ? `\n${failures} pemeriksaan gagal.` : "\nSemua pemeriksaan lolos.");
process.exit(failures ? 1 : 0);
