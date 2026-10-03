// Markdown views of a project for coding agents (MCP tool results, CLI output, AGENTS.md export).

import type { HandoverMode, Project, Task, TaskStatus, TopoNode } from "../shared/types.ts";
import { countTasks } from "./store.ts";
import { nextTask, orderedTasks, unmetDependencies } from "./taskOps.ts";

const STATUS: Record<TaskStatus, string> = {
  todo: "todo",
  in_progress: "in progress",
  blocked: "blocked",
  done: "done",
};

const CHECKBOX: Record<TaskStatus, string> = { todo: "[ ]", in_progress: "[~]", blocked: "[!]", done: "[x]" };

export interface BridgeInfo {
  apiUrl: string;
  mcpServerPath: string;
  cliPath: string;
  /** executable that runs the bridge scripts: "node", or the desktop app itself in Node mode */
  command: string;
  /** extra environment the command needs (ELECTRON_RUN_AS_NODE for the desktop app) */
  commandEnv: Record<string, string>;
}

export function progressLine(project: Project): string {
  const c = countTasks(project);
  return `${c.done}/${project.tasks.length} done · ${c.in_progress} in progress · ${c.blocked} blocked · ${c.todo} todo`;
}

export function taskLine(project: Project, t: Task): string {
  const waiting = t.status === "todo" ? unmetDependencies(project, t) : [];
  return (
    `${CHECKBOX[t.status]} ${t.id} ${t.title} (${STATUS[t.status]}${t.assignee ? `, ${t.assignee}` : ""})` +
    (waiting.length ? ` · waiting for ${waiting.map((w) => w.id).join(", ")}` : "")
  );
}

export function taskMarkdown(project: Project, t: Task): string {
  const phase = project.phases.find((p) => p.id === t.phaseId);
  const features = t.featureIds
    .map((id) => project.topology?.nodes.find((n) => n.id === id))
    .filter((n): n is TopoNode => !!n)
    .map((n) => `${n.label} (${n.id}): ${n.description}`);
  const deps = t.dependsOn.map((id) => {
    const d = project.tasks.find((x) => x.id === id);
    return d ? `${d.id} (${STATUS[d.status]})` : id;
  });
  const notes = t.log.filter((l) => l.kind === "note" || l.kind === "block" || l.kind === "reopen").slice(-6);

  const out = [
    `## ${t.id} · ${t.title}`,
    `Status: ${STATUS[t.status]}${t.assignee ? ` · assignee: ${t.assignee}` : ""}`,
    `Phase: ${phase ? `${phase.id} ${phase.name}` : "-"} · Type: ${t.type} · Priority: ${t.priority} · Estimate: ${t.estimate}`,
  ];
  if (deps.length) out.push(`Depends on: ${deps.join(", ")}`);
  out.push("", "### Description", t.description || "-");
  if (features.length) out.push("", "### Related features", ...features.map((f) => `- ${f}`));
  if (t.acceptance.length) out.push("", "### Acceptance criteria", ...t.acceptance.map((a) => `- [ ] ${a}`));
  if (t.agentHint) out.push("", "### Implementation hint", t.agentHint);
  if (notes.length) {
    out.push("", "### Notes", ...notes.map((n) => `- ${n.at.slice(0, 16).replace("T", " ")} ${n.by} (${n.kind}): ${n.text ?? ""}`));
  }
  if (t.completion) {
    out.push("", "### Completion", `By ${t.completion.by}${t.completedAt ? ` at ${t.completedAt}` : ""}`, t.completion.summary);
    if (t.completion.files.length) out.push(`Files: ${t.completion.files.join(", ")}`);
  }
  return out.join("\n");
}

function featureMap(project: Project): string[] {
  const t = project.topology;
  if (!t) return ["(topologi fitur belum dibuat)"];
  const children = new Map<string | null, TopoNode[]>();
  for (const n of t.nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      const tag = n.kind === "product" ? "" : `[${n.priority.toUpperCase()}] `;
      lines.push(`${"  ".repeat(depth)}- ${tag}${n.label} \`${n.id}\`${n.kind === "integration" ? " (integration)" : ""}: ${n.description}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  if (t.links.length) {
    lines.push("", "Dependencies (prerequisite → dependent):");
    for (const l of t.links) lines.push(`- \`${l.source}\` → \`${l.target}\`${l.label ? ` (${l.label})` : ""}`);
  }
  return lines;
}

export const WORKFLOW_RULES = [
  "1. Call `get_project_context` once to read the brief, feature map and progress.",
  "2. Call `get_next_task` with `claim: true`. It returns your unfinished task, or the next task whose dependencies are done, and marks it as yours.",
  "3. Implement the task in the current repository until every acceptance criterion is met. Follow the tech stack in the brief.",
  "4. Verify your work (build, tests, or run the app).",
  "5. Call `complete_task` with a short summary and the files you changed. This ticks the task off in BWA.",
  "6. Repeat from step 2 until `get_next_task` reports that nothing is left.",
  "",
  "- Stuck or need a human decision? Call `block_task` with the reason, then continue with another task.",
  "- Long task? Post progress with `add_task_note`.",
  "- Found necessary work that is not planned? Call `create_task` instead of silently expanding scope.",
  "- Never mark a task done unless its acceptance criteria are met.",
];

export function contextMarkdown(project: Project): string {
  const b = project.brief;
  const name = b?.name || project.idea?.title || project.name;
  const out = [`# ${name}`, b?.oneLiner || project.idea?.tagline || "", "", `Project id: \`${project.id}\``, ""];
  if (b) {
    const list = (items: string[]) => (items.length ? items.join(", ") : "-");
    out.push(
      "## Brief",
      `- Problem: ${b.problem}`,
      `- Solution: ${b.solution}`,
      `- Target users: ${list(b.targetUsers)}`,
      `- Platforms: ${list(b.platforms)}`,
      `- Core value: ${b.coreValue}`,
      `- Tech stack: ${list(b.techStack)}`,
      `- Monetization: ${b.monetization}`,
      `- MVP scope: ${b.mvpScope}`,
      `- Constraints: ${list(b.constraints)}`,
      "",
    );
  } else {
    out.push("## Idea", project.prompt, "");
  }
  out.push("## Feature map", ...featureMap(project), "");
  if (project.phases.length) {
    out.push("## Phases");
    for (const p of project.phases) {
      const tasks = project.tasks.filter((t) => t.phaseId === p.id);
      const done = tasks.filter((t) => t.status === "done").length;
      out.push(`- ${p.id} ${p.name} (${done}/${tasks.length} done): ${p.goal}`);
    }
    out.push("");
  }
  if (project.prd) {
    const words = project.prd.markdown.split(/\s+/).filter(Boolean).length;
    out.push("## PRD", `A full Product Requirements Document exists (${words} words). Call get_prd to read user stories, requirements and non-functional needs.`, "");
  }
  out.push("## Progress", progressLine(project), "");
  out.push("## Working agreement", ...WORKFLOW_RULES);
  return out.join("\n");
}

/** Sent to the brain session once Agent 3 has split the tasks: leave brain mode and become the coding agent. */
export function handoverMarkdown(project: Project, mode: HandoverMode): string {
  const name = project.brief?.name || project.idea?.title || project.name;
  const first = nextTask(project, "");
  const phases = project.phases.map((p) => `- ${p.id} ${p.name}: ${project.tasks.filter((t) => t.phaseId === p.id).length} tasks`);
  const out = [
    `# BWA handover · planning finished for "${name}" (project_id ${project.id})`,
    "Brain mode is over. Do NOT call wait_for_brain_job again unless the user asks you to be BWA's brain again.",
    "From now on you are the coding agent for this project, working in the current repository.",
    "",
    `Progress: ${progressLine(project)}`,
    ...(phases.length ? ["Phases:", ...phases] : []),
    first ? `First ready task: ${first.id} · ${first.title}` : "",
    "",
    "## What to do now",
    "1. Check the current working directory. If it clearly belongs to a different project, tell the user and ask which folder to use before writing any code. An empty or new folder is fine.",
  ];
  if (mode === "auto") {
    out.push(
      "2. Write the user a 2-3 line summary in the language of the project brief: product name, phases, first task.",
      "3. Start right away and keep going without asking for permission, following the working agreement below until no task is left.",
      "   The user may steer you in chat at any time: follow their instructions.",
    );
  } else {
    out.push(
      "2. Write the user a short summary in the language of the project brief: product name, phases with task counts, and the first ready task.",
      `3. Ask what they want to do (for example "Mulai dari ${first?.id ?? "T01"}?"), then wait for their reply in chat. Do not start coding before they answer.`,
    );
  }
  out.push("", `## Working agreement (always pass project_id "${project.id}")`, ...WORKFLOW_RULES);
  return out.filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

export function taskListMarkdown(project: Project, tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks match.";
  const out: string[] = [];
  let phaseId: string | null | undefined;
  for (const t of tasks) {
    if (t.phaseId !== phaseId) {
      phaseId = t.phaseId;
      const phase = project.phases.find((p) => p.id === phaseId);
      out.push("", `### ${phase ? `${phase.id} ${phase.name}` : "Tanpa fase"}`);
    }
    out.push(`- ${taskLine(project, t)}`);
  }
  return [`Progress: ${progressLine(project)}`, ...out].join("\n");
}

export function agentsMd(project: Project, bridge: BridgeInfo): string {
  const name = project.brief?.name || project.idea?.title || project.name;
  const out = [
    `# AGENTS.md · ${name}`,
    "",
    `This repository is planned in **BWA** (project \`${project.id}\`). BWA holds the brief, the feature topology and the task backlog.`,
    "AI coding agents take tasks from BWA, implement them here, and tick them off when done.",
    "",
    "## Connect to BWA",
    `BWA API: ${bridge.apiUrl} (the BWA app must be running).`,
    "",
    "MCP server (Claude Code, Codex, Cursor, Gemini CLI, …):",
    "```",
    `command: ${bridge.command}`,
    `args:    ${bridge.mcpServerPath}`,
    `env:     ${Object.entries({ ...bridge.commandEnv, BWA_URL: bridge.apiUrl, BWA_PROJECT_ID: project.id })
      .map(([k, v]) => `${k}=${v}`)
      .join("  ")}`,
    "```",
    "",
    "No MCP? Use the CLI from any shell:",
    "```bash",
    `node "${bridge.cliPath}" next --claim --agent <your-name> --project ${project.id}`,
    `node "${bridge.cliPath}" done <TASK_ID> --summary "what you did" --files "src/a.ts,src/b.ts" --project ${project.id}`,
    "```",
    "",
    "## Working agreement",
    ...WORKFLOW_RULES,
    "",
    contextMarkdown(project).split("\n").slice(4).join("\n").replace(/## Working agreement[\s\S]*$/, "").trim(),
    "",
    "## Task checklist",
    ...orderedTasks(project).map((t) => `- ${taskLine(project, t)}`),
    "",
  ];
  return out.join("\n");
}
