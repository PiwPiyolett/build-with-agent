import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { Project } from "../../shared/types";
import { CodeBlock, CopyButton, Led, Modal, Segmented } from "../components/ui";
import { api, type BridgeInfo } from "../lib/api";
import { mcpConfigs } from "../lib/bridgeConfig";
import { timeAgo } from "../lib/format";

type Tab = "claude" | "codex" | "json" | "cli";

const SYSTEM_ACTORS = new Set(["user", "agent-1", "agent-2", "agent-3", "api", "pipeline-test"]);

export function ConnectAgentDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const [bridge, setBridge] = useState<BridgeInfo | null>(null);
  const [tab, setTab] = useState<Tab>("claude");

  useEffect(() => {
    if (open && !bridge) api.bridge().then(setBridge).catch(() => setBridge(null));
  }, [open, bridge]);

  const agents = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of project.activity) if (!SYSTEM_ACTORS.has(a.by)) seen.set(a.by, a.at);
    return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1]));
  }, [project.activity]);

  const name = project.brief?.name || project.idea?.title || project.name;
  const pid = project.id;
  const { url, cli, claude: claudeCmd, codex: codexToml, json } = mcpConfigs(bridge, { BWA_PROJECT_ID: pid });

  const starter =
    `Kamu terhubung ke BWA lewat MCP server "bwa". Kerjakan proyek ${name} (id ${pid}) di repository ini.\n` +
    "Panggil get_project_context sekali. Lalu ulangi: get_next_task (claim=true), kerjakan sampai semua acceptance criteria terpenuhi dan terverifikasi, " +
    "lalu complete_task dengan ringkasan dan daftar file yang diubah. Kalau butuh keputusanku, panggil block_task lalu lanjut ke task lain. " +
    "Berhenti saat semua task selesai.";

  const cliCmds = `node "${cli}" next --claim --agent aider --project ${pid}
node "${cli}" done T03 --summary "Apa yang dikerjakan" --files "src/a.ts,src/b.ts" --project ${pid}
node "${cli}" help`;

  return (
    <Modal open={open} onClose={onClose} eyebrow="Agent coding" title="Hubungkan Claude Code, Codex, atau agent lain" width="max-w-3xl">
      <div className="space-y-5">
        <p className="text-[14px] leading-relaxed text-ink-2">
          Agent terhubung ke BWA lewat MCP. Ia membaca brief, mengambil task berikutnya, mengerjakannya di repository
          kodemu, lalu mencentangnya di sini. Aplikasi BWA harus tetap berjalan selama agent bekerja.
        </p>

        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-wash px-3.5 py-2.5 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">Agent yang pernah terhubung:</span>
          {agents.length === 0 ? (
            <span className="text-steel">belum ada</span>
          ) : (
            agents.map(([agent, at]) => (
              <span key={agent} className="tag normal-case tracking-normal" title={`terakhir aktif ${timeAgo(at)}`}>
                <Led state="green" /> {agent} · {timeAgo(at)}
              </span>
            ))
          )}
        </div>

        <Segmented<Tab>
          label="Pilih agent"
          value={tab}
          onChange={setTab}
          options={[
            { value: "claude", label: "Claude Code" },
            { value: "codex", label: "Codex" },
            { value: "json", label: "Cursor · Gemini · lainnya" },
            { value: "cli", label: "Tanpa MCP" },
          ]}
        />

        {tab === "claude" && (
          <div className="space-y-4">
            <CodeBlock label="1. Jalankan sekali di folder repository proyekmu" code={claudeCmd} />
            <p className="text-[13.5px] text-ink-2">
              2. Buka <span className="kbd">claude</span> di folder itu, cek dengan <span className="kbd">/mcp</span>, lalu kirim
              prompt di bawah. Bisa juga dengan perintah <span className="mono text-[12px]">/mcp__bwa__kerjakan_task</span>.
            </p>
          </div>
        )}
        {tab === "codex" && (
          <div className="space-y-4">
            <CodeBlock label="1. Tambahkan ke ~/.codex/config.toml (Windows: %USERPROFILE%\.codex\config.toml)" code={codexToml} />
            <p className="text-[13.5px] text-ink-2">
              2. Jalankan <span className="kbd">codex</span> di folder repository proyekmu, lalu kirim prompt di bawah.
            </p>
          </div>
        )}
        {tab === "json" && (
          <div className="space-y-3">
            <CodeBlock label="Konfigurasi MCP (format mcpServers)" code={json} />
            <ul className="space-y-1 text-[13px] text-ink-2">
              <li>
                Cursor: <span className="mono text-[12px]">.cursor/mcp.json</span> di repository
              </li>
              <li>
                Gemini CLI: <span className="mono text-[12px]">~/.gemini/settings.json</span>
              </li>
              <li>
                Windsurf: <span className="mono text-[12px]">~/.codeium/windsurf/mcp_config.json</span>
              </li>
              <li>Cline, Roo, Claude Desktop, dan klien MCP lain memakai format yang sama.</li>
            </ul>
          </div>
        )}
        {tab === "cli" && (
          <div className="space-y-3">
            <CodeBlock label="Untuk agent yang hanya punya akses terminal (Aider, skrip, dll.)" code={cliCmds} />
            <p className="text-[13px] text-ink-2">
              REST API juga tersedia di <span className="mono text-[12px]">{url}/api/agent/…</span>. Lihat README untuk daftar
              endpoint.
            </p>
          </div>
        )}

        <div className="border-t border-rule-2 pt-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink-2">Prompt untuk agent</span>
            <CopyButton text={starter} />
          </div>
          <p className="rounded-lg border border-rule bg-wash px-3.5 py-3 text-[13.5px] leading-relaxed text-ink">{starter}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule px-3.5 py-3">
          <div className="text-[13px] text-ink-2">
            <span className="font-semibold text-ink">AGENTS.md</span> berisi brief, aturan kerja, cara terhubung, dan checklist.
            Simpan di root repository agar agent langsung paham konteksnya.
          </div>
          <a className="btn btn-secondary btn-sm" href={`/api/projects/${pid}/export/agents-md`} download="AGENTS.md">
            <Download size={14} /> Unduh AGENTS.md
          </a>
        </div>
      </div>
    </Modal>
  );
}
