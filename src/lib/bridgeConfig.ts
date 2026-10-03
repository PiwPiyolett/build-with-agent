import type { HandoverMode } from "../../shared/types";
import type { BridgeInfo } from "./api";

/**
 * Ready-to-paste configs that register the bwa MCP server. `env` adds variables such as BWA_PROJECT_ID.
 * `userScope` registers it for every folder (brain mode); otherwise only for the folder the command runs in.
 */
export function mcpConfigs(bridge: BridgeInfo | null, env: Record<string, string> = {}, userScope = false) {
  const url = bridge?.apiUrl ?? "http://127.0.0.1:3900";
  const mcp = bridge?.mcpServerPath ?? "<folder BWA>/bridge/mcp-server.mjs";
  const cli = bridge?.cliPath ?? "<folder BWA>/bridge/cli.mjs";
  // In the desktop app the bridge runs on BWA.exe itself (ELECTRON_RUN_AS_NODE), so agents need no Node install.
  const command = bridge?.command ?? "node";
  const fullEnv: Record<string, string> = { ...(bridge?.commandEnv ?? {}), BWA_URL: url, ...env };
  const quotedCommand = command === "node" ? "node" : `"${command}"`;
  // The server name must come before --env: that option takes several values and would swallow it.
  const claude = `claude mcp add bwa${userScope ? " --scope user" : ""} --transport stdio ${Object.entries(fullEnv)
    .map(([k, v]) => `--env ${k}=${v}`)
    .join(" ")} -- ${quotedCommand} "${mcp}"`;
  const codex = `[mcp_servers.bwa]
command = "${command}"
args = ["${mcp}"]
env = { ${Object.entries({ ...fullEnv, BWA_AGENT_NAME: "codex" })
    .map(([k, v]) => `${k} = "${v}"`)
    .join(", ")} }`;
  const json = JSON.stringify({ mcpServers: { bwa: { command, args: [mcp], env: fullEnv } } }, null, 2);
  return { url, mcp, cli, claude, codex, json };
}

/** Same loop as the jadi_otak MCP prompt, for clients that do not expose MCP prompts as commands (Codex). */
export const BRAIN_STARTER =
  "Jadilah otak AI untuk aplikasi BWA lewat MCP server bwa. Ulangi terus: panggil wait_for_brain_job; " +
  "kalau belum ada job, langsung panggil lagi; kalau ada job, jawab persis sesuai bagian SYSTEM dengan data INPUT " +
  "(biasanya satu objek JSON tanpa komentar), kirim dengan submit_brain_result, lalu tunggu job berikutnya. " +
  "Untuk job otak, jangan membaca atau mengubah file dan jangan memakai tool lain. " +
  'Kalau yang datang adalah "BWA handover", berhenti memanggil wait_for_brain_job dan ikuti instruksinya: ' +
  "kamu menjadi agent coding untuk proyek itu di folder ini. Selain itu, berhenti hanya kalau aku minta. " +
  "Kalau aku menyela untuk ganti model (/model), lanjutkan putaran wait_for_brain_job setelah aku bilang lanjut; " +
  "job yang masuk selama jeda masih menunggu di antrean BWA.";

export const HANDOVER_OPTIONS: { value: HandoverMode; label: string }[] = [
  { value: "wait", label: "Tunggu perintahku" },
  { value: "auto", label: "Langsung kerjakan" },
];

export const HANDOVER_HINT: Record<HandoverMode, string> = {
  wait: "Agent meringkas proyek di chat, lalu menunggu perintahmu sebelum menulis kode.",
  auto: "Agent meringkas singkat, lalu langsung mengerjakan task satu per satu. Kamu tetap bisa menyela lewat chat.",
};
