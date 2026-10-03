import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Project, ProjectSummary, TaskCounts } from "../shared/types.ts";
import { HttpError, newId, nowIso } from "./util.ts";

export const ROOT_DIR = path.resolve(import.meta.dirname, "..");
export const DATA_DIR = path.resolve(process.env.BWA_DATA_DIR || path.join(ROOT_DIR, "data"));
const PROJECTS_DIR = path.join(DATA_DIR, "projects");

const MAX_ACTIVITY = 300;

export interface ProjectEvent {
  id: string;
  source: string;
  updatedAt: string;
}

/** Emits "project" events whenever a project is saved. The UI listens through SSE. */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

const cache = new Map<string, Project>();
let loaded = false;

function withDefaults(raw: Partial<Project> & { id: string }): Project {
  return {
    name: "Proyek tanpa nama",
    prompt: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    stage: "idea",
    idea: null,
    brief: null,
    topology: null,
    phases: [],
    tasks: [],
    prd: null,
    activity: [],
    ...raw,
    selections: { directionId: null, choices: {}, notes: "", ...(raw.selections ?? {}) },
  };
}

function ensureLoaded() {
  if (loaded) return;
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  for (const file of fs.readdirSync(PROJECTS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, file), "utf8"));
      if (raw?.id) cache.set(raw.id, withDefaults(raw));
    } catch (err) {
      console.warn(`[store] melewati ${file}: ${(err as Error).message}`);
    }
  }
  loaded = true;
}

export function writeFileAtomic(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows can refuse the rename while another process (antivirus, editor) holds the file.
    fs.writeFileSync(file, data, "utf8");
    fs.rmSync(tmp, { force: true });
  }
}

function projectFile(id: string) {
  if (!/^p_[a-f0-9]+$/.test(id)) throw new HttpError(400, "ID proyek tidak valid.");
  return path.join(PROJECTS_DIR, `${id}.json`);
}

export function listProjects(): Project[] {
  ensureLoaded();
  return [...cache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): Project {
  ensureLoaded();
  const project = cache.get(id);
  if (!project) throw new HttpError(404, `Proyek ${id} tidak ditemukan.`);
  return project;
}

export function createProject(prompt: string, source: string): Project {
  ensureLoaded();
  const now = nowIso();
  const project = withDefaults({
    id: newId("p", 4),
    name: prompt.split(/\s+/).slice(0, 6).join(" ").slice(0, 60) || "Ide baru",
    prompt,
    createdAt: now,
    updatedAt: now,
  });
  return saveProject(project, source);
}

export function saveProject(project: Project, source: string): Project {
  ensureLoaded();
  project.updatedAt = nowIso();
  if (project.activity.length > MAX_ACTIVITY) project.activity = project.activity.slice(-MAX_ACTIVITY);
  cache.set(project.id, project);
  writeFileAtomic(projectFile(project.id), JSON.stringify(project, null, 2));
  bus.emit("project", { id: project.id, source, updatedAt: project.updatedAt } satisfies ProjectEvent);
  return project;
}

/** Load → mutate → save in one synchronous step, so concurrent agents can't interleave. */
export function mutateProject<T>(id: string, source: string, fn: (project: Project) => T): T {
  const project = getProject(id);
  const result = fn(project);
  saveProject(project, source);
  return result;
}

export function deleteProject(id: string) {
  ensureLoaded();
  getProject(id);
  cache.delete(id);
  fs.rmSync(projectFile(id), { force: true });
  bus.emit("project", { id, source: "api", updatedAt: nowIso() } satisfies ProjectEvent);
}

export function pushActivity(project: Project, by: string, text: string, taskId?: string) {
  project.activity.push({ at: nowIso(), by, text, ...(taskId ? { taskId } : {}) });
}

export function countTasks(project: Project): TaskCounts {
  const counts: TaskCounts = { todo: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const task of project.tasks) counts[task.status]++;
  return counts;
}

export function summarize(project: Project): ProjectSummary {
  const ordered = [...project.tasks].sort((a, b) => a.order - b.order);
  return {
    id: project.id,
    name: project.brief?.name || project.idea?.title || project.name,
    prompt: project.prompt,
    stage: project.stage,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    taskCounts: countTasks(project),
    taskStrip: ordered.map((t) => t.status),
  };
}
