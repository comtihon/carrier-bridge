"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Code, Database, HelpCircle, Layers } from "lucide-react";
import { clsx } from "clsx";
import type { CombinedPart, RunPartStatus } from "@/lib/types";
import {
  outputPartId,
  partKind,
  partRunState,
  partRunStats,
  partSubtitle,
  runPartsById,
  type PartKind,
  type PartRunState,
} from "@/lib/combinedDatasource";

const KIND_ICON: Record<PartKind, React.ComponentType<{ className?: string }>> = {
  datasource: Database,
  python: Code,
  combined: Layers,
  unknown: HelpCircle,
};

/** Icon tint per kind — matches the data_source / python step colours. */
const KIND_TEXT: Record<PartKind, string> = {
  datasource: "text-cyan-300",
  python: "text-yellow-300",
  combined: "text-blue-300",
  unknown: "text-slate-400",
};

const RUN_ROW_CLS: Record<PartRunState, string> = {
  completed: "border-emerald-600/70 bg-emerald-950/40",
  failed:    "border-red-500/80 bg-red-950/50",
  skipped:   "border-slate-700 bg-slate-900/40 opacity-60",
  active:    "border-sky-400 bg-sky-950/50",
  pending:   "border-slate-700 bg-slate-900/30 opacity-70",
};

export interface CombinedPartsListProps {
  parts: CombinedPart[] | undefined | null;
  /** The definition's `output` (part id); defaults to the last part. */
  output?: string | null;
  /** Per-part run summary, when the run response carries one. */
  runParts?: RunPartStatus[] | null;
  /** The run's own `output_part`, which wins over the definition. */
  runOutputPart?: string | null;
  /** Show each part's error strings (the step detail panel, not the node). */
  showErrors?: boolean;
  depth?: number;
}

/**
 * The ordered parts of a combined_datasource step as a mini vertical chain.
 * Used inside the canvas node (compact) and in the run step detail.
 */
export function CombinedPartsList({
  parts,
  output,
  runParts,
  runOutputPart,
  showErrors = false,
  depth = 0,
}: CombinedPartsListProps) {
  // A run may carry parts for a definition we could not load — draw those.
  const list: CombinedPart[] =
    parts && parts.length
      ? parts
      : (runParts ?? []).map((r) => ({ id: r.id, type: r.type ?? "unknown" }));
  const runById = runPartsById(runParts);
  const outId = outputPartId(list, runOutputPart || output);

  if (!list.length) {
    return <p className="text-[9px] text-slate-500 italic px-1">no parts</p>;
  }

  return (
    <ol className={clsx("relative", depth > 0 && "ml-2 pl-1.5 border-l border-slate-600/60")}
      data-testid="combined-parts">
      {list.map((part, i) => (
        <PartRow
          key={`${part.id}-${i}`}
          part={part}
          isOutput={part.id === outId}
          run={runById.get(part.id)}
          showErrors={showErrors}
          depth={depth}
          last={i === list.length - 1}
        />
      ))}
    </ol>
  );
}

function PartRow({
  part,
  isOutput,
  run,
  showErrors,
  depth,
  last,
}: {
  part: CombinedPart;
  isOutput: boolean;
  run?: RunPartStatus;
  showErrors: boolean;
  depth: number;
  last: boolean;
}) {
  const kind = partKind(part);
  const Icon = KIND_ICON[kind];
  const state = partRunState(run?.status);
  const stats = partRunStats(run);
  const [expanded, setExpanded] = useState(false);
  const nestedParts = Array.isArray(part.parts) ? part.parts : [];
  const nestedRun = run?.parts ?? undefined;
  const nestedCount = nestedParts.length || nestedRun?.length || 0;
  const subtitle = partSubtitle(kind === "combined" ? { ...part, parts: nestedParts.length ? nestedParts : (nestedRun as CombinedPart[] | undefined) } : part);

  return (
    <li
      className="relative"
      data-testid="combined-part"
      data-part-id={part.id}
      data-kind={kind}
      data-run-state={state ?? ""}
      data-output={isOutput ? "true" : undefined}
    >
      <div
        className={clsx(
          "rounded border px-1.5 py-1 text-[10px] leading-tight",
          state ? RUN_ROW_CLS[state] : "border-slate-700/80 bg-slate-950/40",
        )}
        title={`${part.id} — ${subtitle}`}
      >
        <div className="flex items-center gap-1 min-w-0">
          <Icon className={clsx("w-3 h-3 shrink-0", KIND_TEXT[kind])} aria-label={kind} />
          <span className="font-mono truncate min-w-0 flex-1 text-slate-100">{part.id}</span>
          {isOutput && (
            <span
              className="shrink-0 px-1 rounded bg-amber-500/20 border border-amber-500/60 text-amber-200 text-[8px] font-bold uppercase"
              data-testid="output-badge"
              title="This part's output becomes the step output"
            >
              out
            </span>
          )}
          {state === "active" && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />}
          {state === "completed" && <span className="shrink-0 text-emerald-400">✓</span>}
          {state === "failed" && <span className="shrink-0 text-red-400">✗</span>}
          {state === "skipped" && <span className="shrink-0 text-slate-500">⊘</span>}
        </div>
        <div className="flex items-center gap-1 min-w-0 pl-4">
          {kind === "combined" ? (
            <button
              type="button"
              className="nodrag flex items-center gap-0.5 text-slate-400 hover:text-slate-200"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="toggle-nested"
            >
              {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
              {nestedCount} part{nestedCount === 1 ? "" : "s"}
            </button>
          ) : (
            <span className="truncate text-slate-400 font-mono text-[9px]">{subtitle}</span>
          )}
        </div>
        {stats.length > 0 && (
          <div className="pl-4 text-[9px] font-mono text-slate-400 truncate" data-testid="part-stats">
            {stats.join(" · ")}
          </div>
        )}
        {showErrors && run?.errors && run.errors.length > 0 && (
          <ul className="pl-4 mt-0.5 space-y-0.5">
            {run.errors.map((err, j) => (
              <li key={j} className="text-[9px] text-red-300 font-mono whitespace-pre-wrap break-words">{err}</li>
            ))}
          </ul>
        )}
      </div>
      {kind === "combined" && expanded && (
        <div className="mt-1">
          <CombinedPartsList
            parts={nestedParts}
            output={part.output}
            runParts={nestedRun}
            showErrors={showErrors}
            depth={depth + 1}
          />
        </div>
      )}
      {!last && <div className="ml-3 h-1.5 w-px bg-slate-500" aria-hidden />}
    </li>
  );
}
