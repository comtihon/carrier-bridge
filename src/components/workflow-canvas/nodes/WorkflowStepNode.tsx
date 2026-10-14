"use client";

import React, { useState, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { TYPE_COLORS, STATE_STYLES } from "../constants";
import { TYPE_ICONS } from "../utils/typeIcons";
import { formatTokensK } from "@/lib/formatTokens";
import { NodeDatasourceRiskBadge } from "@/components/DatasourceRiskBadge";
import type { CombinedPart, RunPartStatus } from "@/lib/types";
import { CombinedPartsList } from "./CombinedPartsList";

/**
 * The pyramid under a combined_datasource node: output key and part count,
 * then the ordered parts as a mini chain (run-coloured in run mode).
 */
function CombinedBody({ data }: { data: WorkflowStepNodeData }) {
  const parts = (Array.isArray(data.parts) ? data.parts : []) as CombinedPart[];
  const runParts = (Array.isArray(data.runParts) ? data.runParts : undefined) as RunPartStatus[] | undefined;
  const count = parts.length || runParts?.length || 0;
  return (
    <div className="mt-1.5 pt-1.5 border-t border-white/10 space-y-1 w-full" data-testid="combined-body">
      <div className="flex items-center gap-1 text-[9px] text-slate-400 font-mono min-w-0">
        {typeof data.output_key === "string" && data.output_key && (
          <span className="truncate min-w-0" title={`output_key: ${data.output_key}`}>→ {data.output_key}</span>
        )}
        <span className="ml-auto shrink-0">{count} part{count === 1 ? "" : "s"}</span>
      </div>
      <CombinedPartsList
        parts={parts}
        output={data.output_part as string | undefined}
        runParts={runParts}
        runOutputPart={data.runOutputPart as string | undefined}
      />
    </div>
  );
}

// ─── Data interface ───────────────────────────────────────────────────────────

export interface WorkflowStepNodeData extends Record<string, unknown> {
  label: string;
  stepType: string;
  onDelete?: (id: string) => void;
  runState?: "pending" | "active" | "completed" | "failed" | "skipped" | "cancelled";
  isApproval?: boolean;
  tokenTotal?: number;
  // Post-compact meta-LLM token total for this step — a separate bucket from
  // tokenTotal (agent-LLM), never merged.
  metaTotal?: number;
  // Number of addon nodes attached to this agent (drives the fold toggle).
  _addonCount?: number;
  // Whether the attached addons are currently unfolded (visible).
  _addonsUnfolded?: boolean;
  // Callback to toggle folded/unfolded state for this agent's addons.
  _onToggleAddons?: (id: string) => void;
  [key: string]: unknown;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkflowStepNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowStepNodeData;
  const [hovered, setHovered] = useState(false);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (typeof nodeData.onDelete === "function") {
        nodeData.onDelete(id);
      }
    },
    [id, nodeData],
  );

  const runState = nodeData.runState;
  const isCombined = nodeData.stepType === "combined_datasource";

  // A datasource node runs one operation, so the badge reflects that operation
  // (falling back to the whole source until one is picked). Only this node type
  // has a `source`, so every other node renders nothing and costs no fetch.
  const riskBadge =
    nodeData.stepType === "data_source" ? (
      <NodeDatasourceRiskBadge
        sourceId={nodeData.source as string | null | undefined}
        operation={nodeData.operation as string | null | undefined}
      />
    ) : null;

  // TYPE_COLORS: always used as base background/text
  const colors = TYPE_COLORS[nodeData.stepType] ?? TYPE_COLORS.llm;

  if (runState) {
    // Run mode: TYPE_COLORS base + STATE_STYLES border/ring overlay
    const styles = STATE_STYLES[runState] ?? STATE_STYLES.pending;
    const isApproval = nodeData.isApproval;

    const borderColor = isApproval && runState === "active"
      ? "#f59e0b"
      : styles.borderColor;

    return (
      <>
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-slate-600 !border-slate-500 !w-2.5 !h-2.5"
        />
        <div
          className={clsx(
            "px-3 py-2 rounded-lg border text-xs font-medium w-44 cursor-pointer transition-all",
            colors.bg,
            colors.text,
            styles.ring,
            selected && "ring-2 ring-white/70 ring-offset-1 ring-offset-slate-950",
          )}
          style={{ borderColor }}
        >
          <div className="flex items-center gap-2">
          <span className="text-base leading-none shrink-0">{TYPE_ICONS[nodeData.stepType] ?? "•"}</span>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="truncate">{nodeData.label}</span>
            {nodeData.tokenTotal != null && (
              <span className="text-[9px] text-slate-500 font-mono leading-tight">
                {formatTokensK(nodeData.tokenTotal)}
                {nodeData.metaTotal ? `; ${formatTokensK(nodeData.metaTotal)}` : ""}
                {" tok"}
              </span>
            )}
            {!!nodeData._addonCount && (
              <span className="text-[9px] text-slate-500 font-mono leading-tight">
                +{nodeData._addonCount} addon{nodeData._addonCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          {riskBadge}
          {runState === "active" && (
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping flex-shrink-0" />
          )}
          {runState === "completed" && (
            <span className="ml-auto text-emerald-400 flex-shrink-0">✓</span>
          )}
          {runState === "failed" && (
            <span className="ml-auto text-red-400 flex-shrink-0">✗</span>
          )}
          {(runState === "skipped" || runState === "cancelled") && (
            <span className="ml-auto text-slate-500 flex-shrink-0">⊘</span>
          )}
          </div>
          {isCombined && <CombinedBody data={nodeData} />}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-slate-600 !border-slate-500 !w-2.5 !h-2.5"
        />
      </>
    );
  }

  // Editor mode: TYPE_COLORS, delete button, _slackHover support
  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      <div
        className={clsx(
          "px-3 py-2 rounded-lg border text-xs font-medium w-44 select-none cursor-pointer transition-all",
          colors.bg,
          colors.text,
          selected && "ring-2 ring-white/50",
        )}
        style={{ borderColor: selected ? "#e2e8f0" : colors.border }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base leading-none shrink-0">
            {TYPE_ICONS[nodeData.stepType] ?? "•"}
          </span>
          {/* min-w-0 flex-1: the label yields to the badge instead of shoving it
              out of the node's fixed width. */}
          <span className="truncate min-w-0 flex-1">{nodeData.label}</span>
          {riskBadge}
        </div>
        {isCombined && <CombinedBody data={nodeData} />}
      </div>
      {typeof nodeData.onDelete === "function" && (hovered || selected) && (
        <button
          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center z-10 transition-colors"
          onClick={handleDelete}
          title="Delete node"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-slate-500 !border-slate-400 !w-2.5 !h-2.5"
      />
      {!!nodeData._addonCount && typeof nodeData._onToggleAddons === "function" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (typeof nodeData._onToggleAddons === "function") {
              nodeData._onToggleAddons(id);
            }
          }}
          title={`${nodeData._addonsUnfolded ? "Hide" : "Show"} ${nodeData._addonCount} addon${nodeData._addonCount > 1 ? "s" : ""}`}
          style={{
            position: "absolute",
            bottom: -14,
            left: "50%",
            transform: "translateX(-50%)",
            minWidth: 24,
            height: 24,
            padding: "0 6px",
            borderRadius: 12,
            background: "#7c3aed",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
            pointerEvents: "auto",
            cursor: "pointer",
            zIndex: 20,
            boxShadow: "0 2px 8px rgba(124,58,237,0.5)",
          }}
        >
          {nodeData._addonsUnfolded ? "−" : `+${nodeData._addonCount}`}
        </button>
      )}
      {!!(nodeData as Record<string, unknown>)._slackHover && (
        <>
          <div
            style={{
              position: "absolute",
              inset: -2,
              borderRadius: "inherit",
              border: "2px solid #7c3aed",
              boxShadow: "0 0 12px rgba(124,58,237,0.6)",
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: -14,
              left: "50%",
              transform: "translateX(-50%)",
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "#7c3aed",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 300,
              pointerEvents: "none",
              zIndex: 20,
              boxShadow: "0 2px 8px rgba(124,58,237,0.5)",
            }}
          >
            +
          </div>
        </>
      )}
    </div>
  );
}
