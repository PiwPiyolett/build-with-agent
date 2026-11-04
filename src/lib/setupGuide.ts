// The wording and links of the "Hubungkan asisten AI" guide, written for someone who has never used a terminal.
// Screens read from here, so a redesign does not touch the words. Text between backticks is shown as a key-cap.

import type { GuideAgent, GuideProgress, GuideStep } from "../../shared/setupGuide";
import type { AgentConnection } from "../../shared/types";

export const ASSISTANTS: Record<GuideAgent, { name: string; app: string; plan: string; command: string }> = {
  claude: {
    name: "Claude",
    app: "aplikasi Claude",
    plan: "Butuh langganan Claude berbayar (Pro ke atas). Paket gratis Claude belum bisa dipakai.",
    command: "/bwa",
  },
  codex: {
    name: "Codex",
    app: "aplikasi ChatGPT",
    plan: "Memakai akun ChatGPT. Codex tersedia di semua paket, tapi di paket gratis jatahnya terbatas dan belum tentu aktif untuk semua orang.",
    command: "$bwa",
  },
};

export const GUIDE_INTRO =
  "BWA butuh asisten AI untuk berpikir. Asisten itu memakai akun Claude atau ChatGPT milikmu sendiri, jadi biayanya mengikuti langgananmu. BWA sendiri gratis.";

export const KEEP_OPEN =
  "Biarkan percakapan itu tetap terbuka selama kamu bekerja di BWA, karena di sanalah jawabannya dibuat. Kalau sudah selesai, tutup percakapannya supaya jatah langgananmu tidak habis untuk menunggu.";

export const NEW_CONVERSATION = "Harus percakapan baru, karena percakapan yang sudah terbuka belum mengenal BWA.";

export interface StepCopy {
  title: string;
  lines: string[];
  /** numbered instructions, for the step where the person does several things outside BWA */
  howTo?: string[];
}

const HOW_TO_START: Record<GuideAgent, string[]> = {
  claude: [
    "Buka aplikasi Claude, lalu pilih tab `Code`.",
    "Pilih folder untuk menyimpan hasil kerjamu. Belum punya? Buat folder baru dulu, misalnya di Dokumen.",
    "Ketik `/bwa` lalu tekan `Enter`.",
    "Kalau Claude meminta izin memakai BWA, pilih izinkan.",
  ],
  codex: [
    "Buka aplikasi ChatGPT, lalu buka Codex.",
    "Pilih folder untuk menyimpan hasil kerjamu lewat Add new project. Belum punya? Buat folder baru dulu, misalnya di Dokumen.",
    "Ketik `$bwa` lalu tekan `Enter`. Kalau tidak jalan, ketik saja: Hubungkan ke BWA",
    "Kalau Codex meminta izin memakai BWA, pilih izinkan.",
  ],
};

export function stepCopy(agent: GuideAgent, step: GuideStep, conn: AgentConnection, progress: GuideProgress, downloadable: boolean): StepCopy {
  const { name, app } = ASSISTANTS[agent];
  switch (step) {
    case "install":
      return {
        title: `Pasang ${app}`,
        lines: downloadable
          ? [`Unduh seperti aplikasi biasa, buka file unduhannya, lalu ikuti petunjuknya. Setelah terpasang, tekan Sudah terpasang kalau langkah ini belum tercentang sendiri.`]
          : [`${app[0].toUpperCase()}${app.slice(1)} belum tersedia langsung untuk komputer ini, jadi pakai cara lewat terminal di bagian bawah panduan ini.`],
      };
    case "signin":
      if (progress.needsCodeTab) {
        return { title: "Masuk ke akunmu", lines: ["Satu langkah lagi: di aplikasi Claude, klik tab `Code` sekali. Langkah ini akan tercentang sendiri dalam beberapa detik."] };
      }
      if (conn.signedIn === false) {
        return { title: "Masuk ke akunmu", lines: ["Buka terminal, jalankan `claude auth login`, lalu ikuti petunjuknya. Langkah ini akan tercentang sendiri setelah kamu masuk."] };
      }
      return { title: "Masuk ke akunmu", lines: [`Buka ${app}, lalu masuk dengan akunmu. Kata sandimu tidak pernah sampai ke BWA.`] };
    case "connect":
      return {
        title: `Hubungkan ${name} ke BWA`,
        lines: [
          progress.needsUpdate
            ? `Sambungannya perlu diperbarui. Cukup satu klik, pengaturan ${name} yang lain tidak diubah.`
            : `Satu klik supaya ${name} dan BWA bisa saling bicara. Pengaturan ${name} yang lain tidak diubah.`,
        ],
      };
    case "start":
      return { title: "Mulai percakapan", lines: [NEW_CONVERSATION, KEEP_OPEN], howTo: HOW_TO_START[agent] };
  }
}

/** The official download for this computer, or null when there is none and the terminal is the way. */
export function downloadUrl(agent: GuideAgent, platform: string, arch: string): string | null {
  if (agent === "codex") {
    return platform === "win32" ? "https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi" : "https://learn.chatgpt.com/docs/app";
  }
  if (platform === "win32") return `https://claude.ai/api/desktop/win32/${arch === "arm64" ? "arm64" : "x64"}/setup/latest/redirect`;
  if (platform === "darwin") return "https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect";
  return null;
}

/** The same thing without the desktop app, for people already at home in a terminal. */
export function terminalWay(agent: GuideAgent, platform: string): { install: string; start: string } {
  if (agent === "claude") {
    return {
      install: platform === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash",
      start: "Jalankan `claude` di folder proyekmu, ikuti petunjuk masuk akunnya, lalu ketik `/bwa`.",
    };
  }
  return {
    install:
      platform === "win32"
        ? 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
        : platform === "darwin"
          ? "brew install --cask codex"
          : "npm install -g @openai/codex",
    start: "Jalankan `codex` di folder proyekmu, ikuti petunjuk masuk akunnya, lalu ketik `$bwa`.",
  };
}

/** What the confirmation shows before BWA changes anything: plain words first, then exactly what happens. */
export function connectConfirmBody(agent: GuideAgent, conn: AgentConnection): string {
  const { name } = ASSISTANTS[agent];
  return `BWA hanya menambahkan pendaftarannya sendiri dan satu perintah pendek. Pengaturan ${name} yang lain tidak diubah.\n\nRincian teknis:\n• ${conn.changes.join("\n• ")}`;
}
