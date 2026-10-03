// Launch test for the packaged desktop app: starts the unpacked build from release/ (what the installer
// installs), waits for its in-process server, checks the public defaults and the UI, then stops it.
// Runs on Windows, macOS and Linux (CI uses it right after electron-builder).
//   node scripts/launch-test.mjs
// Uses a throwaway data folder and port, so an installed BWA and its data are never touched.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RELEASE = path.join(ROOT, "release");
const PORT = Number(process.env.LAUNCH_PORT || 3990);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-launch-"));

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

/** The app executable inside the unpacked build for this platform. */
function findExecutable() {
  const dirs = fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE) : [];
  if (process.platform === "win32") {
    const exe = path.join(RELEASE, "win-unpacked", "BWA.exe");
    return fs.existsSync(exe) ? exe : null;
  }
  if (process.platform === "darwin") {
    // mac-arm64/ or mac/ (x64): prefer the one matching this machine.
    const order = dirs.filter((d) => /^mac/.test(d)).sort((a) => (a.includes(process.arch) ? -1 : 1));
    for (const d of order) {
      const app = fs.readdirSync(path.join(RELEASE, d)).find((f) => f.endsWith(".app"));
      if (!app) continue;
      const macos = path.join(RELEASE, d, app, "Contents", "MacOS");
      const bin = fs.readdirSync(macos)[0];
      if (bin) return path.join(macos, bin);
    }
    return null;
  }
  const dir = path.join(RELEASE, "linux-unpacked");
  if (!fs.existsSync(dir)) return null;
  const bin = fs.readdirSync(dir).find((f) => /^bwa$/i.test(f));
  return bin ? path.join(dir, bin) : null;
}

const exe = findExecutable();
if (!exe) {
  console.error("✗ build desktop tidak ditemukan di release/. Jalankan electron-builder dulu.");
  process.exit(1);
}
console.log(`menjalankan ${path.relative(ROOT, exe)}`);

const appArgs = ["--hidden", ...(process.platform === "linux" ? ["--no-sandbox"] : [])];
// Linux CI has no display: run under a virtual X server.
const [cmd, args] = process.platform === "linux" && !process.env.DISPLAY ? ["xvfb-run", ["-a", exe, ...appArgs]] : [exe, appArgs];
const child = spawn(cmd, args, {
  env: { ...process.env, BWA_USER_DATA: userData, BWA_PORT: String(PORT), ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));
let exited = null;
child.on("exit", (code, signal) => (exited = `${code ?? signal}`));

const get = async (p) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, { signal: AbortSignal.timeout(3000) });
  return { status: res.status, text: await res.text() };
};

function stop() {
  if (exited !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGKILL"); // the whole group: xvfb-run, Electron and its helpers
    } catch {
      /* already gone */
    }
  }
}

try {
  let health = null;
  for (let i = 0; i < 180 && exited === null; i++) {
    try {
      health = JSON.parse((await get("/api/health")).text);
      if (health?.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  check(exited === null, `aplikasi tetap berjalan${exited === null ? "" : ` (keluar dengan ${exited})`}`);
  check(health?.ok === true && health?.desktop === true, "server di dalam aplikasi menjawab (desktop=true)");

  const settings = JSON.parse((await get("/api/settings")).text);
  check(settings.routerEnabled === false && settings.provider === "mcp", "bawaan publik: otak MCP, 9router tersembunyi");

  const bridge = JSON.parse((await get("/api/bridge")).text);
  check(fs.existsSync(bridge.mcpServerPath), "bridge MCP ada di luar asar (bisa dijalankan agent)");

  const ui = await get("/");
  check(ui.status === 200 && /<div id="root"><\/div>/.test(ui.text), "UI tersaji");
} catch (err) {
  failures++;
  console.error("✗ error:", err?.message ?? err);
} finally {
  stop();
  if (failures) console.log(`\n--- log aplikasi ---\n${output.slice(-4000)}`);
  await new Promise((r) => setTimeout(r, 1000));
  fs.rmSync(userData, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} pemeriksaan gagal.` : "\nSemua pemeriksaan lolos.");
process.exit(failures ? 1 : 0);
