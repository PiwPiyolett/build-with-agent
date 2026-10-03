// Agent 3 · Penulis PRD
// Turns the brief and the (user-edited) feature topology into a shareable Product Requirements Document.
// Two model calls run in parallel for the narrative; the feature scope, tables and diagrams are rendered
// straight from the topology so the document always matches what the user shaped.

import type { Brief, Priority, Project, TopoNode, Topology } from "../../shared/types.ts";
import { chatJson, type JsonChatOptions } from "../llm.ts";
import { brainLabel } from "../settings.ts";
import { asArray, isRecord, pick, str, strList } from "../util.ts";
import { briefToText, describeSelections } from "./idea.ts";
import { topologyOutline } from "./topology.ts";

type RunOpts = Pick<JsonChatOptions, "signal" | "onProgress" | "onStatus">;

const STRATEGY_SYSTEM = `BWA agent: prd.strategy
You are Agent 3 in PRD mode: a senior product manager writing a Product Requirements Document that will be shared with people who were not part of the ideation (teammates, clients, lecturers, investors).
Write the strategy half of the PRD from the brief and the feature map.
Rules:
- Same language as the brief. Clear and concrete: no hype, no filler.
- Stay inside the brief and the feature map. Do not invent features.
- Output ONLY compact JSON:
{"language":"ISO code of the brief's language, e.g. id or en",
"summary":"3-4 sentence executive summary",
"background":"1-2 short paragraphs: context, the problem, why now",
"goals":["3-5 measurable goals"],
"nonGoals":["3-6 things explicitly out of scope for the first release"],
"metrics":[{"name":"...","target":"concrete target","how":"how it is measured"}],
"personas":[{"name":"short persona name","role":"...","needs":"...","pains":"..."}],
"userStories":[{"id":"US-01","persona":"persona name","story":"As a ..., I want ..., so that ...","priority":"must","acceptance":["2-3 testable criteria"]}],
"flows":[{"name":"...","steps":["3-7 steps"]}]}
Counts: metrics 3-6, personas 2-4, userStories 8-14 covering every "must" feature (priority is must, should or could), flows 2-4.`;

const DELIVERY_SYSTEM = `BWA agent: prd.delivery
You are Agent 3 in PRD mode: a senior product manager writing a Product Requirements Document that will be shared with people who were not part of the ideation.
Write the delivery half of the PRD: detailed requirements and the plan.
Rules:
- Same language as the brief. Specific and testable.
- Refer to features only by the ids in the feature map. Do not invent features.
- Output ONLY compact JSON:
{"requirements":[{"featureId":"id from the feature map","items":["1-3 functional requirements, each one testable sentence such as 'The system shall ...' written in the brief's language"]}],
"nonFunctional":[{"category":"e.g. Performance, Security, Privacy, Availability, Accessibility, Compatibility, Localization (in the brief's language)","requirement":"specific and measurable"}],
"architecture":"1-2 short paragraphs: proposed architecture on the chosen tech stack (main components, data storage, integrations)",
"dataEntities":[{"name":"...","fields":"key fields, comma separated","notes":"..."}],
"release":[{"name":"MVP","goal":"...","features":["feature ids"]}],
"risks":[{"risk":"...","impact":"high","mitigation":"..."}],
"openQuestions":["decisions still needed"],
"glossary":[{"term":"...","definition":"..."}]}
Counts: one requirements entry per "must" and "should" feature, nonFunctional 6-10, dataEntities 3-8, release 2-4 milestones where the first holds every "must" feature, risks 4-7 (impact is high, medium or low), openQuestions 3-6, glossary 0-8.`;

// ---------- narrative shape ----------

interface Narrative {
  language: "id" | "en";
  summary: string;
  background: string;
  goals: string[];
  nonGoals: string[];
  metrics: { name: string; target: string; how: string }[];
  personas: { name: string; role: string; needs: string; pains: string }[];
  userStories: { id: string; persona: string; story: string; priority: Priority; acceptance: string[] }[];
  flows: { name: string; steps: string[] }[];
  requirements: Map<string, string[]>;
  nonFunctional: { category: string; requirement: string }[];
  architecture: string;
  dataEntities: { name: string; fields: string; notes: string }[];
  release: { name: string; goal: string; features: string[] }[];
  risks: { risk: string; impact: "high" | "medium" | "low"; mitigation: string }[];
  openQuestions: string[];
  glossary: { term: string; definition: string }[];
}

const records = (v: unknown) => asArray(v).filter(isRecord);

export function normalizeNarrative(a: unknown, b: unknown, topology: Topology): Narrative {
  const s = isRecord(a) ? a : {};
  const d = isRecord(b) ? b : {};
  const nodeIds = new Set(topology.nodes.map((n) => n.id));
  const requirements = new Map<string, string[]>();
  for (const r of records(d.requirements)) {
    const id = str(r.featureId ?? r.feature, 80);
    const items = strList(r.items ?? r.requirements, 4, 400);
    if (nodeIds.has(id) && items.length) requirements.set(id, items);
  }
  return {
    language: str(s.language, 5).toLowerCase().startsWith("en") ? "en" : "id",
    summary: str(s.summary, 1500),
    background: str(s.background, 2500),
    goals: strList(s.goals, 8, 300),
    nonGoals: strList(s.nonGoals ?? s.non_goals, 8, 300),
    metrics: records(s.metrics)
      .map((m) => ({ name: str(m.name, 160), target: str(m.target, 160), how: str(m.how, 240) }))
      .filter((m) => m.name)
      .slice(0, 8),
    personas: records(s.personas)
      .map((p) => ({ name: str(p.name, 80), role: str(p.role, 160), needs: str(p.needs, 400), pains: str(p.pains, 400) }))
      .filter((p) => p.name)
      .slice(0, 5),
    userStories: records(s.userStories ?? s.user_stories)
      .map((u, i) => ({
        id: str(u.id, 12) || `US-${String(i + 1).padStart(2, "0")}`,
        persona: str(u.persona, 80),
        story: str(u.story, 500),
        priority: pick(u.priority, ["must", "should", "could"] as const, "should"),
        acceptance: strList(u.acceptance, 5, 300),
      }))
      .filter((u) => u.story)
      .slice(0, 20),
    flows: records(s.flows)
      .map((f) => ({ name: str(f.name, 120), steps: strList(f.steps, 10, 300) }))
      .filter((f) => f.name && f.steps.length)
      .slice(0, 5),
    requirements,
    nonFunctional: records(d.nonFunctional ?? d.non_functional)
      .map((n) => ({ category: str(n.category, 60), requirement: str(n.requirement, 400) }))
      .filter((n) => n.requirement)
      .slice(0, 12),
    architecture: str(d.architecture, 2500),
    dataEntities: records(d.dataEntities ?? d.data_entities)
      .map((e) => ({ name: str(e.name, 80), fields: str(e.fields, 400), notes: str(e.notes, 300) }))
      .filter((e) => e.name)
      .slice(0, 10),
    release: records(d.release)
      .map((r) => ({
        name: str(r.name, 60),
        goal: str(r.goal, 300),
        features: strList(r.features, 60, 80).filter((id) => nodeIds.has(id)),
      }))
      .filter((r) => r.name)
      .slice(0, 5),
    risks: records(d.risks)
      .map((r) => ({
        risk: str(r.risk, 300),
        impact: pick(r.impact, ["high", "medium", "low"] as const, "medium"),
        mitigation: str(r.mitigation, 400),
      }))
      .filter((r) => r.risk)
      .slice(0, 8),
    openQuestions: strList(d.openQuestions ?? d.open_questions, 8, 300),
    glossary: records(d.glossary)
      .map((g) => ({ term: str(g.term, 60), definition: str(g.definition, 300) }))
      .filter((g) => g.term)
      .slice(0, 10),
  };
}

// ---------- headings (the narrative's language decides) ----------

const TEXT = {
  id: {
    status: "Status",
    draft: "Draf",
    version: "Versi",
    date: "Tanggal",
    madeWith: "Disusun dengan",
    madeWithValue: "Build With Agent (Agent 1–3 lewat 9router)",
    toc: "Daftar isi",
    summary: "Ringkasan",
    background: "Latar belakang dan masalah",
    problem: "Masalah utama",
    solution: "Solusi yang diusulkan",
    coreValue: "Nilai utama",
    goalsSection: "Tujuan dan batasan",
    goals: "Tujuan",
    nonGoals: "Di luar cakupan rilis pertama",
    metrics: "Metrik keberhasilan",
    metric: "Metrik",
    target: "Target",
    how: "Cara mengukur",
    users: "Pengguna",
    targetUsers: "Target pengguna",
    personas: "Persona",
    needs: "Kebutuhan",
    pains: "Kendala",
    platform: "Platform dan teknologi",
    platforms: "Platform",
    stack: "Tech stack",
    monetization: "Model bisnis",
    architecture: "Arsitektur yang diusulkan",
    data: "Entitas data",
    entity: "Entitas",
    fields: "Field utama",
    notes: "Catatan",
    scope: "Cakupan fitur",
    moscow:
      "Prioritas memakai metode MoSCoW: **Must** wajib ada di MVP, **Should** menyusul setelah MVP, **Could** dikerjakan bila sempat.",
    map: "Peta fitur",
    feature: "Fitur",
    priority: "Prioritas",
    complexity: "Kompleksitas",
    description: "Deskripsi",
    fr: "Kebutuhan fungsional",
    integrations: "Integrasi eksternal",
    integration: "Integrasi",
    usedBy: "Dipakai oleh",
    deps: "Ketergantungan antar fitur",
    needsWord: "butuh",
    stories: "User story",
    flows: "Alur pengguna utama",
    nfr: "Kebutuhan non-fungsional",
    category: "Kategori",
    requirement: "Kebutuhan",
    release: "Rencana rilis",
    includes: "Mencakup",
    risks: "Risiko dan mitigasi",
    risk: "Risiko",
    impact: "Dampak",
    mitigation: "Mitigasi",
    impacts: { high: "Tinggi", medium: "Sedang", low: "Rendah" },
    questions: "Pertanyaan terbuka",
    glossary: "Glosarium",
    term: "Istilah",
    definition: "Arti",
    complexityLabels: ["", "Sepele", "Ringan", "Sedang", "Berat", "Sangat berat"],
    footer: (prompt: string) => `Dokumen ini disusun dengan Build With Agent (BWA) dari ide awal: “${prompt}”.`,
    locale: "id-ID",
  },
  en: {
    status: "Status",
    draft: "Draft",
    version: "Version",
    date: "Date",
    madeWith: "Prepared with",
    madeWithValue: "Build With Agent (Agents 1–3 via 9router)",
    toc: "Contents",
    summary: "Summary",
    background: "Background and problem",
    problem: "Core problem",
    solution: "Proposed solution",
    coreValue: "Core value",
    goalsSection: "Goals and boundaries",
    goals: "Goals",
    nonGoals: "Out of scope for the first release",
    metrics: "Success metrics",
    metric: "Metric",
    target: "Target",
    how: "How it is measured",
    users: "Users",
    targetUsers: "Target users",
    personas: "Personas",
    needs: "Needs",
    pains: "Pain points",
    platform: "Platform and technology",
    platforms: "Platforms",
    stack: "Tech stack",
    monetization: "Business model",
    architecture: "Proposed architecture",
    data: "Data entities",
    entity: "Entity",
    fields: "Key fields",
    notes: "Notes",
    scope: "Feature scope",
    moscow: "Priorities use MoSCoW: **Must** ships in the MVP, **Should** follows the MVP, **Could** ships if time allows.",
    map: "Feature map",
    feature: "Feature",
    priority: "Priority",
    complexity: "Complexity",
    description: "Description",
    fr: "Functional requirements",
    integrations: "External integrations",
    integration: "Integration",
    usedBy: "Used by",
    deps: "Feature dependencies",
    needsWord: "needs",
    stories: "User stories",
    flows: "Key user flows",
    nfr: "Non-functional requirements",
    category: "Category",
    requirement: "Requirement",
    release: "Release plan",
    includes: "Includes",
    risks: "Risks and mitigations",
    risk: "Risk",
    impact: "Impact",
    mitigation: "Mitigation",
    impacts: { high: "High", medium: "Medium", low: "Low" },
    questions: "Open questions",
    glossary: "Glossary",
    term: "Term",
    definition: "Definition",
    complexityLabels: ["", "Trivial", "Light", "Medium", "Heavy", "Very heavy"],
    footer: (prompt: string) => `This document was prepared with Build With Agent (BWA) from the original idea: “${prompt}”.`,
    locale: "en-US",
  },
};

const PRIORITY_LABEL: Record<Priority, string> = { must: "Must", should: "Should", could: "Could" };

// ---------- markdown helpers ----------

const cell = (s: string) => (s || "-").replace(/\|/g, "\\|").replace(/\s*\n+\s*/g, " ");
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
const mermaidText = (s: string) =>
  s
    .replace(/["'`()[\]{}<>#;:|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48) || "?";

/** Same anchors GitHub generates for headings, so the contents list works there and in BWA. */
export function headingSlug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

function childrenOf(topology: Topology) {
  const map = new Map<string, TopoNode[]>();
  for (const n of topology.nodes) if (n.parentId) map.set(n.parentId, [...(map.get(n.parentId) ?? []), n]);
  return map;
}

function mindmap(topology: Topology, root: TopoNode, children: Map<string, TopoNode[]>) {
  const lines = ["```mermaid", "mindmap", `  root((${mermaidText(root.label)}))`];
  const walk = (id: string, depth: number) => {
    for (const c of children.get(id) ?? []) {
      lines.push(`${"  ".repeat(depth + 2)}${mermaidText(c.label)}`);
      walk(c.id, depth + 1);
    }
  };
  walk(root.id, 0);
  lines.push("```");
  return lines.join("\n");
}

function dependencyChart(topology: Topology) {
  const byId = new Map(topology.nodes.map((n) => [n.id, n]));
  const lines = ["```mermaid", "flowchart LR"];
  for (const l of topology.links) {
    const a = byId.get(l.source);
    const b = byId.get(l.target);
    if (!a || !b) continue;
    const label = l.label ? `|${mermaidText(l.label)}|` : "";
    // Prefixed ids: words such as "end" or "class" are reserved in Mermaid.
    lines.push(`  n_${a.id}["${mermaidText(a.label)}"] -->${label} n_${b.id}["${mermaidText(b.label)}"]`);
  }
  lines.push("```");
  return lines.join("\n");
}

// ---------- document ----------

export function renderPrd(project: Project, n: Narrative): string {
  const t = TEXT[n.language];
  const brief = project.brief as Brief;
  const topology = project.topology as Topology;
  const byId = new Map(topology.nodes.map((x) => [x.id, x]));
  const children = childrenOf(topology);
  const root = topology.nodes.find((x) => x.kind === "product") ?? topology.nodes[0];
  const date = new Date().toLocaleDateString(t.locale, { day: "numeric", month: "long", year: "numeric" });

  const sections: { title: string; body: string }[] = [];
  const add = (title: string, body: string) => body.trim() && sections.push({ title, body: body.trim() });

  add(t.summary, n.summary || brief.oneLiner);

  add(
    t.background,
    [
      n.background,
      brief.problem && `**${t.problem}:** ${brief.problem}`,
      brief.solution && `**${t.solution}:** ${brief.solution}`,
      brief.coreValue && `**${t.coreValue}:** ${brief.coreValue}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );

  add(
    t.goalsSection,
    [
      n.goals.length && `### ${t.goals}\n\n${bullets(n.goals)}`,
      n.nonGoals.length && `### ${t.nonGoals}\n\n${bullets(n.nonGoals)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );

  if (n.metrics.length) add(t.metrics, table([t.metric, t.target, t.how], n.metrics.map((m) => [m.name, m.target, m.how])));

  add(
    t.users,
    [
      brief.targetUsers.length && `### ${t.targetUsers}\n\n${bullets(brief.targetUsers)}`,
      n.personas.length &&
        `### ${t.personas}\n\n${n.personas
          .map((p) => `#### ${p.name}${p.role ? ` · ${p.role}` : ""}\n\n- **${t.needs}:** ${p.needs || "-"}\n- **${t.pains}:** ${p.pains || "-"}`)
          .join("\n\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );

  add(
    t.platform,
    [
      bullets(
        [
          brief.platforms.length && `**${t.platforms}:** ${brief.platforms.join(", ")}`,
          brief.techStack.length && `**${t.stack}:** ${brief.techStack.join(", ")}`,
          brief.monetization && `**${t.monetization}:** ${brief.monetization}`,
        ].filter((x): x is string => !!x),
      ),
      n.architecture && `### ${t.architecture}\n\n${n.architecture}`,
      n.dataEntities.length &&
        `### ${t.data}\n\n${table([t.entity, t.fields, t.notes], n.dataEntities.map((e) => [e.name, e.fields, e.notes]))}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );

  // Feature scope comes straight from the topology the user edited.
  let fr = 0;
  const scope: string[] = [t.moscow, `### ${t.map}\n\n${mindmap(topology, root, children)}`];
  (children.get(root.id) ?? []).forEach((group, gi) => {
    const rows: string[][] = [];
    const reqLines: string[] = [];
    const visit = (node: TopoNode, depth: number) => {
      rows.push([
        `${depth > 0 ? "↳ ".repeat(depth) : ""}**${node.label}**${node.kind === "integration" ? ` (${t.integration})` : ""}`,
        PRIORITY_LABEL[node.priority],
        t.complexityLabels[node.complexity] ?? String(node.complexity),
        node.description,
      ]);
      for (const item of n.requirements.get(node.id) ?? []) {
        fr++;
        reqLines.push(`- **FR-${String(fr).padStart(2, "0")}** · ${node.label}: ${item}`);
      }
      for (const c of children.get(node.id) ?? []) visit(c, depth + 1);
    };
    for (const item of n.requirements.get(group.id) ?? []) {
      fr++;
      reqLines.push(`- **FR-${String(fr).padStart(2, "0")}** · ${group.label}: ${item}`);
    }
    for (const c of children.get(group.id) ?? []) visit(c, 0);
    scope.push(
      [
        `### ${gi + 1}. ${group.label} · ${PRIORITY_LABEL[group.priority]}`,
        group.description,
        rows.length ? table([t.feature, t.priority, t.complexity, t.description], rows) : "",
        reqLines.length ? `**${t.fr}**\n\n${reqLines.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  });
  const integrations = topology.nodes.filter((x) => x.kind === "integration");
  if (integrations.length) {
    scope.push(
      `### ${t.integrations}\n\n${table(
        [t.integration, t.usedBy, t.description],
        integrations.map((i) => [i.label, i.parentId ? (byId.get(i.parentId)?.label ?? "-") : "-", i.description]),
      )}`,
    );
  }
  if (topology.links.length) {
    const lines = topology.links
      .map((l) => {
        const a = byId.get(l.source);
        const b = byId.get(l.target);
        return a && b ? `- **${b.label}** ${t.needsWord} **${a.label}**${l.label ? ` (${l.label})` : ""}` : "";
      })
      .filter(Boolean);
    scope.push(`### ${t.deps}\n\n${dependencyChart(topology)}\n\n${lines.join("\n")}`);
  }
  add(t.scope, scope.join("\n\n"));

  if (n.userStories.length) {
    add(
      t.stories,
      n.userStories
        .map(
          (u) =>
            `#### ${u.id} · ${PRIORITY_LABEL[u.priority]}${u.persona ? ` · ${u.persona}` : ""}\n\n${u.story}${
              u.acceptance.length ? `\n\n${u.acceptance.map((a) => `- [ ] ${a}`).join("\n")}` : ""
            }`,
        )
        .join("\n\n"),
    );
  }

  if (n.flows.length) {
    add(t.flows, n.flows.map((f) => `### ${f.name}\n\n${f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`).join("\n\n"));
  }

  if (n.nonFunctional.length) {
    add(t.nfr, table([t.category, t.requirement], n.nonFunctional.map((x) => [x.category, x.requirement])));
  }

  const release = n.release.length
    ? n.release
    : (["must", "should", "could"] as const)
        .map((p, i) => ({
          name: ["MVP", "v1.1", "v2"][i],
          goal: "",
          features: topology.nodes.filter((x) => x.kind !== "product" && x.kind !== "module" && x.priority === p).map((x) => x.id),
        }))
        .filter((r) => r.features.length);
  add(
    t.release,
    release
      .map((r) => {
        const labels = r.features.map((id) => byId.get(id)?.label).filter(Boolean);
        return `### ${r.name}${r.goal ? ` · ${r.goal}` : ""}${labels.length ? `\n\n**${t.includes}:** ${labels.join(", ")}` : ""}`;
      })
      .join("\n\n"),
  );

  if (n.risks.length) {
    add(t.risks, table([t.risk, t.impact, t.mitigation], n.risks.map((r) => [r.risk, t.impacts[r.impact], r.mitigation])));
  }
  if (n.openQuestions.length) add(t.questions, n.openQuestions.map((q) => `- [ ] ${q}`).join("\n"));
  if (n.glossary.length) add(t.glossary, table([t.term, t.definition], n.glossary.map((g) => [g.term, g.definition])));

  const numbered = sections.map((s, i) => ({ ...s, heading: `${i + 1}. ${s.title}` }));
  return [
    `# PRD · ${brief.name}`,
    brief.oneLiner ? `> ${brief.oneLiner}` : "",
    `**${t.status}:** ${t.draft} · **${t.version}:** 0.1 · **${t.date}:** ${date} · **${t.madeWith}:** ${t.madeWithValue}`,
    `## ${t.toc}\n\n${numbered.map((s) => `- [${s.heading}](#${headingSlug(s.heading)})`).join("\n")}`,
    ...numbered.map((s) => `## ${s.heading}\n\n${s.body}`),
    `---\n\n_${t.footer(project.prompt.replace(/\s+/g, " ").trim())}_`,
    "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- generation ----------

function promptContext(project: Project): string {
  const idea = project.idea;
  return [
    `Original idea:\n"""\n${project.prompt}\n"""`,
    idea ? `Sharpened idea: ${idea.title}: ${idea.summary}\nProblem: ${idea.problem}` : "",
    idea ? `User choices:\n${describeSelections(project)}` : "",
    `Project brief:\n${briefToText(project.brief as Brief)}`,
    `Feature map (ids in brackets are the feature ids):\n${topologyOutline(project.topology as Topology)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function writePrd(project: Project, run: RunOpts): Promise<{ markdown: string; model: string }> {
  const user = promptContext(project);
  const local = new AbortController();
  const signal = run.signal ? AbortSignal.any([run.signal, local.signal]) : local.signal;
  const progress = { a: 0, b: 0, ra: 0, rb: 0 };
  const report = () => run.onProgress?.({ chars: progress.a + progress.b, reasoningChars: progress.ra + progress.rb });
  const part = (system: string, key: "a" | "b", temperature: number) =>
    chatJson({
      agent: "tasks",
      system,
      user,
      temperature,
      timeoutSec: 600,
      signal,
      onStatus: run.onStatus,
      onProgress: (p) => {
        progress[key] = p.chars;
        progress[key === "a" ? "ra" : "rb"] = p.reasoningChars;
        report();
      },
    }).catch((err) => {
      local.abort();
      throw err;
    });

  run.onStatus?.("Agent 3 menulis dua bagian PRD sekaligus: strategi dan rincian kebutuhan…");
  const [strategy, delivery] = await Promise.all([part(STRATEGY_SYSTEM, "a", 0.5), part(DELIVERY_SYSTEM, "b", 0.4)]);
  run.onStatus?.("Menyusun dokumen Markdown…");
  const narrative = normalizeNarrative(strategy, delivery, project.topology as Topology);
  return { markdown: renderPrd(project, narrative), model: brainLabel("tasks") };
}

export function prdFileName(project: Project) {
  const name = project.brief?.name || project.idea?.title || project.name;
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `PRD-${slug || "bwa"}.md`;
}
