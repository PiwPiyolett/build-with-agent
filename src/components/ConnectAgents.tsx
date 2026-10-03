import { useCallback, useEffect, useState } from "react";
import type { AgentConnection } from "../../shared/types";
import { api, type ApiError } from "../lib/api";
import { BRAIN_STARTER } from "../lib/bridgeConfig";
import { CopyButton, Led, useConfirm, useToast } from "./ui";

type Agent = AgentConnection["agent"];

const NAME: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };

/** Removing the connection is easy to mistake for leaving brain mode, so the dialog says what it is not. */
const STOP_BRAIN = "Ini BUKAN untuk menghentikan mode otak: untuk itu cukup tekan Esc di sesi agent, koneksinya tetap ada.";
const DISCONNECT_BODY: Record<Agent, string> = {
  claude: `${STOP_BRAIN}

BWA akan menghapus pendaftaran MCP server bwa (claude mcp remove bwa) dan perintah /bwa dari Claude Code. Untuk memakai BWA lagi, kamu perlu menekan Sambungkan. Pengaturan Claude Code lainnya tidak disentuh.`,
  codex: `${STOP_BRAIN}

BWA akan menghapus bagian [mcp_servers.bwa] dari config.toml (salinan sebelumnya disimpan sebagai config.toml.bak-bwa). Pengaturan Codex lainnya tidak disentuh.`,
};

const CONNECTED_TOAST: Record<Agent, string> = {
  claude: "Claude Code tersambung. Buka sesi baru di folder proyekmu, lalu ketik /bwa.",
  codex: "Codex tersambung. Jalankan codex di folder proyekmu, lalu kirim prompt jadi otak.",
};

/** What a card shows: the light, a one-line state, and whether "Sambungkan" still has work to do. */
function describe(c: AgentConnection): { led: "off" | "amber" | "green"; label: string; action: string | null } {
  if (c.agent === "claude" && !c.found) return { led: "off", label: "tidak ditemukan di komputer ini", action: null };
  if (c.state === "outdated") return { led: "amber", label: "menunjuk ke lokasi BWA lain", action: "Perbarui" };
  if (c.state === "disconnected") {
    return { led: "off", label: c.found ? "belum tersambung" : "belum terdeteksi, pengaturan tetap bisa disiapkan", action: "Sambungkan" };
  }
  if (c.agent === "claude" && !c.skill) return { led: "amber", label: "tersambung · perintah /bwa perlu dipasang", action: "Perbarui" };
  return { led: "green", label: c.agent === "claude" ? "tersambung · /bwa terpasang" : "tersambung", action: null };
}

/** "Sambungkan otomatis": registers BWA in Claude Code and Codex with one click, after showing what will change. */
export function ConnectAgents() {
  const toast = useToast();
  const confirm = useConfirm();
  const [conns, setConns] = useState<Record<Agent, AgentConnection> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Agent | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .connections()
      .then(setConns)
      .catch((err) => setLoadError((err as Error).message));
  }, []);
  useEffect(load, [load]);

  const act = async (c: AgentConnection, mode: "connect" | "disconnect") => {
    const ok = await confirm(
      mode === "connect"
        ? { title: `Sambungkan ${NAME[c.agent]} ke BWA?`, body: `BWA akan:\n• ${c.changes.join("\n• ")}`, confirmLabel: "Sambungkan" }
        : { title: `Hapus koneksi BWA dari ${NAME[c.agent]}?`, body: DISCONNECT_BODY[c.agent], confirmLabel: "Hapus koneksi", danger: true },
    );
    if (!ok) return;
    setBusy(c.agent);
    try {
      const next = mode === "connect" ? await api.connectAgent(c.agent) : await api.disconnectAgent(c.agent);
      setConns((all) => all && { ...all, [c.agent]: next });
      toast(mode === "connect" ? CONNECTED_TOAST[c.agent] : `Koneksi BWA dihapus dari ${NAME[c.agent]}.`, "success");
    } catch (err) {
      const e = err as ApiError;
      toast([e.message, e.hint].filter(Boolean).join(" "), "error");
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <p className="text-[13px] text-ink-2">
        Status agent gagal dibaca: {loadError}{" "}
        <button className="font-semibold text-pair-blue underline underline-offset-2" onClick={load}>
          Coba lagi
        </button>
      </p>
    );
  }
  if (!conns) return <p className="text-[13px] text-steel">Memeriksa Claude Code dan Codex di komputer ini…</p>;

  return (
    <div className="space-y-2.5">
      {(["claude", "codex"] as const).map((agent) => {
        const c = conns[agent];
        const d = describe(c);
        const connected = c.state === "connected";
        return (
          <div key={agent} className="rounded-lg border border-rule px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Led state={d.led} />
                <span className="text-[14px] font-semibold text-ink">{NAME[agent]}</span>
                <span className="truncate text-[13px] text-steel">{d.label}</span>
              </div>
              <div className="flex gap-2">
                {d.action && (
                  <button className="btn btn-primary btn-sm" onClick={() => act(c, "connect")} disabled={busy !== null}>
                    {busy === agent ? "Memproses…" : d.action}
                  </button>
                )}
                {c.state !== "disconnected" && (
                  <button className="btn btn-ghost btn-sm" onClick={() => act(c, "disconnect")} disabled={busy !== null}>
                    {busy === agent && !d.action ? "Memproses…" : "Hapus koneksi"}
                  </button>
                )}
              </div>
            </div>
            {c.detail && (
              <p className="mono mt-1 truncate text-[11px] text-steel" title={c.detail}>
                {c.detail}
              </p>
            )}
            {c.message && <p className="mt-1.5 text-[12.5px] text-ink-2">{c.message}</p>}
            {connected && agent === "claude" && (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                Buka <span className="font-semibold text-ink">sesi baru</span> Claude Code di folder repository proyekmu, lalu
                ketik <span className="mono text-[12px]">/bwa</span>. Biarkan sesinya terbuka: setelah task terbentuk, sesi yang
                sama yang mengerjakannya. Untuk berhenti dari mode otak, tekan <span className="kbd">Esc</span> di sesi itu; koneksi ini
                tetap tersimpan.
              </p>
            )}
            {connected && agent === "codex" && (
              <div className="mt-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[13px] text-ink-2">
                    Jalankan <span className="kbd">codex</span> di folder repository proyekmu, lalu kirim prompt ini:
                  </span>
                  <CopyButton text={BRAIN_STARTER} />
                </div>
                <p className="rounded-lg border border-rule bg-wash px-3.5 py-3 text-[13px] leading-relaxed text-ink">{BRAIN_STARTER}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
