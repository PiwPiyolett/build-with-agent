import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import type { RouterStatus } from "../shared/types";
import { api, detectRuntime, serverDownHint } from "./lib/api";
import { useRoute } from "./lib/router";
import { SettingsDialog } from "./components/SettingsDialog";
import { ConfirmProvider, Led, ToastProvider } from "./components/ui";
import { HomePage } from "./pages/HomePage";
import { ProjectPage } from "./pages/ProjectPage";

interface AppContextValue {
  status: RouterStatus | null;
  refreshStatus: () => void;
  openSettings: () => void;
  /** running inside the desktop app */
  desktop: boolean;
}

const AppContext = createContext<AppContextValue>({
  status: null,
  refreshStatus: () => {},
  openSettings: () => {},
  desktop: false,
});
export const useApp = () => useContext(AppContext);

export const ROUTER_DASHBOARD = "http://localhost:20128/dashboard";

export function App() {
  const route = useRoute();
  const [status, setStatus] = useState<RouterStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    void detectRuntime().then((r) => setDesktop(r.desktop));
  }, []);

  const checking = useRef(false);
  const refreshStatus = useCallback(() => {
    if (checking.current) return;
    checking.current = true;
    api
      .routerStatus()
      .then(setStatus)
      .catch(() =>
        setStatus((prev) => ({
          provider: prev?.provider ?? "mcp",
          state: "error",
          reachable: false,
          configured: false,
          model: "",
          modelCount: 0,
          error: "Server BWA tidak merespons.",
          hint: serverDownHint(),
        })),
      )
      .finally(() => {
        checking.current = false;
      });
  }, []);

  // Check often while the brain is not ready, rarely once it is, and again whenever the tab comes back.
  // MCP status is a cheap in-memory read, and agents come and go, so it stays fresher.
  const ready = status?.state === "ok";
  const mcp = status?.provider === "mcp";
  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, ready ? (mcp ? 15_000 : 60_000) : 5_000);
    const onFocus = () => document.visibilityState === "visible" && refreshStatus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [ready, mcp, refreshStatus]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppContext.Provider value={{ status, refreshStatus, openSettings, desktop }}>
          <div className="flex min-h-dvh flex-col">
            <TopBar status={status} onSettings={openSettings} />
            <main className="flex flex-1 flex-col">
              {route.name === "project" ? <ProjectPage key={route.id} id={route.id} stage={route.stage} /> : <HomePage />}
            </main>
          </div>
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={refreshStatus} />
        </AppContext.Provider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function TopBar({ status, onSettings }: { status: RouterStatus | null; onSettings: () => void }) {
  let led: "off" | "green" | "red" | "amber" = "off";
  let text: ReactNode = "memeriksa otak AI…";
  if (status?.provider === "mcp") {
    if (status.reachable) {
      led = "green";
      text = (
        <>
          Agent MCP <span className="text-mute">·</span> <span className="mono text-[11.5px]">{status.model}</span>
        </>
      );
    } else if (status.state === "error") {
      led = "red";
      text = "server BWA tidak merespons";
    } else {
      led = "amber";
      text = "Agent MCP · belum ada yang standby";
    }
  } else if (status) {
    if (status.state === "stalled") {
      led = "amber";
      text = "9router menyala, belum siap";
    } else if (status.state === "auth") {
      led = "red";
      text = "API key 9router ditolak";
    } else if (status.state === "off") {
      led = "red";
      text = "9router tidak berjalan";
    } else if (!status.reachable) {
      led = "red";
      text = "9router bermasalah";
    } else if (!status.configured) {
      led = "amber";
      text = "9router terhubung · pilih model";
    } else {
      led = "green";
      text = (
        <>
          9router <span className="text-mute">·</span> <span className="mono text-[11.5px]">{status.model}</span>
        </>
      );
    }
  }
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <a href="#/" className="flex items-center gap-2.5" aria-label="Build With Agent, ke beranda">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <span className="wordmark text-[17px] text-ink">BWA</span>
          <span className="mono hidden text-[10.5px] text-steel sm:inline">Build With Agent</span>
        </a>
        <div className="flex-1" />
        <button
          onClick={onSettings}
          className="flex h-8 min-w-0 items-center gap-2 rounded-full border border-rule bg-panel px-3 text-[13px] text-ink-2 transition-colors hover:border-steel"
          title={status?.error ? [status.error, status.hint].filter(Boolean).join("\n") : "Atur otak AI"}
        >
          <Led state={led} />
          <span className="truncate">{text}</span>
        </button>
        <button className="btn btn-ghost btn-icon" onClick={onSettings} aria-label="Pengaturan">
          <Settings2 size={18} />
        </button>
      </div>
    </header>
  );
}
