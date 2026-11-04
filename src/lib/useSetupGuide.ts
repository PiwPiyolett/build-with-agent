import { useCallback, useEffect, useState } from "react";
import { guideProgress, suggestAgent, type GuideAgent, type GuideAnswers } from "../../shared/setupGuide";
import type { AgentConnection, BrainWorker } from "../../shared/types";
import { api } from "./api";

type AllAnswers = Partial<Record<GuideAgent, GuideAnswers>>;

const ANSWERS_KEY = "bwa.guideAnswers";

// Only a convenience: the guide works the same if the browser's storage is unavailable, it just asks again.
function readAnswers(): AllAnswers {
  try {
    return JSON.parse(localStorage.getItem(ANSWERS_KEY) ?? "{}") as AllAnswers;
  } catch {
    return {};
  }
}

function saveAnswers(answers: AllAnswers) {
  try {
    localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
  } catch {
    /* see readAnswers */
  }
}

/** The state of the guide while it is open: what is on this computer, who is connected, and which step is next. */
export function useSetupGuide(open: boolean) {
  const [conns, setConns] = useState<Record<GuideAgent, AgentConnection> | null>(null);
  const [workers, setWorkers] = useState<BrainWorker[]>([]);
  const [chosen, setChosen] = useState<GuideAgent | null>(null);
  const [answers, setAnswers] = useState<AllAnswers>(readAnswers);
  const [loadError, setLoadError] = useState<string | null>(null);

  const agent = chosen ?? (conns ? suggestAgent(conns, workers) : "claude");
  const conn = conns?.[agent] ?? null;
  const progress = conn ? guideProgress(conn, workers, answers[agent]) : null;

  const recheck = useCallback(() => {
    api
      .connections()
      .then((next) => {
        setConns(next);
        setLoadError(null);
      })
      .catch((err) => setLoadError((err as Error).message));
  }, []);

  // Asking who is connected is a cheap read, so it runs often.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const poll = () =>
      api
        .brainStatus()
        .then((s) => alive && setWorkers(s.workers))
        .catch(() => {});
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);

  // Coming back from installing or signing in is the moment something may have changed.
  useEffect(() => {
    if (!open) return;
    recheck();
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [open, recheck]);

  // Checking the agents starts a program, so it repeats only on the steps that wait for something outside BWA.
  const waitingOutside = progress?.current === "install" || progress?.current === "signin";
  useEffect(() => {
    if (!open || !waitingOutside) return;
    const t = setInterval(recheck, 8000);
    return () => clearInterval(t);
  }, [open, waitingOutside, recheck]);

  const answer = useCallback(
    (key: keyof GuideAnswers) => {
      const next = { ...answers, [agent]: { ...answers[agent], [key]: true } };
      setAnswers(next);
      saveAnswers(next);
      recheck();
    },
    [agent, answers, recheck],
  );

  const connect = useCallback(async () => {
    const next = await api.connectAgent(agent);
    setConns((all) => all && { ...all, [agent]: next });
  }, [agent]);

  return { agent, setAgent: setChosen, conn, progress, loadError, recheck, answer, connect };
}
