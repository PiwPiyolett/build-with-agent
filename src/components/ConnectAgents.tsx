import { useCallback, useEffect, useState } from "react";
import type { AgentConnection } from "../../shared/types";
import { api, type ApiError } from "../lib/api";
import { ASSISTANTS, connectConfirmBody } from "../lib/setupGuide";
import { Led, useConfirm, useToast } from "./ui";

type Agent = AgentConnection["agent"];

const NAME: Record<Agent, string> = { claude: "Claude", codex: "Codex" };
const COMMAND: Record<Agent, string> = { claude: "/bwa", codex: "$bwa" };

/** Removing the connection is easy to mistake for stopping the assistant, so the dialog says what it is not. */
const STOP_BRAIN = "Ini BUKAN untuk menghentikan asisten. Untuk itu cukup tekan Esc atau tutup percakapannya, sambungannya tetap ada.";
const DISCONNECT_BODY: Record<Agent, string> = {
  claude: `${STOP_BRAIN}

BWA akan menghapus pendaftarannya dan perintah /bwa dari Claude. Untuk memakai BWA lagi, kamu perlu menekan Hubungkan. Pengaturan Claude yang lain tidak disentuh.

Rincian teknis: claude mcp remove bwa`,
  codex: `${STOP_BRAIN}

BWA akan menghapus pendaftarannya dan perintah $bwa dari Codex. Untuk memakai BWA lagi, kamu perlu menekan Hubungkan. Pengaturan Codex yang lain tidak disentuh.

Rincian teknis: bagian [mcp_servers.bwa] dihapus dari config.toml, dan salinan sebelumnya disimpan sebagai config.toml.bak-bwa.`,
};

/** What a card shows: the light, a one-line state, and whether "Hubungkan" still has work to do. */
function describe(c: AgentConnection): { led: "off" | "amber" | "green"; label: string; action: string | null } {
  if (c.agent === "claude" && !c.found) return { led: "off", label: c.appFound ? "buka tab Code di aplikasi Claude sekali" : "belum terpasang", action: null };
  if (c.state === "outdated") return { led: "amber", label: "sambungan perlu diperbarui", action: "Perbarui" };
  if (c.state === "disconnected") {
    return { led: "off", label: c.found ? "belum terhubung" : "belum terdeteksi, tapi tetap bisa disiapkan", action: "Hubungkan" };
  }
  if (!c.skill) return { led: "amber", label: `terhubung · perintah ${COMMAND[c.agent]} perlu dipasang`, action: "Perbarui" };
  return { led: "green", label: `terhubung · perintah ${COMMAND[c.agent]} siap`, action: null };
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
        ? { title: `Hubungkan ${NAME[c.agent]} ke BWA?`, body: connectConfirmBody(c.agent, c), confirmLabel: "Hubungkan" }
        : { title: `Putuskan sambungan ${NAME[c.agent]}?`, body: DISCONNECT_BODY[c.agent], confirmLabel: "Putuskan", danger: true },
    );
    if (!ok) return;
    setBusy(c.agent);
    try {
      const next = mode === "connect" ? await api.connectAgent(c.agent) : await api.disconnectAgent(c.agent);
      setConns((all) => all && { ...all, [c.agent]: next });
      toast(
        mode === "connect" ? `${NAME[c.agent]} terhubung. Buka percakapan baru di folder proyekmu, lalu ketik ${COMMAND[c.agent]}.` : `Sambungan ${NAME[c.agent]} diputus.`,
        "success",
      );
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
        Keadaan komputer ini belum bisa dibaca: {loadError}{" "}
        <button className="font-semibold text-pair-blue underline underline-offset-2" onClick={load}>
          Coba lagi
        </button>
      </p>
    );
  }
  if (!conns) return <p className="text-[13px] text-steel">Memeriksa Claude dan Codex di komputer ini…</p>;

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
                    {busy === agent && !d.action ? "Memproses…" : "Putuskan"}
                  </button>
                )}
              </div>
            </div>
            {c.message && <p className="mt-1.5 text-[12.5px] text-ink-2">{c.message}</p>}
            {connected && (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                Buka <span className="font-semibold text-ink">percakapan baru</span> di {ASSISTANTS[agent].app}, pilih folder
                proyekmu, lalu ketik <span className="kbd">{COMMAND[agent]}</span> dan tekan <span className="kbd">Enter</span>.
                Biarkan percakapannya terbuka: setelah task terbentuk, percakapan yang sama yang mengerjakannya. Kalau sudah
                selesai, tutup percakapannya supaya jatah langgananmu tidak habis untuk menunggu.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
