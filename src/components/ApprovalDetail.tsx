"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Check, Clock, ExternalLink, Loader2,
  RefreshCw, ShieldAlert, Sparkles, X,
} from "lucide-react";
import { clsx } from "clsx";
import {
  decideApproval, getApproval, getApprovalHistory, vetoApproval,
} from "@/lib/api";
import type {
  ApprovalCase, ApprovalCaseStatus, ApprovalCaseSummary, ApprovalHistoryResponse,
} from "@/lib/types";
import { MetaLlmAdvice, TargetList, rowsLabel } from "./DatasourceApprovalPanel";
import { ValueView } from "./ValueView";

/**
 * One held deletion, in the main window.
 *
 * The dock panel is a queue: it fits a row count and two buttons, which is
 * enough to clear a case somebody already understands and not enough to decide
 * one they don't. This is where the case is actually read — the data source and
 * operation it would call, the values it would send, the workflow and run it
 * came from, and what was decided the last times the same operation asked.
 *
 * The layout is the queue's argument at full size: the row count stays the
 * largest thing on the page, the decision sits directly under it, and
 * everything that turns the number into a decision — endpoint, values, targets
 * — is above the fold rather than behind a click. Prior decisions come last,
 * because they are the strongest evidence and the reviewer should reach them
 * having already seen what this call would do.
 *
 * It re-reads the case on mount even though the queue handed one over. Two
 * reasons: a row can be minutes stale, and a case decided elsewhere must not
 * offer buttons that will fail — and the queue row is a *summary*, which is
 * why the panel opens quickly. The values, the targets and the details arrive
 * with this read, and until it lands those sections say so rather than
 * claiming the call sends nothing.
 */

export const APPROVAL_STATUS_CLS: Record<ApprovalCaseStatus, string> = {
  pending: "text-amber-300 bg-amber-950/40 border-amber-800",
  approved: "text-emerald-300 bg-emerald-950/40 border-emerald-800",
  rejected: "text-red-300 bg-red-950/40 border-red-800",
  cancelled: "text-orange-300 bg-orange-950/40 border-orange-800",
  expired: "text-slate-400 bg-slate-800/60 border-slate-700",
};

/** A delete and a write ask the reviewer a different question. */
const VERB: Record<NonNullable<ApprovalCase["change_kind"]>, string> = {
  delete: "deleted",
  write: "written",
  other: "affected",
};

const SURFACE_LABEL: Record<ApprovalCase["surface"], string> = {
  workflow: "workflow run",
  mcp: "agent tool call",
  try_run: "operation try-run",
};

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleString();
}

/** Seconds left on an autonomous decision's veto window, or null. */
function vetoSecondsLeft(deadline: string | null | undefined, now: number): number | null {
  if (!deadline) return null;
  const left = Math.ceil((new Date(deadline).getTime() - now) / 1000);
  return left > 0 ? left : null;
}

function Fact({ label, children, mono = false }: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={clsx("text-[11px] text-slate-200 break-words", mono && "font-mono")}>
        {children}
      </dd>
    </div>
  );
}

function Section({ title, children, action }: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] uppercase tracking-wide text-slate-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A value the call would send.
 *
 * The rendering is delegated: a request body, a SQL statement or an XML
 * document reaches a parameter as a single unbroken string, and that is the
 * form in which an over-wide `WHERE` clause is invisible. `ValueView` sniffs
 * it, indents it and paints it, and keeps the raw bytes one click away.
 */
function ParamRow({ name, value }: { name: string; value: unknown }) {
  return (
    <div className="grid grid-cols-[minmax(6rem,12rem)_1fr] items-start gap-x-3 gap-y-1 py-1.5 border-b border-slate-800/60 last:border-0">
      <p className="font-mono text-[11px] text-slate-500 break-words">{name}</p>
      <ValueView value={value} />
    </div>
  );
}

/**
 * What happened the last times this operation asked.
 *
 * The streak and the threshold are read from the server, never recomputed here:
 * this view and the gate must not disagree about whether the next identical
 * call gets decided without a human. That number is the reason a reviewer might
 * answer differently, so it is stated before the list.
 */
function PriorDecisions({ history, loading, error, currentId }: {
  history: ApprovalHistoryResponse | null;
  loading: boolean;
  error: string | null;
  currentId: string;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[11px] text-slate-500">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading prior decisions…
      </p>
    );
  }
  if (error) {
    return <p className="text-[11px] text-slate-500">Prior decisions unavailable — {error}</p>;
  }
  const others = (history?.items ?? []).filter((h) => h.id !== currentId);
  return (
    <div className="space-y-2">
      {history && (history.streak > 0 || history.autonomous_next) && (
        <p
          className={clsx(
            "rounded-lg border px-3 py-2 text-[11px]",
            history.autonomous_next
              ? "border-violet-800/70 bg-violet-950/20 text-violet-200"
              : "border-slate-800 bg-slate-900/40 text-slate-300",
          )}
        >
          {history.streak > 0 && (
            <>
              {history.streak} identical {history.streak_decision ?? "human"} decision
              {history.streak === 1 ? "" : "s"} in a row
              {history.threshold > 0 && ` of ${history.threshold} needed`}.
            </>
          )}
          {history.autonomous_next && (
            <> The next identical call is decided by the meta-LLM without asking.</>
          )}
        </p>
      )}
      {others.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          No earlier decision on this operation — this is the first time it has asked.
        </p>
      ) : (
        <ul className="space-y-1">
          {others.map((h) => (
            <li
              key={h.id}
              className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
            >
              <span
                className={clsx(
                  "shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-mono leading-none",
                  APPROVAL_STATUS_CLS[h.status],
                )}
              >
                {h.status}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-slate-300 truncate">
                  {rowsLabel(h.affected_rows)}
                  {h.decided_by_name ? ` · by ${h.decided_by_name}` : ""}
                  {h.decision_source === "meta_llm" ? " · meta-LLM" : ""}
                </p>
                {h.reason && <p className="text-[10px] text-slate-500 break-words">{h.reason}</p>}
                <p className="text-[10px] text-slate-600 font-mono">{when(h.decided_at ?? h.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ApprovalDetail({
  caseItem, onDecided, onClose, onOpenWorkflow, onOpenRun,
}: {
  /** The queue's summary row — the starting point, re-read in full on mount. */
  caseItem: ApprovalCaseSummary;
  /** Bubbled up so the queue, the badge and any open run agree again. */
  onDecided?: (updated: ApprovalCase) => void;
  onClose: () => void;
  /** Jump to the workflow that made the call, if it is one this UI can open. */
  onOpenWorkflow?: (workflowId: string) => void;
  /** Jump to the run the call is holding up. */
  onOpenRun?: (runId: string) => void;
}) {
  const [item, setItem] = useState<ApprovalCaseSummary>(caseItem);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | "veto" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [history, setHistory] = useState<ApprovalHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      setItem(await getApproval(caseItem.id));
    } catch (err) {
      // The row we were handed still renders; say the re-read failed and stop.
      setError(err instanceof Error ? err.message : "Failed to reload the case");
    } finally {
      setRefreshing(false);
    }
  }, [caseItem.id]);

  useEffect(() => {
    setItem(caseItem);
    setReason("");
    setError(null);
    reload();
  }, [caseItem, reload]);

  const loadHistory = useCallback(async () => {
    if (!item.datasource_id || !item.operation) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      // Summaries: a prior-decision row shows who, why, when and how many.
      setHistory(await getApprovalHistory({
        workflowId: item.workflow_id,
        datasourceId: item.datasource_id,
        operation: item.operation,
        limit: 20,
        view: "summary",
      }));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "request failed");
    } finally {
      setHistoryLoading(false);
    }
  }, [item.workflow_id, item.datasource_id, item.operation]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const left = vetoSecondsLeft(item.veto_deadline, now);
  useEffect(() => {
    if (vetoSecondsLeft(item.veto_deadline, Date.now()) === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [item.veto_deadline]);

  // A summary row carries no `params` key at all; an empty object means the
  // call really sends nothing. The difference is the whole point of the
  // optional fields, so the page never says "no parameters" about a case it
  // has not finished reading.
  const loaded = item.params !== undefined;
  const params = useMemo(() => Object.entries(item.params ?? {}), [item.params]);
  const details = useMemo(() => Object.entries(item.details ?? {}), [item.details]);

  const act = useCallback(async (action: "approve" | "reject" | "veto") => {
    setBusy(action);
    setError(null);
    try {
      const updated = action === "veto"
        ? await vetoApproval(item.id)
        : await decideApproval(item.id, {
            approved: action === "approve",
            reason: reason.trim() || undefined,
          });
      // A decision endpoint answers with the whole case, so the page shows the
      // recorded decision rather than an optimistic guess at it.
      if (updated && typeof updated === "object" && "id" in updated) setItem(updated);
      else await reload();
      onDecided?.(updated);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the decision");
    } finally {
      setBusy(null);
    }
  }, [item.id, reason, reload, onDecided, loadHistory]);

  const pending = item.status === "pending";
  const decidedByModel = item.decision_source === "meta_llm";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 shrink-0">
        <ShieldAlert className={clsx("w-4 h-4 shrink-0", pending ? "text-amber-400" : "text-slate-500")} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">
            {item.datasource_name || item.datasource_id}
            <span className="text-slate-500"> · </span>
            <span className="font-mono">{item.operation}</span>
          </p>
          <p className="text-[10px] text-slate-500 font-mono truncate">{item.id}</p>
        </div>
        <span
          className={clsx(
            "shrink-0 px-2 py-0.5 rounded border text-[10px] font-mono leading-none",
            APPROVAL_STATUS_CLS[item.status],
          )}
        >
          {item.status}
        </span>
        <button onClick={reload} title="Reload this case"
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors">
          <RefreshCw className={clsx("w-4 h-4", refreshing && "animate-spin")} />
        </button>
        <button onClick={onClose} title="Close"
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 max-w-4xl">
        {/* The one number the gate exists for. */}
        <div
          className={clsx(
            "rounded-xl border px-4 py-4 space-y-3",
            pending ? "border-red-700/60 bg-red-950/20" : "border-slate-800 bg-slate-900/40",
          )}
        >
          <div className="flex items-baseline gap-2">
            <span className={clsx("text-4xl font-bold tabular-nums", pending ? "text-red-300" : "text-slate-300")}>
              {item.affected_rows.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400">
              {item.affected_rows === 1 ? "row" : "rows"}
              {pending ? ` would be ${VERB[item.change_kind ?? "delete"]}` : " were in scope"} by{" "}
              <span className="font-mono text-red-400">{item.method}</span>
            </span>
          </div>

          {left !== null && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-orange-800/70 bg-orange-950/20 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] text-orange-300">
                <Clock className="w-3 h-3" />
                Runs in {left}s unless cancelled
              </p>
              <button onClick={() => act("veto")} disabled={busy !== null}
                className="px-2.5 py-1 rounded bg-orange-800 hover:bg-orange-700 text-white text-[11px] font-semibold disabled:opacity-50">
                {busy === "veto" ? "Cancelling…" : "Cancel"}
              </button>
            </div>
          )}

          {pending ? (
            <div className="space-y-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (recorded with the decision)"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
              <div className="flex gap-2">
                <button onClick={() => act("approve")} disabled={busy !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" />
                  {busy === "approve" ? "Approving…" : `Approve ${rowsLabel(item.affected_rows)}`}
                </button>
                <button onClick={() => act("reject")} disabled={busy !== null}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50">
                  <X className="w-3.5 h-3.5" />
                  {busy === "reject" ? "Rejecting…" : "Reject"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              {item.status} {item.decided_by_name ? `by ${item.decided_by_name}` : ""}
              {decidedByModel ? " by the meta-LLM" : ""}
              {item.decided_at ? ` · ${when(item.decided_at)}` : ""}
              {item.reason ? ` — ${item.reason}` : ""}
              {item.vetoed_by ? ` · cancelled by ${item.vetoed_by}` : ""}
            </p>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-[11px] text-red-400">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <Section title="Call">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
            <Fact label="Data source">
              {item.datasource_name || "—"}
              <span className="block text-[10px] text-slate-500 font-mono">{item.datasource_id}</span>
            </Fact>
            <Fact label="Operation" mono>
              {item.operation} <span className="text-red-400">[{item.method}]</span>
            </Fact>
            <div className="col-span-2 min-w-0">
              <Fact label="Endpoint" mono>{item.endpoint || "—"}</Fact>
            </div>
            <Fact label="Opened by">{SURFACE_LABEL[item.surface] ?? item.surface}</Fact>
            <Fact label="Created">{when(item.created_at)}</Fact>
          </dl>
        </Section>

        <Section title="Values">
          {!loaded ? (
            <p className="flex items-center gap-2 text-[11px] text-slate-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading the values…
            </p>
          ) : params.length === 0 ? (
            <p className="text-[11px] text-slate-500">The call sends no parameters.</p>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2">
              {params.map(([key, value]) => (
                <ParamRow key={key} name={key} value={value} />
              ))}
            </div>
          )}
        </Section>

        {loaded && ((item.affected_sample ?? []).length > 0 || (item.targets ?? []).length > 0) && (
          <Section title="Targets">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
              <TargetList
                targets={item.targets ?? []}
                sample={item.affected_sample ?? []}
                total={item.affected_rows}
              />
            </div>
          </Section>
        )}

        {details.length > 0 && (
          <Section title="Context">
            {/* The backend states here whether generated code produced the
                values. A reviewer who misses that is approving a model's
                arithmetic, so it is a section rather than a footnote. */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
              {details.map(([label, value]) => (
                <Fact key={label} label={label}>{value}</Fact>
              ))}
            </dl>
          </Section>
        )}

        <Section title="Origin">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 space-y-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Fact label="Workflow">
                {item.workflow_name || item.workflow_id || "no workflow"}
                {item.workflow_id && (
                  <span className="block text-[10px] text-slate-500 font-mono">{item.workflow_id}</span>
                )}
              </Fact>
              <Fact label="Step" mono>{item.step_id || "—"}</Fact>
              <Fact label="Run" mono>{item.run_id || "—"}</Fact>
              <Fact label="Agent" mono>{item.agent_id || "—"}</Fact>
            </dl>
            {(item.workflow_id || item.run_id) && (
              <div className="flex flex-wrap gap-2">
                {item.workflow_id && onOpenWorkflow && (
                  <button onClick={() => onOpenWorkflow(item.workflow_id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-800/60 hover:bg-violet-700/60 text-violet-100 text-[11px] font-semibold transition-colors">
                    <ExternalLink className="w-3 h-3" />
                    Open workflow
                  </button>
                )}
                {item.run_id && onOpenRun && (
                  <button onClick={() => onOpenRun(item.run_id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-800/60 hover:bg-sky-700/60 text-sky-100 text-[11px] font-semibold transition-colors">
                    <ArrowUpRight className="w-3 h-3" />
                    Open run
                  </button>
                )}
              </div>
            )}
          </div>
        </Section>

        {item.meta_llm && (
          <Section title={decidedByModel ? "Decision made by the meta-LLM" : "Recommended action"}>
            <MetaLlmAdvice verdict={item.meta_llm} decided={decidedByModel} />
          </Section>
        )}

        {!item.meta_llm && pending && (
          <Section title="Recommended action">
            <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
              <Sparkles className="w-3 h-3 mt-0.5 shrink-0 text-slate-600" />
              No recommendation — the meta-LLM did not weigh in on this case.
            </p>
          </Section>
        )}

        <Section
          title="Previous approvals"
          action={
            historyLoading
              ? <Loader2 className="w-3 h-3 text-slate-600 animate-spin" />
              : (
                <button onClick={loadHistory}
                  className="text-[10px] text-sky-400 hover:text-sky-300">
                  Reload
                </button>
              )
          }
        >
          <PriorDecisions
            history={history}
            loading={historyLoading && history === null}
            error={historyError}
            currentId={item.id}
          />
        </Section>
      </div>
    </div>
  );
}
