import { memo } from "react";
import { Handle, Position, useStore, type Node, type NodeProps, type ReactFlowState } from "@xyflow/react";
import { Box, Cloud, Network, Router } from "lucide-react";
import type { NodeKind, Priority, TopoNode } from "../../shared/types";
import { cx, KIND_LABEL, PRIORITY_META } from "../lib/format";

export type FeatureNodeData = {
  node: TopoNode;
  direction: "LR" | "TB";
  depth: number;
  childCount: number;
  isNew: boolean;
  /** faded because another node is in focus */
  dim: boolean;
};

export type FeatureRFNode = Node<FeatureNodeData, "feature">;

export const KIND_ICON: Record<NodeKind, typeof Box> = {
  product: Router,
  module: Network,
  feature: Box,
  integration: Cloud,
};

export function PriorityTag({ priority }: { priority: Priority }) {
  return (
    <span
      className={cx("tag ml-auto", priority === "must" && "tag-ink", priority === "could" && "tag-dashed")}
      title={PRIORITY_META[priority].hint}
    >
      {PRIORITY_META[priority].short}
    </span>
  );
}

// Semantic zoom: when zoomed far out, nodes show only their name in large type.
const farSelector = (s: ReactFlowState) => s.transform[2] < 0.55;

function FeatureNodeView({ data, selected }: NodeProps<FeatureRFNode>) {
  const n = data.node;
  const far = useStore(farSelector);
  const Icon = KIND_ICON[n.kind];

  // Ports. Tree cables: "t-in" / "t-out". Dependency cables: "d-out" on the right,
  // "d-in-l" / "d-in-r" on either side, so routed cables always meet a node from the side.
  // In the columns layout children hang off a trunk on the parent's left edge (TRUNK_X = 22).
  const columns = data.direction === "TB";
  const treeIn = !columns ? Position.Left : data.depth <= 1 ? Position.Top : Position.Left;
  const treeOut = columns ? Position.Bottom : Position.Right;
  const trunk = columns && data.depth > 0 ? { left: 22 } : undefined;

  const handles = (
    <>
      <Handle id="t-in" type="target" position={treeIn} className={cx("port", n.kind === "product" && "port-hidden")} />
      <Handle id="t-out" type="source" position={treeOut} className="port" style={trunk} />
      <Handle id="d-out" type="source" position={Position.Right} className="port port-dep" style={{ top: "30%" }} />
      <Handle id="d-in-l" type="target" position={Position.Left} className="port port-dep" style={{ top: "70%" }} />
      <Handle id="d-in-r" type="target" position={Position.Right} className="port port-dep" style={{ top: "70%" }} />
    </>
  );

  const state = cx(
    `kind-${n.kind}`,
    `prio-${n.priority}`,
    selected && "is-selected",
    data.isNew && "is-new",
    data.dim && "is-dim",
  );

  if (far) {
    return (
      <div className={cx("topo-node topo-node-far", state)}>
        {handles}
        <span className="kind-bar" />
        <span className="line-clamp-2 text-[25px] font-bold leading-[1.12]">{n.label}</span>
      </div>
    );
  }

  return (
    <div className={cx("topo-node", state)}>
      {handles}
      <div className="flex items-center gap-2">
        <span className="kind-badge">
          <Icon size={12} strokeWidth={2.4} />
        </span>
        <span className="eyebrow">{KIND_LABEL[n.kind]}</span>
        {n.kind !== "product" && <PriorityTag priority={n.priority} />}
      </div>
      <div className="mt-1.5 truncate text-[14px] font-bold leading-snug" title={n.label}>
        {n.label}
      </div>
      <div className="node-desc mt-0.5 line-clamp-2 min-h-[31px] text-[12px] leading-snug text-steel">
        {n.description || "Belum ada deskripsi."}
      </div>
      <div className="mt-2 flex h-3 items-center justify-between">
        {n.kind !== "product" ? (
          <div className="pips" title={`Kompleksitas ${n.complexity} dari 5`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <i key={i} data-on={i <= n.complexity} />
            ))}
          </div>
        ) : (
          <span />
        )}
        {data.childCount > 0 && <span className="mono text-[9.5px] text-mute">{data.childCount} cabang</span>}
      </div>
    </div>
  );
}

export const FeatureNode = memo(FeatureNodeView);
