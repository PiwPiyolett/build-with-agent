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
    try {
      execFile(
        shim ? `"${exe}"` : exe,
        shim ? args.map((a) => `"${a}"`) : args,
        { timeout: timeoutMs, windowsHide: true, shell: shim, encoding: "utf8" },
        (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` }),
      );
    } catch (err) {
      // A damaged or half-downloaded executable can throw here instead of reporting through the callback.
      resolve({ ok: false, out: (err as Error).message });
    }
  });
}

// ---------- Claude Code ----------

/** Newest first, by numeric version folder name (2.1.286 before 2.1.40). */
const newestFirst = (names: string[]) => [...names].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

const appData = () => process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
/** The Microsoft Store build of the desktop app keeps its data per package under %LOCALAPPDATA%\Claude-Data. */
const storeData = () => path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Claude-Data");
const subfolders = (dir: string) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/** Where the Claude desktop app keeps its copy of Claude Code. */
function desktopRoots(): string[] {
  if (process.platform === "win32") {
    return [path.join(appData(), "Claude", "claude-code"), ...subfolders(storeData()).map((pkg) => path.join(storeData(), pkg, "claude-code"))];
  }
  if (process.platform === "darwin") return [path.join(home, "Library", "Application Support", "Claude", "claude-code")];
  return [path.join(home, ".config", "Claude", "claude-code")];
}

/** The desktop app can be installed before its copy of Claude Code exists, which arrives once the Code tab is used. */
function claudeAppFound(): boolean {
  if (process.platform === "win32") return subfolders(storeData()).length > 0 || fs.existsSync(path.join(appData(), "Claude"));
  if (process.platform === "darwin") return ["/Applications/Claude.app", path.join(home, "Applications", "Claude.app")].some((p) => fs.existsSync(p));
  return fs.existsSync(path.join(home, ".config", "Claude"));
}

/** The claude CLI: an explicit override, PATH, then the copy bundled with the Claude desktop app. */
export function findClaude(): string | null {
  const override = process.env.BWA_CLAUDE_PATH;
  if (override && isFile(override)) return override;

  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) if (isFile(path.join(dir, name))) return path.join(dir, name);
  }

  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  for (const root of desktopRoots()) {
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

/**
 * How long one wait_for_brain_job call blocks. Every call that comes back empty costs the user a model turn, so
 * longer is cheaper. Claude Code moves an MCP call still running after two minutes to the background, which would
 * break the loop, so this stays well under that. MAX_WAIT_SEC in brainQueue.ts must allow it.
 */
const BRAIN_WAIT_SEC = 100;

function bridgeEnv(bridge: BridgeInfo): Record<string, string> {
  return { ...bridge.commandEnv, BWA_URL: bridge.apiUrl, BWA_WAIT_SEC: String(BRAIN_WAIT_SEC) };
}

/** Only ever deletes BWA's own skills/bwa folder. */
function removeSkillFolder(target: string) {
  const dir = path.dirname(target);
  if (path.basename(dir) === "bwa" && path.basename(path.dirname(dir)) === "skills") fs.rmSync(dir, { recursive: true, force: true });
}

/** `claude mcp add` arguments. The name precedes --env: that option is variadic and would swallow it. */
function claudeAddArgs(bridge: BridgeInfo): string[] {
  const env = Object.entries(bridgeEnv(bridge)).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
  return ["mcp", "add", "bwa", "--scope", "user", "--transport", "stdio", ...env, "--", bridge.command, bridge.mcpServerPath];
}

const display = (args: string[]) => `claude ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`;

/** A terminal install's login. Only a JSON answer counts: an older CLI without this command also fails, which says nothing. */
async function claudeSignedIn(exe: string): Promise<boolean | null> {
  const got = await run(exe, ["auth", "status"], 15_000);
  try {
    JSON.parse(/\{[\s\S]*\}/.exec(got.out)?.[0] ?? "");
    return got.ok;
  } catch {
    return null;
  }
}

export async function claudeStatus(bridge: BridgeInfo): Promise<AgentConnection> {
  const exe = findClaude();
  const changes = [`Menjalankan: ${display(claudeAddArgs(bridge))}`, `Memasang perintah /bwa di ${skillTarget()}`];
  if (!exe) {
    const appFound = claudeAppFound();
    return {
      agent: "claude",
      found: false,
      appFound,
      state: "disconnected",
      detail: "",
      changes,
      message: appFound
        ? "Aplikasi Claude sudah terpasang. Buka aplikasinya, masuk ke akunmu, lalu buka tab Code sekali."
        : "Claude belum terpasang di komputer ini.",
    };
  }
  const via = desktopRoots().some((root) => exe.startsWith(root + path.sep)) ? "app" : "cli";
  const [got, signedIn] = await Promise.all([run(exe, ["mcp", "get", "bwa"]), via === "app" ? null : claudeSignedIn(exe)]);
  // Registered for this BWA only if the entry runs this install's bridge (paths compared loosely: slashes, case).
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  const ours = [bridge.mcpServerPath, bridge.command, `BWA_WAIT_SEC=${BRAIN_WAIT_SEC}`].every((part) => norm(got.out).includes(norm(part)));
  return {
    agent: "claude",
    found: true,
    appFound: via === "app" || claudeAppFound(),
    via,
    signedIn,
    state: !got.ok ? "disconnected" : ours ? "connected" : "outdated",
    detail: exe,
    skill: skillCurrent(),
    changes,
  };
}

/** Registers bwa at user scope (every folder) and installs /bwa. Idempotent: an existing entry is replaced. */
export async function connectClaude(bridge: BridgeInfo): Promise<AgentConnection> {
  const exe = findClaude();
  if (!exe) throw new HttpError(404, "Claude belum ditemukan di komputer ini.", "Pasang aplikasi Claude, masuk ke akunmu, buka tab Code sekali, lalu coba lagi.");
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
  removeSkillFolder(skillTarget());
  return claudeStatus(bridge);
}

// ---------- Codex: config.toml, edited only inside its [mcp_servers.bwa] table ----------

const codexHome = () => process.env.CODEX_HOME || path.join(home, ".codex");
export const codexConfig = () => path.join(codexHome(), "config.toml");
const toPosix = (p: string) => p.replace(/\\/g, "/");
/** TOML basic strings share JSON's escapes for the values written here (paths, URLs). */
const tomlString = (s: string) => JSON.stringify(s);

/** The short $bwa command. Codex reads personal skills from ~/.agents/skills, in both the app and the CLI. */
export const codexSkillTarget = () => path.join(home, ".agents", "skills", "bwa", "SKILL.md");
const codexSkill = () => fs.readFileSync(path.join(ROOT_DIR, "plugins", "bwa", "codex", "SKILL.md"), "utf8");

function codexSkillCurrent(): boolean {
  try {
    return fs.readFileSync(codexSkillTarget(), "utf8") === codexSkill();
  } catch {
    return false;
  }
}

function codexBlock(bridge: BridgeInfo): string {
  const env = { ...bridgeEnv(bridge), BWA_AGENT_NAME: "codex" };
  return [
    "[mcp_servers.bwa]",
    `command = ${tomlString(toPosix(bridge.command))}`,
    `args = [${tomlString(toPosix(bridge.mcpServerPath))}]`,
    `env = { ${Object.entries(env)
      .map(([k, v]) => `${k} = ${tomlString(v)}`)
      .join(", ")} }`,
    // Codex gives up on a tool call after 60 seconds unless told otherwise, and that must outlast the wait.
    `tool_timeout_sec = ${BRAIN_WAIT_SEC + 30}`,
    // Waiting for BWA's next request calls these tools again and again, so a prompt each time would be unusable.
    'default_tools_approval_mode = "approve"',
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
  const cli = onPath("codex");
  const found = cli || fs.existsSync(codexHome());
  return {
    agent: "codex",
    found,
    via: !found ? undefined : cli ? "cli" : "app",
    // The ChatGPT app has no way to ask from outside, and the CLI's non-logged-in answer is not documented.
    signedIn: null,
    state: !bwa.trim() ? "disconnected" : bwa.trim() === codexBlock(bridge) ? "connected" : "outdated",
    detail: file,
    skill: codexSkillCurrent(),
    changes: [
      `Menulis bagian [mcp_servers.bwa] di ${file} (salinan sebelumnya disimpan sebagai config.toml.bak-bwa)`,
      `Memasang perintah $bwa di ${codexSkillTarget()}`,
    ],
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
  fs.mkdirSync(path.dirname(codexSkillTarget()), { recursive: true });
  fs.writeFileSync(codexSkillTarget(), codexSkill());
  return codexStatus(bridge);
}

export function disconnectCodex(bridge: BridgeInfo): AgentConnection {
  if (fs.existsSync(codexConfig())) rewriteCodexConfig("");
  removeSkillFolder(codexSkillTarget());
  return codexStatus(bridge);
}
