import type { ProjectSummary } from "../../shared/types";

export type ProgressStepState = "done" | "current" | "todo";

export interface ProjectProgress {
  /** Share of tasks done, rounded down so 100 only ever means all of them. Null while there are no tasks. */
  percent: number | null;
  /** The road a project travels. Exactly one step is current, and it is the last one once the project is finished. */
  steps: { label: string; state: ProgressStepState }[];
}

export function projectProgress({ stage, taskStrip }: Pick<ProjectSummary, "stage" | "taskStrip">): ProjectProgress {
  const total = taskStrip.length;
  const done = taskStrip.filter((status) => status === "done").length;

  // A PRD is the end of its path. Tasks are the end of theirs only once every one of them is done.
  const finished = stage === "prd" || (stage === "tasks" && total > 0 && done === total);
  const reached = finished ? 3 : stage === "idea" ? 0 : stage === "topology" ? 1 : 2;

  return {
    percent: total > 0 ? Math.floor((done / total) * 100) : null,
    steps: ["Ide", "Topologi", stage === "prd" ? "PRD" : "Task", "Selesai"].map((label, i) => ({
      label,
      state: i < reached ? "done" : i === reached ? "current" : "todo",
    })),
  };
}
