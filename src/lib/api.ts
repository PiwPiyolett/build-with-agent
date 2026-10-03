import type {
  AgentConnection,
  AgentEvent,
  BrainWorker,
  PrdDoc,
  Project,
  ProjectSummary,
  PublicSettings,
  RouterStatus,
  Topology,
} from "../../shared/types";

/** Identifies this browser tab, so live updates caused by our own requests can be ignored. */
export const CLIENT_ID = `ui_${Math.random().toString(36).slice(2, 10)}`;

export class ApiError extends Error {
  status: number;
  hint?: string;
  constructor(message: string, status: number, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-bwa-client": CLIENT_ID },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("Server BWA tidak merespons.", 0, serverDownHint());
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new ApiError(data?.error || `HTTP ${res.status}`, res.status, data?.hint);
  return data as T;
}

export interface RouterModel {
  id: string;
  ownedBy?: string;
  maxOutput?: number;
  thinking?: boolean;
}

export interface ConnectionTest {
  ok: boolean;
  models?: RouterModel[];
  latencyMs?: number;
  baseUrl?: string;
  error?: string;
  hint?: string;
}

export interface ModelTest {
  ok: boolean;
  model: string;
  reply?: string;
  latencyMs?: number;
  error?: string;
  hint?: string;
}

export interface BridgeInfo {
  apiUrl: string;
  mcpServerPath: string;
  cliPath: string;
  command: string;
  commandEnv: Record<string, string>;
  nodePath: string;
}

/** Set once at startup from /api/health: true inside the desktop app. */
export const runtime = { desktop: false };

export async function detectRuntime() {
  try {
    const res = await fetch("/api/health");
    const data = (await res.json()) as { desktop?: boolean };
    runtime.desktop = data.desktop === true;
  } catch {
    /* keep web defaults */
  }
  return runtime;
}

export const serverDownHint = () =>
  runtime.desktop ? "Tutup lalu buka lagi aplikasi BWA." : "Pastikan `npm run dev` masih berjalan di terminal.";

export interface SettingsPatch {
  provider?: PublicSettings["provider"];
  handover?: PublicSettings["handover"];
  baseUrl?: string;
  apiKey?: string | null;
  model?: string;
  agentModels?: Partial<PublicSettings["agentModels"]>;
  temperature?: number;
  maxTokens?: number;
  timeoutSec?: number;
}

export const api = {
  settings: () => request<PublicSettings>("GET", "/settings"),
  saveSettings: (patch: SettingsPatch) => request<PublicSettings>("PUT", "/settings", patch),
  testConnection: (draft: { baseUrl?: string; apiKey?: string | null }) =>
    request<ConnectionTest>("POST", "/settings/test", draft),
  testModel: (model: string) => request<ModelTest>("POST", "/settings/test-model", { model }),
  testBrain: () => request<ModelTest>("POST", "/settings/test-brain", {}),
  brainStatus: () => request<{ workers: BrainWorker[]; pending: number }>("GET", "/brain/status"),
  connections: () => request<Record<AgentConnection["agent"], AgentConnection>>("GET", "/connect"),
  connectAgent: (agent: AgentConnection["agent"]) => request<AgentConnection>("POST", `/connect/${agent}`),
  disconnectAgent: (agent: AgentConnection["agent"]) => request<AgentConnection>("DELETE", `/connect/${agent}`),
  routerStatus: () => request<RouterStatus>("GET", "/llm/status"),
  bridge: () => request<BridgeInfo>("GET", "/bridge"),
  start9router: () => request<{ ok: true }>("POST", "/system/start-9router"),

  projects: () => request<ProjectSummary[]>("GET", "/projects"),
  createProject: (prompt: string) => request<Project>("POST", "/projects", { prompt }),
  project: (id: string) => request<Project>("GET", `/projects/${id}`),
  patchProject: (id: string, patch: Record<string, unknown>) => request<Project>("PATCH", `/projects/${id}`, patch),
  deleteProject: (id: string) => request<{ ok: true }>("DELETE", `/projects/${id}`),
  saveTopology: (id: string, topology: Topology) =>
    request<{ updatedAt: string; topology: Topology }>("PUT", `/projects/${id}/topology`, topology),
  createTask: (id: string, body: Record<string, unknown>) => request<Project>("POST", `/projects/${id}/tasks`, body),
  patchTask: (id: string, taskId: string, body: Record<string, unknown>) =>
    request<Project>("PATCH", `/projects/${id}/tasks/${taskId}`, body),
  deleteTask: (id: string, taskId: string) => request<Project>("DELETE", `/projects/${id}/tasks/${taskId}`),
  savePrd: (id: string, markdown: string) =>
    request<{ prd: PrdDoc; updatedAt: string }>("PUT", `/projects/${id}/prd`, { markdown }),
};

export class AgentError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

/** POSTs to a streaming agent endpoint and resolves with the final result. */
export async function runAgent<T>(
  path: string,
  body: unknown,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bwa-client": CLIENT_ID },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new AgentError("Server BWA tidak merespons.", serverDownHint());
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new AgentError(data.error || `HTTP ${res.status}`, data.hint);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as AgentEvent;
      if (event.type === "done") return event.result as T;
      if (event.type === "error") throw new AgentError(event.message, event.hint);
      onEvent(event);
    }
  }
  throw new AgentError("Koneksi ke agent terputus sebelum selesai.", "Coba jalankan lagi.");
}
