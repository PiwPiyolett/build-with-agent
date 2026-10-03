import type { NodeKind, Priority, TaskStatus } from "../../shared/types";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" });

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "baru saja";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const nf = new Intl.NumberFormat("id-ID");

export const AGENTS = {
  1: { name: "Pengembang Ide", short: "Agent 1" },
  2: { name: "Arsitek Fitur", short: "Agent 2" },
  3: { name: "Pembagi Task", short: "Agent 3" },
} as const;

export const KIND_LABEL: Record<NodeKind, string> = {
  product: "Produk",
  module: "Modul",
  feature: "Fitur",
  integration: "Integrasi",
};

export const PRIORITY_META: Record<Priority, { short: string; label: string; hint: string }> = {
  must: { short: "Must", label: "Wajib", hint: "Harus ada di MVP" },
  should: { short: "Should", label: "Sebaiknya", hint: "Menyusul setelah MVP" },
  could: { short: "Could", label: "Nanti", hint: "Bagus kalau sempat" },
};

export const STATUS_META: Record<TaskStatus, { label: string; led: string }> = {
  todo: { label: "Antre", led: "led" },
  in_progress: { label: "Dikerjakan", led: "led led-amber" },
  blocked: { label: "Terhambat", led: "led led-red" },
  done: { label: "Selesai", led: "led led-green" },
};

export const TASK_TYPES = [
  "setup",
  "frontend",
  "backend",
  "database",
  "integration",
  "testing",
  "devops",
  "design",
  "docs",
];

export const COMPLEXITY_LABEL = ["", "Sepele", "Ringan", "Sedang", "Berat", "Sangat berat"];

export function prdFileName(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `PRD-${slug || "bwa"}.md`;
}

/** GitHub-style heading anchors; matches the contents list the server writes into the PRD. */
export function headingSlug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

export function downloadText(fileName: string, text: string, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}
