"use client";

import React, { useCallback, useContext } from "react";
import {
  getSmoothStepPath,
  EdgeLabelRenderer,
  BaseEdge,
  Position,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { clsx } from "clsx";
import { ReadonlyContext } from "../ReadonlyContext";

export function EditableEdge({
  id,
  sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  data,
  markerEnd,
  style,
  animated,
}: EdgeProps) {
  const { setEdges, screenToFlowPosition } = useReactFlow();
  const readonly = useContext(ReadonlyContext);

  const edgeData = (data ?? {}) as {
    condition?: string;
    wait_seconds?: number;
    waypoints?: Array<{ x: number; y: number }>;
  };
  const waypoint = edgeData.waypoints?.[0] ?? null;
  const condition = edgeData.condition;
  const waitSeconds = edgeData.wait_seconds;

  let edgePath: string;
  let midX: number;
  let midY: number;

  if (waypoint) {
    const wx = waypoint.x;
    const wy = waypoint.y;
    // Orthogonal routing: exit source straight, bend 90° through waypoint, arrive at target straight
    if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
      edgePath = `M ${sourceX} ${sourceY} L ${wx} ${sourceY} L ${wx} ${wy} L ${targetX} ${wy} L ${targetX} ${targetY}`;
    } else {
      edgePath = `M ${sourceX} ${sourceY} L ${sourceX} ${wy} L ${wx} ${wy} L ${wx} ${targetY} L ${targetX} ${targetY}`;
    }
    midX = wx;
    midY = wy;
  } else {
    [edgePath, midX, midY] = getSmoothStepPath({
      sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    });
  }

  // Always use the path midpoint (midX/midY) so the label sits on the edge.
  // The geometric centre (sourceX+targetX)/2 is off-path for L-shaped waypoint edges.
  const labelX = midX;
  const labelY = midY;

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if (readonly) return;
      e.stopPropagation();
      e.preventDefault();
      const onMove = (me: MouseEvent) => {
        const pos = screenToFlowPosition({ x: me.clientX, y: me.clientY });
        setEdges((eds) =>
          eds.map((ed) =>
            ed.id === id
              ? { ...ed, data: { ...(ed.data as object), waypoints: [pos] } }
              : ed,
          ),
        );
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [id, readonly, setEdges, screenToFlowPosition],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.detail >= 2 && waypoint) {
        setEdges((eds) =>
          eds.map((ed) =>
            ed.id === id
              ? { ...ed, data: { ...(ed.data as object), waypoints: [] } }
              : ed,
          ),
        );
      }
    },
    [id, waypoint, setEdges],
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={animated ? { ...style, stroke: "#6366f1", strokeWidth: 2 } : style}
      />
      <EdgeLabelRenderer>
        {(condition || waitSeconds) && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
            className="flex gap-1"
          >
            {condition && (
              <span className="bg-indigo-950/90 text-indigo-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-indigo-800/50">
                {condition}
              </span>
            )}
            {waitSeconds && (
              <span
                title="delay before next node"
                className="bg-amber-950/90 text-amber-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-800/50"
              >
                wait {waitSeconds}s
              </span>
            )}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%,-50%) translate(${midX}px,${midY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
          onMouseDown={startDrag}
          onClick={handleClick}
        >
          <div
            className={clsx(
              "rounded-full border transition-all duration-100",
              waypoint
                ? "w-3 h-3 bg-slate-500 border-slate-300 cursor-grab active:cursor-grabbing hover:bg-white hover:border-white"
                : "w-2.5 h-2.5 bg-transparent border-transparent hover:bg-slate-500 hover:border-slate-400 cursor-crosshair",
            )}
          />
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
