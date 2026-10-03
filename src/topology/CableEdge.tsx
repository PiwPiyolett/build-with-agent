import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { labelPoint, roundedPath, type Pt } from "./cables";

export type CableEdgeData = {
  points?: Pt[];
  showLabel?: boolean;
};

export type CableRFEdge = Edge<CableEdgeData, "cable">;

/** Draws a routed cable when the router produced one, otherwise a plain orthogonal step. */
function CableEdgeView({
  id,
  data,
  label,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps<CableRFEdge>) {
  let path: string;
  let lx: number;
  let ly: number;
  if (data?.points && data.points.length >= 2) {
    path = roundedPath(data.points);
    ({ x: lx, y: ly } = labelPoint(data.points));
  } else {
    [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 7, offset: 14 });
  }
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth ?? 16} />
      {label && data?.showLabel && (
        <EdgeLabelRenderer>
          <div
            className="cable-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const CableEdge = memo(CableEdgeView);
