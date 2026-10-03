import { useEffect, useState } from "react";
import { Check, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { Project, Task, TaskLogKind, TaskPriority, TaskStatus } from "../../shared/types";
import { Segmented, StatusLed } from "../components/ui";
import { clock, cx, STATUS_META, TASK_TYPES, timeAgo } from "../lib/format";

const LOG_LABEL: Record<TaskLogKind, string> = {
  create: "membuat task",
  claim: "mengambil task",
  note: "catatan",
  complete: "menandai selesai",
  block: "terhambat",
  release: "melepas task",
  reopen: "membuka lagi",
  edit: "mengubah task",
};

const actorLabel = (by: string) =>
  ({ "agent-1": "Agent 1", "agent-2": "Agent 2", "agent-3": "Agent 3", user: "Kamu" })[by] ?? by;

interface Props {
  project: Project;
  task: Task;
  onClose: () => void;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
  onOpenTask: (id: string) => void;
}

export function TaskDrawer({ project, task, onClose, onPatch, onDelete, onOpenTask }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [hint, setHint] = useState(task.agentHint);
  const [criteria, setCriteria] = useState<string[]>(task.acceptance);
  const [depPick, setDepPick] = useState("");
  const [featPick, setFeatPick] = useState("");

  // Pick up changes made by agents while the drawer is open.
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);
  useEffect(() => setHint(task.agentHint), [task.agentHint]);
  useEffect(() => setCriteria(task.acceptance), [task.acceptance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = (field: keyof Task, value: unknown) => {
    if (JSON.stringify(value) !== JSON.stringify(task[field])) void onPatch({ [field]: value });
  };

  const nodes = project.topology?.nodes ?? [];
  const deps = task.dependsOn.map((id) => project.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t);
  const depOptions = [...project.tasks]
    .sort((a, b) => a.order - b.order)
    .filter((t) => t.id !== task.id && !task.dependsOn.includes(t.id));
  const features = task.featureIds.map((id) => nodes.find((n) => n.id === id)).filter((n) => !!n);
  const featureOptions = nodes.filter((n) => n.kind !== "product" && !task.featureIds.includes(n.id));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/25" onMouseDown={onClose}>
      <aside
        className="rise-in flex h-full w-full max-w-[540px] flex-col bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={`Task ${task.id}`}
      >
        <div className="flex items-center gap-2.5 border-b border-rule-2 px-5 py-3">
          <StatusLed status={task.status} large />
          <span className="mono text-[12px] font-semibold text-ink">{task.id}</span>
          <select
            className="field h-8 w-auto py-0 text-[13px]"
            value={task.status}
            onChange={(e) => void onPatch({ status: e.target.value as TaskStatus })}
            aria-label="Status"
          >
            {(Object.keys(STATUS_META) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          {task.assignee && <span className={cx(task.status === "in_progress" ? "agent-chip" : "tag normal-case tracking-normal")}>{task.assignee}</span>}
          <button className="btn btn-ghost btn-sm btn-icon ml-auto" onClick={onClose} aria-label="Tutup">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <textarea
            className="display w-full resize-none bg-transparent text-[21px] leading-snug text-ink outline-none"
            rows={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && commit("title", title.trim())}
            aria-label="Judul task"
          />

          {task.completion && (
            <div className="rounded-lg border border-led-green/40 bg-led-green/5 p-3.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <Check size={15} className="text-pair-green" /> Selesai oleh {actorLabel(task.completion.by)}
                <span className="font-normal text-steel">· {timeAgo(task.completedAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{task.completion.summary}</p>
              {task.completion.files.length > 0 && (
                <ul className="mono mt-2 space-y-0.5 text-[11px] text-steel">
                  {task.completion.files.map((f) => (
                    <li key={f} className="truncate">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="t-phase">
                Fase
              </label>
              <select id="t-phase" className="field" value={task.phaseId ?? ""} onChange={(e) => commit("phaseId", e.target.value || null)}>
                <option value="">Tanpa fase</option>
                {project.phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} · {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="t-type">
                Tipe
              </label>
              <select id="t-type" className="field" value={task.type} onChange={(e) => commit("type", e.target.value)}>
                {[...new Set([...TASK_TYPES, task.type])].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Prioritas</span>
              <Segmented<TaskPriority>
                label="Prioritas"
                value={task.priority}
                onChange={(v) => commit("priority", v)}
                options={[
                  { value: "high", label: "Tinggi" },
                  { value: "medium", label: "Sedang" },
                  { value: "low", label: "Rendah" },
                ]}
              />
            </div>
            <div>
              <span className="label">Estimasi</span>
              <Segmented<string>
                label="Estimasi"
                value={task.estimate}
                onChange={(v) => commit("estimate", v)}
                options={[
                  { value: "S", label: "S", title: "Kurang dari 1 jam" },
                  { value: "M", label: "M", title: "1 sampai 3 jam" },
                  { value: "L", label: "L", title: "3 sampai 6 jam" },
                ]}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="t-desc">
              Deskripsi
            </label>
            <textarea
              id="t-desc"
              className="field min-h-[110px] resize-y text-[14px] leading-relaxed"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => commit("description", description)}
            />
          </div>

          <div>
            <span className="label">Kriteria selesai</span>
            <ul className="space-y-1.5">
              {criteria.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2.5 h-3.5 w-3.5 shrink-0 rounded-[4px] border-[1.5px] border-mute" aria-hidden />
                  <input
                    className="field py-1.5 text-[13.5px]"
                    value={c}
                    onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))}
                    onBlur={() => commit("acceptance", criteria.map((x) => x.trim()).filter(Boolean))}
                    aria-label={`Kriteria ${i + 1}`}
                  />
                  <button
                    className="btn btn-ghost btn-sm btn-icon mt-0.5"
                    onClick={() => {
                      const next = criteria.filter((_, j) => j !== i);
                      setCriteria(next);
                      commit("acceptance", next.map((x) => x.trim()).filter(Boolean));
                    }}
                    aria-label="Hapus kriteria"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn btn-ghost btn-sm mt-1.5" onClick={() => setCriteria([...criteria, ""])}>
              <Plus size={14} /> Tambah kriteria
            </button>
          </div>

          <div>
            <label className="label" htmlFor="t-hint">
              Petunjuk untuk agent
            </label>
            <textarea
              id="t-hint"
              className="field min-h-[70px] resize-y text-[13.5px]"
              value={hint}
              placeholder="File yang disentuh, library yang dipakai, jebakan yang perlu dihindari."
              onChange={(e) => setHint(e.target.value)}
              onBlur={() => commit("agentHint", hint)}
            />
          </div>

          <div>
            <span className="label">Bergantung pada</span>
            <div className="flex flex-wrap gap-1.5">
              {deps.length === 0 && <span className="text-[13px] text-mute">Tidak ada. Task ini bisa langsung dikerjakan.</span>}
              {deps.map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-wash py-0.5 pl-2 pr-0.5 text-[12.5px]">
                  <StatusLed status={d.status} />
                  <button className="font-semibold hover:underline" onClick={() => onOpenTask(d.id)}>
                    {d.id}
                  </button>
                  <span className="max-w-[180px] truncate text-steel">{d.title}</span>
                  <button
                    className="btn btn-ghost btn-sm btn-icon h-6 w-6"
                    onClick={() => commit("dependsOn", task.dependsOn.filter((x) => x !== d.id))}
                    aria-label={`Hapus dependensi ${d.id}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <select
              className="field mt-2 text-[13px]"
              value={depPick}
              onChange={(e) => {
                setDepPick("");
                if (e.target.value) commit("dependsOn", [...task.dependsOn, e.target.value]);
              }}
              aria-label="Tambah dependensi"
            >
              <option value="">Tambah dependensi…</option>
              {depOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.title}
                </option>
              ))}
            </select>
          </div>

          {nodes.length > 0 && (
            <div>
              <span className="label">Fitur terkait</span>
              <div className="flex flex-wrap gap-1.5">
                {features.length === 0 && <span className="text-[13px] text-mute">Belum dikaitkan ke fitur.</span>}
                {features.map((n) => (
                  <span key={n!.id} className="inline-flex items-center gap-1 rounded-md border border-rule py-0.5 pl-2 pr-0.5 text-[12.5px]">
                    {n!.label}
                    <button
                      className="btn btn-ghost btn-sm btn-icon h-6 w-6"
                      onClick={() => commit("featureIds", task.featureIds.filter((x) => x !== n!.id))}
                      aria-label={`Lepas fitur ${n!.label}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <select
                className="field mt-2 text-[13px]"
                value={featPick}
                onChange={(e) => {
                  setFeatPick("");
                  if (e.target.value) commit("featureIds", [...task.featureIds, e.target.value]);
                }}
                aria-label="Kaitkan fitur"
              >
                <option value="">Kaitkan fitur…</option>
                {featureOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <span className="label">Riwayat</span>
            <ol className="space-y-2.5 border-l border-rule pl-4">
              {[...task.log].reverse().map((entry, i) => (
                <li key={i} className="relative text-[13px]">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-steel bg-panel" aria-hidden />
                  <div className="text-ink-2">
                    <span className="font-semibold text-ink">{actorLabel(entry.by)}</span> {LOG_LABEL[entry.kind]}
                    <span className="mono ml-1.5 text-[10.5px] text-mute" title={new Date(entry.at).toLocaleString("id-ID")}>
                      {clock(entry.at)} · {timeAgo(entry.at)}
                    </span>
                  </div>
                  {entry.text && <p className="mt-0.5 whitespace-pre-wrap text-steel">{entry.text}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-rule-2 px-5 py-3">
          <button className="btn btn-danger btn-sm" onClick={onDelete}>
            <Trash2 size={14} /> Hapus
          </button>
          <div className="flex-1" />
          {task.status !== "todo" && task.status !== "done" && (
            <button className="btn btn-secondary btn-sm" onClick={() => void onPatch({ status: "todo" })}>
              <RotateCcw size={14} /> Kembalikan ke antrean
            </button>
          )}
          {task.status === "done" ? (
            <button className="btn btn-secondary" onClick={() => void onPatch({ status: "todo" })}>
              <RotateCcw size={15} /> Buka lagi
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void onPatch({ status: "done" })}>
              <Check size={15} /> Tandai selesai
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
