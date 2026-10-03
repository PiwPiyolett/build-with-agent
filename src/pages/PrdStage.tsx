import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Router } from "lucide-react";
import type { Project } from "../../shared/types";
import type { AgentRunner, RunStep } from "../components/AgentRun";
import { MarkdownView, outline } from "../components/MarkdownView";
import { CopyButton, Segmented, useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { cx, downloadText, nf, prdFileName, timeAgo } from "../lib/format";
import { projectHref } from "../lib/router";

interface Props {
  project: Project;
  setProject: (p: Project) => void;
  runner: AgentRunner;
}

export const prdRunStep = (projectId: string): RunStep => ({
  agent: 3,
  agentName: "Penulis PRD",
  label: "Menulis PRD: strategi, kebutuhan, rilis, dan risiko",
  path: `/projects/${projectId}/agents/prd/generate`,
});

type Mode = "read" | "edit";
type SaveState = "saved" | "dirty" | "saving" | "error";

const CONTENTS_TITLES = new Set(["daftar isi", "contents"]);

export function PrdStage({ project, setProject, runner }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const prd = project.prd;
  const name = project.brief?.name || project.idea?.title || project.name;
  const [mode, setMode] = useState<Mode>("read");
  const [draft, setDraft] = useState(prd?.markdown ?? "");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [active, setActive] = useState<string | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  // Adopt a new or remotely changed PRD unless the user is mid-edit.
  useEffect(() => {
    if (!dirty.current) setDraft(prd?.markdown ?? "");
  }, [prd?.markdown]);

  const save = async (text: string) => {
    setSaveState("saving");
    try {
      const res = await api.savePrd(projectRef.current.id, text);
      dirty.current = false;
      setProject({ ...projectRef.current, prd: res.prd, updatedAt: res.updatedAt });
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast(`PRD gagal disimpan: ${(err as Error).message}`, "error");
    }
  };

  const edit = (text: string) => {
    setDraft(text);
    dirty.current = true;
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(text), 800);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const write = () =>
    runner.start([prdRunStep(project.id)], {
      onDone: ([result]) => {
        dirty.current = false;
        setProject(result as Project);
        setMode("read");
        toast("PRD selesai ditulis.", "success");
      },
    });

  const rewrite = async () => {
    const ok = await confirm({
      title: "Tulis ulang PRD?",
      body: prd?.edited
        ? "Agent 3 akan menulis PRD baru dari brief dan topologi terbaru. Editan yang sudah kamu buat akan diganti."
        : "Agent 3 akan menulis PRD baru dari brief dan topologi terbaru.",
      confirmLabel: "Tulis ulang",
      danger: !!prd?.edited,
    });
    if (ok) void write();
  };

  const sections = useMemo(() => outline(draft).filter((s) => !CONTENTS_TITLES.has(s.title.toLowerCase())), [draft]);
  const words = useMemo(() => draft.split(/\s+/).filter(Boolean).length, [draft]);

  // Highlight the section being read in the contents rail.
  useEffect(() => {
    if (mode !== "read") return;
    const heads = [...document.querySelectorAll<HTMLElement>(".prd-doc h2[id]")];
    if (heads.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-72px 0px -65% 0px" },
    );
    heads.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [mode, draft]);

  if (!prd) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 py-14 sm:px-6">
        <div className="card p-6">
          <div className="eyebrow">PRD · Agent 3</div>
          <h2 className="display mt-2 text-[22px] leading-tight">PRD belum ditulis</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
            Agent 3 akan menulis Product Requirements Document dari brief dan topologi fitur proyek ini. Hasilnya bisa kamu
            edit, lalu diunduh sebagai file .md untuk dibagikan.
          </p>
          {project.topology && project.brief ? (
            <button className="btn btn-primary mt-5" onClick={() => void write()} disabled={runner.busy}>
              <Router size={16} /> Tulis PRD
            </button>
          ) : (
            <a className="btn btn-secondary mt-5" href={projectHref(project.id, "idea")}>
              Selesaikan tahap ide dan topologi dulu
            </a>
          )}
        </div>
      </div>
    );
  }

  const saveLabel = { saved: "tersimpan", dirty: "belum disimpan", saving: "menyimpan…", error: "gagal simpan" }[saveState];
  const fileName = prdFileName(name);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="eyebrow">PRD · Agent 3 · Penulis PRD</div>
          <h2 className="display mt-1 text-[26px] leading-tight text-ink">Product Requirements Document</h2>
          <p className="mt-1 text-[13.5px] text-steel">
            Ditulis {timeAgo(prd.generatedAt)} · {nf.format(words)} kata · <span className="mono text-[11.5px]">{prd.model}</span>
            {prd.edited && " · sudah diedit"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Mode>
            label="Mode PRD"
            value={mode}
            onChange={setMode}
            options={[
              { value: "read", label: "Pratinjau" },
              { value: "edit", label: "Edit Markdown" },
            ]}
          />
          <CopyButton text={draft} label="Salin Markdown" />
          <button className="btn btn-primary" onClick={() => downloadText(fileName, draft)}>
            <Download size={16} /> Unduh .md
          </button>
          <button className="btn btn-ghost btn-icon" onClick={rewrite} disabled={runner.busy} title="Tulis ulang dengan Agent 3" aria-label="Tulis ulang PRD">
            <Router size={16} />
          </button>
        </div>
      </header>

      <p className="mt-4 rounded-lg bg-wash px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
        Bagikan file <span className="mono text-[12px] text-ink">{fileName}</span> apa adanya, atau tempel isinya di GitHub, GitLab,
        atau Notion. Diagram Mermaid di dalamnya otomatis tampil sebagai gambar di sana.
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden self-start lg:sticky lg:top-[72px] lg:block" aria-label="Daftar isi PRD">
          <div className="eyebrow mb-2">Daftar isi</div>
          <ol className="space-y-0.5 border-l border-rule">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  className={cx(
                    "-ml-px block w-full border-l-2 py-1 pl-3 text-left text-[13px] leading-snug transition-colors",
                    active === s.id ? "border-ink font-semibold text-ink" : "border-transparent text-steel hover:text-ink",
                  )}
                  onClick={() => {
                    if (mode !== "read") setMode("read");
                    setTimeout(() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
          {mode === "read" ? (
            <article className="card px-5 py-7 sm:px-10 sm:py-10">
              <MarkdownView markdown={draft} />
            </article>
          ) : (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-rule-2 px-4 py-2">
                <span className="mono text-[11px] text-steel">{fileName}</span>
                <span className={cx("mono text-[10.5px]", saveState === "error" ? "text-led-red" : "text-steel")} aria-live="polite">
                  {saveLabel}
                </span>
              </div>
              <textarea
                className="block min-h-[70dvh] w-full resize-y bg-panel px-5 py-4 font-mono text-[13px] leading-relaxed text-ink outline-none"
                value={draft}
                onChange={(e) => edit(e.target.value)}
                spellCheck={false}
                aria-label="Isi PRD dalam Markdown"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
