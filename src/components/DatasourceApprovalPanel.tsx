"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Sparkles, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { approveWorkflowRun, rejectWorkflowRun } from "@/lib/api";
import type { DatasourceApprovalPayload, MetaLlmVerdict, WorkflowRun } from "@/lib/types";
import { ValueView } from "./ValueView";

/**
 * The panel a paused deletion shows.
 *
 * Everything here is arranged around one number. A reviewer who reads nothing
 * else must still read the row count, so it is the largest thing on the card
 * and the buttons sit below it — never above, never beside it. The endpoint,
 * the inputs and the target list are what turn that number into a decision,
 * and they are visible without a click when there are few enough to fit.
 *
 * The meta-LLM's recommendation, when there is one, is deliberately last and
 * deliberately labelled: it is advice, and a reviewer who scrolls past it has
 * lost nothing.
 */

export function rowsLabel(n: number): string {
  return n === 1 ? "1 row" : `${n.toLocaleString()} rows`;
}

/**
 * Inline, above the buttons — advice, not a verdict.
 *
 * `decided` flips the wording: the same verdict is a recommendation while a
 * human still owes an answer, and the reason the deletion ran once it was the
 * decision. Saying "would approve" about a call that already went through
 * would be a lie in the audit trail.
 */
export function MetaLlmAdvice({ verdict, decided = false }: {
  verdict: MetaLlmVerdict;
  decided?: boolean;
}) {
  if (verdict.decision === "abstain") return null;
  const approving = verdict.decision === "approve";
  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2.5 space-y-1",
        approving
          ? "border-emerald-800/70 bg-emerald-950/20"
          : "border-red-800/70 bg-red-950/20",
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
        <Sparkles className={clsx("w-3 h-3", approving ? "text-emerald-400" : "text-red-400")} />
        Meta-LLM {decided ? "decided to" : "would"} {approving ? "approve" : "reject"}
      </p>
      {verdict.reason && <p className="text-[11px] text-slate-400">{verdict.reason}</p>}
      <p className="text-[10px] text-slate-500">
        From {verdict.history_size} prior decision
        {verdict.history_size === 1 ? "" : "s"} on this operation.
        {decided ? " Recorded as the decision." : " Advisory — you decide."}
      </p>
    </div>
  );
}

export function TargetList({ targets, sample, total }: {
  targets: string[];
  sample: string[];
  total: number;
}) {
  const lines = sample.length > 0 ? sample : targets;
  // Six fits without scrolling on a laptop; past that the list is a summary
  // with a way in, not a wall the buttons hide behind.
  const [expanded, setExpanded] = useState(false);
  if (lines.length === 0) return null;
  const shown = expanded ? lines : lines.slice(0, 6);
  const hiddenHere = lines.length - shown.length;
  const beyondSample = total - lines.length;

  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">Targets</p>
      <ul className="space-y-0.5 font-mono text-[11px] text-slate-300">
        {shown.map((line, i) => (
          <li key={i} className="truncate" title={line}>{line}</li>
        ))}
      </ul>
      {hiddenHere > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
        >
          <ChevronDown className="w-3 h-3" />
          Show {hiddenHere} more
        </button>
      )}
      {expanded && lines.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
        >
          <ChevronUp className="w-3 h-3" />
          Show fewer
        </button>
      )}
      {beyondSample > 0 && (
        <p className="text-[10px] text-slate-500">
          …and {beyondSample.toLocaleString()} more not sampled
        </p>
      )}
    </div>
  );
}

export function DatasourceApprovalPanel({ run, onUpdate }: {
  run: WorkflowRun;
  onUpdate: (run: WorkflowRun) => void;
}) {
  const payload = run.interrupt_payload as unknown as DatasourceApprovalPayload;
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [submitted, setSubmitted] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Once the run moves past this interrupt the overlay clears, so a second
  // deletion later in the same run draws its own card.
  useEffect(() => {
    if (submitted && run.status !== "waiting_approval") setSubmitted(null);
  }, [run.status, submitted]);

  const params = useMemo(
    () => Object.entries(payload?.params ?? {}),
    [payload?.params],
  );

  if (!payload) return null;

  async function act(approved: boolean) {
    const kind = approved ? "approve" : "reject";
    setLoading(kind);
    setSubmitted(kind);
    setError(null);
    try {
      const updated = approved
        ? await approveWorkflowRun(run.id)
        : await rejectWorkflowRun(run.id, { reason: reason.trim() || undefined });
      onUpdate(updated);
    } catch (err) {
      setSubmitted(null);
      setError(err instanceof Error ? err.message : "Failed to submit the decision");
    } finally {
      setLoading(null);
    }
  }

  if (submitted) {
    return (
      <div
        className={clsx(
          "rounded-lg border px-4 py-3 text-xs",
          submitted === "approve"
            ? "border-emerald-700/60 bg-emerald-950/20 text-emerald-300"
            : "border-red-700/60 bg-red-950/20 text-red-300",
        )}
      >
        {submitted === "approve" ? "Approving the deletion…" : "Rejecting the deletion…"}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-700/60 bg-red-950/20 px-4 py-4 space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-red-300">
        <AlertTriangle className="w-4 h-4" />
        Deletion needs approval
      </h3>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-red-300 tabular-nums">
          {payload.affected_rows.toLocaleString()}
        </span>
        <span className="text-xs text-slate-400">
          {payload.affected_rows === 1 ? "row will be deleted" : "rows will be deleted"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <div>
          <dt className="uppercase tracking-wide text-slate-500">Data source</dt>
          <dd className="text-slate-200 truncate" title={payload.datasource_name}>
            {payload.datasource_name || payload.datasource_id}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-slate-500">Operation</dt>
          <dd className="font-mono text-slate-200 truncate" title={payload.operation}>
            {payload.operation}{" "}
            <span className="text-red-400">[{payload.method}]</span>
          </dd>
        </div>
      </dl>

      {payload.endpoint && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Endpoint</p>
          <p className="font-mono text-[11px] text-slate-300 break-all">{payload.endpoint}</p>
        </div>
      )}

      {params.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Input</p>
          {/* A body or a statement arrives here as one unbroken string, which
              is the form that hides an over-wide filter. Same view as the
              approvals detail page, so the two never disagree on what a value
              is. */}
          <ul className="space-y-1">
            {params.map(([key, value]) => (
              <li key={key} className="space-y-0.5">
                <span className="font-mono text-[11px] text-slate-500">{key}</span>
                <ValueView value={value} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <TargetList
        targets={payload.targets ?? []}
        sample={payload.affected_sample ?? []}
        total={payload.affected_rows}
      />

      {payload.meta_llm && <MetaLlmAdvice verdict={payload.meta_llm} />}

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (recorded with the decision)"
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
      />

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => act(true)}
          disabled={loading !== null}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          {loading === "approve" ? "Approving…" : `Delete ${rowsLabel(payload.affected_rows)}`}
        </button>
        <button
          onClick={() => act(false)}
          disabled={loading !== null}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <XCircle className="w-3.5 h-3.5" />
          {loading === "reject" ? "Rejecting…" : "Keep the data"}
        </button>
      </div>
    </div>
  );
}
