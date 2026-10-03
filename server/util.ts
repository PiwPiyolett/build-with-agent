import { randomBytes } from "node:crypto";

export class HttpError extends Error {
  status: 400 | 403 | 404 | 409 | 415 | 422 | 500 | 502;
  hint?: string;
  constructor(status: HttpError["status"], message: string, hint?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.hint = hint;
  }
}

export const nowIso = () => new Date().toISOString();

export function newId(prefix: string, bytes = 5): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

// ---------- defensive coercion for LLM output and request bodies ----------

export function str(value: unknown, max = 2000): string {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function strList(value: unknown, maxItems = 20, maxLen = 400): string[] {
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string") items = value.split(/\r?\n|;/);
  return items
    .map((item) => {
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        return str(obj.label ?? obj.name ?? obj.text ?? obj.title, maxLen);
      }
      return str(item, maxLen).replace(/^[-*•]\s*/, "");
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function slugify(value: string, fallback: string): string {
  const s = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || fallback;
}

/** Returns a slug id that is not yet in `taken`, and reserves it. */
export function reserveId(raw: unknown, fallback: string, taken: Set<string>): string {
  const base = slugify(str(raw, 80), fallback);
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
