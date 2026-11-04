import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ROUTER_DASHBOARD, useApp } from "../App";
import { Led, useToast } from "../components/ui";
import { api } from "../lib/api";
import { BRAND, QUOTES } from "../lib/brand";
import { navigate, projectHref } from "../lib/router";

const SEEDS = [
  { label: "Aplikasi kas kelas dengan QRIS", idea: "Aplikasi kas kelas dengan bayar QRIS dan pengingat tunggakan lewat WhatsApp" },
  { label: "Monitoring jaringan lab sekolah", idea: "Monitoring jaringan lab sekolah yang kirim notifikasi ke Telegram saat perangkat mati" },
  { label: "Bank soal per jurusan", idea: "Bank soal per jurusan dengan kunci jawaban dan statistik hasil ujian siswa" },
];

export function HomePage() {
  const { status, openSettings, openGuide, desktop, refreshStatus } = useApp();
  const toast = useToast();
  const [launching, setLaunching] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

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

  const notReady = status && !status.reachable;

  return (
    <div className="relative flex-1">
      <div className="home-hero">
        <img src={BRAND.hero} alt={BRAND.heroAlt} />
      </div>

      <div className="home-stack stagger">
        <h1 className="home-title">
          <span>Build With Agent</span>
          <span className="cross">x</span>
          <span className="with">{BRAND.school}</span>
        </h1>
        <p className="mt-2.5 min-h-7 text-[19px] font-medium tracking-[-0.008em] text-ink-2">{quote}</p>

        <section className="ask">
          <label htmlFor="idea" className="sr-only">
            Ide proyek
          </label>
          <textarea
            id="idea"
            ref={input}
            className="block h-[76px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-[17px] leading-[1.45] tracking-[-0.006em] text-ink outline-none placeholder:text-mute"
            placeholder="Contoh: aplikasi absensi yang mengirim ringkasan ke wali kelas"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void start();
            }}
          />
          <div className="flex items-center justify-between gap-3 py-1 pl-4 pr-1">
            <span className="hidden text-[12.5px] text-steel sm:inline">
              <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> untuk mulai
            </span>
            <button className="btn btn-primary ml-auto h-[42px]" onClick={start} disabled={!prompt.trim() || creating}>
              {creating ? "Membuat proyek…" : "Kembangkan ide"}
              <ArrowRight size={16} />
            </button>
          </div>
        </section>

        {notReady ? (
          <div className="glass-card mt-3.5 flex items-start gap-2.5 rounded-[18px] px-4 py-3 text-left text-[13.5px] text-ink-2">
            <span className="mt-1.5">
              <Led state={status.state === "stalled" || (status.provider === "mcp" && status.state === "off") ? "amber" : "red"} />
            </span>
            <div>
              <p>
                <span className="font-semibold text-ink">{status.error ?? "Asisten AI belum terhubung."}</span>{" "}
                {status.hint ?? "BWA belum bisa bekerja sampai asisten AI siap."}
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
                {status.provider === "mcp" ? (
                  <button className="btn btn-primary btn-sm" onClick={openGuide}>
                    Hubungkan asisten AI
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={openSettings}>
                    Atur koneksi
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SEEDS.map((seed) => (
              <button key={seed.label} className="seed" onClick={() => setPrompt(seed.idea)}>
                {seed.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
