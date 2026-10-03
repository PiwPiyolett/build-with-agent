import { useEffect, useId, useMemo, useState } from "react";
import type { AgentKey, BrainProvider, BrainWorker, HandoverMode, PublicSettings } from "../../shared/types";
import { ROUTER_DASHBOARD } from "../App";
import { api, type BridgeInfo, type ConnectionTest, type ModelTest } from "../lib/api";
import { BRAIN_STARTER, HANDOVER_HINT, HANDOVER_OPTIONS, mcpConfigs } from "../lib/bridgeConfig";
import { AGENTS, nf, timeAgo } from "../lib/format";
import { ConnectAgents } from "./ConnectAgents";
import { CodeBlock, CopyButton, ErrorNote, Led, Modal, Segmented, useToast } from "./ui";

const AGENT_FIELDS: { key: AgentKey; n: 1 | 2 | 3; hint: string }[] = [
  { key: "idea", n: 1, hint: "Dipakai berulang saat eksplorasi. Model cepat terasa lebih enak." },
  { key: "topology", n: 2, hint: "Butuh penalaran struktur. Model kuat lebih rapi." },
  { key: "tasks", n: 3, hint: "Membagi task dan menulis PRD. Output panjang, pilih model yang kuat." },
];

export function SettingsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const listId = useId();
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
      toast(provider === "mcp" ? "Otak AI: agent MCP. Pengaturan disimpan." : "Pengaturan 9router disimpan.", "success");
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Pengaturan"
      title={provider === "mcp" ? "Otak AI lewat agent MCP" : "Otak AI lewat 9router"}
      width="max-w-2xl"
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
        <p className="text-steel">Memuat pengaturan…</p>
      ) : (
        <div className="space-y-7">
          {loaded.routerEnabled && (
          <section className="space-y-2.5">
            <h3 className="eyebrow">Sumber otak AI</h3>
            <Segmented<BrainProvider>
              label="Sumber otak AI"
              value={provider}
              onChange={setProvider}
              options={[
                { value: "9router", label: "9router (API)" },
                { value: "mcp", label: "Agent MCP (Claude Code · Codex)" },
              ]}
            />
            <p className="text-[12.5px] leading-snug text-steel">
              {provider === "mcp"
                ? "Agent 1, 2, dan 3 dijawab oleh Claude Code atau Codex yang sedang standby, memakai langganan atau model agent itu sendiri. 9router tidak dibutuhkan."
                : "Agent 1, 2, dan 3 memanggil model lewat endpoint OpenAI-compatible dari 9router."}
            </p>
          </section>
          )}

          {provider === "mcp" && <BrainPanel handover={handover} onHandover={setHandover} />}

          {provider === "9router" && (
          <>
          <section className="space-y-3.5">
            <h3 className="eyebrow">Koneksi</h3>
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
            <h3 className="eyebrow">Model</h3>
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

          <details className="group">
            <summary className="eyebrow cursor-pointer select-none list-none">
              <span className="group-open:hidden">+ </span>
              <span className="hidden group-open:inline">− </span>
              Lanjutan
            </summary>
            <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
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
                  <p className="mt-1 text-[12px] leading-snug text-steel">Batas waktu agent menjawab satu job setelah mengambilnya.</p>
                )}
              </div>
            </div>
          </details>

          {provider === "9router" && (
          <p className="rounded-lg bg-wash px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
            9router belum jalan? Buka terminal lalu jalankan <span className="kbd">9router</span>. Di{" "}
            <a className="font-semibold text-pair-blue underline underline-offset-2" href={ROUTER_DASHBOARD} target="_blank" rel="noreferrer">
              dashboard 9router
            </a>
            , hubungkan provider (misalnya Kiro yang gratis) lalu salin API key ke sini. Nama combo 9router juga bisa dipakai
            sebagai model agar otomatis pindah ke provider lain saat kuota habis.
          </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Settings body for provider "mcp": who is standby, how to start one, a round-trip test, and the handover mode. */
function BrainPanel({ handover, onHandover }: { handover: HandoverMode; onHandover: (mode: HandoverMode) => void }) {
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
      <h3 className="eyebrow">Agent standby</h3>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-wash px-3.5 py-2.5 text-[13px] text-ink-2">
        {workers === null ? (
          <span className="text-steel">Memeriksa…</span>
        ) : workers.length === 0 ? (
          <span className="flex items-center gap-2">
            <Led state="amber" /> Belum ada agent yang standby. Ikuti langkah di bawah.
          </span>
        ) : (
          workers.map((w) => (
            <span key={w.name} className="tag normal-case tracking-normal" title={`terakhir terlihat ${timeAgo(w.lastSeen)}`}>
              <Led state="green" /> {w.name}
              {w.busy > 0 ? ` · mengerjakan ${w.busy} job` : " · standby"}
            </span>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-secondary btn-sm" onClick={runTest} disabled={test?.testing || !workers?.length}>
          {test?.testing ? "Menunggu jawaban agent…" : "Tes otak MCP"}
        </button>
        {test && !test.testing && test.ok && (
          <span className="flex items-center gap-2 text-[13px] text-ink-2">
            <Led state="green" /> {test.model.replace(/^mcp:/, "")} menjawab dalam {(test.latencyMs! / 1000).toFixed(1)} detik
          </span>
        )}
      </div>
      {test && !test.testing && !test.ok && <ErrorNote message={test.error ?? "Agent tidak menjawab."} hint={test.hint} />}

      <h3 className="eyebrow pt-1">Sambungkan agent</h3>
      <ConnectAgents />

      <details className="group rounded-lg border border-rule-2 px-3.5 py-2.5">
        <summary className="cursor-pointer select-none list-none text-[13px] font-semibold text-ink-2">
          <span className="group-open:hidden">+ </span>
          <span className="hidden group-open:inline">− </span>
          Cara manual (jalankan perintahnya sendiri)
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
            2. Buka <span className="font-semibold text-ink">sesi baru</span> Claude Code di{" "}
            <span className="font-semibold text-ink">folder repository proyekmu</span> (sesi yang sudah terbuka sebelum langkah 1
            belum mengenal bwa), lalu ketik <span className="mono text-[12px]">/mcp__bwa__jadi_otak</span> di chat (atau{" "}
            <span className="mono text-[12px]">/bwa</span> kalau perintah itu sudah dipasang). Biarkan sesinya
            terbuka: setelah task terbentuk, sesi yang sama yang mengerjakannya.
          </p>
        </div>
      )}
      {tab === "codex" && (
        <div className="space-y-3">
          <CodeBlock label="1. Tambahkan ke ~/.codex/config.toml (lewati jika sudah pernah)" code={cfg.codex} />
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13.5px] text-ink-2">
                2. Jalankan <span className="kbd">codex</span> di folder repository proyekmu, lalu kirim prompt ini dan biarkan
                sesinya terbuka:
              </span>
              <CopyButton text={BRAIN_STARTER} />
            </div>
            <p className="rounded-lg border border-rule bg-wash px-3.5 py-3 text-[13px] leading-relaxed text-ink">{BRAIN_STARTER}</p>
          </div>
        </div>
      )}
        </div>
      </details>
      <div className="space-y-1.5 border-t border-rule-2 pt-3.5">
        <h3 className="eyebrow">Setelah task terbentuk, sesi agent:</h3>
        <Segmented<HandoverMode> label="Mode serah-terima" value={handover} onChange={onHandover} options={HANDOVER_OPTIONS} />
        <p className="text-[12.5px] leading-snug text-steel">
          Begitu Agent 3 selesai membagi task, sesi otak menjadi agent coding proyek itu dan kamu melanjutkan lewat chat-nya.{" "}
          {HANDOVER_HINT[handover]}
        </p>
      </div>
      <p className="text-[12.5px] leading-snug text-steel">
        Satu agent mengerjakan job satu per satu. PRD terdiri dari dua bagian, jadi akan lebih cepat kalau ada dua agent
        standby. Model, temperature, dan max tokens mengikuti pengaturan agent itu sendiri.
      </p>
      <p className="rounded-lg bg-wash px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">Ganti model di tengah jalan?</span> Bisa. Misalnya Sonnet untuk ide, lalu Opus
        untuk topologi dan task. Tekan <span className="kbd">Esc</span> di sesi agent, ganti dengan{" "}
        <span className="mono text-[12px]">/model</span>, lalu ketik lagi <span className="mono text-[12px]">/bwa</span> (atau
        "lanjut"). Job yang masuk selama jeda menunggu
        di antrean sekitar 2 menit.
      </p>
    </section>
  );
}
