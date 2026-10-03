// BWA desktop shell.
// Runs the BWA server inside the app, shows the UI in its own window, and keeps running in the tray so
// coding agents (Claude Code, Codex, …) can keep answering brain jobs and taking and ticking off tasks.
// Only the AI brain runs outside: a standby MCP agent session, or 9router when opted in.

import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Folder of the source project this build was made from (for the one-time import of existing data). */
declare const __BWA_SOURCE_DIR__: string;

const PORT = Number(process.env.BWA_PORT || 3900);
/** Start straight into the tray (e.g. for autostart): `BWA.exe --hidden`. */
const startHidden = process.argv.includes("--hidden") || process.env.BWA_START_HIDDEN === "1";
const HOST = "127.0.0.1";
const ROUTER_DASHBOARD = "http://localhost:20128/dashboard";

if (process.env.BWA_USER_DATA) app.setPath("userData", process.env.BWA_USER_DATA);
app.setAppUserModelId("id.bwa.app");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const here = import.meta.dirname; // dist-electron
const appRoot = app.getAppPath(); // project folder in dev, resources/app.asar when installed
const unpackedRoot = app.isPackaged ? appRoot.replace(/app\.asar$/, "app.asar.unpacked") : appRoot;
const iconPath = path.join(appRoot, "build", "icon.png");
const trayIconPath = path.join(appRoot, "build", "tray.png");
const userData = app.getPath("userData");
const dataDir = path.join(userData, "data");
const prefsFile = path.join(userData, "desktop.json");

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let appUrl = `http://${HOST}:${PORT}/`;
let quitting = false;
let stopServer: (() => Promise<void>) | null = null;

// ---------- preferences ----------

interface Prefs {
  closeAction?: "tray" | "quit";
  trayHintShown?: boolean;
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(fs.readFileSync(prefsFile, "utf8")) as Prefs;
  } catch {
    return {};
  }
}

function writePrefs(patch: Prefs) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(prefsFile, JSON.stringify({ ...readPrefs(), ...patch }, null, 2));
}

// ---------- first run: bring over projects and the 9router settings from the web version ----------

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function importFromSourceFolder() {
  const source = typeof __BWA_SOURCE_DIR__ === "string" ? __BWA_SOURCE_DIR__ : "";
  if (!source || !fs.existsSync(source) || path.resolve(source) === path.resolve(userData)) return;

  const projectsDir = path.join(dataDir, "projects");
  const from = path.join(source, "data", "projects");
  const empty = !fs.existsSync(projectsDir) || fs.readdirSync(projectsDir).length === 0;
  if (empty && fs.existsSync(from)) {
    fs.mkdirSync(projectsDir, { recursive: true });
    for (const file of fs.readdirSync(from)) {
      if (file.endsWith(".json")) fs.copyFileSync(path.join(from, file), path.join(projectsDir, file));
    }
  }

  const settingsFile = path.join(dataDir, "settings.json");
  if (fs.existsSync(settingsFile)) return;
  fs.mkdirSync(dataDir, { recursive: true });
  const savedSettings = path.join(source, "data", "settings.json");
  const envFile = path.join(source, ".env");
  if (fs.existsSync(savedSettings)) {
    fs.copyFileSync(savedSettings, settingsFile);
  } else if (fs.existsSync(envFile)) {
    const env = parseEnv(fs.readFileSync(envFile, "utf8"));
    const settings: Record<string, unknown> = {
      agentModels: {
        idea: env.AGENT_IDEA_MODEL ?? "",
        topology: env.AGENT_TOPOLOGY_MODEL ?? "",
        tasks: env.AGENT_TASKS_MODEL ?? "",
      },
    };
    if (env.NINEROUTER_BASE_URL) settings.baseUrl = env.NINEROUTER_BASE_URL;
    if (env.NINEROUTER_API_KEY) settings.apiKey = env.NINEROUTER_API_KEY;
    if (env.NINEROUTER_MODEL) settings.model = env.NINEROUTER_MODEL;
    if (env.BWA_PROVIDER) settings.provider = env.BWA_PROVIDER;
    if (env.BWA_HANDOVER) settings.handover = env.BWA_HANDOVER;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  }
}

/** Same opt-in as routerEnabled() in server/settings.ts: 9router menu items only for those who use it. */
function routerEnabled(): boolean {
  if (process.env.BWA_ENABLE_9ROUTER === "1") return true;
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).enable9router === true;
  } catch {
    return false;
  }
}

const routerMenu = (): Electron.MenuItemConstructorOptions[] =>
  routerEnabled() ? [{ label: "Buka dashboard 9router", click: () => void shell.openExternal(ROUTER_DASHBOARD) }] : [];

// ---------- backend ----------

async function startBackend(): Promise<boolean> {
  process.env.BWA_DATA_DIR = dataDir;
  process.env.BWA_DESKTOP = "1";
  process.env.BWA_BRIDGE_DIR = path.join(unpackedRoot, "dist-electron", "bridge");
  process.env.BWA_BRIDGE_COMMAND = process.execPath;
  process.env.BWA_DIST_DIR = path.join(appRoot, "dist");
  process.env.PORT = String(PORT);
  process.env.HOST = HOST;

  try {
    importFromSourceFolder();
  } catch (err) {
    console.warn("[bwa] impor data lama gagal:", err);
  }

  const server = (await import(pathToFileURL(path.join(here, "server.mjs")).href)) as {
    startServer: (opts: { port: number; host: string }) => Promise<{ url: string; close: () => Promise<void> }>;
  };
  try {
    const running = await server.startServer({ port: PORT, host: HOST });
    stopServer = running.close;
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    return usePortOwner();
  }
}

/** Port taken: reuse it if it is another BWA (e.g. `npm run dev`), otherwise explain and stop. */
async function usePortOwner(): Promise<boolean> {
  const other = await fetch(`http://${HOST}:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.json() as Promise<{ name?: string; desktop?: boolean }>)
    .catch(() => null);
  if (other?.name === "bwa") {
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Build With Agent",
      message: `BWA lain sudah berjalan di port ${PORT}.`,
      detail: other.desktop
        ? "Aplikasi BWA sudah terbuka."
        : "Kemungkinan versi web dari `npm run dev`. Jendela ini akan memakai server dan data milik versi web tersebut.",
      buttons: ["Pakai yang sedang berjalan", "Keluar"],
      defaultId: 0,
      cancelId: 1,
    });
    return response === 0;
  }
  await dialog.showMessageBox({
    type: "error",
    title: "Build With Agent",
    message: `Port ${PORT} sedang dipakai aplikasi lain.`,
    detail: "Tutup aplikasi yang memakai port itu, lalu buka BWA lagi.",
  });
  return false;
}

// ---------- window, tray, menu ----------

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  quitting = true;
  app.quit();
}

async function onCloseRequested() {
  const prefs = readPrefs();
  let action = prefs.closeAction;
  if (!action) {
    const res = await dialog.showMessageBox(win!, {
      type: "question",
      title: "Tutup BWA?",
      message: "Biarkan BWA tetap berjalan di latar belakang?",
      detail:
        "Claude Code dan Codex hanya bisa menjawab job otak AI (mode MCP) serta mengambil dan mencentang task selama BWA berjalan. " +
        "Kalau disembunyikan, BWA tetap ada di tray (pojok kanan bawah).",
      buttons: ["Sembunyikan ke tray", "Keluar", "Batal"],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: "Ingat pilihan ini",
    });
    if (res.response === 2) return;
    action = res.response === 0 ? "tray" : "quit";
    if (res.checkboxChecked) writePrefs({ closeAction: action });
  }
  if (action === "quit") return quitApp();
  win?.hide();
  if (!readPrefs().trayHintShown) {
    tray?.displayBalloon({
      title: "BWA masih berjalan",
      content: "Klik ikon BWA di tray untuk membuka lagi. Klik kanan untuk keluar.",
      iconType: "info",
    });
    writePrefs({ trayHintShown: true });
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: "Build With Agent",
    icon: iconPath,
    backgroundColor: "#eef1ef",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => {
    if (!startHidden) win?.show();
  });
  win.webContents.on("did-finish-load", () => console.log(`[bwa] UI dimuat: ${win?.webContents.getURL()}`));
  win.webContents.on("did-fail-load", (_event, code, description, url) =>
    console.error(`[bwa] UI gagal dimuat (${code} ${description}): ${url}`),
  );
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") console.error(`[renderer] ${details.message}`);
  });
  // Links to other sites (9router dashboard, docs) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    void onCloseRequested();
  });
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL(appUrl);
}

function createTray() {
  const image = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : image);
  tray.setToolTip("Build With Agent");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Buka BWA", click: showWindow },
      ...routerMenu(),
      { label: "Buka folder data", click: () => void shell.openPath(dataDir) },
      { type: "separator" },
      { label: "Keluar", click: quitApp },
    ]),
  );
  tray.on("click", showWindow);
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "BWA",
        submenu: [
          ...routerMenu(),
          { label: "Buka folder data", click: () => void shell.openPath(dataDir) },
          { type: "separator" },
          { label: "Muat ulang", role: "reload" },
          { label: "Developer tools", role: "toggleDevTools" },
          { type: "separator" },
          { label: "Keluar", accelerator: "Ctrl+Q", click: quitApp },
        ],
      },
      {
        label: "Tampilan",
        submenu: [
          { label: "Perbesar", role: "zoomIn" },
          { label: "Perkecil", role: "zoomOut" },
          { label: "Ukuran normal", role: "resetZoom" },
          { type: "separator" },
          { label: "Layar penuh", role: "togglefullscreen" },
        ],
      },
    ]),
  );
}

// ---------- lifecycle ----------

app.on("second-instance", showWindow);
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => {
  void stopServer?.();
});
// Closing the window only hides it (tray); quitting is always explicit.
app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(async () => {
    const ok = await startBackend();
    if (!ok) return quitApp();
    appUrl = `http://${HOST}:${PORT}/`;
    createMenu();
    createTray();
    createWindow();
  })
  .catch((err: unknown) => {
    dialog.showErrorBox("BWA gagal dibuka", err instanceof Error ? (err.stack ?? err.message) : String(err));
    quitApp();
  });
