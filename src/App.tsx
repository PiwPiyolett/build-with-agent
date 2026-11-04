import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RouterStatus } from "../shared/types";
import { api, detectRuntime, serverDownHint } from "./lib/api";
import { readBackgroundMotion, saveBackgroundMotion } from "./lib/glow";
import { useRoute, type Route } from "./lib/router";
import { Glow } from "./components/Glow";
import { SettingsDialog } from "./components/SettingsDialog";
import { SetupGuide } from "./components/SetupGuide";
import { TopBar } from "./components/TopBar";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import { HelpPage } from "./pages/HelpPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { ProjectPage } from "./pages/ProjectPage";

interface AppContextValue {
  route: Route;
  status: RouterStatus | null;
  refreshStatus: () => void;
  openSettings: () => void;
  openGuide: () => void;
  /** running inside the desktop app */
  desktop: boolean;
  /** whether the red glow behind the pages moves; set in Settings and remembered on this laptop */
  backgroundMotion: boolean;
  setBackgroundMotion: (moving: boolean) => void;
}

const AppContext = createContext<AppContextValue>({
  route: { name: "home" },
  status: null,
  refreshStatus: () => {},
  openSettings: () => {},
  openGuide: () => {},
  desktop: false,
  backgroundMotion: true,
  setBackgroundMotion: () => {},
});
export const useApp = () => useContext(AppContext);

export const ROUTER_DASHBOARD = "http://localhost:20128/dashboard";

const GUIDE_SEEN_KEY = "bwa.guideSeen";

/** The guide opens by itself only once. If the browser's storage is unavailable it simply is not forced open. */
function firstTimeGuide(): boolean {
  try {
    if (localStorage.getItem(GUIDE_SEEN_KEY)) return false;
    localStorage.setItem(GUIDE_SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function App() {
  const route = useRoute();
  const [status, setStatus] = useState<RouterStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [backgroundMotion, setMotion] = useState(readBackgroundMotion);

  const setBackgroundMotion = useCallback((moving: boolean) => {
    setMotion(moving);
    saveBackgroundMotion(moving);
  }, []);

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
  const openGuide = useCallback(() => setGuideOpen(true), []);

  // First time here with no assistant connected: start with the guide instead of a page that cannot work yet.
  const nobodyConnected = status?.provider === "mcp" && status.state === "off";
  useEffect(() => {
    if (nobodyConnected && firstTimeGuide()) setGuideOpen(true);
  }, [nobodyConnected]);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppContext.Provider value={{ route, status, refreshStatus, openSettings, openGuide, desktop, backgroundMotion, setBackgroundMotion }}>
          {/* A project shows its own bar and decides its own glow, because its working pages stay still. */}
          {route.name !== "project" && <Glow />}
          {/* Stays mounted across the main pages, so the capsule's thumb slides instead of jumping. */}
          {route.name !== "project" && <TopBar />}
          <main className="flex min-h-dvh flex-col">
            {route.name === "project" && <ProjectPage key={route.id} id={route.id} stage={route.stage} />}
            {route.name === "history" && <HistoryPage />}
            {route.name === "help" && <HelpPage />}
            {route.name === "home" && <HomePage />}
          </main>
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={refreshStatus} />
          <SetupGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
        </AppContext.Provider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
