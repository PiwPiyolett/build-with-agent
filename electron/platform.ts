// What differs between operating systems in the desktop shell: the app menu and the close dialog.
// Electron is only used for its types here, so scripts/desktop-shell-test.mjs can check macOS from any computer.

import type { MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  routerItems: MenuItemConstructorOptions[];
  openDataFolder: () => void;
  quit: () => void;
}

/** macOS delivers these shortcuts through the app menu, so without it Command+C and V do nothing in a text box. */
const EDIT_MENU: MenuItemConstructorOptions = {
  label: "Edit",
  submenu: [
    { label: "Batalkan", role: "undo" },
    { label: "Ulangi", role: "redo" },
    { type: "separator" },
    { label: "Potong", role: "cut" },
    { label: "Salin", role: "copy" },
    { label: "Tempel", role: "paste" },
    { label: "Pilih semua", role: "selectAll" },
  ],
};

export function appMenuTemplate(platform: NodeJS.Platform, { routerItems, openDataFolder, quit }: MenuActions): MenuItemConstructorOptions[] {
  return [
    {
      label: "BWA",
      submenu: [
        ...routerItems,
        { label: "Buka folder data", click: openDataFolder },
        { type: "separator" },
        { label: "Muat ulang", role: "reload" },
        { label: "Developer tools", role: "toggleDevTools" },
        { type: "separator" },
        { label: "Keluar", accelerator: "CmdOrCtrl+Q", click: quit },
      ],
    },
    ...(platform === "darwin" ? [EDIT_MENU] : []),
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
  ];
}

/** Where the BWA icon sits while its window is hidden. A Linux panel can be anywhere, so it names no corner. */
function iconPlace(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "pojok kanan atas layar";
  if (platform === "win32") return "pojok kanan bawah layar";
  return "deretan ikon sistem";
}

/** The question asked when a window is closed. main.ts reads `buttons` by position: hide, quit, cancel. */
export function closeDialogText(platform: NodeJS.Platform) {
  return {
    message: "Biarkan BWA tetap berjalan di latar belakang?",
    detail: `Asisten AI hanya bisa menjawab, mengambil task, dan mencentang task selama BWA berjalan. Kalau disembunyikan, ikon BWA tetap ada di ${iconPlace(platform)}.`,
    buttons: ["Sembunyikan", "Keluar", "Batal"],
  };
}
