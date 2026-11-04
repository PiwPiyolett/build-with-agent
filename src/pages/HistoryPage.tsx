import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ProjectSummary } from "../../shared/types";
import { useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { cx, timeAgo } from "../lib/format";
import { projectProgress, type ProgressStepState } from "../lib/projectProgress";
import { projectHref } from "../lib/router";

const RADIUS = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ percent }: { percent: number | null }) {
  const label = percent === null ? "Belum ada task" : `${percent}% task selesai`;
  return (
    <div className="progress-ring" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 58 58" aria-hidden>
        <circle cx="29" cy="29" r={RADIUS} stroke="#efeff2" />
        {!!percent && <circle className="progress-ring-fill" cx="29" cy="29" r={RADIUS} stroke="url(#ring-red)" strokeLinecap="round" strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`} />}
      </svg>
      <b className={cx(percent === null && "font-medium text-mute")}>{percent === null ? "–" : `${percent}%`}</b>
    </div>
  );
}

const STEP_COLOR: Record<ProgressStepState, string> = {
  done: "text-ink-2",
  current: "text-telkom-deep",
  todo: "text-mute",
};

function ProjectCard({ project, onRemove }: { project: ProjectSummary; onRemove: () => void }) {
  const { percent, steps } = projectProgress(project);
  return (
    <li className="lift glass-card group relative rounded-[20px]">
      <a href={projectHref(project.id)} className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-4 py-3.5 pl-3.5 pr-5 sm:grid-cols-[58px_minmax(0,1fr)_auto]">
        <Ring percent={percent} />
        <div className="min-w-0">
          <h2 className="display truncate text-[17px] leading-tight tracking-[-0.016em] text-ink">{project.name}</h2>
          <p className="truncate text-[13.5px] text-steel">{project.prompt}</p>
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold" aria-label={`Tahap: ${steps.find((s) => s.state === "current")?.label}`}>
            {steps.map((step, i) => (
              <span key={step.label} className="contents">
                {i > 0 && <i className="h-[1.5px] w-3.5 rounded-sm bg-rule" aria-hidden />}
                <span className={STEP_COLOR[step.state]}>{step.label}</span>
              </span>
            ))}
          </div>
        </div>
        <span className="hidden self-start whitespace-nowrap pr-8 pt-0.5 text-[12.5px] text-steel sm:block">{timeAgo(project.updatedAt)}</span>
      </a>
      <button
        className="btn btn-ghost btn-sm btn-icon absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
        onClick={onRemove}
        aria-label={`Hapus ${project.name}`}
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

export function HistoryPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch(() => setProjects([]));

  useEffect(() => {
    void load();
  }, []);

  const remove = async (p: ProjectSummary) => {
    const ok = await confirm({
      title: `Hapus "${p.name}"?`,
      body: "Ide, topologi, dan semua task proyek ini akan dihapus dari BWA. File hasil kerja di folder kamu tidak tersentuh.",
      confirmLabel: "Hapus proyek",
      danger: true,
    });
    if (!ok) return;
    await api.deleteProject(p.id);
    toast("Proyek dihapus.");
    void load();
  };

  const doneTasks = projects?.reduce((sum, p) => sum + p.taskCounts.done, 0) ?? 0;

  return (
    <div className="mx-auto w-full max-w-[960px] px-6 pb-16 pt-[118px]">
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id="ring-red" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ef3b41" />
            <stop offset="1" stopColor="#b3121a" />
          </linearGradient>
        </defs>
      </svg>

      <h1 className="display text-[40px] leading-[1.08] text-ink">Riwayat</h1>
      {projects === null ? (
        <p className="mt-1.5 text-[17px] text-ink">Memuat proyek…</p>
      ) : projects.length === 0 ? (
        <>
          <p className="mt-1.5 text-[17px] text-ink">Belum ada proyek.</p>
          <a href="#/" className="btn btn-primary mt-5">
            Tulis ide pertamamu
          </a>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[17px] tracking-[-0.006em] text-ink">
            {projects.length} proyek, {doneTasks} task sudah selesai.
          </p>
          <ul className="stagger mt-6 flex flex-col gap-2.5">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onRemove={() => void remove(p)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
