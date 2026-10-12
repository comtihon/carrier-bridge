"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Clock, Loader2, ShieldAlert, Sparkles, X } from "lucide-react";
import { clsx } from "clsx";
import { decideApproval, listApprovals, vetoApproval } from "@/lib/api";
import type { ApprovalCaseStatus, ApprovalCaseSummary } from "@/lib/types";
import { PanelShell } from "./dock";

/**
 * Approvals: every destructive data-source call the platform has held.
 *
 * Two lists in one, separated by a filter rather than a tab, because they are
 * the same rows at different ages — a pending case becomes a history entry
 * without moving. Pending is the default view: the queue is the thing somebody
 * opens this panel to clear.
 *
 * A row is a summary, not the case: it carries the row count and the two
 * buttons, which is enough to clear a case the reviewer already understands.
 * Clicking it opens the case in the main window, where the values, the origin
 * and the prior decisions on the same operation have the room to be read. The
 * buttons stay on the row so the queue can still be cleared without opening
 * anything.
 *
 * A case a *workflow* opened can also be answered from its run, and one an
 * agent opened can only be answered here — so the panel never assumes it is
 * the only decider. It reloads after every action and on a slow interval,
 * which is what keeps two open tabs from disagreeing.
 */

const RELOAD_MS = 15_000;

const STATUS_CLS: Record<ApprovalCaseStatus, string> = {
  pending: "text-amber-300 bg-amber-950/40 border-amber-800",
  approved: "text-emerald-300 bg-emerald-950/40 border-emerald-800",
  rejected: "text-red-300 bg-red-950/40 border-red-800",
  cancelled: "text-orange-300 bg-orange-950/40 border-orange-800",
  expired: "text-slate-400 bg-slate-800/60 border-slate-700",
};

const FILTERS: Array<{ label: string; value: ApprovalCaseStatus | "all" }> = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

function rowsLabel(n: number): string {
  return n === 1 ? "1 row" : `${n.toLocaleString()} rows`;
}

/** Seconds left on an autonomous decision's veto window, or null. */
function vetoSecondsLeft(deadline: string | null | undefined, now: number): number | null {
  if (!deadline) return null;
  const left = Math.ceil((new Date(deadline).getTime() - now) / 1000);
  return left > 0 ? left : null;
}

function CaseRow({ item, now, onAct, onOpen, selected, busy }: {
  item: ApprovalCaseSummary;
  now: number;
  onAct: (action: "approve" | "reject" | "veto", item: ApprovalCaseSummary) => void;
  onOpen?: (item: ApprovalCaseSummary) => void;
  selected?: boolean;
  busy: boolean;
}) {
  const left = vetoSecondsLeft(item.veto_deadline, now);
  const decidedByModel = item.decision_source === "meta_llm";

  return (
    <div
      onClick={onOpen ? () => onOpen(item) : undefined}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      title={onOpen ? "Open this case" : undefined}
      onKeyDown={onOpen ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(item); }
      } : undefined}
      className={clsx(
        "rounded-xl border px-3 py-2.5 space-y-2 transition-colors",
        onOpen && "cursor-pointer",
        selected
          ? "border-amber-500 bg-amber-950/30"
          : item.status === "pending"
            ? "border-amber-800/70 bg-amber-950/10 hover:border-amber-700"
            : "border-slate-800 bg-slate-900/40 hover:border-slate-700",
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert
          className={clsx(
            "w-4 h-4 mt-0.5 shrink-0",
            item.status === "pending" ? "text-amber-400" : "text-slate-500",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-200 truncate">
            {item.datasource_name || item.datasource_id}
            <span className="text-slate-500"> · </span>
            <span className="font-mono">{item.operation}</span>
          </p>
          <p className="text-[10px] text-slate-500 truncate mt-0.5">
            {item.workflow_name || item.workflow_id || "no workflow"}
            {item.surface === "mcp" && " · agent tool call"}
          </p>
        </div>
        <span
          className={clsx(
            "shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-mono leading-none",
            STATUS_CLS[item.status],
          )}
        >
          {item.status}
        </span>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-red-300">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        {rowsLabel(item.affected_rows)} · <span className="font-mono">{item.method}</span>
      </p>

      {item.meta_llm && item.meta_llm.decision !== "abstain" && (
        <p className="flex items-start gap-1.5 text-[10px] text-slate-400">
          <Sparkles className="w-3 h-3 mt-0.5 shrink-0 text-violet-400" />
          <span>
            Meta-LLM {decidedByModel ? "decided" : "suggests"}:{" "}
            {item.meta_llm.decision}
            {item.meta_llm.reason ? ` — ${item.meta_llm.reason}` : ""}
          </span>
        </p>
      )}

      {item.decided_by_name && item.status !== "pending" && (
        <p className="text-[10px] text-slate-500 truncate">
          {item.status} by {item.decided_by_name}
          {item.reason ? ` — ${item.reason}` : ""}
        </p>
      )}

      {left !== null && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-orange-800/70 bg-orange-950/20 px-2 py-1.5">
          <p className="flex items-center gap-1.5 text-[10px] text-orange-300">
            <Clock className="w-3 h-3" />
            Runs in {left}s unless cancelled
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); onAct("veto", item); }}
            disabled={busy}
            className="px-2 py-1 rounded bg-orange-800 hover:bg-orange-700 text-white text-[10px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}

      {item.status === "pending" && (
        <div className="flex gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onAct("approve", item); }}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAct("reject", item); }}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors disabled:opacity-50"
          >
            <X className="w-3 h-3" />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

export function ApprovalsPanel({ onClose, onOpen, selectedId, reloadToken }: {
  onClose: () => void;
  /** Opens the case in the centre pane. Absent leaves rows unclickable. */
  onOpen?: (item: ApprovalCaseSummary) => void;
  /** The case the centre pane is showing, so the queue marks its place. */
  selectedId?: string | null;
  /** Bumped elsewhere (a run approved from its own panel) to refresh here. */
  reloadToken?: number;
}) {
  const [filter, setFilter] = useState<ApprovalCaseStatus | "all">("pending");
  const [items, setItems] = useState<ApprovalCaseSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Summaries: the row below reads a dozen short fields, and the detail
      // page re-reads the case by id anyway.
      const body = await listApprovals({
        status: filter === "all" ? undefined : filter,
        limit: 50,
        view: "summary",
      });
      setItems(body.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load, reloadToken]);

  useEffect(() => {
    const timer = setInterval(load, RELOAD_MS);
    return () => clearInterval(timer);
  }, [load]);

  // The veto countdown is the only thing here that changes without a reload.
  useEffect(() => {
    const hasWindow = items.some((i) => vetoSecondsLeft(i.veto_deadline, Date.now()) !== null);
    if (!hasWindow) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [items]);

  const act = useCallback(async (
    action: "approve" | "reject" | "veto",
    item: ApprovalCaseSummary,
  ) => {
    setBusyId(item.id);
    setError(null);
    try {
      if (action === "veto") {
        await vetoApproval(item.id);
      } else {
        await decideApproval(item.id, { approved: action === "approve" });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the decision");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  return (
    <PanelShell id="approvals" onClose={onClose}>
      <div className="flex gap-1 px-2 pt-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={clsx(
              "px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors",
              filter === f.value
                ? "bg-amber-800/60 text-amber-200"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/60",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {loading && items.length === 0 && (
          <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>
        )}
        {error && (
          <p className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">
            {error}
          </p>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
            <p className="text-2xl">🛡️</p>
            <p className="text-xs text-slate-500">
              {filter === "pending" ? "Nothing waiting for approval." : "No cases here yet."}
            </p>
          </div>
        )}
        {items.map((item) => (
          <CaseRow
            key={item.id}
            item={item}
            now={now}
            onAct={act}
            onOpen={onOpen}
            selected={selectedId === item.id}
            busy={busyId === item.id}
          />
        ))}
        {loading && items.length > 0 && (
          <Loader2 className="w-3 h-3 mx-auto text-slate-600 animate-spin" />
        )}
      </div>
    </PanelShell>
  );
}
