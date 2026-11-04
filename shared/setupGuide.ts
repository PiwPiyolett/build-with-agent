// Where someone stands in the "Hubungkan asisten AI" guide. Logic only, with no screens or wording, so it survives
// a redesign of the UI and can be tested without a browser. The wording lives in src/lib/setupGuide.ts.

import type { AgentConnection, BrainWorker } from "./types.ts";

export type GuideAgent = AgentConnection["agent"];
export type GuideStep = "install" | "signin" | "connect" | "start";
export type GuideStepState = "done" | "current" | "todo";

/** What the person told the guide themselves, for what BWA cannot check from outside. */
export interface GuideAnswers {
  install?: boolean;
  signin?: boolean;
}

export interface GuideProgress {
  steps: Record<GuideStep, GuideStepState>;
  /** the first unfinished step; null once the assistant has answered BWA */
  current: GuideStep | null;
  /** this assistant is talking to BWA right now */
  ready: boolean;
  /** the Claude app is signed in, but its copy of Claude Code only arrives once the Code tab has been opened */
  needsCodeTab: boolean;
  /** connected by an older BWA, or the short command is missing: the connect step says "update" */
  needsUpdate: boolean;
}

export const GUIDE_STEPS: GuideStep[] = ["install", "signin", "connect", "start"];

/** The name a connected assistant reports to BWA. */
const WORKER_NAME: Record<GuideAgent, string> = { claude: "claude-code", codex: "codex" };
const LABELS: Record<string, string> = { "claude-code": "Claude", codex: "Codex" };

/** What to call a connected assistant on screen. */
export const agentLabel = (workerName: string) => LABELS[workerName] ?? workerName;

const isReady = (agent: GuideAgent, workers: BrainWorker[]) => workers.some((w) => w.name === WORKER_NAME[agent]);

export function guideProgress(conn: AgentConnection, workers: BrainWorker[], answers: GuideAnswers = {}): GuideProgress {
  const ready = isReady(conn.agent, workers);
  const connected = conn.state === "connected" && conn.skill !== false;
  // Claude Code has to be on this machine before BWA can register itself in it.
  const canConnect = conn.agent === "codex" || conn.found;
  const finished: Record<GuideStep, boolean> = {
    install: conn.found || conn.appFound === true || answers.install === true,
    // A known "not signed in" wins over the person's answer. Someone already connected has clearly signed in before.
    signin: conn.signedIn === true || (conn.signedIn !== false && ((answers.signin === true && canConnect) || conn.state === "connected")),
    connect: connected,
    start: false,
  };
  // An assistant that answers proves every step, including the ones BWA could not check.
  const current = ready ? null : (GUIDE_STEPS.find((step) => !finished[step]) ?? null);
  const position = current ? GUIDE_STEPS.indexOf(current) : GUIDE_STEPS.length;
  const steps = Object.fromEntries(
    GUIDE_STEPS.map((step, i) => [step, i < position ? "done" : i === position ? "current" : "todo"]),
  ) as Record<GuideStep, GuideStepState>;
  return {
    steps,
    current,
    ready,
    needsCodeTab: conn.agent === "claude" && !conn.found && conn.appFound === true && answers.signin === true,
    needsUpdate: conn.state === "outdated" || (conn.state === "connected" && conn.skill === false),
  };
}

/** Which assistant to show first: the one furthest along, and Claude when there is nothing to go on. */
export function suggestAgent(conns: Record<GuideAgent, AgentConnection>, workers: BrainWorker[]): GuideAgent {
  const score = (agent: GuideAgent) => {
    const c = conns[agent];
    if (isReady(agent, workers)) return 3;
    if (c.state !== "disconnected") return 2;
    return c.found || c.appFound ? 1 : 0;
  };
  return score("codex") > score("claude") ? "codex" : "claude";
}
