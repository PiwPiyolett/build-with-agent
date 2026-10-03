// Minimal OpenAI-compatible client for 9router (http://127.0.0.1:20128/v1).
// Streams every completion so long generations never hit idle timeouts,
// and reports progress so the UI can show that the agent is still working.
// With provider "mcp", chat() hands the prompt to a standby MCP agent instead (see brainQueue.ts).

import type { AgentKey } from "../shared/types.ts";
import { chatViaBrain } from "./brainQueue.ts";
import { DEFAULT_BASE_URL, getSettings, modelFor, type Settings } from "./settings.ts";

export class LlmError extends Error {
  code: string;
  hint?: string;
  constructor(message: string, code = "llm_error", hint?: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.hint = hint;
  }
}

export interface RouterModel {
  id: string;
  ownedBy?: string;
  maxOutput?: number;
  thinking?: boolean;
}

export function normalizeBaseUrl(raw: string): string {
  let url = (raw || "").trim().replace(/\/+$/, "");
  if (!url) return DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/(chat\/completions|models)\/?$/, "");
    if (u.pathname === "" || u.pathname === "/") u.pathname = "/v1";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url;
  }
}

function headers(s: Settings): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
  };
  if (s.apiKey) h.Authorization = `Bearer ${s.apiKey}`;
  return h;
}

function unreachable(baseUrl: string, err: unknown): LlmError {
  const e = err as { cause?: { code?: string }; code?: string; message?: string };
  const detail = e?.cause?.code || e?.code || e?.message || "unknown";
  return new LlmError(
    `Tidak bisa terhubung ke 9router di ${baseUrl}.`,
    "unreachable",
    `Jalankan \`9router\` di terminal (dashboard: http://localhost:20128), lalu coba lagi. Detail: ${detail}`,
  );
}

function httpError(status: number, body: string): LlmError {
  let msg = body;
  try {
    const j = JSON.parse(body);
    msg = j?.error?.message || (typeof j?.error === "string" ? j.error : "") || j?.message || body;
  } catch {
    /* plain text body */
  }
  msg = String(msg || "").slice(0, 400);
  if (status === 401 || status === 403) {
    return new LlmError(
      `9router menolak API key (HTTP ${status}).`,
      "auth",
      "Salin API key dari dashboard 9router (http://localhost:20128/dashboard) ke Pengaturan.",
    );
  }
  if (status === 404) {
    return new LlmError(
      `Endpoint atau model tidak ditemukan (HTTP 404). ${msg}`,
      "not_found",
      "Periksa Base URL (berakhiran /v1) dan nama model di Pengaturan.",
    );
  }
  if (status === 429) {
    return new LlmError(
      `Limit atau kuota provider habis (HTTP 429). ${msg}`,
      "rate_limit",
      "Tunggu sebentar, pilih model lain, atau buat combo di 9router agar otomatis fallback.",
    );
  }
  return new LlmError(`9router mengembalikan HTTP ${status}. ${msg}`, "http");
}

export async function listModels(s: Settings = getSettings(), timeoutMs = 6000): Promise<RouterModel[]> {
  const base = normalizeBaseUrl(s.baseUrl);
  let res: Response;
  try {
    res = await fetch(`${base}/models`, { headers: headers(s), signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error)?.name === "TimeoutError") {
      throw new LlmError(`9router tidak menjawab /v1/models dalam ${Math.round(timeoutMs / 1000)} detik.`, "timeout");
    }
    throw unreachable(base, err);
  }
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""));
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const list = (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []) as Record<string, any>[];
  return list
    .map((m) => ({
      id: String(m?.id ?? m?.name ?? ""),
      ownedBy: typeof m?.owned_by === "string" ? m.owned_by : undefined,
      maxOutput: Number(m?.max_completion_tokens ?? m?.capabilities?.maxOutput) || undefined,
      thinking: Boolean(m?.capabilities?.thinking ?? m?.capabilities?.reasoning),
    }))
    .filter((m) => m.id);
}

export type RouterDiagnosis = {
  state: "ok" | "off" | "stalled" | "auth" | "error";
  message: string;
  hint?: string;
};

/**
 * Explains a failed /v1 call: is 9router not running at all, or running with a stuck /v1 proxy?
 * The dashboard at the server root answers even when the proxy routes hang.
 */
export async function diagnoseRouter(err: unknown, s: Settings = getSettings()): Promise<RouterDiagnosis> {
  const e = err as LlmError;
  if (e?.code === "auth") return { state: "auth", message: e.message, hint: e.hint };
  if (e?.code !== "timeout" && e?.code !== "unreachable") return { state: "error", message: e?.message ?? String(err), hint: e?.hint };
  const base = normalizeBaseUrl(s.baseUrl);
  let alive = false;
  try {
    await fetch(`${new URL(base).origin}/`, { redirect: "manual", signal: AbortSignal.timeout(2500) });
    alive = true;
  } catch {
    alive = false;
  }
  if (!alive) {
    return {
      state: "off",
      message: `9router tidak berjalan di ${base}.`,
      hint: "Jalankan `9router` di terminal, lalu tunggu sampai dashboard http://localhost:20128 terbuka.",
    };
  }
  return {
    state: "stalled",
    message: "9router menyala, tapi endpoint /v1 belum menjawab.",
    hint:
      "Dashboard 9router hidup, tapi jalur AI-nya macet. Biasanya ada provider yang sedang login ulang atau macet. " +
      "Cek terminal 9router, buka dashboard → Providers, atau tutup lalu jalankan ulang 9router.",
  };
}

export interface ChatOptions {
  agent: AgentKey;
  system: string;
  user: string;
  temperature?: number;
  /** overrides the configured timeout for unusually long outputs */
  timeoutSec?: number;
  signal?: AbortSignal;
  onProgress?: (p: { chars: number; reasoningChars: number }) => void;
  onStatus?: (message: string) => void;
}

export interface ChatResult {
  text: string;
  finishReason: string | null;
  model: string;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : (part?.text ?? ""))).join("");
  }
  return "";
}

export async function chat(opts: ChatOptions, s: Settings = getSettings()): Promise<ChatResult> {
  if (s.provider === "mcp") return chatViaBrain(opts, Math.max(s.timeoutSec, opts.timeoutSec ?? 0));
  const model = modelFor(opts.agent, s);
  if (!model) {
    throw new LlmError(
      "Model 9router belum dipilih.",
      "no_model",
      "Buka Pengaturan, klik Tes koneksi, lalu pilih model (mis. kr/claude-sonnet-4.5 atau nama combo).",
    );
  }
  const base = normalizeBaseUrl(s.baseUrl);
  const body: Record<string, unknown> = {
    model,
    stream: true,
    temperature: opts.temperature ?? s.temperature,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (s.maxTokens > 0) body.max_tokens = s.maxTokens;

  const timeoutSec = Math.max(s.timeoutSec, opts.timeoutSec ?? 0);
  const timeout = AbortSignal.timeout(timeoutSec * 1000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  const send = async () => {
    try {
      return await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: headers(s),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw abortReason(opts.signal, timeout, timeoutSec) ?? unreachable(base, err);
    }
  };

  let res = await send();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Some providers reject a max_tokens above their own ceiling: retry once without it.
    if (res.status === 400 && body.max_tokens && /max_tokens|max_completion_tokens|maximum/i.test(text)) {
      delete body.max_tokens;
      res = await send();
      if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""));
    } else {
      throw httpError(res.status, text);
    }
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const raw = await res.text();
    if (!raw.trimStart().startsWith("data:")) {
      try {
        const j = JSON.parse(raw);
        const choice = j?.choices?.[0];
        return {
          text: contentToText(choice?.message?.content ?? choice?.text),
          finishReason: choice?.finish_reason ?? null,
          model: j?.model ?? model,
        };
      } catch {
        throw new LlmError("Respons 9router tidak bisa dibaca.", "bad_response", raw.slice(0, 200));
      }
    }
    // SSE body with a wrong content-type: fall through by re-wrapping it.
    res = new Response(raw);
  }

  let text = "";
  let reasoningChars = 0;
  let finishReason: string | null = null;
  let streamError: LlmError | null = null;

  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j: any;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j?.error) {
      streamError = new LlmError(`9router: ${j.error.message || JSON.stringify(j.error)}`.slice(0, 400), "stream_error");
      return;
    }
    const choice = j?.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? choice.message ?? {};
    text += contentToText(delta.content);
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === "string") reasoningChars += reasoning.length;
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, nl).replace(/\r$/, ""));
        buffer = buffer.slice(nl + 1);
      }
      opts.onProgress?.({ chars: text.length, reasoningChars });
    }
    if (buffer.trim()) handleLine(buffer.trim());
  } catch (err) {
    throw abortReason(opts.signal, timeout, timeoutSec) ?? new LlmError(`Stream dari 9router terputus: ${(err as Error).message}`, "stream_error");
  }
  if (streamError && !text) throw streamError;
  return { text, finishReason, model };
}

function abortReason(user: AbortSignal | undefined, timeout: AbortSignal, timeoutSec: number): LlmError | null {
  if (user?.aborted) return new LlmError("Dibatalkan.", "aborted");
  if (timeout.aborted) {
    return new LlmError(
      `9router tidak selesai dalam ${timeoutSec} detik.`,
      "timeout",
      "Naikkan Timeout di Pengaturan, atau pilih model yang lebih cepat.",
    );
  }
  return null;
}

// ---------- JSON output ----------

function repairJson(s: string): string {
  return s.replace(/^﻿/, "").replace(/,\s*([}\]])/g, "$1");
}

export function extractJson(raw: string): unknown {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) candidates.push(m[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  candidates.push(text);
  for (const candidate of candidates) {
    for (const variant of [candidate, repairJson(candidate)]) {
      try {
        const parsed = JSON.parse(variant);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        /* try next */
      }
    }
  }
  throw new Error("no JSON object found");
}

export type JsonChatOptions = ChatOptions;

/** Runs a chat completion and returns the parsed JSON object, repairing it once if needed. */
export async function chatJson(opts: JsonChatOptions): Promise<unknown> {
  const first = await chat(opts);
  try {
    return extractJson(first.text);
  } catch {
    if (opts.signal?.aborted) throw new LlmError("Dibatalkan.", "aborted");
    const truncated = first.finishReason === "length";
    opts.onStatus?.(truncated ? "Output terpotong, meminta model menutup JSON…" : "Merapikan format JSON…");
    const fixed = await chat({
      ...opts,
      temperature: 0,
      system:
        "You repair malformed JSON. Output ONLY the corrected JSON object: no prose, no markdown fences. " +
        "If it is truncated, close it properly and drop the last incomplete item.",
      user: first.text.slice(0, 80_000),
    });
    try {
      return extractJson(fixed.text);
    } catch {
      throw new LlmError(
        truncated ? "Output model terpotong sebelum selesai." : "Model tidak mengembalikan JSON yang valid.",
        "bad_json",
        truncated
          ? "Naikkan Max tokens di Pengaturan, atau pilih model dengan output lebih panjang."
          : "Jalankan ulang, atau ganti model di Pengaturan.",
      );
    }
  }
}
