// Agent 1 · Pengembang Ide
// explore(): raw idea → sharpened summary + directions + clickable option dimensions
// moreOptions(): 4 fresh options for one dimension
// synthesizeBrief(): the user's picks → project brief used by Agent 2, Agent 3 and coding agents

import type { Brief, IdeaDimension, IdeaExploration, IdeaOption, Project } from "../../shared/types.ts";
import { chatJson, type JsonChatOptions } from "../llm.ts";
import { asArray, isRecord, reserveId, str, strList } from "../util.ts";

type RunOpts = Pick<JsonChatOptions, "signal" | "onProgress" | "onStatus">;

const LANGUAGE_RULE =
  "Write every human-readable string in the same language as the user's idea. If unclear, use Indonesian.";

const MULTI_DEFAULT = new Set(["target_users", "platform", "core_features", "differentiator"]);

const EXPLORE_SYSTEM = `BWA agent: idea.explore
You are Agent 1, the Idea Developer inside "Build With Agent" (BWA), a studio that turns a raw app idea into a buildable plan.
Your job: understand the user's raw idea, sharpen it, then expand it into many concrete, clickable choices.

Rules:
- ${LANGUAGE_RULE}
- Be specific to THIS idea. No generic filler such as "user friendly" or "modern UI".
- Option labels are short (max 6 words). Details are one short sentence.
- Output ONLY one valid, compact JSON object. No markdown fences, no commentary.

JSON shape:
{"title":"working name, 1-3 words","tagline":"one-sentence value proposition","summary":"2-3 sentences describing the sharpened idea","problem":"the core problem it solves, 1-2 sentences",
"directions":[{"id":"d1","title":"...","pitch":"1-2 sentences","why":"why this angle is promising"}],
"dimensions":[{"id":"target_users","label":"...","question":"...?","multi":true,"options":[{"id":"o1","label":"...","detail":"..."}]}]}

Requirements:
- "directions": exactly 4 distinct angles for developing the idea (different audience, business model, or core mechanic).
- "dimensions", in this order and with these ids:
  1. target_users (multi): who uses it
  2. platform (multi): web, Android, iOS, desktop, chat bot, etc.
  3. core_features (multi): 6 to 8 concrete capabilities
  4. differentiator (multi): what makes it stand out
  5. monetization (single)
  6. tech_stack (single): each option is a complete stack, e.g. "Next.js + Supabase"
  7. mvp_scope (single): size of the first release
  Then 1 or 2 extra dimensions unique to this idea (snake_case ids), e.g. integrations, data sources, design style.
- 4 to 6 options per dimension (core_features: 6 to 8). Option ids unique within their dimension.
- Put the option you would recommend first.`;

function normalizeOptions(raw: unknown, taken = new Set<string>()): IdeaOption[] {
  return asArray(raw)
    .map((item, i): IdeaOption | null => {
      const o: Record<string, unknown> = isRecord(item) ? item : { label: item };
      const label = str(o.label ?? o.title ?? o.name, 80);
      if (!label) return null;
      return {
        id: reserveId(o.id, `o${i + 1}`, taken),
        label,
        detail: str(o.detail ?? o.description, 240) || undefined,
        ...(o.custom === true ? { custom: true } : {}),
      };
    })
    .filter((o): o is IdeaOption => o !== null);
}

export function normalizeExploration(raw: unknown, prompt: string): IdeaExploration {
  const r = isRecord(raw) ? raw : {};
  const dirIds = new Set<string>();
  const directions = asArray(r.directions)
    .map((item, i) => {
      const d = isRecord(item) ? item : {};
      const title = str(d.title ?? d.name, 100);
      if (!title) return null;
      return {
        id: reserveId(d.id, `d${i + 1}`, dirIds),
        title,
        pitch: str(d.pitch ?? d.description, 400),
        why: str(d.why, 300) || undefined,
        ...(d.custom === true ? { custom: true } : {}),
      };
    })
    .filter((d) => d !== null)
    .slice(0, 6);

  const dimIds = new Set<string>();
  const dimensions: IdeaDimension[] = asArray(r.dimensions)
    .map((item, i) => {
      const d = isRecord(item) ? item : {};
      const label = str(d.label ?? d.name, 80);
      const options = normalizeOptions(d.options);
      if (!label || options.length === 0) return null;
      const id = reserveId(d.id, `dim${i + 1}`, dimIds);
      return {
        id,
        label,
        question: str(d.question, 200),
        multi: typeof d.multi === "boolean" ? d.multi : MULTI_DEFAULT.has(id),
        options,
      } satisfies IdeaDimension;
    })
    .filter((d): d is IdeaDimension => d !== null);

  if (dimensions.length === 0) throw new Error("Agent 1 tidak menghasilkan pilihan apa pun.");

  return {
    title: str(r.title, 60) || prompt.split(/\s+/).slice(0, 3).join(" "),
    tagline: str(r.tagline, 200),
    summary: str(r.summary, 900),
    problem: str(r.problem, 600),
    directions,
    dimensions,
  };
}

export async function explore(project: Project, feedback: string, run: RunOpts): Promise<IdeaExploration> {
  const prev = project.idea;
  const user = [
    `Raw idea:\n"""\n${project.prompt}\n"""`,
    feedback && prev
      ? `This is a new round. Previous working title: "${prev.title}". Previous summary: ${prev.summary}\n` +
        `User feedback to apply:\n"""\n${feedback}\n"""\nKeep whatever the feedback does not ask to change.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  run.onStatus?.("Agent 1 membaca ide dan menyusun pilihan…");
  const raw = await chatJson({ agent: "idea", system: EXPLORE_SYSTEM, user, ...run });
  return normalizeExploration(raw, project.prompt);
}

// ---------- more options for one dimension ----------

const MORE_SYSTEM = `BWA agent: idea.more
You are Agent 1, the Idea Developer in BWA. Add fresh options to one decision dimension of an app idea.
Rules:
- Same language as the existing options.
- Specific to this idea. No duplicates or near-duplicates of existing options.
- Labels max 6 words; detail is one sentence.
- Output ONLY compact JSON: {"options":[{"label":"...","detail":"..."}]} with exactly 4 new options.`;

export async function moreOptions(
  project: Project,
  dimension: IdeaDimension,
  hint: string,
  run: RunOpts,
): Promise<IdeaOption[]> {
  const idea = project.idea!;
  const user = [
    `App idea: ${idea.title}: ${idea.summary}`,
    `Dimension: ${dimension.label}${dimension.question ? ` (${dimension.question})` : ""}`,
    `Existing options:\n${dimension.options.map((o) => `- ${o.label}`).join("\n")}`,
    hint ? `The user wants options in this direction: ${hint}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  run.onStatus?.(`Agent 1 mencari pilihan baru untuk "${dimension.label}"…`);
  const raw = await chatJson({ agent: "idea", system: MORE_SYSTEM, user, temperature: 0.9, ...run });
  const taken = new Set(dimension.options.map((o) => o.id));
  const existing = new Set(dimension.options.map((o) => o.label.toLowerCase()));
  return normalizeOptions(isRecord(raw) ? raw.options : raw, taken).filter(
    (o) => !existing.has(o.label.toLowerCase()),
  );
}

// ---------- brief ----------

const BRIEF_SYSTEM = `BWA agent: idea.brief
You are Agent 1, the Idea Developer in BWA. The user explored their idea and made choices.
Synthesize them into a crisp project brief that a product team and AI coding agents will build from.
Rules:
- ${LANGUAGE_RULE}
- Respect the user's choices. Where they chose nothing, pick the most sensible option and keep it modest.
- Options the user typed themselves (marked "custom") carry extra weight. Honour the user's notes.
- Tech stack must be concrete (framework, database, hosting), consistent with the chosen platform.
- Output ONLY compact JSON:
{"name":"short brandable product name","oneLiner":"one sentence","problem":"1-2 sentences","solution":"2-3 sentences",
"targetUsers":["..."],"platforms":["..."],"coreValue":"the single most important value, 1 sentence",
"keyCapabilities":["5-8 concrete capabilities"],"monetization":"1 sentence",
"techStack":["e.g. Next.js 15","Supabase (Postgres + Auth)","Tailwind CSS"],
"mvpScope":"what the first release includes and explicitly excludes, 2-3 sentences","constraints":["notable constraints or assumptions"]}`;

export function describeSelections(project: Project): string {
  const idea = project.idea;
  if (!idea) return "";
  const sel = project.selections;
  const lines: string[] = [];
  const direction = idea.directions.find((d) => d.id === sel.directionId);
  if (direction) lines.push(`Chosen direction${direction.custom ? " (custom)" : ""}: ${direction.title}: ${direction.pitch}`);
  for (const dim of idea.dimensions) {
    const picked = (sel.choices[dim.id] ?? [])
      .map((id) => dim.options.find((o) => o.id === id))
      .filter((o): o is IdeaOption => !!o);
    if (picked.length === 0) {
      lines.push(`${dim.label}: (no choice)`);
      continue;
    }
    lines.push(
      `${dim.label}: ${picked
        .map((o) => `${o.label}${o.custom ? " (custom)" : ""}${o.detail ? ` [${o.detail}]` : ""}`)
        .join("; ")}`,
    );
  }
  if (sel.notes.trim()) lines.push(`User notes: ${sel.notes.trim()}`);
  return lines.join("\n");
}

export function normalizeBrief(raw: unknown, fallbackName: string): Brief {
  const r = isRecord(raw) ? raw : {};
  return {
    name: str(r.name, 60) || fallbackName,
    oneLiner: str(r.oneLiner ?? r.one_liner, 240),
    problem: str(r.problem, 600),
    solution: str(r.solution, 900),
    targetUsers: strList(r.targetUsers ?? r.target_users, 10, 160),
    platforms: strList(r.platforms, 8, 80),
    coreValue: str(r.coreValue ?? r.core_value, 300),
    keyCapabilities: strList(r.keyCapabilities ?? r.key_capabilities, 12, 200),
    monetization: str(r.monetization, 300),
    techStack: strList(r.techStack ?? r.tech_stack, 14, 120),
    mvpScope: str(r.mvpScope ?? r.mvp_scope, 900),
    constraints: strList(r.constraints, 10, 240),
  };
}

export async function synthesizeBrief(project: Project, run: RunOpts): Promise<Brief> {
  const idea = project.idea!;
  const user = [
    `Raw idea:\n"""\n${project.prompt}\n"""`,
    `Sharpened idea: ${idea.title}: ${idea.tagline}\n${idea.summary}\nProblem: ${idea.problem}`,
    `User choices:\n${describeSelections(project)}`,
  ].join("\n\n");

  run.onStatus?.("Agent 1 merangkum pilihanmu menjadi brief proyek…");
  const raw = await chatJson({ agent: "idea", system: BRIEF_SYSTEM, user, temperature: 0.4, ...run });
  return normalizeBrief(raw, idea.title);
}

export function briefToText(brief: Brief): string {
  const list = (items: string[]) => (items.length ? items.join("; ") : "-");
  return [
    `Name: ${brief.name}`,
    `One-liner: ${brief.oneLiner}`,
    `Problem: ${brief.problem}`,
    `Solution: ${brief.solution}`,
    `Target users: ${list(brief.targetUsers)}`,
    `Platforms: ${list(brief.platforms)}`,
    `Core value: ${brief.coreValue}`,
    `Key capabilities: ${list(brief.keyCapabilities)}`,
    `Monetization: ${brief.monetization}`,
    `Tech stack: ${list(brief.techStack)}`,
    `MVP scope: ${brief.mvpScope}`,
    `Constraints: ${list(brief.constraints)}`,
  ].join("\n");
}
