// "Sambungkan otomatis": registers BWA's MCP bridge in the coding agents on this machine, so users never
// have to type `claude mcp add` themselves. Claude Code is changed only through its own CLI (its config
// format belongs to Claude Code); the /bwa command is a skill file copied into the Claude config folder.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentConnection } from "../shared/types.ts";
import type { BridgeInfo } from "./context.ts";
import { ROOT_DIR, writeFileAtomic } from "./store.ts";
import { HttpError } from "./util.ts";

const home = os.homedir();
const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Runs a CLI without a shell; .cmd/.bat shims (npm installs on Windows) need one, with every argument quoted. */
function run(exe: string, args: string[], timeoutMs = 60_000): Promise<{ ok: boolean; out: string }> {
  const shim = /\.(cmd|bat)$/i.test(exe);
  return new Promise((resolve) => {
    execFile(
      shim ? `"${exe}"` : exe,
      shim ? args.map((a) => `"${a}"`) : args,
      { timeout: timeoutMs, windowsHide: true, shell: shim, encoding: "utf8" },
      (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` }),
    );
  });
}

// ---------- Claude Code ----------

/** Newest first, by numeric version folder name (2.1.286 before 2.1.40). */
const newestFirst = (names: string[]) => [...names].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

/** The claude CLI: an explicit override, PATH, then the copy bundled with the Claude desktop app. */
export function findClaude(): string | null {
  const override = process.env.BWA_CLAUDE_PATH;
  if (override && isFile(override)) return override;

  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) if (isFile(path.join(dir, name))) return path.join(dir, name);
  }

  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const desktopRoots = {
    win32: [path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude", "claude-code")],
    darwin: [path.join(home, "Library", "Application Support", "Claude", "claude-code")],
  }[process.platform as "win32" | "darwin"] ?? [path.join(home, ".config", "Claude", "claude-code")];
  for (const root of desktopRoots) {
    let versions: string[] = [];
    try {
      versions = newestFirst(fs.readdirSync(root));
    } catch {
      continue;
    }
    for (const version of versions) {
      const direct = path.join(root, version, exe);
      if (isFile(direct)) return direct;
      let builds: string[] = [];
      try {
        builds = fs.readdirSync(path.join(root, version));
      } catch {
        continue;
      }
      for (const build of builds) if (isFile(path.join(root, version, build, exe))) return path.join(root, version, build, exe);
    }
  }

  for (const p of [path.join(home, ".local", "bin", exe), path.join(home, ".claude", "local", exe)]) if (isFile(p)) return p;
  return null;
}

const claudeConfigDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
export const skillTarget = () => path.join(claudeConfigDir(), "skills", "bwa", "SKILL.md");
/**
 * The skill is shipped once, in the Claude Code plugin, as `start` (run there as /bwa:start; inside app.asar
 * in the desktop build). Installed as a personal skill it is renamed `bwa`, so it runs as /bwa.
 */
const personalSkill = () =>
  fs.readFileSync(path.join(ROOT_DIR, "plugins", "bwa", "skills", "start", "SKILL.md"), "utf8").replace(/^name: .*$/m, "name: bwa");

function skillCurrent(): boolean {
  try {
    return fs.readFileSync(skillTarget(), "utf8") === personalSkill();
  } catch {
    return false;
  }
}

function bridgeEnv(bridge: BridgeInfo): Record<string, string> {
  return { ...bridge.commandEnv, BWA_URL: bridge.apiUrl };
}

/** `claude mcp add` arguments. The name precedes --env: that option is variadic and would swallow it. */
function claudeAddArgs(bridge: BridgeInfo): string[] {
  const env = Object.entries(bridgeEnv(bridge)).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
  return ["mcp", "add", "bwa", "--scope", "user", "--transport", "stdio", ...env, "--", bridge.command, bridge.mcpServerPath];
}

const display = (args: string[]) => `claude ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`;

export async function claudeStatus(bridge: BridgeInfo): Promise<AgentConnection> {
  const exe = findClaude();
  const changes = [`Menjalankan: ${display(claudeAddArgs(bridge))}`, `Memasang perintah /bwa di ${skillTarget()}`];
  if (!exe) {
    return {
      agent: "claude",
      found: false,
      state: "disconnected",
      detail: "",
      changes,
      message: "Claude Code tidak ditemukan. Pasang Claude Code (CLI atau aplikasi desktop Claude), lalu periksa lagi.",
    };
  }
  const got = await run(exe, ["mcp", "get", "bwa"]);
  // Registered for this BWA only if the entry runs this install's bridge (paths compared loosely: slashes, case).
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  const ours = norm(got.out).includes(norm(bridge.mcpServerPath)) && norm(got.out).includes(norm(bridge.command));
  return {
    agent: "claude",
    found: true,
    state: !got.ok ? "disconnected" : ours ? "connected" : "outdated",
    detail: exe,
    skill: skillCurrent(),
    changes,
  };
}

/** Registers bwa at user scope (every folder) and installs /bwa. Idempotent: an existing entry is replaced. */
export async function connectClaude(bridge: BridgeInfo): Promise<AgentConnection> {
  const exe = findClaude();
  if (!exe) throw new HttpError(404, "Claude Code tidak ditemukan di komputer ini.", "Pasang Claude Code (CLI atau aplikasi desktop Claude), lalu coba lagi.");
  // `mcp add` refuses an existing name, so a stale entry from another install is removed first.
  await run(exe, ["mcp", "remove", "bwa", "--scope", "user"]);
  const added = await run(exe, claudeAddArgs(bridge));
  if (!added.ok) throw new HttpError(500, "Claude Code menolak pendaftaran MCP server bwa.", added.out.trim().slice(0, 400));
  fs.mkdirSync(path.dirname(skillTarget()), { recursive: true });
  fs.writeFileSync(skillTarget(), personalSkill());
  return claudeStatus(bridge);
}

/** Unregisters bwa and removes the /bwa skill folder; the rest of the Claude config is untouched. */
export async function disconnectClaude(bridge: BridgeInfo): Promise<AgentConnection> {
  const exe = findClaude();
  if (exe) await run(exe, ["mcp", "remove", "bwa", "--scope", "user"]);
  const dir = path.dirname(skillTarget());
  // Guard: only ever delete BWA's own skills/bwa folder.
  if (path.basename(dir) === "bwa" && path.basename(path.dirname(dir)) === "skills") fs.rmSync(dir, { recursive: true, force: true });
  return claudeStatus(bridge);
}

// ---------- Codex: config.toml, edited only inside its [mcp_servers.bwa] table ----------

const codexHome = () => process.env.CODEX_HOME || path.join(home, ".codex");
export const codexConfig = () => path.join(codexHome(), "config.toml");
const toPosix = (p: string) => p.replace(/\\/g, "/");
/** TOML basic strings share JSON's escapes for the values written here (paths, URLs). */
const tomlString = (s: string) => JSON.stringify(s);

function codexBlock(bridge: BridgeInfo): string {
  const env = { ...bridgeEnv(bridge), BWA_AGENT_NAME: "codex" };
  return [
    "[mcp_servers.bwa]",
    `command = ${tomlString(toPosix(bridge.command))}`,
    `args = [${tomlString(toPosix(bridge.mcpServerPath))}]`,
    `env = { ${Object.entries(env)
      .map(([k, v]) => `${k} = ${tomlString(v)}`)
      .join(", ")} }`,
  ].join("\n");
}

/** Splits config.toml into everything else and the bwa table (with sub-tables such as [mcp_servers.bwa.env]). */
function splitBwaTable(text: string): { rest: string; bwa: string } {
  const rest: string[] = [];
  const bwa: string[] = [];
  let inBwa = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[/.test(line) ? line.trim() : null;
    if (header) inBwa = header === "[mcp_servers.bwa]" || header.startsWith("[mcp_servers.bwa.");
    (inBwa ? bwa : rest).push(line);
  }
  return { rest: rest.join("\n").trimEnd(), bwa: bwa.join("\n") };
}

function onPath(name: string): boolean {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  return (process.env.PATH ?? "").split(path.delimiter).some((dir) => exts.some((e) => isFile(path.join(dir, name + e))));
}

export function codexStatus(bridge: BridgeInfo): AgentConnection {
  const file = codexConfig();
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    /* no config yet */
  }
  const { bwa } = splitBwaTable(text);
  const ours = bwa.includes(tomlString(toPosix(bridge.mcpServerPath)));
  return {
    agent: "codex",
    found: onPath("codex") || fs.existsSync(codexHome()),
    state: !bwa.trim() ? "disconnected" : ours ? "connected" : "outdated",
    detail: file,
    changes: [`Menulis bagian [mcp_servers.bwa] di ${file} (salinan sebelumnya disimpan sebagai config.toml.bak-bwa)`],
  };
}

function rewriteCodexConfig(bwaTable: string) {
  const file = codexConfig();
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (before) fs.copyFileSync(file, `${file}.bak-bwa`);
  const { rest } = splitBwaTable(before);
  writeFileAtomic(file, [rest, bwaTable].filter(Boolean).join("\n\n") + "\n");
}

export function connectCodex(bridge: BridgeInfo): AgentConnection {
  rewriteCodexConfig(codexBlock(bridge));
  return codexStatus(bridge);
}

export function disconnectCodex(bridge: BridgeInfo): AgentConnection {
  if (fs.existsSync(codexConfig())) rewriteCodexConfig("");
  return codexStatus(bridge);
}
