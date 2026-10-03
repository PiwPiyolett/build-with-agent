#!/usr/bin/env node
// BWA CLI: the same task workflow as the MCP server, for agents that only have a shell.
//   node bridge/cli.mjs next --claim --agent codex
//   node bridge/cli.mjs done T03 --summary "Built the login form" --files "src/login.tsx,src/api.ts"

import { call, BwaError, resolveProjectId, withWarnings } from "./client.mjs";

const HELP = `BWA CLI · ambil task dari BWA dan centang setelah selesai

Pemakaian: node bridge/cli.mjs <perintah> [argumen] [--project p_xxx] [--agent nama] [--json]

Perintah:
  projects                          daftar proyek
  context                           brief, peta fitur, progres, aturan kerja
  prd                               PRD proyek (jika sudah ditulis)
  tasks [--status open|todo|in_progress|blocked|done|all]
  next [--claim]                    task berikutnya (dan klaim untukmu)
  show <TASK>                       detail satu task
  claim <TASK> [--force]            klaim task tertentu
  note <TASK> "catatan"             kirim catatan progres
  done <TASK> --summary "..." [--files a.ts,b.ts]
                                    tandai selesai (centang)
  block <TASK> --reason "..."       tandai terhambat
  release <TASK> [--note "..."]     kembalikan ke antrean
  add "judul" [--description "..."] [--depends T01,T02] [--priority high|medium|low]

Env: BWA_URL (default http://127.0.0.1:3900), BWA_PROJECT_ID, BWA_AGENT_NAME`;

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
      const next = argv[i + 1];
      if (inline !== undefined) flags[key] = inline;
      else if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(arg);
  }
  return { positional, flags };
}

const list = (value) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

async function main() {
  const { positional, flags } = parse(process.argv.slice(2));
  const [command, ...rest] = positional;
  if (!command || flags.help || command === "help") {
    console.log(HELP);
    return;
  }
  const agent = String(flags.agent || process.env.BWA_AGENT_NAME || "cli-agent");
  const needTask = () => {
    if (!rest[0]) throw new BwaError(`Perintah "${command}" butuh ID task, mis. T03.`);
    return encodeURIComponent(rest[0]);
  };
  const pid = async () => resolveProjectId(flags.project);

  let result;
  switch (command) {
    case "projects":
      result = await call("GET", "/projects", undefined, agent);
      break;
    case "context":
      result = await call("GET", `/projects/${await pid()}/context`, undefined, agent);
      break;
    case "prd":
      result = await call("GET", `/projects/${await pid()}/prd`, undefined, agent);
      break;
    case "tasks":
      result = await call("GET", `/projects/${await pid()}/tasks?status=${flags.status || "all"}`, undefined, agent);
      break;
    case "next":
      result = flags.claim
        ? await call("POST", `/projects/${await pid()}/tasks/next`, { agent }, agent)
        : await call("GET", `/projects/${await pid()}/tasks/next?agent=${encodeURIComponent(agent)}`, undefined, agent);
      break;
    case "show":
      result = await call("GET", `/projects/${await pid()}/tasks/${needTask()}`, undefined, agent);
      break;
    case "claim":
      result = await call("POST", `/projects/${await pid()}/tasks/${needTask()}/claim`, { agent, force: !!flags.force }, agent);
      break;
    case "note":
      result = await call("POST", `/projects/${await pid()}/tasks/${needTask()}/note`, { agent, text: rest.slice(1).join(" ") || flags.text }, agent);
      break;
    case "done":
    case "complete":
      if (!flags.summary || flags.summary === true) throw new BwaError('Tambahkan --summary "apa yang dikerjakan".');
      result = await call(
        "POST",
        `/projects/${await pid()}/tasks/${needTask()}/complete`,
        { agent, summary: flags.summary, files: list(flags.files) },
        agent,
      );
      break;
    case "block":
      if (!flags.reason || flags.reason === true) throw new BwaError('Tambahkan --reason "apa yang menghambat".');
      result = await call("POST", `/projects/${await pid()}/tasks/${needTask()}/block`, { agent, reason: flags.reason }, agent);
      break;
    case "release":
      result = await call("POST", `/projects/${await pid()}/tasks/${needTask()}/release`, { agent, note: flags.note || "" }, agent);
      break;
    case "add":
      if (!rest[0]) throw new BwaError('Tulis judul task, mis. add "Tambah halaman profil".');
      result = await call(
        "POST",
        `/projects/${await pid()}/tasks`,
        {
          agent,
          title: rest.join(" "),
          description: flags.description || "",
          dependsOn: list(flags.depends),
          priority: flags.priority,
        },
        agent,
      );
      break;
    default:
      throw new BwaError(`Perintah tidak dikenal: ${command}\n\n${HELP}`);
  }
  console.log(flags.json ? JSON.stringify(result, null, 2) : withWarnings(result));
}

main().catch((err) => {
  console.error(err instanceof BwaError ? err.message : err);
  process.exit(1);
});
