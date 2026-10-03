import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { Project, Stage } from "../../shared/types";
import { AgentRunOverlay, useAgentRun } from "../components/AgentRun";
import { cx } from "../lib/format";
import { projectHref } from "../lib/router";
import { useProject } from "../lib/useProject";
import { IdeaStage } from "./IdeaStage";
import { PrdStage } from "./PrdStage";
import { TasksStage } from "./TasksStage";
import { TopologyStage } from "./TopologyStage";

export function ProjectPage({ id, stage }: { id: string; stage: Stage | null }) {
  const { project, setProject, error, remote } = useProject(id);
  const runner = useAgentRun();

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-[1080px] px-4 py-16 sm:px-6">
        {error ? (
          <div>
            <p className="text-[15px] text-ink">{error}</p>
            <a href="#/" className="btn btn-secondary mt-4">
              Kembali ke beranda
            </a>
          </div>
        ) : (
          <p className="text-steel">Memuat proyek…</p>
        )}
      </div>
    );
  }

  const available: Record<Stage, boolean> = {
    idea: true,
    topology: !!project.topology,
    tasks: project.tasks.length > 0,
    prd: !!project.prd,
  };
  const wanted = stage ?? project.stage;
  const shown: Stage = available[wanted] ? wanted : available[project.stage] ? project.stage : "idea";

  return (
    <div className="flex flex-1 flex-col">
      <ProjectHeader project={project} stage={shown} available={available} />
      {shown === "idea" && <IdeaStage project={project} setProject={setProject} runner={runner} />}
      {shown === "topology" && <TopologyStage project={project} setProject={setProject} runner={runner} remote={remote} />}
      {shown === "tasks" && <TasksStage project={project} setProject={setProject} runner={runner} />}
      {shown === "prd" && <PrdStage project={project} setProject={setProject} runner={runner} />}
      <AgentRunOverlay runner={runner} />
    </div>
  );
}

function StepLink({
  href,
  active,
  enabled,
  children,
}: {
  href: string;
  active: boolean;
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={enabled ? href : undefined}
      aria-current={active ? "step" : undefined}
      aria-disabled={!enabled}
      className={cx(
        "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold transition-colors",
        active ? "bg-ink text-paper" : enabled ? "text-ink-2 hover:bg-ink/5" : "pointer-events-none text-mute",
      )}
    >
      {children}
    </a>
  );
}

function StepNumber({ n, active }: { n: number; active: boolean }) {
  return (
    <span className={cx("mono grid h-5 w-5 place-items-center rounded text-[10.5px]", active ? "bg-paper text-ink" : "border border-rule bg-panel")}>
      {n}
    </span>
  );
}

function ProjectHeader({ project, stage, available }: { project: Project; stage: Stage; available: Record<Stage, boolean> }) {
  const name = project.brief?.name || project.idea?.title || project.name;
  const line = (on: boolean) => <span className={cx("h-px w-5 shrink-0 sm:w-8", on ? "bg-steel" : "bg-rule")} aria-hidden />;
  return (
    <div className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <a href="#/" className="btn btn-ghost btn-sm btn-icon -ml-2 shrink-0" aria-label="Kembali ke daftar proyek">
            <ChevronLeft size={18} />
          </a>
          <div className="min-w-0">
            <div className="eyebrow">Proyek</div>
            <h1 className="display truncate text-[20px] leading-tight text-ink">{name}</h1>
          </div>
        </div>
        <nav aria-label="Tahap proyek" className="-mx-1 flex items-center overflow-x-auto px-1">
          <StepLink href={projectHref(project.id, "idea")} active={stage === "idea"} enabled>
            <StepNumber n={1} active={stage === "idea"} /> Ide
          </StepLink>
          {line(available.topology)}
          <StepLink href={projectHref(project.id, "topology")} active={stage === "topology"} enabled={available.topology}>
            <StepNumber n={2} active={stage === "topology"} /> Topologi fitur
          </StepLink>
          {line(available.tasks || available.prd)}
          {/* Step 3 forks: build with coding agents, or write a PRD to share. */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-rule bg-panel p-0.5" role="group" aria-label="Langkah 3: pilih jalur">
            <span className="mono grid h-5 w-5 place-items-center rounded text-[10.5px] text-steel">3</span>
            <StepLink href={projectHref(project.id, "tasks")} active={stage === "tasks"} enabled={available.tasks}>
              Task
            </StepLink>
            <span className="text-[11px] text-mute" aria-hidden>
              atau
            </span>
            <StepLink href={projectHref(project.id, "prd")} active={stage === "prd"} enabled={available.prd}>
              PRD
            </StepLink>
          </div>
        </nav>
      </div>
    </div>
  );
}

