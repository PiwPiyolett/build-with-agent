// Renders the app and tray icons into build/ (used by the desktop window, tray and installer).
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "build");
fs.mkdirSync(dir, { recursive: true });

// The Telkom Schools logo on a white rounded tile. The logo has a white background of its own, so it blends into the tile.
const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, "public", "brand", "logo.png")).toString("base64")}`;

const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">
  <rect x="24" y="24" width="464" height="464" rx="104" fill="#FFFFFF"/>
  <image x="44" y="44" width="424" height="424" xlink:href="${logo}"/>
  <rect x="24" y="24" width="464" height="464" rx="104" fill="none" stroke="#E3E3E6" stroke-width="4"/>
</svg>`;

// Tray icons are drawn at 16 and 32 px, so the logo fills the tile edge to edge to stay recognisable.
const trayIcon = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">
  <rect x="1" y="1" width="62" height="62" rx="14" fill="#FFFFFF"/>
  <image x="-10" y="-11" width="84" height="84" xlink:href="${logo}"/>
</svg>`;

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

fs.writeFileSync(path.join(dir, "icon.png"), render(appIcon, 512));
fs.writeFileSync(path.join(dir, "tray.png"), render(trayIcon, 16));
fs.writeFileSync(path.join(dir, "tray@2x.png"), render(trayIcon, 32));
console.log("icons written to build/");
