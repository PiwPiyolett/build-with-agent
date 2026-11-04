import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import type { Project, Stage } from "../../shared/types";
import { AgentRunOverlay, useAgentRun } from "../components/AgentRun";
import { Glow } from "../components/Glow";
import { Capsule, TopBar, type CapsuleItem } from "../components/TopBar";
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
      <div className="mx-auto w-full max-w-[1080px] px-4 pb-16 pt-[118px] sm:px-6">
        <TopBar />
        {error ? (
          <div>
            <p className="text-[15px] text-ink">{error}</p>
            <a href="#/riwayat" className="btn btn-secondary mt-4">
              Kembali ke Riwayat
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
    <div className="flex flex-1 flex-col pt-[78px]">
      {/* Topology and Tasks stay still: people read and arrange many boxes there. */}
      {(shown === "idea" || shown === "prd") && <Glow soft />}
      <ProjectBar project={project} stage={shown} available={available} />
      <div className="page-fade flex flex-1 flex-col">
        {shown === "idea" && <IdeaStage project={project} setProject={setProject} runner={runner} />}
        {shown === "topology" && <TopologyStage project={project} setProject={setProject} runner={runner} remote={remote} />}
        {shown === "tasks" && <TasksStage project={project} setProject={setProject} runner={runner} />}
        {shown === "prd" && <PrdStage project={project} setProject={setProject} runner={runner} />}
      </div>
      <AgentRunOverlay runner={runner} />
    </div>
  );
}

/** Inside a project the floating bar shows its way back, its name, and its steps instead of the three main pages. */
function ProjectBar({ project, stage, available }: { project: Project; stage: Stage; available: Record<Stage, boolean> }) {
  const name = project.brief?.name || project.idea?.title || project.name;
  const step = (n: number, label: string) => (
    <>
      <span className="capsule-step">{n}</span>
      {label}
    </>
  );
  const items = useMemo<CapsuleItem[]>(
    () => [
      { key: "idea", label: step(1, "Ide"), href: projectHref(project.id, "idea") },
      { key: "topology", label: step(2, "Topologi"), href: projectHref(project.id, "topology"), enabled: available.topology },
      { key: "tasks", label: step(3, "Task"), href: projectHref(project.id, "tasks"), enabled: available.tasks },
      // Step 3 forks: build with an assistant, or write a PRD to share.
      {
        key: "prd",
        label: "PRD",
        href: projectHref(project.id, "prd"),
        enabled: available.prd,
        before: (
          <span className="capsule-or" aria-hidden>
            atau
          </span>
        ),
      },
    ],
    [project.id, available.topology, available.tasks, available.prd],
  );
  return (
    <TopBar
      left={
        <a href="#/riwayat" className="topbar-pill glass max-w-full gap-1 pl-2.5 pr-[18px]" aria-label={`Kembali ke Riwayat. Proyek ini: ${name}`} title={name}>
          <ChevronLeft size={18} className="shrink-0" />
          <span className="truncate text-[14px] font-semibold tracking-[-0.005em]">{name}</span>
        </a>
      }
      center={<Capsule items={items} active={stage} label="Tahap proyek" current="step" compact />}
    />
  );
}

