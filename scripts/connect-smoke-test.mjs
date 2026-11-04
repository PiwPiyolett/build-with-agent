// Integration test for "Sambungkan otomatis": BWA registers itself in Claude Code and Codex.
// Runs a private BWA server whose CLAUDE_CONFIG_DIR and CODEX_HOME point at throwaway folders,
// and checks the outcome through the real consumers (`claude mcp get bwa`, Codex's config.toml).
// Your own Claude Code / Codex configuration is never touched.
//   node scripts/connect-smoke-test.mjs

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.SMOKE_PORT || 3912);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-connect-smoke-"));
const claudeHome = path.join(tmp, "claude");
const codexHome = path.join(tmp, "codex");
const userHome = path.join(tmp, "home");
const dataDir = path.join(tmp, "data");
for (const dir of [claudeHome, codexHome, userHome, dataDir]) fs.mkdirSync(dir, { recursive: true });
// Variables passed down by a parent Claude session would make `claude auth status` report that session's login.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k)));
const isolatedEnv = { ...cleanEnv, CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: codexHome, USERPROFILE: userHome, HOME: userHome };

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

/** The real Claude Code, as BWA itself finds it (read from the first status). */
let claude = null;
/** What Claude Code itself reports for the bwa server in the isolated config, or null when absent. */
function claudeGetBwa() {
  try {
    return execFileSync(claude, ["mcp", "get", "bwa"], { env: isolatedEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  cwd: ROOT,
  env: { ...isolatedEnv, PORT: String(PORT), BWA_DATA_DIR: dataDir },
  stdio: "ignore",
});
const apiAt = (port) => async (method, p, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const api = apiAt(PORT);

async function waitUp(call) {
  for (let i = 0; ; i++) {
    try {
      if ((await call("GET", "/health")).body?.ok) return;
    } catch {
      /* not up yet */
    }
    if (i > 80) throw new Error("server BWA tidak menyala");
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** One more private server with its own environment, for a machine layout the real one does not have. */
async function scenario(port, env, run) {
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: { ...env, PORT: String(port), BWA_DATA_DIR: dataDir },
    stdio: "ignore",
  });
  try {
    const call = apiAt(port);
    await waitUp(call);
    await run(call);
  } finally {
    child.kill();
  }
}

try {
  await waitUp(api);

  // ---------- 0a. Claude Code bundled with the Microsoft Store build of the desktop app ----------
  if (process.platform === "win32") {
    const machine = path.join(tmp, "store-machine");
    const pkg = path.join(machine, "Local", "Claude-Data", "claude_test");
    fs.mkdirSync(pkg, { recursive: true });
    const noClaude = Object.fromEntries(Object.entries(isolatedEnv).filter(([k]) => !/^(path|appdata|localappdata|bwa_claude_path)$/i.test(k)));
    const env = {
      ...noClaude,
      PATH: "",
      APPDATA: path.join(machine, "Roaming"),
      LOCALAPPDATA: path.join(machine, "Local"),
      USERPROFILE: machine,
      HOME: machine,
    };
    await scenario(PORT + 1, env, async (call) => {
      const notReady = (await call("GET", "/connect")).body?.claude;
      check(notReady?.found === false && notReady?.appFound === true, "aplikasi Claude terpasang, tapi Claude Code di dalamnya belum ada");
      const exe = path.join(pkg, "claude-code", "2.1.9", "abc123", "claude.exe");
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.writeFileSync(exe, "");
      const found = (await call("GET", "/connect")).body?.claude;
      check(found?.found === true && found?.detail === exe, `Claude Code versi Microsoft Store ditemukan (dapat: ${found?.detail})`);
      check(found?.via === "app", `jalurnya dikenali sebagai aplikasi (dapat: ${found?.via})`);
      // Outside the app, `claude auth status` says logged out even when the app is signed in, so it proves nothing here.
      check(found?.signedIn === null, `status login aplikasi tidak dianggap pasti (dapat: ${found?.signedIn})`);
    });
  }

  // ---------- 0b. sign-in state of a terminal install, through a stand-in CLI ----------
  {
    const dir = path.join(tmp, "fake-cli");
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, "signed-in");
    const win = process.platform === "win32";
    const exe = path.join(dir, win ? "claude.cmd" : "claude");
    fs.writeFileSync(
      exe,
      win
        ? `@echo off\r\nif not "%~1"=="auth" exit /b 1\r\nif exist "${marker}" (echo {"authMethod":"claude.ai"}& exit /b 0)\r\necho {"authMethod":"none"}& exit /b 1\r\n`
        : `#!/bin/sh\n[ "$1" = auth ] || exit 1\nif [ -e "${marker}" ]; then echo '{"authMethod":"claude.ai"}'; exit 0; fi\necho '{"authMethod":"none"}'; exit 1\n`,
    );
    fs.chmodSync(exe, 0o755);
    await scenario(PORT + 2, { ...isolatedEnv, BWA_CLAUDE_PATH: exe }, async (call) => {
      const out = (await call("GET", "/connect")).body?.claude;
      check(out?.via === "cli" && out?.signedIn === false, `CLI belum login terbaca (via ${out?.via}, signedIn ${out?.signedIn})`);
      fs.writeFileSync(marker, "");
      const inn = (await call("GET", "/connect")).body?.claude;
      check(inn?.signedIn === true, `CLI sudah login terbaca (signedIn ${inn?.signedIn})`);
    });
  }

  // ---------- 1. status before anything is connected ----------
  const before = await api("GET", "/connect");
  claude = before.body?.claude?.detail || null;
  if (!claude) throw new Error("Claude Code tidak ditemukan di komputer ini; tes Claude tidak bisa dijalankan.");
  check(before.status === 200, `GET /api/connect menjawab (HTTP ${before.status})`);
  check(before.body?.claude?.found === true, "Claude Code terdeteksi oleh BWA");
  check(before.body?.claude?.state === "disconnected", `Claude: belum tersambung (dapat: ${before.body?.claude?.state})`);
  check(Array.isArray(before.body?.claude?.changes) && before.body.claude.changes.length > 0, "Claude: pratinjau perubahan tersedia");

  // ---------- 2. connect Claude Code ----------
  const bridge = (await api("GET", "/bridge")).body;
  const connected = await api("POST", "/connect/claude", {});
  check(connected.status === 200 && connected.body?.state === "connected", `Sambungkan Claude: state ${connected.body?.state}`);
  const got = claudeGetBwa();
  check(!!got && got.includes(bridge.mcpServerPath), "claude mcp get bwa: terdaftar dengan jalur bridge BWA ini");
  check(!!got && /Scope: User/i.test(got), "terdaftar di scope user (berlaku di semua folder)");
  check(!!got && got.includes("BWA_WAIT_SEC=100"), "asisten menunggu 100 detik sebelum bertanya lagi");
  const skill = path.join(claudeHome, "skills", "bwa", "SKILL.md");
  // The plugin ships the skill as `start` (/bwa:start); a personal copy is renamed so it runs as /bwa.
  const repoSkill = fs.readFileSync(path.join(ROOT, "plugins", "bwa", "skills", "start", "SKILL.md"), "utf8");
  const installed = fs.existsSync(skill) ? fs.readFileSync(skill, "utf8") : "";
  check(/^name: bwa$/m.test(installed), "salinan pribadi bernama 'bwa' (dipanggil /bwa)");
  check(installed.replace(/^name: .*$/m, "") === repoSkill.replace(/^name: .*$/m, ""), "isi perintah /bwa sama dengan skill plugin di repo");
  const afterConnect = (await api("GET", "/connect")).body?.claude;
  check(afterConnect?.state === "connected" && afterConnect?.skill === true, "status: tersambung dan /bwa terpasang");

  // ---------- 3. registered, but for an old BWA location ----------
  const cli = (args) => execFileSync(claude, args, { env: isolatedEnv, stdio: "ignore" });
  cli(["mcp", "remove", "bwa", "--scope", "user"]);
  cli(["mcp", "add", "bwa", "--scope", "user", "--transport", "stdio", "--", "node", "C:/BWA-lama/bridge/mcp-server.mjs"]);
  const stale = (await api("GET", "/connect")).body?.claude;
  check(stale?.state === "outdated", `jalur lama terdeteksi 'outdated' (dapat: ${stale?.state})`);
  const fixed = await api("POST", "/connect/claude", {});
  check(fixed.body?.state === "connected", "Sambungkan ulang memperbaikinya");
  const gotFixed = claudeGetBwa();
  check(!!gotFixed && gotFixed.includes(bridge.mcpServerPath) && !gotFixed.includes("BWA-lama"), "entri lama diganti, bukan diduplikasi");
  // Connected by an older BWA: right path, but it still asks every 40 seconds and uses up the user's quota.
  cli(["mcp", "remove", "bwa", "--scope", "user"]);
  cli(["mcp", "add", "bwa", "--scope", "user", "--transport", "stdio", "--", bridge.command, bridge.mcpServerPath]);
  const noWait = (await api("GET", "/connect")).body?.claude;
  check(noWait?.state === "outdated", `sambungan tanpa waktu tunggu perlu diperbarui (dapat: ${noWait?.state})`);
  await api("POST", "/connect/claude", {});

  // ---------- 4. disconnect Claude Code ----------
  const removed = await api("DELETE", "/connect/claude");
  check(removed.status === 200 && removed.body?.state === "disconnected", `Lepaskan Claude: state ${removed.body?.state}`);
  check(claudeGetBwa() === null, "claude mcp get bwa: tidak terdaftar lagi");
  check(!fs.existsSync(path.dirname(skill)), "folder perintah /bwa dihapus");
  check(fs.existsSync(path.join(claudeHome, ".claude.json")), "konfigurasi Claude lainnya tetap ada");

  // ---------- 5. connect Codex with no config.toml yet ----------
  const toml = path.join(codexHome, "config.toml");
  const codexBefore = (await api("GET", "/connect")).body?.codex;
  check(codexBefore?.state === "disconnected", `Codex: belum tersambung (dapat: ${codexBefore?.state})`);
  const codexOn = await api("POST", "/connect/codex", {});
  check(codexOn.status === 200 && codexOn.body?.state === "connected", `Sambungkan Codex: state ${codexOn.body?.state}`);
  const written = fs.existsSync(toml) ? fs.readFileSync(toml, "utf8") : "";
  const slash = (p) => p.replace(/\\/g, "/");
  check(/^\[mcp_servers\.bwa\]$/m.test(written), "config.toml berisi [mcp_servers.bwa]");
  check(written.includes(`command = "${slash(bridge.command)}"`), "command menunjuk ke runtime bridge BWA");
  check(written.includes(`args = ["${slash(bridge.mcpServerPath)}"]`), "args menunjuk ke mcp-server.mjs BWA ini");
  check(written.includes(`BWA_URL = "${bridge.apiUrl}"`) && written.includes('BWA_AGENT_NAME = "codex"'), "env berisi BWA_URL dan BWA_AGENT_NAME");
  check(written.includes('BWA_WAIT_SEC = "100"') && /^tool_timeout_sec = 130$/m.test(written), "Codex diberi waktu tunggu 100 detik, dengan batas alat yang lebih longgar");
  check(/^default_tools_approval_mode = "approve"$/m.test(written), "alat BWA tidak meminta izin di setiap panggilan");
  const codexSkill = path.join(userHome, ".agents", "skills", "bwa", "SKILL.md");
  const codexSkillText = fs.existsSync(codexSkill) ? fs.readFileSync(codexSkill, "utf8") : "";
  check(/^name: bwa$/m.test(codexSkillText) && /wait_for_brain_job/.test(codexSkillText), "perintah pendek $bwa terpasang untuk Codex");
  check(codexOn.body?.skill === true, "status Codex: perintah $bwa terpasang");
  check(codexOn.body?.signedIn === null, "status login Codex tidak dianggap pasti");
  fs.rmSync(codexSkill);
  check((await api("GET", "/connect")).body?.codex?.skill === false, "perintah $bwa yang hilang terdeteksi");
  await api("POST", "/connect/codex", {});
  check(fs.existsSync(codexSkill), "Hubungkan ulang memasang lagi perintah $bwa");
  const otherSkill = path.join(userHome, ".agents", "skills", "punya-guru", "SKILL.md");
  fs.mkdirSync(path.dirname(otherSkill), { recursive: true });
  fs.writeFileSync(otherSkill, "punya orang lain");
  // Optional, needs the network: the real Codex CLI must read the table BWA wrote.
  if (process.env.BWA_TEST_CODEX === "1") {
    let codexSays = "";
    try {
      codexSays = execFileSync("npx", ["-y", "@openai/codex", "mcp", "get", "bwa"], {
        env: isolatedEnv,
        encoding: "utf8",
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      codexSays = String(err?.stdout ?? err?.message ?? err);
    }
    check(/enabled: true/.test(codexSays) && codexSays.includes(slash(bridge.mcpServerPath)), "Codex CLI sungguhan membaca bwa: enabled, jalur bridge benar");
  }

  // ---------- 6. a real-world config.toml: other settings stay, an old bwa table is replaced ----------
  const userConfig = [
    'model = "gpt-5-codex"',
    "",
    "[mcp_servers.other]",
    'command = "other-server"',
    "",
    "[mcp_servers.bwa]",
    'command = "node"',
    'args = ["C:/BWA-lama/bridge/mcp-server.mjs"]',
    "",
    "[mcp_servers.bwa.env]",
    'BWA_URL = "http://127.0.0.1:3900"',
    "",
    "[profiles.fast]",
    'model = "gpt-5-mini"',
    "",
  ].join("\n");
  fs.writeFileSync(toml, userConfig);
  check((await api("GET", "/connect")).body?.codex?.state === "outdated", "Codex: blok bwa lama terdeteksi 'outdated'");
  await api("POST", "/connect/codex", {});
  const merged = fs.readFileSync(toml, "utf8");
  // Connected by an older BWA: right path, but without the wait and approval settings.
  const olderBlock = `[mcp_servers.bwa]\ncommand = "${slash(bridge.command)}"\nargs = ["${slash(bridge.mcpServerPath)}"]\n`;
  fs.writeFileSync(toml, olderBlock);
  check((await api("GET", "/connect")).body?.codex?.state === "outdated", "Codex: sambungan tanpa waktu tunggu perlu diperbarui");
  fs.writeFileSync(toml, merged);
  check(merged.startsWith('model = "gpt-5-codex"'), "pengaturan model di atas tetap ada");
  check(merged.includes('[mcp_servers.other]\ncommand = "other-server"'), "MCP server lain tidak tersentuh");
  check(merged.includes('[profiles.fast]\nmodel = "gpt-5-mini"'), "profile setelah blok bwa tetap ada");
  check(!merged.includes("BWA-lama") && !merged.includes("[mcp_servers.bwa.env]"), "blok bwa lama (beserta sub-tabelnya) diganti");
  check((merged.match(/^\[mcp_servers\.bwa\]$/gm) ?? []).length === 1, "hanya ada satu [mcp_servers.bwa]");
  check(fs.existsSync(`${toml}.bak-bwa`) && fs.readFileSync(`${toml}.bak-bwa`, "utf8") === userConfig, "salinan sebelum diubah tersimpan di config.toml.bak-bwa");

  // ---------- 7. disconnect Codex: only the bwa table goes ----------
  const codexOff = await api("DELETE", "/connect/codex");
  check(codexOff.body?.state === "disconnected", `Lepaskan Codex: state ${codexOff.body?.state}`);
  const left = fs.readFileSync(toml, "utf8");
  check(!left.includes("[mcp_servers.bwa]"), "blok [mcp_servers.bwa] hilang");
  check(left.includes('model = "gpt-5-codex"') && left.includes("[mcp_servers.other]") && left.includes("[profiles.fast]"), "pengaturan lain tetap utuh");
  check(!fs.existsSync(path.dirname(codexSkill)), "folder perintah $bwa dihapus");
  check(fs.existsSync(otherSkill), "skill lain milik pengguna tidak tersentuh");
} catch (err) {
  failures++;
  console.error("✗ error:", err?.message ?? err);
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} pemeriksaan gagal.` : "\nSemua pemeriksaan lolos.");
process.exit(failures ? 1 : 0);
