import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Info, Palette, Settings, SlidersHorizontal, Workflow, type LucideIcon } from "lucide-react";
import { agentLabel } from "../../shared/setupGuide";
import type { AgentKey, BrainProvider, BrainWorker, HandoverMode, PublicSettings } from "../../shared/types";
import { ROUTER_DASHBOARD, useApp } from "../App";
import { api, type BridgeInfo, type ConnectionTest, type ModelTest } from "../lib/api";
import { BRAND } from "../lib/brand";
import { BRAIN_STARTER, HANDOVER_HINT, HANDOVER_OPTIONS, mcpConfigs } from "../lib/bridgeConfig";
import { AGENTS, nf, timeAgo } from "../lib/format";
import { ConnectAgents } from "./ConnectAgents";
import { CodeBlock, CopyButton, ErrorNote, Led, Modal, Segmented, useSlidingThumb, useToast } from "./ui";

type SectionKey = "assistant" | "behavior" | "appearance" | "advanced" | "about";

const SECTIONS: { key: SectionKey; label: string; note: string; icon: LucideIcon }[] = [
  { key: "assistant", label: "Asisten AI", note: "Lihat asisten yang terhubung dan atur sambungannya.", icon: Bot },
  { key: "behavior", label: "Cara kerja", note: "Atur yang dilakukan asisten setelah task terbentuk.", icon: Workflow },
  { key: "appearance", label: "Tampilan", note: "Atur tampilan BWA di laptop ini.", icon: Palette },
  { key: "advanced", label: "Lanjutan", note: "Biasanya tidak perlu diubah.", icon: SlidersHorizontal },
  { key: "about", label: "Tentang", note: "Orang-orang yang membuat BWA.", icon: Info },
];

function SettingsNav({ sections, active, onPick }: { sections: typeof SECTIONS; active: SectionKey; onPick: (key: SectionKey) => void }) {
  const box = useRef<HTMLElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useSlidingThumb(box, thumb, "button[aria-current]", active);
  return (
    <nav ref={box} className="settings-nav" aria-label="Bagian pengaturan">
      <span ref={thumb} className="settings-thumb" aria-hidden />
      {sections.map(({ key, label, icon: Icon }) => (
        <button key={key} type="button" aria-current={key === active ? "true" : undefined} onClick={() => onPick(key)}>
          <Icon size={17} aria-hidden />
          {label}
        </button>
      ))}
    </nav>
  );
}

/** One part of Settings. It stays mounted while hidden, so unsaved choices and connection checks survive moving around. */
function SettingsPanel({ section, active, children }: { section: SectionKey; active: SectionKey; children: ReactNode }) {
  const { label, note } = SECTIONS.find((s) => s.key === section)!;
  return (
    <div hidden={section !== active} className="settings-panel">
      <h3 className="display text-[22px] leading-tight text-ink">{label}</h3>
      <p className="mb-5 mt-1 text-[13.5px] text-steel">{note}</p>
      {children}
    </div>
  );
}

const AGENT_FIELDS: { key: AgentKey; n: 1 | 2 | 3; hint: string }[] = [
  { key: "idea", n: 1, hint: "Dipakai berulang saat eksplorasi. Model cepat terasa lebih enak." },
  { key: "topology", n: 2, hint: "Butuh penalaran struktur. Model kuat lebih rapi." },
  { key: "tasks", n: 3, hint: "Membagi task dan menulis PRD. Output panjang, pilih model yang kuat." },
];

export function SettingsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { openGuide, backgroundMotion, setBackgroundMotion } = useApp();
  const listId = useId();
  const [motion, setMotion] = useState(backgroundMotion);
  const [section, setSection] = useState<SectionKey>("assistant");
  const [loaded, setLoaded] = useState<PublicSettings | null>(null);
  const [provider, setProvider] = useState<BrainProvider>("9router");
  const [handover, setHandover] = useState<HandoverMode>("wait");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [model, setModel] = useState("");
  const [agentModels, setAgentModels] = useState<Record<AgentKey, string>>({ idea: "", topology: "", tasks: "" });
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(12000);
  const [timeoutSec, setTimeoutSec] = useState(300);
  const [conn, setConn] = useState<(ConnectionTest & { testing?: boolean }) | null>(null);
  const [modelTest, setModelTest] = useState<(ModelTest & { testing?: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);

  const testConnection = async (draft: { baseUrl?: string; apiKey?: string | null }) => {
    setConn({ ok: false, testing: true });
    try {
      setConn(await api.testConnection(draft));
    } catch (err) {
      setConn({ ok: false, error: (err as Error).message });
    }
  };

  useEffect(() => {
    if (!open) return;
    setModelTest(null);
    setApiKey("");
    setClearKey(false);
    setConn(null);
    setMotion(backgroundMotion);
    setSection("assistant");
    api.settings().then((s) => {
      setLoaded(s);
      setProvider(s.provider);
      setHandover(s.handover);
      setBaseUrl(s.baseUrl);
      setModel(s.model);
      setAgentModels(s.agentModels);
      setTemperature(s.temperature);
      setMaxTokens(s.maxTokens);
      setTimeoutSec(s.timeoutSec);
    });
  }, [open]);

  // Probe 9router only when it is the chosen brain, so MCP users do not see its connection errors.
  useEffect(() => {
    if (open && loaded && provider === "9router" && !conn) void testConnection({ baseUrl: loaded.baseUrl });
  }, [open, loaded, provider, conn]);

  const models = conn?.models ?? [];
  const grouped = useMemo(() => {
    const groups = new Map<string, number>();
    for (const m of models) {
      const prefix = m.id.includes("/") ? m.id.split("/")[0] : "combo";
      groups.set(prefix, (groups.get(prefix) ?? 0) + 1);
    }
    return [...groups.entries()];
  }, [models]);
  const modelKnown = !model || models.length === 0 || models.some((m) => m.id === model);

  const draftKey = () => (clearKey ? null : apiKey.trim() || undefined);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings({
        provider,
        handover,
        baseUrl,
        apiKey: draftKey(),
        model,
        agentModels,
        temperature,
        maxTokens,
        timeoutSec,
      });
      setBackgroundMotion(motion);
      toast(provider === "mcp" ? "Pengaturan disimpan." : "Pengaturan 9router disimpan.", "success");
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const runModelTest = async () => {
    setModelTest({ ok: false, model, testing: true });
    // Save first so the test uses the key and URL typed here.
    await api.saveSettings({ baseUrl, apiKey: draftKey(), model });
    setApiKey("");
    setClearKey(false);
    setLoaded(await api.settings());
    setModelTest(await api.testModel(model));
    onSaved();
  };

  // "Cara kerja" only applies to an assistant, so with 9router it steps aside.
  const sections = SECTIONS.filter((s) => s.key !== "behavior" || provider === "mcp");
  const active: SectionKey = sections.some((s) => s.key === section) ? section : "assistant";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <Settings size={20} className="text-telkom-deep" aria-hidden />
          Pengaturan
        </span>
      }
      width="max-w-3xl"
      flush
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !loaded}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </>
      }
    >
      {!loaded ? (
        <p className="px-6 py-5 text-steel">Memuat pengaturan…</p>
      ) : (
        <div className="flex h-[min(560px,70dvh)] flex-col sm:flex-row">
          <SettingsNav sections={sections} active={active} onPick={setSection} />
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <SettingsPanel section="assistant" active={active}>
          <div className="space-y-7">
          {loaded.routerEnabled && (
          <section className="space-y-2.5">
            <h4 className="settings-label">Sumber otak AI</h4>
            <Segmented<BrainProvider>
              label="Sumber otak AI"
              value={provider}
              onChange={setProvider}
              options={[
                { value: "9router", label: "9router (API)" },
                { value: "mcp", label: "Asisten AI (Claude · Codex)" },
              ]}
            />
            <p className="text-[12.5px] leading-snug text-steel">
              {provider === "mcp"
                ? "Agent 1, 2, dan 3 dijawab oleh Claude atau Codex yang percakapannya sedang terbuka, memakai langgananmu sendiri. 9router tidak dibutuhkan."
                : "Agent 1, 2, dan 3 memanggil model lewat endpoint OpenAI-compatible dari 9router."}
            </p>
          </section>
          )}

          {provider === "mcp" && (
            <BrainPanel
              onOpenGuide={() => {
                onClose();
                openGuide();
              }}
            />
          )}

          {provider === "9router" && (
          <>
          <section className="space-y-3.5">
            <h4 className="settings-label">Koneksi</h4>
            <div>
              <label className="label" htmlFor="s-url">
                Base URL
              </label>
              <input
                id="s-url"
                className="field mono text-[13px]"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:20128/v1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="label" htmlFor="s-key">
                API key
              </label>
              <input
                id="s-key"
                className="field mono text-[13px]"
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setClearKey(false);
                }}
                placeholder={
                  loaded.hasApiKey && !clearKey
                    ? `Tersimpan (${loaded.apiKeyPreview}). Ketik untuk mengganti.`
                    : "Kosongkan jika 9router tidak mewajibkan API key"
                }
                autoComplete="off"
              />
              {loaded.hasApiKey && (
                <label className="mt-2 flex items-center gap-2 text-[13px] text-steel">
                  <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />
                  Hapus API key yang tersimpan
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => testConnection({ baseUrl, apiKey: clearKey ? null : apiKey.trim() || undefined })}
                disabled={conn?.testing}
              >
                {conn?.testing ? "Menguji…" : "Tes koneksi"}
              </button>
              {conn && !conn.testing && conn.ok && (
                <span className="flex items-center gap-2 text-[13px] text-ink-2">
                  <Led state="green" /> Terhubung · {nf.format(models.length)} model · {conn.latencyMs} ms
                </span>
              )}
            </div>
            {conn && !conn.testing && !conn.ok && <ErrorNote message={conn.error ?? "Gagal terhubung."} hint={conn.hint} />}
            {grouped.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {grouped.map(([prefix, count]) => (
                  <span key={prefix} className="tag">
                    {prefix} · {count}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3.5">
            <h4 className="settings-label">Model</h4>
            <datalist id={listId}>
              {models.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
            <div>
              <label className="label" htmlFor="s-model">
                Model utama
              </label>
              <div className="flex gap-2">
                <input
                  id="s-model"
                  className="field mono text-[13px]"
                  list={listId}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="kr/claude-sonnet-4.5 atau nama combo"
                  spellCheck={false}
                />
                <button className="btn btn-secondary shrink-0" onClick={runModelTest} disabled={!model || modelTest?.testing}>
                  {modelTest?.testing ? "Menguji…" : "Tes model"}
                </button>
              </div>
              {!modelKnown && (
                <p className="mt-1.5 text-[12.5px] text-steel">
                  Model ini tidak ada di daftar 9router. Tidak apa-apa jika itu nama combo yang baru dibuat.
                </p>
              )}
              {modelTest && !modelTest.testing && modelTest.ok && (
                <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                  <Led state="green" /> Model menjawab dalam {(modelTest.latencyMs! / 1000).toFixed(1)} detik
                </p>
              )}
              {modelTest && !modelTest.testing && !modelTest.ok && (
                <div className="mt-2">
                  <ErrorNote message={modelTest.error ?? "Model tidak menjawab."} hint={modelTest.hint} />
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {AGENT_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="label" htmlFor={`s-${f.key}`}>
                    {AGENTS[f.n].short} · {AGENTS[f.n].name}
                  </label>
                  <input
                    id={`s-${f.key}`}
                    className="field mono text-[12px]"
                    list={listId}
                    value={agentModels[f.key]}
                    onChange={(e) => setAgentModels((a) => ({ ...a, [f.key]: e.target.value }))}
                    placeholder="Sama dengan model utama"
                    spellCheck={false}
                  />
                  <p className="mt-1 text-[12px] leading-snug text-steel">{f.hint}</p>
                </div>
              ))}
            </div>
          </section>
          </>
          )}

          {provider === "9router" && (
          <p className="rounded-xl bg-wash px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
            9router belum jalan? Buka terminal lalu jalankan <span className="kbd">9router</span>. Di{" "}
            <a className="font-semibold text-telkom-deep underline underline-offset-2" href={ROUTER_DASHBOARD} target="_blank" rel="noreferrer">
              dashboard 9router
            </a>
            , hubungkan provider (misalnya Kiro yang gratis) lalu salin API key ke sini. Nama combo 9router juga bisa dipakai
            sebagai model agar otomatis pindah ke provider lain saat kuota habis.
          </p>
          )}
          </div>
          </SettingsPanel>

          {provider === "mcp" && (
            <SettingsPanel section="behavior" active={active}>
              <HandoverPanel handover={handover} onHandover={setHandover} />
            </SettingsPanel>
          )}

          <SettingsPanel section="appearance" active={active}>
            <div className="settings-row">
              <span className="text-[14px] font-semibold text-ink">Animasi latar</span>
              <Segmented<"on" | "off">
                label="Animasi latar"
                value={motion ? "on" : "off"}
                onChange={(v) => setMotion(v === "on")}
                options={[
                  { value: "on", label: "Bergerak" },
                  { value: "off", label: "Diam" },
                ]}
              />
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-steel">Kalau laptop terasa berat, pilih Diam. Warna merahnya tetap ada, hanya tidak bergerak. Pilihan ini tersimpan di laptop ini saja.</p>
          </SettingsPanel>

          <SettingsPanel section="advanced" active={active}>
            <div className="grid gap-3 sm:grid-cols-3">
              {provider === "9router" && (
              <>
              <div>
                <label className="label" htmlFor="s-temp">
                  Temperature
                </label>
                <input
                  id="s-temp"
                  className="field"
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label" htmlFor="s-max">
                  Max tokens
                </label>
                <input
                  id="s-max"
                  className="field"
                  type="number"
                  step="1000"
                  min={0}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                />
              </div>
              </>
              )}
              <div>
                <label className="label" htmlFor="s-timeout">
                  Timeout (detik)
                </label>
                <input
                  id="s-timeout"
                  className="field"
                  type="number"
                  step="30"
                  min={30}
                  value={timeoutSec}
                  onChange={(e) => setTimeoutSec(Number(e.target.value))}
                />
                {provider === "mcp" && (
                  <p className="mt-1 text-[12px] leading-snug text-steel">Batas waktu asisten AI menjawab satu permintaan.</p>
                )}
              </div>
            </div>
          </SettingsPanel>

          <SettingsPanel section="about" active={active}>
            <section className="space-y-2.5">
              <h4 className="settings-label">Build by</h4>
              <ul className="space-y-1.5 text-[14px] text-ink">
                {BRAND.builders.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </section>
          </SettingsPanel>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** What happens after the tasks are split, and how conversations behave. */
function HandoverPanel({ handover, onHandover }: { handover: HandoverMode; onHandover: (mode: HandoverMode) => void }) {
  return (
    <div className="space-y-5">
      <section>
        <h4 className="settings-label">Setelah task terbentuk, asisten AI:</h4>
        <Segmented<HandoverMode> label="Yang dilakukan asisten setelah task terbentuk" value={handover} onChange={onHandover} options={HANDOVER_OPTIONS} />
        <p className="mt-2 text-[12.5px] leading-snug text-steel">
          Begitu Agent 3 selesai membagi task, asisten di percakapan itu mulai mengurus proyekmu, dan kamu melanjutkannya lewat
          percakapan tersebut. {HANDOVER_HINT[handover]}
        </p>
      </section>
      <p className="text-[12.5px] leading-snug text-steel">
        Satu percakapan mengerjakan satu permintaan dalam satu waktu. PRD terdiri dari dua bagian, jadi lebih cepat kalau ada dua
        percakapan yang terbuka. Pilihan model mengikuti pengaturan di aplikasi asistenmu.
      </p>
      <p className="rounded-xl bg-wash px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">Ingin ganti model di tengah jalan?</span> Bisa. Tekan{" "}
        <span className="kbd">Esc</span> di percakapan, ganti dengan <span className="mono text-[12px]">/model</span>, lalu ketik
        lagi <span className="mono text-[12px]">/bwa</span> (atau "lanjut"). Permintaan yang masuk selama jeda menunggu sekitar 2
        menit.
      </p>
    </div>
  );
}

/** The assistant part of Settings: who is ready, how to connect one, and a round-trip test. */
function BrainPanel({ onOpenGuide }: { onOpenGuide: () => void }) {
  const [bridge, setBridge] = useState<BridgeInfo | null>(null);
  const [tab, setTab] = useState<"claude" | "codex">("claude");
  const [workers, setWorkers] = useState<BrainWorker[] | null>(null);
  const [test, setTest] = useState<(ModelTest & { testing?: boolean }) | null>(null);

  useEffect(() => {
    api.bridge().then(setBridge).catch(() => setBridge(null));
    let alive = true;
    const poll = () =>
      api
        .brainStatus()
        .then((s) => alive && setWorkers(s.workers))
        .catch(() => alive && setWorkers([]));
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const cfg = mcpConfigs(bridge, {}, true);

  const runTest = async () => {
    setTest({ ok: false, model: "mcp", testing: true });
    try {
      setTest(await api.testBrain());
    } catch (err) {
      setTest({ ok: false, model: "mcp", error: (err as Error).message });
    }
  };

  return (
    <section className="space-y-3.5">
      <h4 className="settings-label">Asisten yang siap</h4>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-wash px-3.5 py-2.5 text-[13px] text-ink-2">
        {workers === null ? (
          <span className="text-steel">Memeriksa…</span>
        ) : workers.length === 0 ? (
          <span className="flex items-center gap-2">
            <Led state="amber" /> Asisten AI belum terhubung.
          </span>
        ) : (
          workers.map((w) => (
            <span key={w.name} className="tag normal-case tracking-normal" title={`terakhir terlihat ${timeAgo(w.lastSeen)}`}>
              <Led state="green" /> {agentLabel(w.name)}
              {w.busy > 0 ? " · sedang bekerja" : " · siap"}
            </span>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary btn-sm" onClick={onOpenGuide}>
          Buka panduan menghubungkan
        </button>
        <button className="btn btn-secondary btn-sm" onClick={runTest} disabled={test?.testing || !workers?.length}>
          {test?.testing ? "Menunggu jawaban asisten…" : "Coba sambungan"}
        </button>
        {test && !test.testing && test.ok && (
          <span className="flex items-center gap-2 text-[13px] text-ink-2">
            <Led state="green" /> {agentLabel(test.model.replace(/^mcp:/, ""))} menjawab dalam {(test.latencyMs! / 1000).toFixed(1)} detik
          </span>
        )}
      </div>
      {test && !test.testing && !test.ok && <ErrorNote message={test.error ?? "Asisten tidak menjawab."} hint={test.hint} />}

      <h4 className="settings-label pt-1">Sambungan</h4>
      <ConnectAgents />

      <details className="group rounded-lg border border-rule-2 px-3.5 py-2.5">
        <summary className="cursor-pointer select-none list-none text-[13px] font-semibold text-ink-2">
          <span className="group-open:hidden">+ </span>
          <span className="hidden group-open:inline">− </span>
          Sudah terbiasa memakai terminal? Lihat cara manualnya
        </summary>
        <div className="mt-3 space-y-3">
      <Segmented<"claude" | "codex">
        label="Pilih agent"
        value={tab}
        onChange={setTab}
        options={[
          { value: "claude", label: "Claude Code" },
          { value: "codex", label: "Codex" },
        ]}
      />
      {tab === "claude" && (
        <div className="space-y-3">
          <CodeBlock label="1. Jalankan sekali di terminal (PowerShell), bukan di chat. Lewati jika sudah pernah." code={cfg.claude} />
          <p className="text-[12.5px] leading-snug text-steel">
            Perintah <span className="kbd">claude</span> tidak dikenal karena Claude Code-mu terpasang lewat aplikasi desktop?
            Minta Claude Code di chat: "daftarkan MCP server bwa dengan perintah ini", lalu tempel perintah di atas.
          </p>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            2. Buka <span className="font-semibold text-ink">percakapan baru</span> Claude Code di{" "}
            <span className="font-semibold text-ink">folder proyekmu</span> (percakapan yang sudah terbuka sebelum langkah 1
            belum mengenal BWA), lalu ketik <span className="mono text-[12px]">/mcp__bwa__jadi_otak</span> (atau{" "}
            <span className="mono text-[12px]">/bwa</span> kalau perintah itu sudah dipasang). Biarkan percakapannya
            terbuka: setelah task terbentuk, percakapan yang sama yang mengerjakannya.
          </p>
        </div>
      )}
      {tab === "codex" && (
        <div className="space-y-3">
          <CodeBlock label="1. Tambahkan ke ~/.codex/config.toml (lewati jika sudah pernah)" code={cfg.codex} />
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13.5px] text-ink-2">
                2. Jalankan <span className="kbd">codex</span> di folder proyekmu, lalu kirim pesan ini dan biarkan percakapannya
                terbuka:
              </span>
              <CopyButton text={BRAIN_STARTER} />
            </div>
            <p className="rounded-lg border border-rule bg-wash px-3.5 py-3 text-[13px] leading-relaxed text-ink">{BRAIN_STARTER}</p>
          </div>
        </div>
      )}
        </div>
      </details>
    </section>
  );
}
