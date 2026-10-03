import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { AgentError, runAgent } from "../lib/api";
import { AGENTS, cx, elapsed, nf } from "../lib/format";
import { ErrorNote, Led } from "./ui";

export interface RunStep {
  agent: 1 | 2 | 3;
  /** overrides the agent's role name, e.g. Agent 3 writing a PRD */
  agentName?: string;
  label: string;
  path: string;
  body?: unknown;
}

type StepStatus = "pending" | "running" | "done" | "error";

interface RunState {
  steps: (RunStep & { status: StepStatus })[];
  log: string[];
  chars: number;
  reasoning: number;
  startedAt: number;
  stepStartedAt: number;
  error: { message: string; hint?: string } | null;
}

interface StartOptions {
  onDone: (results: unknown[]) => void;
  onStep?: (index: number, result: unknown) => void;
}

/** Runs one or more streaming agent calls in sequence and exposes their live state. */
export function useAgentRun() {
  const [state, setState] = useState<RunState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const last = useRef<{ steps: RunStep[]; opts: StartOptions } | null>(null);

  const start = useCallback(async (steps: RunStep[], opts: StartOptions) => {
    last.current = { steps, opts };
    const ctrl = new AbortController();
    controller.current = ctrl;
    const now = Date.now();
    setState({
      steps: steps.map((s) => ({ ...s, status: "pending" })),
      log: [],
      chars: 0,
      reasoning: 0,
      startedAt: now,
      stepStartedAt: now,
      error: null,
    });
    const setStep = (i: number, status: StepStatus) =>
      setState((s) => s && { ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, status } : st)) });

    const results: unknown[] = [];
    for (let i = 0; i < steps.length; i++) {
      setState((s) => s && { ...s, chars: 0, reasoning: 0, stepStartedAt: Date.now() });
      setStep(i, "running");
      try {
        const result = await runAgent(
          steps[i].path,
          steps[i].body ?? {},
          (ev) => {
            if (ev.type === "status") setState((s) => s && { ...s, log: [...s.log, ev.message].slice(-5) });
            if (ev.type === "progress") setState((s) => s && { ...s, chars: ev.chars, reasoning: ev.reasoningChars });
          },
          ctrl.signal,
        );
        results.push(result);
        setStep(i, "done");
        opts.onStep?.(i, result);
      } catch (err) {
        if (ctrl.signal.aborted) {
          setState(null);
          return;
        }
        const e = err as AgentError;
        setState((s) => s && { ...s, error: { message: e.message, hint: e.hint } });
        setStep(i, "error");
        return;
      }
    }
    setState(null);
    opts.onDone(results);
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    setState(null);
  }, []);

  const dismiss = useCallback(() => setState(null), []);

  const retry = useCallback(() => {
    if (last.current) void start(last.current.steps, last.current.opts);
  }, [start]);

  return { state, start, cancel, dismiss, retry, busy: !!state && !state.error };
}

export type AgentRunner = ReturnType<typeof useAgentRun>;

export function AgentRunOverlay({ runner }: { runner: AgentRunner }) {
  const { state } = runner;
  const mcp = useApp().status?.provider === "mcp";
  const [, tick] = useState(0);
  useEffect(() => {
    if (!state || state.error) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  if (!state) return null;

  const running = state.steps.find((s) => s.status === "running");
  const waitedLong = Date.now() - state.stepStartedAt > 25_000;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-paper/75 p-4 backdrop-blur-[2px]">
      <div className="card rise-in w-full max-w-[460px] p-5 shadow-2xl" role="status" aria-live="polite">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{state.error ? "Agent berhenti" : "Agent sedang bekerja"}</span>
          <span className="mono text-[11px] text-steel">{elapsed(Date.now() - state.startedAt)}</span>
        </div>

        <ol className="mt-4 space-y-2.5">
          {state.steps.map((step, i) => (
            <li key={i} className="flex items-center gap-3">
              <Led
                state={step.status === "done" ? "green" : step.status === "running" ? "amber" : step.status === "error" ? "red" : "off"}
              />
              <div className="min-w-0">
                <div className={cx("text-[14px] font-semibold", step.status === "pending" && "text-mute")}>
                  {AGENTS[step.agent].short} · {step.agentName ?? AGENTS[step.agent].name}
                </div>
                <div className="text-[13px] text-steel">{step.label}</div>
              </div>
            </li>
          ))}
        </ol>

        {!state.error && (
          <div className="mt-5">
            <div className="flex items-center gap-2.5">
              <span className="mono text-[10px] font-semibold tracking-wider text-ink-2">BWA</span>
              <div className="cable flex-1">
                <i />
              </div>
              <span className="mono text-[10px] font-semibold tracking-wider text-ink-2">{mcp ? "AGENT MCP" : "9ROUTER"}</span>
            </div>
            <div className="mono mt-3 text-[11px] text-steel">
              {state.chars > 0
                ? `${nf.format(state.chars)} karakter diterima`
                : state.reasoning > 0
                  ? `model sedang berpikir · ${nf.format(state.reasoning)} karakter penalaran`
                  : mcp
                    ? "menunggu jawaban agent MCP…"
                    : "menunggu respons pertama dari model…"}
            </div>
            {running && waitedLong && state.chars === 0 && (
              <p className="mt-2 text-[12.5px] text-steel">
                {mcp
                  ? "Agent MCP mengirim jawaban sekaligus setelah selesai berpikir. Biasanya 1 sampai 3 menit; pantau sesi agentnya."
                  : "Beberapa provider baru mengirim jawaban setelah selesai menulis. Biasanya 30 sampai 90 detik."}
              </p>
            )}
            {state.log.length > 0 && (
              <ul className="mono mt-3 space-y-1 border-t border-rule-2 pt-3 text-[11px] text-ink-2">
                {state.log.slice(-3).map((line, i) => (
                  <li key={i} className="truncate">
                    › {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {state.error && (
          <div className="mt-4">
            <ErrorNote message={state.error.message} hint={state.error.hint} />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {state.error ? (
            <>
              <button className="btn btn-secondary" onClick={runner.dismiss}>
                Tutup
              </button>
              <button className="btn btn-primary" onClick={runner.retry}>
                Coba lagi
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" onClick={runner.cancel}>
              Batalkan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
