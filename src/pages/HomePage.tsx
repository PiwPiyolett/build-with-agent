import { useEffect, useRef, useState } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import type { ProjectSummary, Stage } from "../../shared/types";
import { ROUTER_DASHBOARD, useApp } from "../App";
import { api } from "../lib/api";
import { cx, timeAgo } from "../lib/format";
import { navigate, projectHref } from "../lib/router";
import { Led, LedStrip, useConfirm, useToast } from "../components/ui";

const SEEDS = [
  "Aplikasi kas kelas dengan bayar QRIS dan pengingat tunggakan lewat WhatsApp",
  "Monitoring jaringan lab sekolah yang kirim notifikasi ke Telegram saat perangkat mati",
  "Marketplace jasa servis laptop untuk mahasiswa di sekitar kampus",
  "Jurnal trading yang membaca screenshot chart dan mencatat entry otomatis",
];

const STAGE_LABEL: Record<Stage, string> = { idea: "Ide", topology: "Topologi", tasks: "Task", prd: "PRD" };

const PIPELINE = [
  { label: "Ide", by: "Agent 1" },
  { label: "Topologi", by: "Agent 2" },
  { label: "Task", by: "Agent 3" },
  { label: "Dicentang", by: "Claude Code · Codex" },
];

export function HomePage() {
  const { status, openSettings, desktop, refreshStatus } = useApp();
  const [launching, setLaunching] = useState(false);

  const launchRouter = async () => {
    setLaunching(true);
    try {
      await api.start9router();
      toast("Jendela 9router dibuka. Tunggu sampai dashboard-nya siap.");
      setTimeout(refreshStatus, 4000);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setTimeout(() => setLaunching(false), 4000);
    }
  };
  const toast = useToast();
  const confirm = useConfirm();
  const [prompt, setPrompt] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch(() => setProjects([]));

  useEffect(() => {
    void load();
    input.current?.focus({ preventScroll: true });
  }, []);

  const start = async () => {
    const text = prompt.trim();
    if (!text || creating) return;
    setCreating(true);
    try {
      const project = await api.createProject(text);
      navigate(projectHref(project.id, "idea"));
    } catch (err) {
      toast((err as Error).message, "error");
      setCreating(false);
    }
  };

  const remove = async (p: ProjectSummary) => {
    const ok = await confirm({
      title: `Hapus "${p.name}"?`,
      body: "Ide, topologi, dan semua task proyek ini akan dihapus dari BWA. Kode di repository tidak tersentuh.",
      confirmLabel: "Hapus proyek",
      danger: true,
    });
    if (!ok) return;
    await api.deleteProject(p.id);
    toast("Proyek dihapus.");
    void load();
  };

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
      <section className="max-w-[820px]">
        <h1 className="display text-[34px] leading-[1.04] text-ink sm:text-[52px]">
          Dari satu kalimat ide ke task yang dicentang agent.
        </h1>
        <p className="mt-4 max-w-[640px] text-[16px] leading-relaxed text-ink-2">
          Tulis idemu. Tiga agent, ditenagai Claude Code atau Codex lewat MCP, mengembangkannya jadi pilihan, memetakan topologi fitur, lalu membagi
          pekerjaan. Claude Code, Codex, atau agent lain mengambil task lewat MCP dan mencentangnya saat selesai.
        </p>

        <ol className="relative mt-8 grid grid-cols-4 gap-2" aria-label="Alur kerja BWA">
          <div className="cable absolute left-[6%] right-[6%] top-[13px]">
            <i />
          </div>
          {PIPELINE.map((step, i) => (
            <li key={step.label} className="relative flex flex-col items-center text-center">
              <span className="grid h-7 w-7 place-items-center rounded-md border border-rule bg-panel shadow-sm">
                <Led state={i === PIPELINE.length - 1 ? "green" : "off"} />
              </span>
              <span className="mt-2 text-[13px] font-semibold text-ink">{step.label}</span>
              <span className="mono text-[10px] text-steel">{step.by}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card mt-10 p-2 shadow-[0_16px_40px_-28px_#121a2166]">
        <label htmlFor="idea" className="sr-only">
          Ide proyek
        </label>
        <textarea
          id="idea"
          ref={input}
          className="block min-h-[140px] w-full resize-y rounded-lg bg-transparent px-3.5 py-3 text-[17px] leading-relaxed text-ink outline-none placeholder:text-mute"
          placeholder="Contoh: aplikasi kas kelas yang bisa bayar lewat QRIS dan mengirim pengingat tunggakan ke WhatsApp orang tua"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void start();
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule-2 px-2 pb-1 pt-2.5">
          <span className="hidden text-[12.5px] text-steel sm:inline">
            <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> untuk mulai
          </span>
          <button className="btn btn-primary ml-auto" onClick={start} disabled={!prompt.trim() || creating}>
            {creating ? "Membuat proyek…" : "Kembangkan ide"}
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {status && !status.reachable && (
        <div className="mt-3 flex items-start gap-2.5 text-[13.5px] text-ink-2">
          <span className="mt-1.5">
            <Led state={status.state === "stalled" || (status.provider === "mcp" && status.state === "off") ? "amber" : "red"} />
          </span>
          <div>
            <p>
              <span className="font-semibold text-ink">{status.error ?? "Otak AI belum terhubung."}</span>{" "}
              {status.hint ?? "Agent belum bisa bekerja sampai otak AI siap."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {desktop && status.provider === "9router" && status.state === "off" && (
                <button className="btn btn-primary btn-sm" onClick={launchRouter} disabled={launching}>
                  {launching ? "Membuka 9router…" : "Jalankan 9router"}
                </button>
              )}
              {status.provider === "9router" && status.state !== "off" && (
                <a className="btn btn-secondary btn-sm" href={ROUTER_DASHBOARD} target="_blank" rel="noreferrer">
                  Buka dashboard 9router
                </a>
              )}
              <button className="btn btn-ghost btn-sm" onClick={openSettings}>
                {status.provider === "mcp" ? "Cara menyiapkan agent" : "Atur koneksi"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <span className="eyebrow mr-1 self-center">Coba</span>
        {SEEDS.map((seed) => (
          <button
            key={seed}
            className="rounded-full border border-rule bg-panel px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:border-steel hover:text-ink"
            onClick={() => setPrompt(seed)}
          >
            {seed}
          </button>
        ))}
      </div>

      <section className="mt-16">
        <div className="flex items-baseline justify-between border-b border-rule pb-2.5">
          <h2 className="eyebrow">Proyek{projects && projects.length > 0 ? ` · ${projects.length}` : ""}</h2>
        </div>
        {projects === null ? (
          <p className="py-6 text-steel">Memuat proyek…</p>
        ) : projects.length === 0 ? (
          <p className="py-8 text-[14.5px] text-steel">Belum ada proyek. Tulis ide pertamamu di atas.</p>
        ) : (
          <ul>
            {projects.map((p) => {
              const total = p.taskStrip.length;
              return (
                <li key={p.id} className="group relative border-b border-rule-2">
                  <a
                    href={projectHref(p.id)}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 py-4 pr-10 sm:grid-cols-[minmax(0,1fr)_88px_220px_110px]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[15.5px] font-semibold text-ink group-hover:underline group-hover:underline-offset-2">
                        {p.name}
                      </div>
                      <div className="truncate text-[13px] text-steel">{p.prompt}</div>
                    </div>
                    <span className="tag justify-self-start">{STAGE_LABEL[p.stage]}</span>
                    <div className="col-span-2 flex items-center gap-2.5 sm:col-span-1">
                      {total > 0 ? (
                        <>
                          <LedStrip statuses={p.taskStrip.slice(0, 48)} />
                          <span className="mono shrink-0 text-[11px] text-steel">
                            {p.taskCounts.done}/{total}
                          </span>
                        </>
                      ) : (
                        <span className="text-[12.5px] text-mute">belum ada task</span>
                      )}
                    </div>
                    <span className={cx("hidden text-right text-[12.5px] text-steel sm:block")}>{timeAgo(p.updatedAt)}</span>
                  </a>
                  <button
                    className="btn btn-ghost btn-sm btn-icon absolute right-0 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 focus:opacity-100"
                    onClick={() => remove(p)}
                    aria-label={`Hapus ${p.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
