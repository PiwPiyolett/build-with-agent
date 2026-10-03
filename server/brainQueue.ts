// The MCP brain: instead of calling 9router, the agents queue their prompt here and a standby
// MCP client (Claude Code, Codex, …) answers it with its own model. The client long-polls
// wait_for_brain_job through the bridge, thinks, and posts the answer with submit_brain_result.
// Once Agent 3 has split the tasks, the same poll delivers a handover: the session leaves brain
// mode and becomes the project's coding agent.
// Everything lives in memory: a restart drops queued jobs and the waiting run fails with a clear message.

import { randomBytes } from "node:crypto";
import type { AgentKey, BrainWorker } from "../shared/types.ts";
import { LlmError, type ChatOptions, type ChatResult } from "./llm.ts";
import { HttpError } from "./util.ts";

/** A worker that polled within this window counts as standby: one long-poll plus the agent's own turn overhead. */
const ONLINE_MS = 90_000;
/** How long a queued job waits when no agent is standby at all, before the run fails with instructions. */
const NO_WORKER_GRACE_MS = 45_000;
/** A handover nobody picked up is stale after this; it must not surprise a brain session opened much later. */
const HANDOVER_TTL_MS = 10 * 60_000;
/**
 * Upper bound for one long-poll. MCP clients give up on a tool call after about 60 seconds
 * (the MCP SDK default, and Codex's tool_timeout_sec), so the server must answer well before that.
 */
export const MAX_WAIT_SEC = 50;

const ROLE: Record<AgentKey, string> = {
  idea: "Agent 1 · Idea Developer",
  topology: "Agent 2 · Feature Architect",
  tasks: "Agent 3 · Task planner and PRD writer",
};

interface Job {
  id: string;
  agent: AgentKey;
  system: string;
  user: string;
  claimedBy: string | null;
  onClaim: (worker: string) => void;
  settle: (result: { text: string; by: string } | LlmError) => void;
}

interface Handover {
  projectId: string;
  /** the session that answered Agent 3, i.e. the one sitting in this project's repository */
  preferred: string | null;
  markdown: string;
  expiresAt: number;
  onDelivered: (worker: string) => void;
}

/** What one wait_for_brain_job call returns: a job to answer, or the end of brain mode. */
export interface BrainDelivery {
  kind: "job" | "handover";
  id: string;
  markdown: string;
}

interface Waiter {
  worker: string;
  give: (delivery: BrainDelivery | null) => void;
}

const pending: Job[] = [];
const claimed = new Map<string, Job>();
const handovers: Handover[] = [];
const waiters: Waiter[] = [];
const lastSeen = new Map<string, number>();
const lastAnswered = new Map<AgentKey, string>();

const touch = (worker: string) => lastSeen.set(worker, Date.now());

export function standbyWorkers(): BrainWorker[] {
  const now = Date.now();
  const busy = new Map<string, number>();
  for (const job of claimed.values()) if (job.claimedBy) busy.set(job.claimedBy, (busy.get(job.claimedBy) ?? 0) + 1);
  return [...lastSeen.entries()]
    .filter(([name, at]) => busy.has(name) || now - at < ONLINE_MS)
    .sort((a, b) => b[1] - a[1])
    .map(([name, at]) => ({ name, lastSeen: new Date(at).toISOString(), busy: busy.get(name) ?? 0 }));
}

export const pendingCount = () => pending.length;

function claim(job: Job, worker: string): BrainDelivery {
  job.claimedBy = worker;
  claimed.set(job.id, job);
  job.onClaim(worker);
  const markdown = [
    `# BWA brain job ${job.id} · ${ROLE[job.agent]}`,
    "You are the AI model behind BWA for this job. Read SYSTEM and INPUT below, then call `submit_brain_result` " +
      `with job_id "${job.id}" and your complete answer as \`output\`.`,
    "- Produce exactly what SYSTEM asks for (usually one JSON object: no markdown fences, no commentary).",
    "- Everything you need is below. Do not read or edit files, run commands, or call other tools for this job.",
    "- If you truly cannot answer, call `fail_brain_job` with the reason instead.",
    "- After submitting, call `wait_for_brain_job` again for the next job.",
    "",
    "## SYSTEM",
    job.system,
    "",
    "## INPUT",
    job.user,
  ].join("\n");
  return { kind: "job", id: job.id, markdown };
}

/** May `worker` take this handover? Its preferred session gets it, unless that session is gone. */
function eligible(h: Handover, worker: string): boolean {
  if (!h.preferred || h.preferred === worker) return true;
  return !standbyWorkers().some((w) => w.name === h.preferred);
}

function deliverHandover(h: Handover, worker: string): BrainDelivery {
  const i = handovers.indexOf(h);
  if (i >= 0) handovers.splice(i, 1);
  // The session leaves brain mode now: stop counting it as standby, so new jobs fail fast instead of waiting for it.
  lastSeen.delete(worker);
  h.onDelivered(worker);
  return { kind: "handover", id: `handover-${h.projectId}`, markdown: h.markdown };
}

function nextHandover(worker: string): Handover | undefined {
  const now = Date.now();
  for (let i = handovers.length - 1; i >= 0; i--) if (handovers[i].expiresAt < now) handovers.splice(i, 1);
  return handovers.find((h) => eligible(h, worker));
}

/** Long-poll: resolves with the next job (already claimed by `worker`) or handover, or null after `waitSec`. */
export function waitForJob(worker: string, waitSec: number, signal?: AbortSignal): Promise<BrainDelivery | null> {
  touch(worker);
  // Answer queued jobs before leaving brain mode, so a handover never strands work.
  const next = pending.shift();
  if (next) return Promise.resolve(claim(next, worker));
  const handover = nextHandover(worker);
  if (handover) return Promise.resolve(deliverHandover(handover, worker));

  return new Promise((resolve) => {
    const waiter: Waiter = {
      worker,
      give: (delivery) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        if (delivery?.kind !== "handover") touch(worker);
        resolve(delivery);
      },
    };
    const timer = setTimeout(() => waiter.give(null), Math.min(waitSec, MAX_WAIT_SEC) * 1000);
    // The bridge gave up on this request: never hand anything to a caller that is gone.
    const onAbort = () => waiter.give(null);
    signal?.addEventListener("abort", onAbort, { once: true });
    waiters.push(waiter);
  });
}

function findClaimed(worker: string, jobId: string): Job {
  touch(worker);
  const job = claimed.get(jobId);
  if (!job) {
    throw new HttpError(
      404,
      `Job ${jobId} sudah tidak menunggu jawaban.`,
      "Job itu sudah dijawab, dibatalkan pengguna, atau kedaluwarsa. Panggil wait_for_brain_job untuk job berikutnya.",
    );
  }
  return job;
}

export function submitJob(worker: string, jobId: string, output: string) {
  if (!output.trim()) throw new HttpError(400, "Output kosong.", "Kirim jawaban lengkap sesuai instruksi SYSTEM pada job.");
  const job = findClaimed(worker, jobId);
  lastAnswered.set(job.agent, worker);
  job.settle({ text: output, by: worker });
}

export function failJob(worker: string, jobId: string, reason: string) {
  findClaimed(worker, jobId).settle(
    new LlmError(
      `Agent MCP (${worker}) tidak bisa menjawab: ${reason || "tanpa alasan"}`,
      "brain_failed",
      "Jalankan lagi, atau ganti ke 9router di Pengaturan.",
    ),
  );
}

/**
 * Ends brain mode for the session that answered Agent 3: its next wait_for_brain_job (or the one it is
 * blocked in right now) returns `markdown`. One handover per project; a newer one replaces the older.
 */
export function queueHandover(projectId: string, markdown: string, onDelivered: (worker: string) => void) {
  for (let i = handovers.length - 1; i >= 0; i--) if (handovers[i].projectId === projectId) handovers.splice(i, 1);
  const h: Handover = {
    projectId,
    preferred: lastAnswered.get("tasks") ?? null,
    markdown,
    expiresAt: Date.now() + HANDOVER_TTL_MS,
    onDelivered,
  };
  const waiter = waiters.find((w) => eligible(h, w.worker));
  if (waiter) waiter.give(deliverHandover(h, waiter.worker));
  else handovers.push(h);
}

const START_HINT =
  "Buka Claude Code atau Codex yang sudah terhubung ke MCP server bwa, lalu jalankan prompt jadi_otak " +
  "(Claude Code: /mcp__bwa__jadi_otak). Biarkan sesinya tetap terbuka. Atau ganti ke 9router di Pengaturan.";

/** chat() for provider "mcp": queues the prompt and resolves when a standby agent answers it. */
export function chatViaBrain(opts: ChatOptions, timeoutSec: number): Promise<ChatResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new LlmError("Dibatalkan.", "aborted"));

    let settled = false;
    let thinking: ReturnType<typeof setTimeout> | undefined;
    let lonelySince: number | null = null;

    const job: Job = {
      id: `b${randomBytes(3).toString("hex")}`,
      agent: opts.agent,
      system: opts.system,
      user: opts.user,
      claimedBy: null,
      onClaim: (worker) => {
        opts.onStatus?.(`${worker} mengambil job ${job.id} dan sedang berpikir…`);
        // Time spent queued behind other jobs does not count: the limit applies to answering.
        thinking = setTimeout(
          () =>
            job.settle(
              new LlmError(
                `${worker} tidak mengirim jawaban dalam ${timeoutSec} detik.`,
                "brain_timeout",
                "Pastikan sesi agent masih berjalan, atau naikkan Timeout di Pengaturan.",
              ),
            ),
          timeoutSec * 1000,
        );
      },
      settle: (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(thinking);
        clearInterval(watch);
        opts.signal?.removeEventListener("abort", onAbort);
        const i = pending.indexOf(job);
        if (i >= 0) pending.splice(i, 1);
        claimed.delete(job.id);
        if (result instanceof LlmError) reject(result);
        else resolve({ text: result.text, finishReason: "stop", model: `mcp:${result.by}` });
      },
    };

    // While unclaimed, fail only when no agent has been standby for the whole grace period.
    const watch = setInterval(() => {
      if (job.claimedBy) return;
      if (standbyWorkers().length > 0) {
        lonelySince = null;
        return;
      }
      lonelySince ??= Date.now();
      if (Date.now() - lonelySince >= NO_WORKER_GRACE_MS) {
        job.settle(new LlmError("Tidak ada agent MCP yang standby untuk menjawab.", "no_worker", START_HINT));
      }
    }, 2_000);
    const onAbort = () => job.settle(new LlmError("Dibatalkan.", "aborted"));
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const standby = standbyWorkers();
    opts.onStatus?.(
      standby.length
        ? `Job ${job.id} masuk antrean · standby: ${standby.map((w) => w.name).join(", ")}`
        : `Job ${job.id} menunggu agent MCP. Jalankan /mcp__bwa__jadi_otak di Claude Code (atau prompt jadi_otak di Codex).`,
    );

    const waiter = waiters.shift();
    if (waiter) waiter.give(claim(job, waiter.worker));
    else pending.push(job);
  });
}
