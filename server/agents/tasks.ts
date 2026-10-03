// Agent 3 · Pembagi Task
// generatePlan(): brief + feature topology → phases and an ordered backlog for coding agents

import type { Brief, Phase, Project, Task, Topology } from "../../shared/types.ts";
import { chatJson, type JsonChatOptions } from "../llm.ts";
import { asArray, isRecord, nowIso, pick, str, strList } from "../util.ts";
import { briefToText } from "./idea.ts";
import { topologyOutline } from "./topology.ts";

type RunOpts = Pick<JsonChatOptions, "signal" | "onProgress" | "onStatus">;

export const TASK_TYPES = [
  "setup",
  "frontend",
  "backend",
  "database",
  "integration",
  "testing",
  "devops",
  "design",
  "docs",
] as const;

const TASKS_SYSTEM = `BWA agent: tasks.generate
You are Agent 3, the Task Planner in BWA. Break a project into an ordered backlog that AI coding agents (Claude Code, Codex, Cursor…) will execute one by one and check off when done.

Every task must be:
- Completable in one focused agent session (roughly 30-180 minutes of work) and verifiable.
- Self-contained: an agent that reads only this task, the brief and the feature map knows what to build.

Plan:
- Start with the foundation: repository setup with the chosen tech stack, project structure, database schema, auth scaffolding if needed.
- Then every "must" feature, then "should", then "could". Group tasks into 3 to 5 phases named in the language of the brief (for Indonesian: Fondasi, MVP inti, Pelengkap, Rilis & polesan).
- Every "must" feature is covered by at least one task. Include testing and deployment tasks.
- 15 to 35 tasks depending on scope.

Task fields:
- id: "T01", "T02", … in execution order
- title: imperative, max 10 words
- description: 2-4 sentences: what to build, where, and how it connects to the rest
- phaseId: one of the phase ids
- featureIds: 1-3 node ids from the feature map
- type: setup | frontend | backend | database | integration | testing | devops | design | docs
- priority: high | medium | low
- estimate: "S" (<1h), "M" (1-3h) or "L" (3-6h)
- dependsOn: ids of earlier tasks that must be done first (earlier ids only, no cycles)
- acceptance: 2-4 testable acceptance criteria
- agentHint: 1-2 sentences of implementation guidance for a coding agent (files, libraries, pitfalls)

All text, including phase names, in the same language as the brief; ids stay ASCII.
Output ONLY compact JSON: {"phases":[{"id":"P1","name":"...","goal":"..."}],"tasks":[...]}`;

export function formatTaskId(n: number) {
  return `T${String(n).padStart(2, "0")}`;
}

export function taskNumber(id: string) {
  const n = Number.parseInt(id.replace(/^\D+/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function nextTaskId(project: Project) {
  return formatTaskId(project.tasks.reduce((max, t) => Math.max(max, taskNumber(t.id)), 0) + 1);
}

export function blankTask(fields: Partial<Task> & Pick<Task, "id" | "title" | "order">, by: string): Task {
  return {
    description: "",
    phaseId: null,
    featureIds: [],
    type: "backend",
    priority: "medium",
    estimate: "M",
    dependsOn: [],
    acceptance: [],
    agentHint: "",
    status: "todo",
    assignee: null,
    claimedAt: null,
    completedAt: null,
    completion: null,
    log: [{ at: nowIso(), by, kind: "create" }],
    ...fields,
  };
}

export function normalizePlan(raw: unknown, topology: Topology | null): { phases: Phase[]; tasks: Task[] } {
  const r = isRecord(raw) ? raw : {};

  const phaseMap = new Map<string, string>();
  const phases: Phase[] = asArray(r.phases)
    .filter(isRecord)
    .slice(0, 8)
    .map((p, i) => {
      const id = `P${i + 1}`;
      const name = str(p.name ?? p.title, 80) || `Fase ${i + 1}`;
      phaseMap.set(str(p.id, 40) || id, id);
      phaseMap.set(name.toLowerCase(), id);
      return { id, name, goal: str(p.goal ?? p.description, 300) };
    });
  if (phases.length === 0) phases.push({ id: "P1", name: "Backlog", goal: "" });

  const nodeIds = new Set(topology?.nodes.map((n) => n.id) ?? []);
  const rawTasks = asArray(r.tasks)
    .filter(isRecord)
    .filter((t) => str(t.title ?? t.name, 200))
    .slice(0, 80);

  const idMap = new Map<string, string>();
  rawTasks.forEach((t, i) => {
    const raw = str(t.id, 40);
    if (raw && !idMap.has(raw)) idMap.set(raw, formatTaskId(i + 1));
  });

  const tasks = rawTasks.map((t, i) => {
    const id = formatTaskId(i + 1);
    const dependsOn = [
      ...new Set(
        strList(t.dependsOn ?? t.depends_on ?? t.dependencies, 12, 40)
          .map((d) => idMap.get(d) ?? idMap.get(d.toUpperCase()))
          .filter((d): d is string => !!d && taskNumber(d) < i + 1),
      ),
    ];
    const phaseRef = str(t.phaseId ?? t.phase, 80);
    const type = str(t.type, 24).toLowerCase();
    return blankTask(
      {
        id,
        order: i,
        title: str(t.title ?? t.name, 160),
        description: str(t.description, 1500),
        phaseId: phaseMap.get(phaseRef) ?? phaseMap.get(phaseRef.toLowerCase()) ?? phases[0].id,
        featureIds: strList(t.featureIds ?? t.features ?? t.feature_ids, 6, 80).filter((f) => nodeIds.has(f)),
        type: type || "backend",
        priority: pick(t.priority, ["high", "medium", "low"] as const, "medium"),
        estimate: str(t.estimate, 16).toUpperCase() || "M",
        dependsOn,
        acceptance: strList(t.acceptance ?? t.acceptanceCriteria ?? t.acceptance_criteria, 8, 300),
        agentHint: str(t.agentHint ?? t.agent_hint ?? t.hint, 600),
      },
      "agent-3",
    );
  });

  return { phases, tasks };
}

export async function generatePlan(project: Project, run: RunOpts): Promise<{ phases: Phase[]; tasks: Task[] }> {
  const brief = project.brief as Brief;
  const topology = project.topology as Topology;
  const user = [`Project brief:\n${briefToText(brief)}`, `Feature topology:\n${topologyOutline(topology)}`].join("\n\n");
  run.onStatus?.("Agent 3 memecah fitur menjadi task untuk agent coding…");
  const raw = await chatJson({ agent: "tasks", system: TASKS_SYSTEM, user, temperature: 0.3, ...run });
  const plan = normalizePlan(raw, topology);
  if (plan.tasks.length === 0) throw new Error("Agent 3 tidak menghasilkan task. Coba lagi.");
  return plan;
}
