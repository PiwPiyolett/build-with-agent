import fs from "node:fs";
import path from "node:path";
import type { AgentKey, BrainProvider, HandoverMode, PublicSettings } from "../shared/types.ts";
import { DATA_DIR, writeFileAtomic } from "./store.ts";
import { clampInt, pick, str } from "./util.ts";

export interface Settings {
  provider: BrainProvider;
  handover: HandoverMode;
  baseUrl: string;
  apiKey: string;
  model: string;
  agentModels: Record<AgentKey, string>;
  temperature: number;
  maxTokens: number;
  timeoutSec: number;
  /** opt-in to 9router from settings.json (the desktop app reads no .env); see routerEnabled() */
  enable9router?: boolean;
}

export const DEFAULT_BASE_URL = "http://127.0.0.1:20128/v1";
export const PROVIDERS = ["9router", "mcp"] as const;
export const HANDOVER_MODES = ["wait", "auto"] as const;

const FILE = path.join(DATA_DIR, "settings.json");

/**
 * 9router is opt-in: the public build offers only MCP agents as the brain. Enable it with
 * BWA_ENABLE_9ROUTER=1 (web, .env) or "enable9router": true in settings.json (desktop).
 */
export function routerEnabled(s: Pick<Settings, "enable9router"> = getSettings()): boolean {
  return process.env.BWA_ENABLE_9ROUTER === "1" || s.enable9router === true;
}

/** Without 9router the only brain is MCP, whatever an older settings.json says. */
function enforceProvider(s: Settings): Settings {
  if (!routerEnabled(s)) s.provider = "mcp";
  return s;
}

function fromEnv(): Settings {
  const env = process.env;
  return {
    provider: pick(env.BWA_PROVIDER, PROVIDERS, "mcp"),
    handover: pick(env.BWA_HANDOVER, HANDOVER_MODES, "wait"),
    baseUrl: env.NINEROUTER_BASE_URL || DEFAULT_BASE_URL,
    apiKey: env.NINEROUTER_API_KEY || "",
    model: env.NINEROUTER_MODEL || "",
    agentModels: {
      idea: env.AGENT_IDEA_MODEL || "",
      topology: env.AGENT_TOPOLOGY_MODEL || "",
      tasks: env.AGENT_TASKS_MODEL || "",
    },
    temperature: Number(env.NINEROUTER_TEMPERATURE ?? 0.7),
    maxTokens: clampInt(env.NINEROUTER_MAX_TOKENS, 0, 200_000, 12_000),
    timeoutSec: clampInt(env.NINEROUTER_TIMEOUT_SEC, 30, 1800, 300),
  };
}

let current: Settings | null = null;

export function getSettings(): Settings {
  if (current) return current;
  const base = fromEnv();
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    current = { ...base, ...saved, agentModels: { ...base.agentModels, ...(saved.agentModels ?? {}) } };
  } catch {
    current = base;
  }
  return enforceProvider(current!);
}

export interface SettingsPatch {
  provider?: BrainProvider;
  handover?: HandoverMode;
  baseUrl?: string;
  /** undefined = keep, "" or null = remove, string = replace */
  apiKey?: string | null;
  model?: string;
  agentModels?: Partial<Record<AgentKey, string>>;
  temperature?: number;
  maxTokens?: number;
  timeoutSec?: number;
}

export function updateSettings(patch: SettingsPatch): Settings {
  const s = { ...getSettings(), agentModels: { ...getSettings().agentModels } };
  if (patch.provider !== undefined) s.provider = pick(patch.provider, PROVIDERS, s.provider);
  if (patch.handover !== undefined) s.handover = pick(patch.handover, HANDOVER_MODES, s.handover);
  if (patch.baseUrl !== undefined) s.baseUrl = str(patch.baseUrl, 500) || DEFAULT_BASE_URL;
  if (patch.apiKey !== undefined) s.apiKey = str(patch.apiKey ?? "", 500);
  if (patch.model !== undefined) s.model = str(patch.model, 200);
  if (patch.agentModels) {
    for (const key of ["idea", "topology", "tasks"] as const) {
      if (patch.agentModels[key] !== undefined) s.agentModels[key] = str(patch.agentModels[key], 200);
    }
  }
  if (patch.temperature !== undefined) {
    const t = Number(patch.temperature);
    s.temperature = Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : 0.7;
  }
  if (patch.maxTokens !== undefined) s.maxTokens = clampInt(patch.maxTokens, 0, 200_000, 12_000);
  if (patch.timeoutSec !== undefined) s.timeoutSec = clampInt(patch.timeoutSec, 30, 1800, 300);
  current = enforceProvider(s);
  writeFileAtomic(FILE, JSON.stringify(s, null, 2));
  return s;
}

export function modelFor(agent: AgentKey, s = getSettings()): string {
  return s.agentModels[agent] || s.model;
}

/** What answers for this agent, for status lines and PRD metadata. */
export function brainLabel(agent: AgentKey, s = getSettings()): string {
  return s.provider === "mcp" ? "agent MCP" : modelFor(agent, s);
}

export function publicSettings(s = getSettings()): PublicSettings {
  const key = s.apiKey;
  return {
    routerEnabled: routerEnabled(s),
    provider: s.provider,
    handover: s.handover,
    baseUrl: s.baseUrl,
    hasApiKey: !!key,
    apiKeyPreview: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : "",
    model: s.model,
    agentModels: { ...s.agentModels },
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    timeoutSec: s.timeoutSec,
  };
}
