import { useEffect, useState } from "react";
import type { Stage } from "../../shared/types";
import { withViewTransition } from "./viewTransition";

export type Route = { name: "home" } | { name: "history" } | { name: "help" } | { name: "project"; id: string; stage: Stage | null };

const STAGES: Stage[] = ["idea", "topology", "tasks", "prd"];

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1]) {
    const stage = STAGES.includes(parts[2] as Stage) ? (parts[2] as Stage) : null;
    return { name: "project", id: parts[1], stage };
  }
  if (parts[0] === "riwayat") return { name: "history" };
  if (parts[0] === "bantuan") return { name: "help" };
  return { name: "home" };
}

/** Call this once, in App: every change of address starts its own transition, and a second one would cancel the first. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () =>
      withViewTransition(() => {
        setRoute(parseHash(window.location.hash));
        window.scrollTo({ top: 0, behavior: "instant" });
      });
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const projectHref = (id: string, stage?: Stage) => `#/p/${id}${stage ? `/${stage}` : ""}`;

export function navigate(href: string) {
  window.location.hash = href.replace(/^#/, "");
}
