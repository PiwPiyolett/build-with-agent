import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../../shared/types";
import { api, CLIENT_ID } from "./api";

export interface RemoteChange {
  source: string;
  updatedAt: string;
}

/** Loads a project and keeps it fresh when agents (or other tabs) change it. */
export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteChange | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const fresh = await api.project(id);
      if (alive.current) {
        setProject(fresh);
        setError(null);
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    setProject(null);
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const events = new EventSource(`/api/projects/${id}/events`);
    events.addEventListener("project", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as RemoteChange;
      if (data.source === CLIENT_ID) return;
      setRemote(data);
      void refresh();
    });
    return () => events.close();
  }, [id, refresh]);

  return { project, setProject, refresh, error, remote };
}
