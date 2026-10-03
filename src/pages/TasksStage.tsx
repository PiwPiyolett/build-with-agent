import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Cable, Check, Download, Plus, Router } from "lucide-react";
import type { Project, Task, TaskStatus } from "../../shared/types";
import type { AgentRunner } from "../components/AgentRun";
import { LedStrip, Modal, Segmented, StatusLed, useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { clock, cx, STATUS_META, timeAgo } from "../lib/format";
import { projectHref } from "../lib/router";
import { ConnectAgentDialog } from "../tasks/ConnectAgentDialog";
import { TaskDrawer } from "../tasks/TaskDrawer";

interface Props {
  project: Project;
  setProject: (p: Project) => void;
  runner: AgentRunner;
}

type View = "board" | "checklist";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

const actorLabel = (by: string) =>
  ({ "agent-1": "Agent 1", "agent-2": "Agent 2", "agent-3": "Agent 3", user: "Kamu" })[by] ?? by;

function readView(): View {
  try {
    return localStorage.getItem("bwa:tasks-view") === "checklist" ? "checklist" : "board";
  } catch {
    return "board";
  }
}

export function TasksStage({ project, setProject, runner }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<View>(readView);
  const [openId, setOpenId] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const ordered = useMemo(() => [...project.tasks].sort((a, b) => a.order - b.order), [project.tasks]);
  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], blocked: [], done: [] };
    for (const t of ordered) map[t.status].push(t);
    return map;
  }, [ordered]);
  const working = byStatus.in_progress;
  const workers = [...new Set(working.map((t) => t.assignee).filter(Boolean))];
  const openTask = openId ? (project.tasks.find((t) => t.id === openId) ?? null) : null;

  // Announce tasks that an agent ticked off while this page is open.
  const previous = useRef<Map<string, TaskStatus> | null>(null);
  useEffect(() => {
    const prev = previous.current;
    if (prev) {
      for (const t of project.tasks) {
        const was = prev.get(t.id);
        if (was && was !== t.status && t.status === "done" && t.completion && t.completion.by !== "user") {
          toast(`${t.completion.by} menyelesaikan ${t.id} · ${t.title}`, "success");
        } else if (was && was !== t.status && t.status === "in_progress" && t.assignee && t.assignee !== "user") {
          toast(`${t.assignee} mulai mengerjakan ${t.id}`);
        }
      }
    }
    previous.current = new Map(project.tasks.map((t) => [t.id, t.status]));
  }, [project.tasks, toast]);

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("bwa:tasks-view", v);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const patchTask = async (taskId: string, body: Record<string, unknown>) => {
    try {
      setProject(await api.patchTask(project.id, taskId, body));
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const deleteTask = async (task: Task) => {
    const ok = await confirm({
      title: `Hapus ${task.id}?`,
      body: `"${task.title}" akan dihapus dan dilepas dari task lain yang bergantung padanya.`,
      confirmLabel: "Hapus task",
      danger: true,
    });
    if (!ok) return;
    setOpenId(null);
    setProject(await api.deleteTask(project.id, task.id));
  };

  const regenerate = async () => {
    const done = byStatus.done.length;
    const ok = await confirm({
      title: "Bagi ulang semua task?",
      body: `Backlog sekarang (${ordered.length} task${done ? `, ${done} sudah selesai` : ""}) akan diganti hasil baru dari Agent 3.`,
      confirmLabel: "Bagi ulang",
      danger: done > 0,
    });
    if (!ok) return;
    void runner.start(
      [{ agent: 3, label: "Memecah fitur menjadi task untuk agent coding", path: `/projects/${project.id}/agents/tasks/generate` }],
      { onDone: ([p]) => setProject(p as Project) },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 sm:px-6">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="min-w-0">
              <div className="eyebrow">Progres · Agent 3 membagi {ordered.length} task</div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="display text-[40px] leading-none text-ink">
                  {byStatus.done.length}
                  <span className="text-mute">/{ordered.length}</span>
                </span>
                <span className="text-[14px] text-ink-2">
                  task selesai
                  {working.length > 0 && (
                    <>
                      {" "}
                      · {working.length} sedang dikerjakan{workers.length ? ` oleh ${workers.join(", ")}` : ""}
                    </>
                  )}
                  {byStatus.blocked.length > 0 && <> · {byStatus.blocked.length} terhambat</>}
                </span>
              </div>
              <div className="mt-3">
                <LedStrip
                  large
                  statuses={ordered.map((t) => t.status)}
                  labels={ordered.map((t) => `${t.id} · ${t.title} (${STATUS_META[t.status].label})`)}
                  onPick={(i) => setOpenId(ordered[i].id)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => setConnectOpen(true)}>
                <Cable size={16} /> Hubungkan agent
              </button>
              <button className="btn btn-secondary" onClick={() => setAddOpen(true)}>
                <Plus size={16} /> Task
              </button>
              <a className="btn btn-secondary btn-icon" href={`/api/projects/${project.id}/export/agents-md`} download="AGENTS.md" title="Unduh AGENTS.md">
                <Download size={16} />
              </a>
              <button className="btn btn-ghost btn-icon" onClick={regenerate} disabled={runner.busy} title="Bagi ulang dengan Agent 3">
                <Router size={16} />
              </button>
            </div>
          </section>

          <div className="mt-7 flex items-center justify-between gap-3">
            <Segmented<View>
              label="Tampilan task"
              value={view}
              onChange={changeView}
              options={[
                { value: "board", label: "Papan" },
                { value: "checklist", label: "Checklist per fase" },
              ]}
            />
            <a href={projectHref(project.id, "topology")} className="text-[13px] font-semibold text-steel hover:text-ink">
              Lihat topologi fitur
            </a>
          </div>

          {view === "board" ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {COLUMNS.map((status) => (
                <section key={status} aria-label={STATUS_META[status].label} className="min-w-0">
                  <div className="mb-2.5 flex items-center gap-2 border-b border-rule pb-2">
                    <StatusLed status={status} />
                    <h3 className="text-[13.5px] font-bold text-ink">{STATUS_META[status].label}</h3>
                    <span className="mono text-[11px] text-steel">{byStatus[status].length}</span>
                  </div>
                  <div className="space-y-2">
                    {byStatus[status].length === 0 && (
                      <p className="rounded-lg border border-dashed border-rule px-3 py-4 text-center text-[12.5px] text-mute">
                        {status === "in_progress" ? "Belum ada agent yang bekerja." : "Kosong."}
                      </p>
                    )}
                    {byStatus[status].map((t) => (
                      <TaskCard key={t.id} task={t} project={project} onOpen={() => setOpenId(t.id)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Checklist project={project} ordered={ordered} onOpen={setOpenId} onToggle={(t) => patchTask(t.id, { status: t.status === "done" ? "todo" : "done" })} />
          )}
        </div>

        <ActivityFeed project={project} onOpen={setOpenId} />
      </div>

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          project={project}
          task={openTask}
          onClose={() => setOpenId(null)}
          onPatch={(body) => patchTask(openTask.id, body)}
          onDelete={() => deleteTask(openTask)}
          onOpenTask={setOpenId}
        />
      )}
      <ConnectAgentDialog open={connectOpen} onClose={() => setConnectOpen(false)} project={project} />
      <AddTaskDialog
        open={addOpen}
        project={project}
        onClose={() => setAddOpen(false)}
        onCreate={async (body) => {
          const updated = await api.createTask(project.id, body);
          setProject(updated);
          toast("Task ditambahkan di akhir backlog.", "success");
        }}
      />
    </div>
  );
}

function unmet(project: Project, task: Task) {
  return task.dependsOn.map((id) => project.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t && t.status !== "done");
}

function TaskCard({ task, project, onOpen }: { task: Task; project: Project; onOpen: () => void }) {
  const waiting = task.status === "todo" ? unmet(project, task) : [];
  const blockNote = task.status === "blocked" ? [...task.log].reverse().find((l) => l.kind === "block")?.text : undefined;
  return (
    <button className="card w-full p-3 text-left transition-colors hover:border-steel" onClick={onOpen}>
      <div className="flex items-center gap-2">
        <StatusLed status={task.status} />
        <span className="mono text-[11px] font-semibold text-ink-2">{task.id}</span>
        <span className="tag">{task.type}</span>
        {task.priority === "high" && <span className="tag tag-ink">Tinggi</span>}
        <span className="mono ml-auto text-[10.5px] text-steel" title="Estimasi">
          {task.estimate}
        </span>
      </div>
      <div className={cx("mt-1.5 text-[14px] font-semibold leading-snug", task.status === "done" ? "text-ink-2" : "text-ink")}>{task.title}</div>
      {(task.assignee || waiting.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.assignee && (
            <span className={task.status === "in_progress" ? "agent-chip" : "tag normal-case tracking-normal"}>
              <Bot size={11} /> {task.assignee}
            </span>
          )}
          {waiting.length > 0 && <span className="text-[12px] text-steel">menunggu {waiting.map((w) => w.id).join(", ")}</span>}
        </div>
      )}
      {blockNote && <p className="mt-2 line-clamp-2 text-[12.5px] text-[#b42f2b]">{blockNote}</p>}
      {task.status === "done" && task.completion && (
        <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-steel">{task.completion.summary}</p>
      )}
    </button>
  );
}

function Checklist({
  project,
  ordered,
  onOpen,
  onToggle,
}: {
  project: Project;
  ordered: Task[];
  onOpen: (id: string) => void;
  onToggle: (t: Task) => void;
}) {
  const groups = [
    ...project.phases.map((p) => ({ key: p.id, title: `${p.id} · ${p.name}`, goal: p.goal, tasks: ordered.filter((t) => t.phaseId === p.id) })),
    { key: "none", title: "Tanpa fase", goal: "", tasks: ordered.filter((t) => !t.phaseId || !project.phases.some((p) => p.id === t.phaseId)) },
  ].filter((g) => g.tasks.length > 0);

  return (
    <div className="mt-4 space-y-8">
      {groups.map((g) => {
        const done = g.tasks.filter((t) => t.status === "done").length;
        return (
          <section key={g.key}>
            <div className="flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-2">
              <div>
                <h3 className="text-[15.5px] font-bold text-ink">{g.title}</h3>
                {g.goal && <p className="text-[13px] text-steel">{g.goal}</p>}
              </div>
              <div className="flex items-center gap-2.5">
                <LedStrip statuses={g.tasks.map((t) => t.status)} />
                <span className="mono text-[11px] text-steel">
                  {done}/{g.tasks.length}
                </span>
              </div>
            </div>
            <ul>
              {g.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-b border-rule-2 py-2.5">
                  <button
                    role="checkbox"
                    aria-checked={t.status === "done"}
                    aria-label={t.status === "done" ? `Buka lagi ${t.id}` : `Tandai ${t.id} selesai`}
                    onClick={() => onToggle(t)}
                    className={cx(
                      "grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border-[1.5px] transition-colors",
                      t.status === "done" ? "border-pair-green bg-pair-green text-white" : "border-mute bg-panel hover:border-ink",
                    )}
                  >
                    {t.status === "done" && <Check size={14} strokeWidth={3} />}
                  </button>
                  <span className="mono w-9 shrink-0 text-[11px] font-semibold text-ink-2">{t.id}</span>
                  <button
                    className={cx(
                      "min-w-0 flex-1 truncate text-left text-[14px] font-semibold hover:underline",
                      t.status === "done" ? "text-steel line-through decoration-rule" : "text-ink",
                    )}
                    onClick={() => onOpen(t.id)}
                  >
                    {t.title}
                  </button>
                  <span className="hidden sm:inline-flex">
                    <span className="tag">{t.type}</span>
                  </span>
                  {t.assignee && (
                    <span className={cx("hidden md:inline-flex", t.status === "in_progress" ? "agent-chip" : "tag normal-case tracking-normal")}>
                      <Bot size={11} /> {t.assignee}
                    </span>
                  )}
                  <span className="flex w-[104px] shrink-0 items-center justify-end gap-1.5 text-[12px] text-steel">
                    <StatusLed status={t.status} />
                    {STATUS_META[t.status].label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ActivityFeed({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const entries = [...project.activity].reverse().slice(0, 40);
  return (
    <aside className="self-start xl:sticky xl:top-[72px]">
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="eyebrow">Aktivitas</h3>
          <span className="flex items-center gap-1.5 text-[11.5px] text-steel">
            <span className="led led-green" aria-hidden /> langsung
          </span>
        </div>
        {entries.length === 0 ? (
          <p className="mt-3 text-[13px] text-steel">Belum ada aktivitas.</p>
        ) : (
          <ol className="mt-3 max-h-[70dvh] space-y-3 overflow-y-auto pr-1">
            {entries.map((a, i) => (
              <li key={`${a.at}-${i}`} className="text-[13px] leading-snug">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-ink">{actorLabel(a.by)}</span>
                  <span className="mono text-[10px] text-mute" title={timeAgo(a.at)}>
                    {clock(a.at)}
                  </span>
                </div>
                {a.taskId ? (
                  <button className="text-left text-ink-2 hover:underline" onClick={() => onOpen(a.taskId!)}>
                    {a.text}
                  </button>
                ) : (
                  <p className="text-ink-2">{a.text}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function AddTaskDialog({
  open,
  project,
  onClose,
  onCreate,
}: {
  open: boolean;
  project: Project;
  onClose: () => void;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setPhaseId(project.phases.at(-1)?.id ?? "");
    }
  }, [open, project.phases]);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onCreate({ title: title.trim(), description: description.trim(), phaseId: phaseId || null });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Task baru"
      title="Tambah task manual"
      width="max-w-lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim() || saving}>
            Tambah task
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label className="label" htmlFor="new-title">
            Judul
          </label>
          <input
            id="new-title"
            className="field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Contoh: Tambah halaman riwayat pembayaran"
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-desc">
            Deskripsi
          </label>
          <textarea
            id="new-desc"
            className="field min-h-[90px] text-[14px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Apa yang harus dibangun, di mana, dan bagaimana tersambung dengan bagian lain."
          />
        </div>
        {project.phases.length > 0 && (
          <div>
            <label className="label" htmlFor="new-phase">
              Fase
            </label>
            <select id="new-phase" className="field" value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
              {project.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} · {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-[12.5px] text-steel">Kriteria selesai, dependensi, dan petunjuk untuk agent bisa diisi setelah task dibuat.</p>
      </div>
    </Modal>
  );
}
