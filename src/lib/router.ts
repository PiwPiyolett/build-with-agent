import { useEffect, useState } from "react";
import type { Stage } from "../../shared/types";

export type Route = { name: "home" } | { name: "project"; id: string; stage: Stage | null };

const STAGES: Stage[] = ["idea", "topology", "tasks", "prd"];

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1]) {
    const stage = STAGES.includes(parts[2] as Stage) ? (parts[2] as Stage) : null;
    return { name: "project", id: parts[1], stage };
  }
  return { name: "home" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const projectHref = (id: string, stage?: Stage) => `#/p/${id}${stage ? `/${stage}` : ""}`;

export function navigate(href: string) {
  window.location.hash = href.replace(/^#/, "");
}
