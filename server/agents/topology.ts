// Agent 2 · Arsitek Fitur
// generate(): brief → feature topology (product → modules → features, plus integrations and dependencies)
// grow(): add children under one node, or suggest missing features for the whole map

import type { Brief, NodeKind, Priority, Project, TopoLink, TopoNode, Topology } from "../../shared/types.ts";
import { chatJson, type JsonChatOptions } from "../llm.ts";
import { asArray, clampInt, isRecord, pick, reserveId, slugify, str } from "../util.ts";
import { briefToText } from "./idea.ts";

type RunOpts = Pick<JsonChatOptions, "signal" | "onProgress" | "onStatus">;

const KINDS = ["product", "module", "feature", "integration"] as const satisfies readonly NodeKind[];
const PRIORITIES = ["must", "should", "could"] as const satisfies readonly Priority[];

const GENERATE_SYSTEM = `BWA agent: topology.generate
You are Agent 2, the Feature Architect in BWA. Turn a project brief into a feature topology: a tree of modules and features plus cross-dependencies. The user will edit it visually, like a network topology diagram.

Node kinds:
- "product": exactly one node, id "root", the whole app.
- "module": a major functional area, parentId "root". 4 to 7 modules.
- "feature": a concrete capability, parentId = its module id (or a feature id for a sub-feature). 3 to 6 per module.
- "integration": an external service, API or device (payment gateway, maps, WhatsApp API, LLM, IoT sensor…), parentId = the module that uses it most. 0 to 5 in total.

Fields per node: id (short snake_case, unique), label (max 5 words), kind, parentId (null only for root), description (1 sentence: what it does for the user), priority ("must" = needed for the MVP, "should" = soon after, "could" = nice to have), complexity (1 trivial to 5 very complex).

Links are cross-dependencies that are NOT parent-child: {"source":"prerequisite_id","target":"dependent_id","label":"2-4 words"} means target needs source to work. 4 to 12 links. Never repeat a parent-child relation as a link.

Rules:
- Labels and descriptions in the same language as the brief; ids stay ASCII snake_case.
- Be strict with priorities: "must" only for features without which the first release cannot launch, at most 40% of features. Most features are "should" or "could".
- 20 to 40 nodes in total.
- Output ONLY compact JSON: {"nodes":[...],"links":[...]}`;

function growSystem(target: TopoNode | null) {
  const task = target
    ? `Add 3 to 5 child nodes under the target node "${target.id}": concrete sub-capabilities that are not in the map yet. Their parentId is "${target.id}" (or another new node's id).`
    : "Suggest 3 to 6 important features or integrations that are missing from the map. Attach each one to the most fitting existing module or feature through parentId.";
  return `BWA agent: topology.grow
You are Agent 2, the Feature Architect in BWA. Extend an existing feature topology.
${task}
Rules:
- New ids: short snake_case, not used by any existing node.
- parentId must be an existing node id or the id of another new node.
- kind is "feature" or "integration" ("module" only if a whole functional area is missing).
- Same language as the existing labels. Label max 5 words, description 1 sentence.
- You may add links between new and existing nodes (source = prerequisite, target = dependent).
- Output ONLY compact JSON: {"nodes":[{"id":"...","label":"...","kind":"feature","parentId":"...","description":"...","priority":"should","complexity":2}],"links":[{"source":"...","target":"...","label":"..."}]}`;
}

interface NormalizeOptions {
  fallbackName: string;
  fallbackDescription?: string;
}

/** Validates any topology-shaped input (LLM output or UI edits) into a consistent tree. */
export function normalizeTopology(raw: unknown, opts: NormalizeOptions): Topology {
  const r = isRecord(raw) ? raw : {};
  const taken = new Set<string>();
  const idMap = new Map<string, string>();
  const nodes: TopoNode[] = [];

  asArray(r.nodes).forEach((item, i) => {
    if (!isRecord(item)) return;
    const label = str(item.label ?? item.name ?? item.title, 80);
    if (!label) return;
    const rawId = str(item.id, 80) || label;
    const id = reserveId(rawId, `n${i + 1}`, taken);
    if (!idMap.has(rawId)) idMap.set(rawId, id);
    const node: TopoNode = {
      id,
      label,
      kind: pick(item.kind ?? item.type, KINDS, "feature"),
      description: str(item.description ?? item.detail, 400),
      parentId: str(item.parentId ?? item.parent ?? item.parent_id, 80) || null,
      priority: pick(item.priority, PRIORITIES, "should"),
      complexity: clampInt(item.complexity, 1, 5, 2),
    };
    if (typeof item.x === "number" && typeof item.y === "number" && Number.isFinite(item.x + item.y)) {
      node.x = Math.round(item.x);
      node.y = Math.round(item.y);
    }
    nodes.push(node);
  });

  const resolve = (ref: unknown): string | null => {
    const s = str(ref, 80);
    if (!s) return null;
    if (idMap.has(s)) return idMap.get(s)!;
    const slug = slugify(s, "");
    return taken.has(slug) ? slug : null;
  };
  for (const n of nodes) n.parentId = n.parentId ? resolve(n.parentId) : null;

  let root = nodes.find((n) => n.kind === "product");
  if (!root) {
    root = {
      id: reserveId("root", "root", taken),
      label: opts.fallbackName,
      kind: "product",
      description: opts.fallbackDescription ?? "",
      parentId: null,
      priority: "must",
      complexity: 3,
    };
    nodes.unshift(root);
  }
  root.parentId = null;
  root.priority = "must";
  for (const n of nodes) if (n !== root && n.kind === "product") n.kind = "module";

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n === root) continue;
    if (!n.parentId || !byId.has(n.parentId) || n.parentId === n.id) {
      n.parentId = root.id;
      continue;
    }
    const seen = new Set([n.id]);
    let cursor: string | null = n.parentId;
    while (cursor) {
      if (seen.has(cursor)) {
        n.parentId = root.id;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const links: TopoLink[] = [];
  const linkKeys = new Set<string>();
  for (const item of asArray(r.links ?? r.edges)) {
    if (!isRecord(item)) continue;
    const source = resolve(item.source ?? item.from);
    const target = resolve(item.target ?? item.to);
    if (!source || !target || source === target) continue;
    if (byId.get(target)?.parentId === source || byId.get(source)?.parentId === target) continue;
    const key = `${source}>${target}`;
    if (linkKeys.has(key)) continue;
    linkKeys.add(key);
    links.push({ id: `l_${source}__${target}`, source, target, label: str(item.label, 60) || undefined });
  }

  return {
    nodes,
    links,
    direction: r.direction === "LR" ? "LR" : "TB",
    manualLayout: r.manualLayout === true,
  };
}

export function topologyOutline(t: Topology): string {
  const children = new Map<string | null, TopoNode[]>();
  for (const n of t.nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      const meta = n.kind === "product" ? n.kind : `${n.kind}, ${n.priority}, complexity ${n.complexity}`;
      lines.push(`${"  ".repeat(depth)}- ${n.id} [${meta}] ${n.label}${n.description ? `: ${n.description}` : ""}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  if (t.links.length) {
    lines.push("", "Dependencies (prerequisite -> dependent):");
    for (const l of t.links) lines.push(`- ${l.source} -> ${l.target}${l.label ? ` (${l.label})` : ""}`);
  }
  return lines.join("\n");
}

export async function generate(project: Project, run: RunOpts): Promise<Topology> {
  const brief = project.brief as Brief;
  run.onStatus?.("Agent 2 memetakan modul, fitur, dan integrasi…");
  const raw = await chatJson({
    agent: "topology",
    system: GENERATE_SYSTEM,
    user: `Project brief:\n${briefToText(brief)}`,
    temperature: 0.5,
    ...run,
  });
  const topology = normalizeTopology(raw, { fallbackName: brief.name, fallbackDescription: brief.oneLiner });
  if (topology.nodes.length < 3) throw new Error("Agent 2 menghasilkan topologi yang terlalu kecil. Coba lagi.");
  return topology;
}

export async function grow(
  project: Project,
  targetId: string | null,
  run: RunOpts,
): Promise<{ topology: Topology; added: TopoNode[] }> {
  const current = project.topology!;
  const target = targetId ? (current.nodes.find((n) => n.id === targetId) ?? null) : null;
  const brief = project.brief;
  const user = [
    brief ? `Project: ${brief.name}: ${brief.oneLiner}\nMVP scope: ${brief.mvpScope}` : `Project idea: ${project.prompt}`,
    `Current topology:\n${topologyOutline(current)}`,
    target ? `Target node: ${target.id} (${target.label}): ${target.description}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  run.onStatus?.(target ? `Agent 2 mengembangkan "${target.label}"…` : "Agent 2 mencari fitur yang belum ada…");
  const raw = await chatJson({ agent: "topology", system: growSystem(target), user, temperature: 0.7, ...run });
  const r = isRecord(raw) ? raw : {};

  const existingIds = new Set(current.nodes.map((n) => n.id));
  const taken = new Set(existingIds);
  const idMap = new Map<string, string>();
  const added: TopoNode[] = [];
  asArray(r.nodes).forEach((item, i) => {
    if (!isRecord(item)) return;
    const label = str(item.label ?? item.name, 80);
    if (!label) return;
    const rawId = str(item.id, 80) || label;
    const id = reserveId(rawId, `new_${i + 1}`, taken);
    idMap.set(rawId, id);
    added.push({
      id,
      label,
      kind: pick(item.kind, ["module", "feature", "integration"] as const, "feature"),
      description: str(item.description, 400),
      parentId: str(item.parentId ?? item.parent, 80) || null,
      priority: pick(item.priority, PRIORITIES, "should"),
      complexity: clampInt(item.complexity, 1, 5, 2),
    });
  });
  const rootId = current.nodes.find((n) => n.kind === "product")?.id ?? current.nodes[0]?.id ?? null;
  for (const n of added) {
    const ref = n.parentId ? (idMap.get(n.parentId) ?? n.parentId) : null;
    n.parentId = ref && taken.has(ref) && ref !== n.id ? ref : (target?.id ?? rootId);
  }

  // Re-run the full normalizer on the merged map to catch cycles and bad links.
  const merged = normalizeTopology(
    {
      ...current,
      nodes: [...current.nodes, ...added],
      links: [
        ...current.links,
        ...asArray(r.links).map((l) =>
          isRecord(l)
            ? {
                source: idMap.get(str(l.source, 80)) ?? l.source,
                target: idMap.get(str(l.target, 80)) ?? l.target,
                label: l.label,
              }
            : l,
        ),
      ],
    },
    { fallbackName: brief?.name ?? project.name },
  );
  const addedIds = new Set(added.map((n) => n.id));
  return { topology: merged, added: merged.nodes.filter((n) => addedIds.has(n.id)) };
}
