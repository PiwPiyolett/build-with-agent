// Structured cabling for the "Kolom" layout.
// Tree cables drop from a parent along a trunk on its left edge and branch straight into each child.
// Dependency cables never cut across nodes: they leave a node to the right, run through the cable
// tray beside the column, travel along the tray above the module row if they must change columns,
// and drop into the target from the side. Every cable in a tray gets its own lane.

import type { Topology } from "../../shared/types";
import { CHANNEL_PAD, LANE, rootOf, STREET_PAD, TREE_DROP, TRUNK_X } from "./model";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Route {
  points: Pt[];
  sourceHandle: string;
  targetHandle: string;
}

/** Relative heights of the dependency ports on a node's sides. */
export const PORT_OUT = 0.3;
export const PORT_IN = 0.7;

export function routeCables(topo: Topology, boxes: Map<string, Box>): Map<string, Route> {
  const routes = new Map<string, Route>();
  if (topo.direction !== "TB") return routes;
  const root = rootOf(topo);
  const rb = root && boxes.get(root.id);
  if (!root || !rb) return routes;

  const children = new Map<string, string[]>();
  for (const n of topo.nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);

  // Columns in their on-screen order.
  const columns = (children.get(root.id) ?? []).filter((id) => boxes.has(id)).sort((a, b) => boxes.get(a)!.x - boxes.get(b)!.x);
  const colOf = new Map<string, number>();
  columns.forEach((column, i) => {
    const stack = [column];
    while (stack.length) {
      const id = stack.pop()!;
      if (colOf.has(id)) continue;
      colOf.set(id, i);
      stack.push(...(children.get(id) ?? []));
    }
  });
  const bounds = columns.map(() => ({ left: Infinity, right: -Infinity }));
  for (const [id, i] of colOf) {
    const b = boxes.get(id);
    if (!b) continue;
    bounds[i].left = Math.min(bounds[i].left, b.x);
    bounds[i].right = Math.max(bounds[i].right, b.x + b.w);
  }

  // ---- tree: product → columns (a distribution line under the product node)
  const rootOut = { x: rb.x + rb.w / 2, y: rb.y + rb.h };
  const moduleTop = Math.min(...columns.map((id) => boxes.get(id)!.y));
  const yTree = rootOut.y + Math.max(8, Math.min(TREE_DROP, (moduleTop - rootOut.y) / 3));
  for (const id of columns) {
    const b = boxes.get(id)!;
    if (b.y < yTree + 8) continue;
    routes.set(`tree:${id}`, {
      points: [rootOut, { x: rootOut.x, y: yTree }, { x: b.x + b.w / 2, y: yTree }, { x: b.x + b.w / 2, y: b.y }],
      sourceHandle: "t-out",
      targetHandle: "t-in",
    });
  }

  // ---- tree: parent trunk → each child
  for (const n of topo.nodes) {
    if (!n.parentId || n.parentId === root.id) continue;
    const pb = boxes.get(n.parentId);
    const nb = boxes.get(n.id);
    if (!pb || !nb) continue;
    const trunk = pb.x + TRUNK_X;
    const y = nb.y + nb.h / 2;
    if (nb.x < trunk + 10 || y < pb.y + pb.h + 6) continue; // moved by hand: fall back to a plain step cable
    routes.set(`tree:${n.id}`, {
      points: [{ x: trunk, y: pb.y + pb.h }, { x: trunk, y }, { x: nb.x, y }],
      sourceHandle: "t-out",
      targetHandle: "t-in",
    });
  }

  // Trays only exist while the columns do not overlap.
  const traysOk = bounds.every((b, i) => i === 0 || bounds[i - 1].right + CHANNEL_PAD <= b.left);
  if (!traysOk) return routes;

  // ---- dependencies through the trays
  const lanes = new Array<number>(columns.length).fill(0);
  let streetLane = 0;
  const streetY = yTree + STREET_PAD;
  const trayX = (k: number) => bounds[k].right + CHANNEL_PAD + lanes[k]++ * LANE;

  const links = [...topo.links].sort(
    (a, b) =>
      (colOf.get(a.source) ?? 0) - (colOf.get(b.source) ?? 0) ||
      (boxes.get(a.source)?.y ?? 0) - (boxes.get(b.source)?.y ?? 0),
  );
  for (const l of links) {
    const ca = colOf.get(l.source);
    const cb = colOf.get(l.target);
    const a = boxes.get(l.source);
    const b = boxes.get(l.target);
    if (ca === undefined || cb === undefined || !a || !b) continue;

    const out = { x: a.x + a.w, y: a.y + a.h * PORT_OUT };
    const x1 = trayX(ca);
    const inLeft = { x: b.x, y: b.y + b.h * PORT_IN };
    const inRight = { x: b.x + b.w, y: b.y + b.h * PORT_IN };

    if (ca === cb) {
      routes.set(l.id, {
        points: [out, { x: x1, y: out.y }, { x: x1, y: inRight.y }, inRight],
        sourceHandle: "d-out",
        targetHandle: "d-in-r",
      });
    } else if (cb === ca + 1) {
      routes.set(l.id, {
        points: [out, { x: x1, y: out.y }, { x: x1, y: inLeft.y }, inLeft],
        sourceHandle: "d-out",
        targetHandle: "d-in-l",
      });
    } else {
      const sy = streetY + streetLane++ * LANE;
      const toRight = cb > ca;
      const x2 = trayX(toRight ? cb - 1 : cb);
      const end = toRight ? inLeft : inRight;
      routes.set(l.id, {
        points: [out, { x: x1, y: out.y }, { x: x1, y: sy }, { x: x2, y: sy }, { x: x2, y: end.y }, end],
        sourceHandle: "d-out",
        targetHandle: toRight ? "d-in-l" : "d-in-r",
      });
    }
  }
  return routes;
}

/** SVG path through orthogonal points with rounded corners. */
export function roundedPath(points: Pt[], radius = 7): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const before = { x: cur.x - ((cur.x - prev.x) / inLen) * r, y: cur.y - ((cur.y - prev.y) / inLen) * r };
    const after = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    d += ` L ${before.x} ${before.y} Q ${cur.x} ${cur.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Midpoint of the longest segment: a calm place for a label. */
export function labelPoint(points: Pt[]): Pt {
  let best = { len: -1, x: points[0].x, y: points[0].y };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best.len) best = { len, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return { x: best.x, y: best.y };
}
