import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Plus, Router, X } from "lucide-react";
import type { IdeaDimension, IdeaDirection, IdeaOption, Project, Selections } from "../../shared/types";
import type { AgentRunner } from "../components/AgentRun";
import { useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { cx, randomId } from "../lib/format";
import { navigate, projectHref } from "../lib/router";

interface Props {
  project: Project;
  setProject: (p: Project) => void;
  runner: AgentRunner;
}

export function IdeaStage({ project, setProject, runner }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [sel, setSel] = useState<Selections>(project.selections);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const pending = useRef<Selections | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRan = useRef(false);
  const idea = project.idea;

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    try {
      await api.patchProject(project.id, { selections: next });
    } catch (err) {
      toast(`Pilihan gagal disimpan: ${(err as Error).message}`, "error");
    }
  };

  const persist = (next: Selections) => {
    setSel(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 450);
  };

  useEffect(
    () => () => {
      void flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const explore = (feedback = "") =>
    runner.start(
      [
        {
          agent: 1,
          label: feedback ? "Menyusun ulang ide sesuai masukanmu" : "Mengembangkan ide menjadi pilihan",
          path: `/projects/${project.id}/agents/idea/explore`,
          body: { feedback },
        },
      ],
      {
        onDone: ([result]) => {
          const next = result as Project;
          setProject(next);
          setSel(next.selections);
          setFresh(new Set());
        },
      },
    );

  useEffect(() => {
    if (!project.idea && !autoRan.current && !runner.state) {
      autoRan.current = true;
      void explore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!idea) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 py-14 sm:px-6">
        <div className="card p-6">
          <div className="eyebrow">Ide awal</div>
          <p className="mt-2 text-[17px] leading-relaxed text-ink">{project.prompt}</p>
          <p className="mt-4 text-[14px] text-steel">
            Agent 1 akan mengembangkan kalimat ini menjadi arah proyek dan pilihan yang bisa kamu klik.
          </p>
          <button className="btn btn-primary mt-5" onClick={() => explore()} disabled={runner.busy}>
            <Router size={16} /> Kembangkan ide
          </button>
        </div>
      </div>
    );
  }

  const toggle = (dim: IdeaDimension, optionId: string) => {
    const current = sel.choices[dim.id] ?? [];
    const nextIds = dim.multi
      ? current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      : current[0] === optionId
        ? []
        : [optionId];
    persist({ ...sel, choices: { ...sel.choices, [dim.id]: nextIds } });
  };

  const saveIdea = async (nextIdea: typeof idea, nextSel: Selections) => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    setSel(nextSel);
    try {
      const updated = await api.patchProject(project.id, { idea: nextIdea, selections: nextSel });
      setProject(updated);
      setSel(updated.selections);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const addCustomOption = (dim: IdeaDimension, label: string) => {
    const nextIdea = structuredClone(idea);
    const option: IdeaOption = { id: randomId("c"), label, custom: true };
    nextIdea.dimensions.find((d) => d.id === dim.id)!.options.push(option);
    const current = sel.choices[dim.id] ?? [];
    void saveIdea(nextIdea, { ...sel, choices: { ...sel.choices, [dim.id]: dim.multi ? [...current, option.id] : [option.id] } });
  };

  const removeCustomOption = (dim: IdeaDimension, optionId: string) => {
    const nextIdea = structuredClone(idea);
    const d = nextIdea.dimensions.find((x) => x.id === dim.id)!;
    d.options = d.options.filter((o) => o.id !== optionId);
    void saveIdea(nextIdea, {
      ...sel,
      choices: { ...sel.choices, [dim.id]: (sel.choices[dim.id] ?? []).filter((id) => id !== optionId) },
    });
  };

  const addCustomDirection = (title: string, pitch: string) => {
    const nextIdea = structuredClone(idea);
    const direction: IdeaDirection = { id: randomId("dc"), title, pitch, custom: true };
    nextIdea.directions.push(direction);
    void saveIdea(nextIdea, { ...sel, directionId: direction.id });
  };

  const moreOptions = async (dim: IdeaDimension) => {
    await flush();
    void runner.start(
      [
        {
          agent: 1,
          label: `Mencari opsi baru untuk "${dim.label}"`,
          path: `/projects/${project.id}/agents/idea/more`,
          body: { dimensionId: dim.id },
        },
      ],
      {
        onDone: ([result]) => {
          const res = result as { project: Project; added: string[] };
          setProject(res.project);
          setFresh(new Set(res.added));
          if (res.added.length === 0) toast("Agent 1 tidak menemukan opsi yang benar-benar baru.");
        },
      },
    );
  };

  const refine = async (feedback: string) => {
    const ok = await confirm({
      title: "Susun ulang semua pilihan?",
      body: "Agent 1 akan membuat arah dan pilihan baru berdasarkan masukanmu. Pilihan yang sudah kamu klik akan direset.",
      confirmLabel: "Susun ulang",
    });
    if (ok) void explore(feedback);
  };

  const buildTopology = async () => {
    await flush();
    if (project.topology) {
      const ok = await confirm({
        title: "Bangun ulang topologi?",
        body: "Topologi fitur yang sekarang, termasuk editanmu, akan diganti hasil baru dari Agent 2.",
        confirmLabel: "Bangun ulang",
      });
      if (!ok) return;
    }
    void runner.start(
      [
        { agent: 1, label: "Merangkum pilihanmu menjadi brief proyek", path: `/projects/${project.id}/agents/idea/brief` },
        { agent: 2, label: "Memetakan modul, fitur, dan integrasi", path: `/projects/${project.id}/agents/topology/generate` },
      ],
      {
        onStep: (i, result) => i === 0 && setProject(result as Project),
        onDone: (results) => {
          setProject(results[1] as Project);
          navigate(projectHref(project.id, "topology"));
        },
      },
    );
  };

  const picked = Object.values(sel.choices).reduce((n, ids) => n + ids.length, 0);
  const direction = idea.directions.find((d) => d.id === sel.directionId);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-6 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-4 self-start lg:sticky lg:top-[72px]">
          <div className="card p-5">
            <div className="eyebrow">Kartu ide · Agent 1</div>
            <h2 className="display mt-2 text-[26px] leading-[1.1] text-ink">{idea.title}</h2>
            {idea.tagline && <p className="mt-2 text-[15px] font-semibold leading-snug text-ink-2">{idea.tagline}</p>}
            {idea.summary && <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{idea.summary}</p>}
            {idea.problem && (
              <div className="mt-4 border-t border-rule-2 pt-3">
                <div className="eyebrow mb-1">Masalah</div>
                <p className="text-[13.5px] leading-relaxed text-ink-2">{idea.problem}</p>
              </div>
            )}
            <div className="mt-4 border-t border-rule-2 pt-3">
              <div className="eyebrow mb-1">Ide awalmu</div>
              <p className="text-[13px] leading-relaxed text-steel">“{project.prompt}”</p>
            </div>
          </div>
          <RefineCard onRefine={refine} disabled={runner.busy} />
        </aside>

        <div className="min-w-0">
          <section aria-labelledby="directions">
            <SectionHead id="directions" title="Arah pengembangan" hint="Pilih satu sudut yang paling ingin kamu kejar." />
            <div className="grid gap-2.5 md:grid-cols-2">
              {idea.directions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={cx("tile", d.custom && "tile-custom")}
                  aria-pressed={sel.directionId === d.id}
                  onClick={() => persist({ ...sel, directionId: sel.directionId === d.id ? null : d.id })}
                >
                  <span className="tick tick-radio">{sel.directionId === d.id && <Check size={12} strokeWidth={3} />}</span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold leading-snug text-ink">{d.title}</span>
                    {d.pitch && <span className="mt-1 block text-[13.5px] leading-snug text-ink-2">{d.pitch}</span>}
                    {d.why && <span className="mt-1.5 block text-[12.5px] leading-snug text-steel">{d.why}</span>}
                  </span>
                </button>
              ))}
              <AddDirection onAdd={addCustomDirection} />
            </div>
          </section>

          {idea.dimensions.map((dim) => (
            <DimensionSection
              key={dim.id}
              dim={dim}
              selected={sel.choices[dim.id] ?? []}
              fresh={fresh}
              busy={runner.busy}
              onToggle={(id) => toggle(dim, id)}
              onAdd={(label) => addCustomOption(dim, label)}
              onRemove={(id) => removeCustomOption(dim, id)}
              onMore={() => moreOptions(dim)}
            />
          ))}

          <section className="mt-10" aria-labelledby="notes">
            <SectionHead id="notes" title="Catatan tambahan" hint="Batasan, referensi, atau hal yang wajib ada. Semua agent membacanya." />
            <textarea
              className="field min-h-[96px] resize-y text-[14.5px]"
              placeholder="Contoh: harus bisa dipakai di HP murah, target rilis 3 minggu, pakai bahasa Indonesia."
              value={sel.notes}
              onChange={(e) => persist({ ...sel, notes: e.target.value })}
            />
          </section>

          <div className="sticky bottom-0 z-20 -mx-4 mt-10 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-t-xl sm:border-x sm:px-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 text-[13.5px] text-ink-2">
                <span className="mono font-semibold text-ink">{picked}</span> pilihan
                {direction ? (
                  <>
                    {" "}
                    · arah <span className="font-semibold text-ink">{direction.title}</span>
                  </>
                ) : (
                  <span className="text-steel"> · yang kosong akan dipilihkan Agent 1</span>
                )}
              </div>
              <div className="flex flex-1 justify-end gap-2">
                {project.topology && (
                  <a className="btn btn-secondary" href={projectHref(project.id, "topology")}>
                    Lihat topologi
                  </a>
                )}
                <button className="btn btn-primary" onClick={buildTopology} disabled={runner.busy}>
                  {project.topology ? "Bangun ulang topologi" : "Bangun topologi fitur"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ id, title, hint, aside }: { id: string; title: string; hint?: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <h3 id={id} className="text-[17px] font-bold leading-tight text-ink">
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-[13.5px] text-steel">{hint}</p>}
      </div>
      {aside}
    </div>
  );
}

function DimensionSection({
  dim,
  selected,
  fresh,
  busy,
  onToggle,
  onAdd,
  onRemove,
  onMore,
}: {
  dim: IdeaDimension;
  selected: string[];
  fresh: Set<string>;
  busy: boolean;
  onToggle: (optionId: string) => void;
  onAdd: (label: string) => void;
  onRemove: (optionId: string) => void;
  onMore: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const firstSuggested = dim.options.find((o) => !o.custom)?.id;

  const submit = () => {
    const label = draft.trim();
    if (label) onAdd(label);
    setDraft("");
    setAdding(false);
  };

  return (
    <section className="mt-10" aria-labelledby={`dim-${dim.id}`}>
      <SectionHead
        id={`dim-${dim.id}`}
        title={dim.label}
        hint={dim.question}
        aside={
          <div className="flex items-center gap-2">
            <span className="tag">{dim.multi ? "Boleh beberapa" : "Pilih satu"}</span>
            <button className="btn btn-ghost btn-sm" onClick={onMore} disabled={busy} title="Minta Agent 1 mencarikan opsi lain">
              <Router size={14} /> Opsi lain
            </button>
          </div>
        }
      />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {dim.options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <div key={o.id} className="relative">
              <button
                type="button"
                className={cx("tile h-full", o.custom && "tile-custom pr-9", fresh.has(o.id) && "ring-2 ring-led-amber/45")}
                aria-pressed={on}
                onClick={() => onToggle(o.id)}
              >
                <span className={cx("tick", !dim.multi && "tick-radio")}>{on && <Check size={12} strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[14px] font-semibold leading-snug text-ink">{o.label}</span>
                    {o.id === firstSuggested && <span className="tag shrink-0">Saran</span>}
                    {fresh.has(o.id) && <span className="tag shrink-0 border-led-amber/60 text-[#8a5a00]">Baru</span>}
                  </span>
                  {o.detail && <span className="mt-0.5 block text-[12.5px] leading-snug text-steel">{o.detail}</span>}
                  {o.custom && <span className="mt-0.5 block text-[12px] text-mute">ditulis sendiri</span>}
                </span>
              </button>
              {o.custom && (
                <button
                  className="btn btn-ghost btn-sm btn-icon absolute right-1.5 top-1.5"
                  onClick={() => onRemove(o.id)}
                  aria-label={`Hapus pilihan ${o.label}`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          );
        })}
        {adding ? (
          <form
            className="tile tile-custom flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              className="field"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Tulis pilihanmu"
              maxLength={80}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
                Batal
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
                Tambah
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="tile tile-custom items-center text-[13.5px] font-semibold text-steel" onClick={() => setAdding(true)}>
            <Plus size={16} /> Tulis pilihan sendiri
          </button>
        )}
      </div>
    </section>
  );
}

function AddDirection({ onAdd }: { onAdd: (title: string, pitch: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  if (!open) {
    return (
      <button type="button" className="tile tile-custom items-center text-[13.5px] font-semibold text-steel" onClick={() => setOpen(true)}>
        <Plus size={16} /> Tulis arah sendiri
      </button>
    );
  }
  return (
    <form
      className="tile tile-custom flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAdd(title.trim(), pitch.trim());
        setOpen(false);
        setTitle("");
        setPitch("");
      }}
    >
      <input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nama arah" maxLength={100} />
      <textarea
        className="field min-h-[64px]"
        value={pitch}
        onChange={(e) => setPitch(e.target.value)}
        placeholder="Jelaskan singkat arah yang kamu mau"
        maxLength={400}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Batal
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim()}>
          Pakai arah ini
        </button>
      </div>
    </form>
  );
}

function RefineCard({ onRefine, disabled }: { onRefine: (feedback: string) => void; disabled: boolean }) {
  const [feedback, setFeedback] = useState("");
  return (
    <div className="card p-4">
      <div className="text-[14px] font-bold text-ink">Belum pas?</div>
      <p className="mt-0.5 text-[13px] text-steel">Beri arahan, Agent 1 menyusun ulang semua pilihan.</p>
      <textarea
        className="field mt-3 min-h-[72px] text-[13.5px]"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Contoh: fokus untuk SD, tanpa aplikasi Android, lebih murah dijalankan"
      />
      <button
        className="btn btn-secondary btn-sm mt-2.5 w-full"
        disabled={disabled || !feedback.trim()}
        onClick={() => onRefine(feedback.trim())}
      >
        <Router size={14} /> Susun ulang pilihan
      </button>
    </div>
  );
}
