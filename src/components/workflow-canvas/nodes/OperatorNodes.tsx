"use client";

import React, { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { STATE_BORDER_COLOR } from "../constants";

// ─── Shared Parallel node ─────────────────────────────────────────────────────

export function SharedParallelNode({ id, data, selected }: NodeProps) {
  const [hovered, setHovered] = useState(false);
  const W = 52, H = 44;
  const nodeData = data as {
    label?: string;
    name?: string;
    runState?: string;
    onDelete?: (id: string) => void;
  };

  const runState = nodeData.runState;
  const strokeColor = runState
    ? (STATE_BORDER_COLOR[runState] ?? "#0891b2")
    : selected ? "#67e8f9" : "#0891b2";
  const fillColor = runState
    ? "#083344aa"
    : selected ? "#164e63cc" : "#083344aa";

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ left: -4, top: "50%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <polygon
          points={`${W},0 0,${H / 2} ${W},${H}`}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={1.5}
        />
      </svg>
      <Handle
        type="source"
        position={Position.Right}
        id="out0"
        style={{ right: -4, top: "22%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out1"
        style={{ right: -4, top: "78%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <span className="text-[9px] text-cyan-300 font-medium mt-0.5 truncate max-w-[56px]">
        {nodeData.name || nodeData.label || "parallel"}
      </span>
      {typeof nodeData.onDelete === "function" && (hovered || selected) && (
        <button
          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center z-10"
          onClick={(e) => {
            e.stopPropagation();
            (nodeData.onDelete as (id: string) => void)(id);
          }}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

// ─── Shared Switch node ───────────────────────────────────────────────────────

export function SharedSwitchNode({ id, data, selected }: NodeProps) {
  const [hovered, setHovered] = useState(false);
  const W = 52, H = 44;
  const nodeData = data as {
    label?: string;
    name?: string;
    runState?: string;
    onDelete?: (id: string) => void;
  };

  const runState = nodeData.runState;
  const strokeColor = runState
    ? (STATE_BORDER_COLOR[runState] ?? "#d97706")
    : selected ? "#fbbf24" : "#d97706";
  const fillColor = runState
    ? "#292524aa"
    : selected ? "#451a03cc" : "#292524aa";

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ left: -4, top: "50%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <polygon
          points={`0,0 ${W},${H / 2} 0,${H}`}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={1.5}
        />
      </svg>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ right: -4, top: "50%", transform: "translateY(-50%)" }}
        className="!bg-amber-500/60 !border-amber-400 !w-3 !h-3"
      />
      <span className="text-[9px] text-amber-300 font-medium mt-0.5 truncate max-w-[56px]">
        {nodeData.name || nodeData.label || "switch"}
      </span>
      {typeof nodeData.onDelete === "function" && (hovered || selected) && (
        <button
          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center z-10"
          onClick={(e) => {
            e.stopPropagation();
            (nodeData.onDelete as (id: string) => void)(id);
          }}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

// ─── Shared Join node ─────────────────────────────────────────────────────────

export function SharedJoinNode({ id, data, selected }: NodeProps) {
  const [hovered, setHovered] = useState(false);
  const W = 24, H = 56;
  const nodeData = data as {
    label?: string;
    name?: string;
    runState?: string;
    onDelete?: (id: string) => void;
  };

  const runState = nodeData.runState;
  const strokeColor = runState
    ? (STATE_BORDER_COLOR[runState] ?? "#7c3aed")
    : selected ? "#c4b5fd" : "#7c3aed";
  const fillColor = runState
    ? "#1a0533aa"
    : selected ? "#2e1065cc" : "#1a0533aa";

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in0"
        style={{ left: -4, top: "25%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="in1"
        style={{ left: -4, top: "50%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="in2"
        style={{ left: -4, top: "75%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <rect
          width={W}
          height={H}
          rx={4}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={1.5}
        />
      </svg>
      <Handle
        type="source"
        position={Position.Right}
        style={{ right: -4, top: "50%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <span className="text-[9px] text-violet-300 font-medium mt-0.5 truncate max-w-[40px]">
        {nodeData.name || nodeData.label || "join"}
      </span>
      {typeof nodeData.onDelete === "function" && (hovered || selected) && (
        <button
          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center z-10"
          onClick={(e) => {
            e.stopPropagation();
            (nodeData.onDelete as (id: string) => void)(id);
          }}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

// ─── Shared Proceed (Or) node ─────────────────────────────────────────────────

/** OR fan-in: the first branch to arrive carries the run onward.
 *
 * Drawn like the join bar because it occupies the same place in a graph, but in
 * amber rather than violet — the two differ only in *when* they release the run,
 * so they must not look alike. The single chevron reads as "whichever gets here
 * first goes through", against the join's plain bar meaning "all of you".
 */
export function SharedProceedOrNode({ id, data, selected }: NodeProps) {
  const [hovered, setHovered] = useState(false);
  const W = 24, H = 56;
  const nodeData = data as {
    label?: string;
    name?: string;
    runState?: string;
    onDelete?: (id: string) => void;
  };

  const runState = nodeData.runState;
  const strokeColor = runState
    ? (STATE_BORDER_COLOR[runState] ?? "#d97706")
    : selected ? "#fcd34d" : "#d97706";
  const fillColor = runState
    ? "#3d1f00aa"
    : selected ? "#78350fcc" : "#3d1f00aa";

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {["in0", "in1", "in2"].map((handleId, idx) => (
        <Handle
          key={handleId}
          type="target"
          position={Position.Left}
          id={handleId}
          style={{ left: -4, top: `${25 * (idx + 1)}%`, transform: "translateY(-50%)" }}
          className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
        />
      ))}
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <rect
          width={W}
          height={H}
          rx={4}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={1.5}
        />
        <path
          d={`M ${W * 0.3} ${H * 0.35} L ${W * 0.7} ${H * 0.5} L ${W * 0.3} ${H * 0.65}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Handle
        type="source"
        position={Position.Right}
        style={{ right: -4, top: "50%", transform: "translateY(-50%)" }}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <span className="text-[9px] text-amber-300 font-medium mt-0.5 truncate max-w-[40px]">
        {nodeData.name || nodeData.label || "or"}
      </span>
      {typeof nodeData.onDelete === "function" && (hovered || selected) && (
        <button
          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center z-10"
          onClick={(e) => {
            e.stopPropagation();
            (nodeData.onDelete as (id: string) => void)(id);
          }}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

// ─── Node types map ───────────────────────────────────────────────────────────

export const sharedOperatorNodeTypes = {
  parallel:   SharedParallelNode,
  switch:     SharedSwitchNode,
  join:       SharedJoinNode,
  proceed_or: SharedProceedOrNode,
};
