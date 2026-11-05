// What the desktop shell does differently per operating system: the app menu and the close dialog.
// Needs no Electron, so the macOS behaviour can be checked from any computer.
//   node --import tsx scripts/desktop-shell-test.mjs

import { appMenuTemplate, closeDialogText } from "../electron/platform.ts";

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

let quits = 0;
const actions = { routerItems: [], openDataFolder: () => {}, quit: () => quits++ };
const menu = (platform) => appMenuTemplate(platform, actions);
const labels = (platform) => menu(platform).map((m) => m.label).join(" ");
const quitItem = (platform) => menu(platform)[0].submenu.find((i) => i.label === "Keluar");

// ---------- app menu ----------

// macOS sends Command+C, V and the like through the app menu: without these roles the shortcuts do nothing.
const editRoles = menu("darwin").find((m) => m.label === "Edit")?.submenu.map((i) => i.role) ?? [];
for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) {
  check(editRoles.includes(role), `macOS: menu Edit punya ${role}`);
}
check(labels("darwin") === "BWA Edit Tampilan", "macOS: menu BWA tetap paling depan");

// Text fields on Windows and Linux handle those keys themselves, so their menus stay as they were.
check(labels("win32") === "BWA Tampilan", "Windows: menunya tidak berubah");
check(labels("linux") === "BWA Tampilan", "Linux: menunya tidak berubah");

// Quit follows each system's habit: Command+Q on macOS, Ctrl+Q elsewhere.
for (const platform of ["darwin", "win32", "linux"]) {
  check(quitItem(platform).accelerator === "CmdOrCtrl+Q", `${platform}: pintasan keluar mengikuti sistemnya`);
  quits = 0;
  quitItem(platform).click();
  check(quits === 1, `${platform}: Keluar benar-benar menutup aplikasi`);
}

const extra = { label: "Buka dashboard 9router" };
check(appMenuTemplate("win32", { ...actions, routerItems: [extra] })[0].submenu[0] === extra, "item 9router tetap paling atas di menu BWA");

// ---------- close dialog ----------

check(/kanan atas/.test(closeDialogText("darwin").detail), "macOS: ikon disebut di kanan atas");
check(/kanan bawah/.test(closeDialogText("win32").detail), "Windows: ikon disebut di kanan bawah");
check(!/kanan (atas|bawah)/.test(closeDialogText("linux").detail), "Linux: tidak menyebut pojok tertentu, karena panelnya bisa di mana saja");

for (const platform of ["darwin", "win32", "linux"]) {
  const { message, detail, buttons } = closeDialogText(platform);
  check(buttons.join() === "Sembunyikan,Keluar,Batal", `${platform}: urutan tombol sesuai yang dibaca main.ts`);
  check(!/\b(job|MCP|tray|standby|session)\b/i.test(`${message} ${detail} ${buttons.join(" ")}`), `${platform}: tanpa istilah teknis`);
}

console.log(failures ? `\n${failures} pemeriksaan gagal.` : "\nSemua pemeriksaan lolos.");
process.exit(failures ? 1 : 0);
