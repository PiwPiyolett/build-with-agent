// Task lifecycle shared by the web UI and external coding agents (MCP / CLI / REST).
// todo → in_progress (claim) → done (complete) ; blocked / released / reopened on the side.

import type { Project, Task, TaskPriority, TaskStatus } from "../shared/types.ts";
import { blankTask, nextTaskId } from "./agents/tasks.ts";
import { pushActivity } from "./store.ts";
import { HttpError, isRecord, nowIso, pick, str, strList } from "./util.ts";

export function findTask(project: Project, taskId: string): Task {
  const wanted = taskId.trim().toUpperCase();
  const task = project.tasks.find((t) => t.id.toUpperCase() === wanted);
  if (!task) throw new HttpError(404, `Task ${taskId} tidak ada di proyek ini.`);
  return task;
}

export function orderedTasks(project: Project): Task[] {
  return [...project.tasks].sort((a, b) => a.order - b.order);
}

export function unmetDependencies(project: Project, task: Task): Task[] {
  return task.dependsOn
    .map((id) => project.tasks.find((t) => t.id === id))
    .filter((t): t is Task => !!t && t.status !== "done");
}

/** The agent's own unfinished task first, otherwise the first todo whose dependencies are done. */
export function nextTask(project: Project, agent: string): Task | null {
  const tasks = orderedTasks(project);
  const own = tasks.find((t) => t.status === "in_progress" && t.assignee === agent);
  if (own) return own;
  return tasks.find((t) => t.status === "todo" && unmetDependencies(project, t).length === 0) ?? null;
}

export function claimTask(project: Project, task: Task, agent: string, force = false): string[] {
  if (task.status === "done") {
    throw new HttpError(409, `${task.id} sudah selesai.`, "Ambil task berikutnya dengan get_next_task.");
  }
  if (task.status === "in_progress" && task.assignee && task.assignee !== agent && !force) {
    throw new HttpError(
      409,
      `${task.id} sedang dikerjakan oleh ${task.assignee}.`,
      "Pilih task lain, atau klaim dengan force=true jika agent tersebut sudah berhenti.",
    );
  }
  const warnings = unmetDependencies(project, task).map((t) => `Dependensi ${t.id} (${t.title}) belum selesai.`);
  const already = task.status === "in_progress" && task.assignee === agent;
  task.status = "in_progress";
  task.assignee = agent;
  if (!already) {
    task.claimedAt = nowIso();
    task.log.push({ at: nowIso(), by: agent, kind: "claim" });
    pushActivity(project, agent, `mengambil ${task.id} · ${task.title}`, task.id);
  }
  return warnings;
}

export function addNote(project: Project, task: Task, agent: string, text: string) {
  const note = str(text, 2000);
  if (!note) throw new HttpError(400, "Catatan kosong.");
  task.log.push({ at: nowIso(), by: agent, kind: "note", text: note });
  pushActivity(project, agent, `catatan di ${task.id}: ${note.slice(0, 120)}`, task.id);
}

export function completeTask(project: Project, task: Task, agent: string, summary: string, files: string[]) {
  const text = str(summary, 4000);
  if (!text) throw new HttpError(400, "Ringkasan pekerjaan wajib diisi saat menandai task selesai.");
  task.status = "done";
  task.assignee = task.assignee ?? agent;
  task.completedAt = nowIso();
  task.completion = { summary: text, files: strList(files, 60, 300), by: agent };
  task.log.push({ at: nowIso(), by: agent, kind: "complete", text });
  pushActivity(project, agent, `menyelesaikan ${task.id} · ${task.title}`, task.id);
}

export function blockTask(project: Project, task: Task, agent: string, reason: string) {
  const text = str(reason, 2000);
  if (!text) throw new HttpError(400, "Alasan terhambat wajib diisi.");
  task.status = "blocked";
  task.assignee = task.assignee ?? agent;
  task.log.push({ at: nowIso(), by: agent, kind: "block", text });
  pushActivity(project, agent, `terhambat di ${task.id}: ${text.slice(0, 120)}`, task.id);
}

export function releaseTask(project: Project, task: Task, agent: string, note = "") {
  if (task.status === "done") throw new HttpError(409, `${task.id} sudah selesai; buka lagi dari UI jika perlu.`);
  task.status = "todo";
  task.assignee = null;
  task.claimedAt = null;
  task.log.push({ at: nowIso(), by: agent, kind: "release", text: str(note, 1000) || undefined });
  pushActivity(project, agent, `melepas ${task.id} kembali ke antrean`, task.id);
}

export function reopenTask(project: Project, task: Task, by: string, reason = "") {
  task.status = "todo";
  task.assignee = null;
  task.claimedAt = null;
  task.completedAt = null;
  task.completion = null;
  task.log.push({ at: nowIso(), by, kind: "reopen", text: str(reason, 1000) || undefined });
  pushActivity(project, by, `membuka lagi ${task.id}`, task.id);
}

const STATUSES = ["todo", "in_progress", "blocked", "done"] as const satisfies readonly TaskStatus[];
const PRIORITIES = ["high", "medium", "low"] as const satisfies readonly TaskPriority[];

function cleanDependencies(project: Project, taskId: string, value: unknown): string[] {
  const valid = new Set(project.tasks.map((t) => t.id));
  return [...new Set(strList(value, 20, 20).map((d) => d.toUpperCase()))].filter(
    (d) => d !== taskId && valid.has(d),
  );
}

function applyFields(project: Project, task: Task, body: Record<string, unknown>) {
  if (body.title !== undefined) task.title = str(body.title, 160) || task.title;
  if (body.description !== undefined) task.description = str(body.description, 3000);
  if (body.phaseId !== undefined) {
    const phase = str(body.phaseId, 20);
    task.phaseId = project.phases.some((p) => p.id === phase) ? phase : null;
  }
  if (body.featureIds !== undefined) {
    const nodes = new Set(project.topology?.nodes.map((n) => n.id) ?? []);
    task.featureIds = strList(body.featureIds, 10, 80).filter((f) => nodes.has(f));
  }
  if (body.type !== undefined) task.type = str(body.type, 24).toLowerCase() || task.type;
  if (body.priority !== undefined) task.priority = pick(body.priority, PRIORITIES, task.priority);
  if (body.estimate !== undefined) task.estimate = str(body.estimate, 16).toUpperCase();
  if (body.dependsOn !== undefined) task.dependsOn = cleanDependencies(project, task.id, body.dependsOn);
  if (body.acceptance !== undefined) task.acceptance = strList(body.acceptance, 12, 400);
  if (body.agentHint !== undefined) task.agentHint = str(body.agentHint, 1500);
}

/** Edits coming from the web UI. Status changes made by the user keep the log honest. */
export function editTask(project: Project, task: Task, body: unknown, by: string) {
  if (!isRecord(body)) throw new HttpError(400, "Body harus berupa objek JSON.");
  applyFields(project, task, body);
  if (body.status !== undefined) {
    const status = pick(body.status, STATUSES, task.status);
    if (status !== task.status) {
      if (status === "done") {
        completeTask(project, task, by, str(body.summary, 4000) || "Ditandai selesai oleh pengguna.", []);
      } else if (status === "todo") {
        if (task.status === "done") reopenTask(project, task, by);
        else releaseTask(project, task, by);
      } else if (status === "blocked") {
        blockTask(project, task, by, str(body.reason, 2000) || "Ditandai terhambat oleh pengguna.");
      } else {
        task.status = "in_progress";
        task.claimedAt = task.claimedAt ?? nowIso();
        task.log.push({ at: nowIso(), by, kind: "claim" });
      }
    }
  }
  if (body.assignee === null) task.assignee = null;
}

export function createTask(project: Project, body: unknown, by: string): Task {
  if (!isRecord(body)) throw new HttpError(400, "Body harus berupa objek JSON.");
  const title = str(body.title, 160);
  if (!title) throw new HttpError(400, "Judul task wajib diisi.");
  const order = project.tasks.reduce((max, t) => Math.max(max, t.order), -1) + 1;
  const task = blankTask({ id: nextTaskId(project), title, order }, by);
  task.phaseId = project.phases.at(-1)?.id ?? null;
  applyFields(project, task, body);
  project.tasks.push(task);
  pushActivity(project, by, `menambah ${task.id} · ${task.title}`, task.id);
  return task;
}

export function deleteTask(project: Project, task: Task, by: string) {
  project.tasks = project.tasks.filter((t) => t !== task);
  for (const t of project.tasks) t.dependsOn = t.dependsOn.filter((d) => d !== task.id);
  pushActivity(project, by, `menghapus ${task.id} · ${task.title}`);
}
