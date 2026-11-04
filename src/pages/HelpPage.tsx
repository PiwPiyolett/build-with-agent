import { ArrowRight, ChevronDown } from "lucide-react";
import { agentLabel } from "../../shared/setupGuide";
import { useApp } from "../App";
import { Led } from "../components/ui";

const CONNECT_STEPS = ["Pasang aplikasinya", "Masuk ke akunmu", "Klik Hubungkan", "Mulai percakapan baru"];

const USE_STEPS = [
  { title: "Tulis idemu", note: "Satu kalimat sudah cukup." },
  { title: "Pilih arahnya", note: "Klik pilihan yang kamu suka." },
  { title: "Lihat peta fitur", note: "Ubah sesukamu seperti diagram." },
  { title: "Jadi task atau dokumen", note: "Asisten mengerjakan task dan mencentangnya, atau menulis dokumen PRD." },
];

const QUESTIONS = [
  {
    q: "Apakah BWA berbayar?",
    a: "BWA sendiri gratis dan berjalan di laptopmu. Yang dipakai adalah akun Claude atau ChatGPT milikmu, jadi biayanya mengikuti langgananmu.",
  },
  {
    q: "Data proyekku disimpan di mana?",
    a: "Proyekmu disimpan di laptop ini. Yang dikirim ke Claude atau ChatGPT hanya hal yang perlu dijawab asisten, lewat akunmu sendiri. BWA tidak menyimpan akun AI-mu.",
  },
  {
    q: "Bagaimana supaya kuota tidak cepat habis?",
    a: "Tutup percakapan di aplikasi Claude atau ChatGPT kalau sudah selesai. Selama terbuka, menunggu pun memakai sedikit jatah langgananmu.",
  },
  {
    q: "Kenapa asisten tiba-tiba berhenti?",
    a: "Biasanya percakapannya sudah tertutup. Buka percakapan baru lalu ketik /bwa di Claude, atau $bwa di Codex. Kalau masih belum jalan, buka panduan di atas.",
  },
];

function StepRow({ steps }: { steps: { title: string; note?: string }[] }) {
  return (
    <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {steps.map((step, i) => (
        <li key={step.title}>
          <span className="help-step">{i + 1}</span>
          <span className="mt-2 block text-[13.5px] font-semibold leading-[1.3] tracking-[-0.005em] text-ink">{step.title}</span>
          {step.note && <span className="mt-0.5 block text-[12.5px] leading-[1.35] text-steel">{step.note}</span>}
        </li>
      ))}
    </ol>
  );
}

export function HelpPage() {
  const { status, openGuide, openSettings } = useApp();
  const connected = status?.provider === "mcp" && status.reachable;
  return (
    <div className="mx-auto w-full max-w-[960px] px-6 pb-16 pt-[118px]">
      <h1 className="display text-[40px] leading-[1.08] text-ink">Bantuan</h1>
      <p className="mt-1.5 text-[17px] tracking-[-0.006em] text-ink">Semua yang perlu kamu tahu supaya BWA bisa bekerja.</p>

      <div className="stagger mt-6 grid grid-cols-6 gap-3">
        <section className="glass-card col-span-6 rounded-3xl p-[22px] md:col-span-4">
          <div className="eyebrow mb-1.5">Mulai dari sini</div>
          <h2 className="display text-[20px] leading-tight tracking-[-0.02em] text-ink">Hubungkan asisten AI</h2>
          <p className="mt-1 text-[14.5px] text-steel">BWA memakai Claude atau ChatGPT milikmu. Ikuti empat langkah ini.</p>
          <StepRow steps={CONNECT_STEPS.map((title) => ({ title }))} />
          <div className="mt-[18px] flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={openGuide}>
              Buka panduan <ArrowRight size={16} />
            </button>
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              <Led state={connected ? "green" : "amber"} />
              {connected ? `Sudah terhubung · ${status.workers?.map((w) => agentLabel(w.name)).join(", ")}` : "Belum terhubung"}
            </span>
          </div>
        </section>

        <section className="glass-card col-span-6 flex flex-col rounded-3xl p-[22px] md:col-span-2">
          <div className="eyebrow mb-1.5">Pengaturan AI</div>
          <h2 className="display text-[20px] leading-tight tracking-[-0.02em] text-ink">Atur asistenmu</h2>
          <p className="mb-4 mt-1 text-[14.5px] text-steel">Lihat yang terhubung, atur cara kerjanya, atau putuskan sambungan.</p>
          <button className="btn btn-secondary mt-auto self-start" onClick={openSettings}>
            Buka Pengaturan
          </button>
        </section>

        <section className="glass-card col-span-6 rounded-3xl p-[22px]">
          <div className="eyebrow mb-1.5">Cara pakai</div>
          <h2 className="display text-[20px] leading-tight tracking-[-0.02em] text-ink">Dari satu kalimat sampai jadi</h2>
          <StepRow steps={USE_STEPS} />
        </section>

        <section className="glass-card col-span-6 rounded-3xl px-[22px] py-2" aria-label="Tanya jawab">
          {QUESTIONS.map(({ q, a }) => (
            <details key={q} className="faq border-b border-rule-2 last:border-b-0">
              <summary className="flex items-center justify-between gap-3 py-[15px] text-[15px] font-semibold tracking-[-0.006em] text-ink">
                {q}
                <ChevronDown size={18} className="shrink-0 text-mute" />
              </summary>
              <p className="pb-4 pr-8 text-[14.5px] text-ink-2">{a}</p>
            </details>
          ))}
        </section>
      </div>
    </div>
  );
}
