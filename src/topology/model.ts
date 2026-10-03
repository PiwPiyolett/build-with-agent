// Pure helpers for editing a feature topology on the client.

import dagre from "@dagrejs/dagre";
import type { TopoLink, TopoNode, Topology } from "../../shared/types";
import { randomId } from "../lib/format";

export const NODE_W = 232;
export const NODE_H = 112;

const INDENT = 40;
const GAP_Y = 16;
const COL_GAP = 44;
const ROW_GAP = 84;

// Structured cabling geometry, shared with the cable router (cables.ts).
/** x offset of the vertical trunk that runs down a parent's left edge */
export const TRUNK_X = 22;
/** vertical drop from the product node to the horizontal distribution line */
export const TREE_DROP = 28;
/** spacing between parallel cables in a tray */
export const LANE = 7;
/** clearance between a column and the first cable in the tray beside it */
export const CHANNEL_PAD = 12;
/** clearance above and below the horizontal tray that runs over the module row */
export const STREET_PAD = 16;

/** Top-level column index (0..n-1) of every node below the product root. */
export function columnIndex(topo: Topology, order?: (a: TopoNode, b: TopoNode) => number): Map<string, number> {
  const root = rootOf(topo);
  const children = childrenMap(topo);
  const columns = [...(root ? (children.get(root.id) ?? []) : [])];
  if (order) columns.sort(order);
  const colOf = new Map<string, number>();
  columns.forEach((column, i) => {
    const stack = [column.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (colOf.has(id)) continue;
      colOf.set(id, i);
      for (const c of children.get(id) ?? []) stack.push(c.id);
    }
  });
  return colOf;
}

/**
 * How many dependency cables each tray carries. Every cable leaves its source through the tray
 * to the right of the source column; cables to a non-adjacent column also use the top tray and
 * the tray beside the target column. Must match routeCables().
 */
export function laneDemand(topo: Topology, colOf: Map<string, number>, columns: number) {
  const channels = new Array<number>(columns).fill(0);
  let street = 0;
  for (const l of topo.links) {
    const a = colOf.get(l.source);
    const b = colOf.get(l.target);
    if (a === undefined || b === undefined) continue;
    channels[a]++;
    if (a === b || b === a + 1) continue;
    channels[b > a ? b - 1 : b]++;
    street++;
  }
  return { channels, street };
}

/** "TB" = compact columns (modules in a row, their features listed below); "LR" = classic horizontal tree. */
export function autoLayout(topo: Topology): Topology {
  return topo.direction === "LR" ? treeLayout(topo) : columnLayout(topo);
}

function treeLayout(topo: Topology): Topology {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 96, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of topo.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const n of topo.nodes) if (n.parentId) g.setEdge(n.parentId, n.id);
  dagre.layout(g);
  return {
    ...topo,
    manualLayout: false,
    nodes: topo.nodes.map((n) => {
      const p = g.node(n.id);
      return { ...n, x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) };
    }),
  };
}

function childrenMap(topo: Topology) {
  const map = new Map<string, TopoNode[]>();
  for (const n of topo.nodes) if (n.parentId) map.set(n.parentId, [...(map.get(n.parentId) ?? []), n]);
  return map;
}

function columnLayout(topo: Topology): Topology {
  const root = rootOf(topo);
  if (!root) return topo;
  const children = childrenMap(topo);
  const columns = children.get(root.id) ?? [];
  const demand = laneDemand(topo, columnIndex(topo), columns.length);
  const pos = new Map<string, { x: number; y: number }>();
  // Room for the distribution line plus one lane per cable in the top tray.
  const rowY = NODE_H + TREE_DROP + STREET_PAD * 2 + demand.street * LANE;
  let x = 0;
  let right = NODE_W;
  columns.forEach((column, i) => {
    pos.set(column.id, { x, y: rowY });
    let y = rowY + NODE_H + GAP_Y + 8;
    let maxIndent = 0;
    const walk = (parentId: string, depth: number) => {
      for (const c of children.get(parentId) ?? []) {
        if (pos.has(c.id)) continue;
        const indent = INDENT * (depth - 1);
        maxIndent = Math.max(maxIndent, indent);
        pos.set(c.id, { x: x + indent, y });
        y += NODE_H + GAP_Y;
        walk(c.id, depth + 1);
      }
    };
    walk(column.id, 2);
    right = x + NODE_W + maxIndent;
    // Widen the tray to the right of this column when many cables run through it.
    x += NODE_W + maxIndent + Math.max(COL_GAP, CHANNEL_PAD * 2 + demand.channels[i] * LANE);
  });
  const width = right;
  pos.set(root.id, { x: Math.round(width / 2 - NODE_W / 2), y: 0 });
  let stray = 0;
  return {
    ...topo,
    manualLayout: false,
    nodes: topo.nodes.map((n) => {
      const p = pos.get(n.id) ?? { x: width + 80, y: stray++ * (NODE_H + GAP_Y) };
      return { ...n, x: p.x, y: p.y };
    }),
  };
}

export function depthMap(topo: Topology): Map<string, number> {
  const byId = new Map(topo.nodes.map((n) => [n.id, n]));
  const depths = new Map<string, number>();
  for (const n of topo.nodes) {
    let d = 0;
    let cur = n.parentId;
    while (cur && d < 50) {
      d++;
      cur = byId.get(cur)?.parentId ?? null;
    }
    depths.set(n.id, d);
  }
  return depths;
}

/** Gives positions to nodes that have none: full auto layout, or next to their parent after manual edits. */
export function placeMissing(topo: Topology): Topology {
  if (topo.nodes.every((n) => n.x !== undefined && n.y !== undefined)) return topo;
  if (!topo.manualLayout) return autoLayout(topo);
  const nodes = topo.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lr = topo.direction === "LR";
  for (const n of nodes) {
    if (n.x !== undefined && n.y !== undefined) continue;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const px = parent?.x ?? 0;
    const py = parent?.y ?? 0;
    const siblings = nodes.filter((s) => s !== n && s.parentId === n.parentId && s.x !== undefined && s.y !== undefined);
    if (lr) {
      n.x = px + NODE_W + 96;
      n.y = siblings.length ? Math.max(...siblings.map((s) => s.y!)) + NODE_H + 16 : py;
    } else if (parent && !parent.parentId) {
      // new column next to the right-most one, on the module row
      n.y = siblings.length ? siblings[0].y! : py + NODE_H + ROW_GAP;
      n.x = siblings.length ? Math.max(...siblings.map((s) => s.x!)) + NODE_W + INDENT + COL_GAP : px;
    } else {
      // new list item below everything its parent already holds
      const held = [...descendantIds({ ...topo, nodes }, parent?.id ?? "")]
        .map((id) => byId.get(id))
        .filter((d) => d && d !== n && d.y !== undefined)
        .map((d) => d!.y!);
      n.x = px + INDENT;
      n.y = Math.max(py, ...held) + NODE_H + GAP_Y;
    }
  }
  return { ...topo, nodes };
}

export function rootOf(topo: Topology): TopoNode | undefined {
  return topo.nodes.find((n) => n.kind === "product") ?? topo.nodes[0];
}

export function descendantIds(topo: Topology, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (parent: string) => {
    for (const n of topo.nodes) {
      if (n.parentId === parent && !out.has(n.id)) {
        out.add(n.id);
        walk(n.id);
      }
    }
  };
  walk(id);
  return out;
}

export function updateNode(topo: Topology, id: string, patch: Partial<TopoNode>): Topology {
  return { ...topo, nodes: topo.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Removes nodes; their children move up to the removed node's parent. The product root is never removed. */
export function removeNodes(topo: Topology, ids: string[]): Topology {
  const doomed = new Set(ids.filter((id) => topo.nodes.find((n) => n.id === id)?.kind !== "product"));
  if (doomed.size === 0) return topo;
  const byId = new Map(topo.nodes.map((n) => [n.id, n]));
  const survivingParent = (id: string | null): string | null => {
    let cur = id;
    while (cur && doomed.has(cur)) cur = byId.get(cur)?.parentId ?? null;
    return cur;
  };
  return {
    ...topo,
    nodes: topo.nodes.filter((n) => !doomed.has(n.id)).map((n) => ({ ...n, parentId: survivingParent(n.parentId) })),
    links: topo.links.filter((l) => !doomed.has(l.source) && !doomed.has(l.target)),
  };
}

export function addChild(topo: Topology, parentId: string, label = "Fitur baru"): { topo: Topology; node: TopoNode } {
  const parent = topo.nodes.find((n) => n.id === parentId);
  const node: TopoNode = {
    id: randomId("n"),
    label,
    kind: parent?.kind === "product" ? "module" : "feature",
    description: "",
    parentId,
    priority: "should",
    complexity: 2,
  };
  const next = placeMissing({ ...topo, nodes: [...topo.nodes, node] });
  return { topo: next, node: next.nodes.find((n) => n.id === node.id)! };
}

export function addLink(topo: Topology, source: string, target: string, label?: string): Topology {
  if (source === target) return topo;
  const s = topo.nodes.find((n) => n.id === source);
  const t = topo.nodes.find((n) => n.id === target);
  if (!s || !t || t.parentId === source || s.parentId === target) return topo;
  if (topo.links.some((l) => l.source === source && l.target === target)) return topo;
  const link: TopoLink = { id: `l_${source}__${target}`, source, target, ...(label ? { label } : {}) };
  return { ...topo, links: [...topo.links, link] };
}

export function removeLink(topo: Topology, id: string): Topology {
  return { ...topo, links: topo.links.filter((l) => l.id !== id) };
}

export function countBy<T extends string>(items: T[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
}
