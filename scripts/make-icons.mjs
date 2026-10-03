// Renders the app and tray icons into build/ (used by the desktop window, tray and installer).
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "build");
fs.mkdirSync(dir, { recursive: true });

// Two feature nodes joined by a cable, with the green "done" LED: the same mark as the favicon.
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="24" y="24" width="464" height="464" rx="104" fill="#121A21"/>
  <rect x="100" y="148" width="132" height="132" rx="28" fill="none" stroke="#EEF1EF" stroke-width="34"/>
  <rect x="280" y="264" width="132" height="132" rx="28" fill="none" stroke="#EEF1EF" stroke-width="34"/>
  <path d="M232 214 H346 V264" fill="none" stroke="#EEF1EF" stroke-width="34" stroke-linejoin="round"/>
  <circle cx="392" cy="128" r="42" fill="#1DB954"/>
</svg>`;

// Tray icons are drawn at 16 and 32 px, so the mark is simplified and the strokes thicker.
const trayIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="14" fill="#121A21"/>
  <rect x="11" y="24" width="24" height="24" rx="5" fill="none" stroke="#EEF1EF" stroke-width="6"/>
  <path d="M35 36 H46 V24" fill="none" stroke="#EEF1EF" stroke-width="6" stroke-linejoin="round"/>
  <circle cx="47" cy="17" r="9" fill="#1DB954"/>
</svg>`;

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

fs.writeFileSync(path.join(dir, "icon.png"), render(appIcon, 512));
fs.writeFileSync(path.join(dir, "tray.png"), render(trayIcon, 16));
fs.writeFileSync(path.join(dir, "tray@2x.png"), render(trayIcon, 32));
console.log("icons written to build/");
