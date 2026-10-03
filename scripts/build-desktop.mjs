// Bundles what the desktop app needs into dist-electron/ (the UI itself comes from `vite build` into dist/).
// Everything is bundled, so the installed app ships no node_modules.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist-electron");
fs.rmSync(out, { recursive: true, force: true });

// Some bundled dependencies still call require(); ESM output needs a real one.
const banner = {
  js: "import { createRequire as __bwaCreateRequire } from 'node:module'; const require = __bwaCreateRequire(import.meta.url);",
};
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner,
  legalComments: "none",
  logLevel: "warning",
};

// The BWA server (started in-process by the desktop shell).
await build({ ...common, entryPoints: [path.join(root, "server/app.ts")], outfile: path.join(out, "server.mjs") });

// MCP bridge and CLI: self-contained so coding agents can run them with BWA.exe (ELECTRON_RUN_AS_NODE) or node.
await build({
  ...common,
  entryPoints: { "mcp-server": path.join(root, "bridge/mcp-server.mjs"), cli: path.join(root, "bridge/cli.mjs") },
  outdir: path.join(out, "bridge"),
  outExtension: { ".js": ".mjs" },
});

// Electron main process.
await build({
  ...common,
  entryPoints: [path.join(root, "electron/main.ts")],
  outfile: path.join(out, "main.mjs"),
  external: ["electron"],
  // The first-run import from this source folder is for personal builds only: embedding the path would
  // ship the builder's folder (and user name) inside public installers. Opt in with BWA_EMBED_SOURCE_DIR=1.
  define: { __BWA_SOURCE_DIR__: JSON.stringify(process.env.BWA_EMBED_SOURCE_DIR === "1" ? root : "") },
});

for (const file of ["server.mjs", "main.mjs", "bridge/mcp-server.mjs", "bridge/cli.mjs"]) {
  const size = fs.statSync(path.join(out, file)).size;
  console.log(`  dist-electron/${file.padEnd(22)} ${(size / 1024).toFixed(0).padStart(6)} KB`);
}
