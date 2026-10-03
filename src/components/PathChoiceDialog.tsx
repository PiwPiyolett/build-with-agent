import { useEffect, useState } from "react";
import { ArrowRight, Check, Router } from "lucide-react";
import type { HandoverMode, Project } from "../../shared/types";
import { useApp } from "../App";
import { api } from "../lib/api";
import { HANDOVER_HINT, HANDOVER_OPTIONS } from "../lib/bridgeConfig";
import { timeAgo } from "../lib/format";
import { Modal, Segmented, useToast } from "./ui";

interface Props {
  open: boolean;
  project: Project;
  busy: boolean;
  onClose: () => void;
  onBuildTasks: () => void;
  onOpenTasks: () => void;
  onWritePrd: () => void;
  onOpenPrd: () => void;
}

/** The fork after the feature map: build it with coding agents, or write a PRD to share. */
export function PathChoiceDialog({ open, project, busy, onClose, onBuildTasks, onOpenTasks, onWritePrd, onOpenPrd }: Props) {
  const tasks = project.tasks.length;
  const done = project.tasks.filter((t) => t.status === "done").length;
  const prd = project.prd;

  return (
    <Modal open={open} onClose={onClose} eyebrow="Langkah berikutnya" title="Mau diapakan idenya?" width="max-w-4xl">
      <p className="text-[14.5px] text-ink-2">
        Topologi fiturnya sudah siap. Pilih jalurnya, dan jalur yang satu lagi tetap bisa diambil kapan saja.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <section className="path-card">
          <div className="path-art" aria-hidden>
            <div className="led-strip led-strip-lg">
              {["done", "done", "done", "in_progress", "todo", "todo", "todo", "todo", "todo", "todo"].map((s, i) => (
                <span key={i} data-s={s} />
              ))}
            </div>
            <span className="mono text-[10px] text-steel">claude-code · codex</span>
          </div>
          <div className="eyebrow mt-4">Dikerjakan AI</div>
          <h3 className="display mt-1 text-[21px] leading-tight text-ink">Kerjakan langsung dengan agent coding</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
            Agent 3 membagi fitur jadi task berurutan. Claude Code, Codex, atau agent lain terhubung ke BWA lewat MCP,
            mengerjakan task di repository-mu, lalu mencentangnya di sini.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13.5px] text-ink-2">
            {["Backlog task lengkap dengan kriteria selesai", "Progres terlihat langsung saat agent bekerja", "Cocok kalau mau dibangun sekarang"].map((x) => (
              <li key={x} className="flex gap-2">
                <Check size={15} className="mt-0.5 shrink-0 text-pair-green" /> {x}
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-5">
            {open && <HandoverChoice />}
            {tasks > 0 ? (
              <>
                <p className="mb-2.5 text-[12.5px] text-steel">
                  {tasks} task sudah dibagi · {done} selesai
                </p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={onOpenTasks}>
                    Lihat task <ArrowRight size={16} />
                  </button>
                  <button className="btn btn-secondary" onClick={onBuildTasks} disabled={busy}>
                    <Router size={15} /> Bagi ulang
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-primary" onClick={onBuildTasks} disabled={busy}>
                Bagi jadi task <ArrowRight size={16} />
              </button>
            )}
          </div>
        </section>

        <section className="path-card">
          <div className="path-art" aria-hidden>
            <div className="doc-glyph">
              <span className="mono text-[9px] font-semibold tracking-wider text-ink">PRD.md</span>
              <i style={{ width: "72%" }} />
              <i style={{ width: "90%" }} />
              <i style={{ width: "60%" }} />
              <i style={{ width: "84%" }} />
            </div>
          </div>
          <div className="eyebrow mt-4">Dibagikan ke orang lain</div>
          <h3 className="display mt-1 text-[21px] leading-tight text-ink">Jadikan PRD (.md)</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
            Agent 3 menulis Product Requirements Document dari ide, brief, dan topologi fitur: tujuan, persona, user story,
            kebutuhan fungsional dan non-fungsional, rencana rilis, sampai risiko.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13.5px] text-ink-2">
            {["Satu file Markdown, siap diunduh atau disalin", "Diagram fitur tampil otomatis di GitHub dan Notion", "Cocok untuk tim, klien, dosen, atau investor"].map((x) => (
              <li key={x} className="flex gap-2">
                <Check size={15} className="mt-0.5 shrink-0 text-pair-green" /> {x}
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-5">
            {prd ? (
              <>
                <p className="mb-2.5 text-[12.5px] text-steel">
                  PRD ditulis {timeAgo(prd.generatedAt)}
                  {prd.edited ? " · sudah kamu edit" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={onOpenPrd}>
                    Lihat PRD <ArrowRight size={16} />
                  </button>
                  <button className="btn btn-secondary" onClick={onWritePrd} disabled={busy}>
                    <Router size={15} /> Tulis ulang
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-primary" onClick={onWritePrd} disabled={busy}>
                Tulis PRD <ArrowRight size={16} />
              </button>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}

/** MCP brain only: what the brain session does once Agent 3 has split the tasks. Saved on click. */
function HandoverChoice() {
  const toast = useToast();
  const mcp = useApp().status?.provider === "mcp";
  const [mode, setMode] = useState<HandoverMode | null>(null);

  useEffect(() => {
    if (mcp) api.settings().then((s) => setMode(s.handover)).catch(() => setMode("wait"));
  }, [mcp]);

  if (!mcp || !mode) return null;

  const change = async (next: HandoverMode) => {
    setMode(next);
    try {
      await api.saveSettings({ handover: next });
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  return (
    <div className="mb-4 space-y-1.5 rounded-lg bg-wash px-3 py-2.5">
      <div className="text-[12.5px] font-semibold text-ink-2">Setelah task jadi, sesi Claude Code / Codex:</div>
      <Segmented<HandoverMode> label="Mode serah-terima" value={mode} onChange={change} options={HANDOVER_OPTIONS} />
      <p className="text-[12px] leading-snug text-steel">{HANDOVER_HINT[mode]}</p>
    </div>
  );
}
