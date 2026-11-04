import { useState } from "react";
import { Check, Download } from "lucide-react";
import { GUIDE_STEPS, type GuideAgent, type GuideStep } from "../../shared/setupGuide";
import { runtime, type ApiError } from "../lib/api";
import { ASSISTANTS, connectConfirmBody, downloadUrl, GUIDE_INTRO, stepCopy, terminalWay } from "../lib/setupGuide";
import { useSetupGuide } from "../lib/useSetupGuide";
import { CodeBlock, ErrorNote, Led, Modal, Segmented, useConfirm, useToast } from "./ui";

/** Text between backticks becomes a key-cap, so a command stands out from the sentence around it. */
function Rich({ text }: { text: string }) {
  return <>{text.split("`").map((part, i) => (i % 2 ? <span key={i} className="kbd">{part}</span> : part))}</>;
}

/** Walks someone through connecting Claude or Codex, ticking off each step as it happens. */
export function SetupGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const guide = useSetupGuide(open);
  const [connecting, setConnecting] = useState(false);
  const { agent, conn, progress } = guide;
  const assistant = ASSISTANTS[agent];
  const url = downloadUrl(agent, runtime.platform, runtime.arch);
  const terminal = terminalWay(agent, runtime.platform);

  const connect = async () => {
    if (!conn) return;
    const ok = await confirm({ title: `Hubungkan ${assistant.name} ke BWA?`, body: connectConfirmBody(agent, conn), confirmLabel: "Hubungkan" });
    if (!ok) return;
    setConnecting(true);
    try {
      await guide.connect();
    } catch (err) {
      const e = err as ApiError;
      toast([e.message, e.hint].filter(Boolean).join(" "), "error");
    } finally {
      setConnecting(false);
    }
  };

  const actions: Record<GuideStep, () => React.ReactNode> = {
    install: () => (
      <>
        {url && (
          <a className="btn btn-primary btn-sm" href={url} target="_blank" rel="noreferrer">
            <Download size={14} /> Unduh {assistant.app}
          </a>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => guide.answer("install")}>
          Sudah terpasang
        </button>
      </>
    ),
    signin: () =>
      progress?.needsCodeTab || conn?.signedIn === false ? (
        <button className="btn btn-secondary btn-sm" onClick={guide.recheck}>
          Periksa lagi
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" onClick={() => guide.answer("signin")}>
          Sudah masuk
        </button>
      ),
    connect: () => (
      <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting}>
        {connecting ? "Menghubungkan…" : progress?.needsUpdate ? "Perbarui sambungan" : "Hubungkan"}
      </button>
    ),
    start: () => (
      <span className="flex items-center gap-2 text-[13px] text-ink-2">
        <Led state="amber" /> Menunggu {assistant.name}. Lampu ini menyala hijau sendiri setelah kamu menekan Enter.
      </span>
    ),
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Panduan"
      title="Hubungkan asisten AI"
      width="max-w-2xl"
      footer={
        <button className={progress?.ready ? "btn btn-primary" : "btn btn-secondary"} onClick={onClose}>
          {progress?.ready ? "Mulai pakai BWA" : "Tutup, lanjutkan nanti"}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-[14.5px] leading-relaxed text-ink-2">{GUIDE_INTRO}</p>

        <div className="space-y-1.5">
          <div className="text-[13px] font-semibold text-ink-2">Pilih yang sudah kamu punya:</div>
          <Segmented<GuideAgent>
            label="Pilih asisten AI"
            value={agent}
            onChange={guide.setAgent}
            options={[
              { value: "claude", label: "Claude" },
              { value: "codex", label: "Codex (ChatGPT)" },
            ]}
          />
          <p className="text-[12.5px] leading-snug text-steel">{assistant.plan}</p>
        </div>

        {guide.loadError && <ErrorNote message="Keadaan komputer ini belum bisa dibaca." hint={guide.loadError} />}
        {!progress && !guide.loadError && <p className="text-[13px] text-steel">Memeriksa komputer ini…</p>}

        {progress?.ready && (
          <div className="flex items-center gap-2.5 rounded-lg bg-wash px-3.5 py-3 text-[14px] font-semibold text-ink">
            <Led state="green" /> {assistant.name} sudah terhubung. Sekarang kamu bisa menulis idemu di Beranda.
          </div>
        )}

        {conn && progress && !progress.ready && (
          <ol className="space-y-2">
            {GUIDE_STEPS.map((step, i) => {
              const state = progress.steps[step];
              const copy = stepCopy(agent, step, conn, progress, !!url);
              return (
                <li key={step} className="rounded-lg border border-rule px-3.5 py-3">
                  <div className="flex items-center gap-2.5">
                    {state === "done" ? <Check size={15} className="shrink-0 text-pair-green" /> : <Led state={state === "current" ? "amber" : "off"} />}
                    <span className={state === "todo" ? "text-[14px] text-steel" : "text-[14px] font-semibold text-ink"}>
                      {i + 1}. {copy.title}
                    </span>
                  </div>
                  {state === "current" && (
                    <div className="mt-2.5 space-y-2.5 text-[13.5px] leading-relaxed text-ink-2">
                      {copy.howTo && (
                        <ol className="list-decimal space-y-1 pl-5">
                          {copy.howTo.map((line) => (
                            <li key={line}>
                              <Rich text={line} />
                            </li>
                          ))}
                        </ol>
                      )}
                      {copy.lines.map((line) => (
                        <p key={line}>
                          <Rich text={line} />
                        </p>
                      ))}
                      <div className="flex flex-wrap items-center gap-2">{actions[step]()}</div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {progress && !progress.ready && (
          <details className="group rounded-lg border border-rule-2 px-3.5 py-2.5">
            <summary className="cursor-pointer select-none list-none text-[13px] font-semibold text-ink-2">
              <span className="group-open:hidden">+ </span>
              <span className="hidden group-open:inline">− </span>
              Sudah terbiasa memakai terminal? Lihat caranya
            </summary>
            <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-ink-2">
              <CodeBlock label={`Pasang ${assistant.name}`} code={terminal.install} />
              <p>
                <Rich text={terminal.start} />
              </p>
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}
