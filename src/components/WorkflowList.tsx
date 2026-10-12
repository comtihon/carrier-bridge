"use client";

import { useState, useMemo } from "react";
import { clsx } from "clsx";
import { Clock, Trash2, Search, X } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { effectiveStatus } from "@/lib/types";
import type { WorkflowRun, WorkflowStatus } from "@/lib/types";

type StatusFilter = WorkflowStatus | null;

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "All",      value: null },
  { label: "Running",  value: "running" },
  { label: "Approval", value: "waiting_approval" },
  { label: "Asking",   value: "asking_context" },
  { label: "Done",     value: "completed" },
  { label: "Failed",   value: "failed" },
];

interface Props {
  runIds: string[];
  runs: Record<string, WorkflowRun>;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  page?: number;
  total?: number;
  pageSize?: number;
  onPrev?: () => void;
  onNext?: () => void;
}

function RelativeTime({ iso }: { iso: string }) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return <span>{diff}s ago</span>;
  if (diff < 3600) return <span>{Math.floor(diff / 60)}m ago</span>;
  return <span>{Math.floor(diff / 3600)}h ago</span>;
}

export function WorkflowList({ runIds, runs, selectedRunId, onSelect, onRemove, page, total, pageSize, onPrev, onNext }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);

  const filteredIds = useMemo(() => {
    return runIds.filter((id) => {
      const run = runs[id];
      if (!run) return statusFilter === null && !search;
      if (statusFilter !== null && effectiveStatus(run) !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          run.workflow_name.toLowerCase().includes(q) ||
          run.user_request.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [runIds, runs, statusFilter, search]);

  const isFiltered = search !== "" || statusFilter !== null;

  if (runIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <p className="text-3xl">🤖</p>
        <p className="text-sm text-slate-500">No runs yet.</p>
        <p className="text-xs text-slate-600">
          Use the chat to start a workflow, or click{" "}
          <span className="text-sky-400">New Run</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Search input */}
      <div className="relative shrink-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search runs…"
          className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-800/60 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-600 transition-colors"
        />
        {search && (
          <button
            aria-label="Clear search"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Status filter pills */}
      <div className="flex gap-1 flex-wrap shrink-0">
        {STATUS_FILTERS.map(({ label, value }) => (
          <button
            key={label}
            onClick={() => setStatusFilter(value)}
            className={clsx(
              "px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors",
              statusFilter === value
                ? "bg-sky-600 text-white"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex flex-col gap-1 overflow-y-auto pr-1 flex-1 min-h-0">
        {filteredIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 gap-1.5 text-center">
            <p className="text-xs text-slate-500">No runs match your filter.</p>
            <button
              onClick={() => { setSearch(""); setStatusFilter(null); }}
              className="text-[10px] text-sky-400 hover:text-sky-300"
            >
              Clear filters
            </button>
          </div>
        ) : (
          filteredIds.map((id) => {
            const run = runs[id];
            const isSelected = id === selectedRunId;

            return (
              <div
                key={id}
                className={clsx(
                  "group relative rounded-xl border px-3 py-3 cursor-pointer transition-all",
                  isSelected
                    ? "border-sky-600 bg-sky-950/40"
                    : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/40",
                  !run && "opacity-50"
                )}
                onClick={() => onSelect(id)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(id);
                  }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400 transition-all"
                  title="Remove from list"
                >
                  <Trash2 className="w-3 h-3" />
                </button>

                {run ? (
                  <>
                    <div className="flex items-start justify-between gap-2 pr-5">
                      <p className="text-xs font-semibold text-slate-200 leading-snug line-clamp-1">
                        {run.workflow_name}
                      </p>
                    </div>
                    <p className="text-[10px] font-mono text-slate-500 truncate mt-0.5 select-all" title={run.id}>
                      <span className="text-slate-600 not-italic">ID:</span> {run.id}
                    </p>
                    <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">
                      {run.user_request}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <StatusBadge status={effectiveStatus(run)} size="xs" />
                      <span className="text-[10px] text-slate-600 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <RelativeTime iso={run.created_at} />
                      </span>
                    </div>
                    {run.status === "waiting_approval" &&
                      run.interrupt_payload?.type !== "ask_context" && (
                        <div className="mt-1.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          <span className="text-[10px] text-amber-400 font-medium">
                            Awaiting approval
                          </span>
                        </div>
                      )}
                  </>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400 font-mono truncate">{id}</p>
                    <p className="text-[10px] text-slate-600">Loading…</p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Filter summary */}
      {isFiltered && (
        <p className="text-[10px] text-slate-600 text-center shrink-0">
          {filteredIds.length} of {runIds.length} runs
        </p>
      )}

      {/* Pagination footer */}
      {(onPrev || onNext) && total !== undefined && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-800 text-xs text-slate-500 shrink-0">
          <button
            onClick={onPrev}
            disabled={!onPrev || page === 0}
            className="px-2 py-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <span>
            {total === 0 ? "No runs" : `${(page ?? 0) * (pageSize ?? 20) + 1}–${Math.min(((page ?? 0) + 1) * (pageSize ?? 20), total)} of ${total}`}
          </span>
          <button
            onClick={onNext}
            disabled={!onNext || ((page ?? 0) + 1) * (pageSize ?? 20) >= (total ?? 0)}
            className="px-2 py-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
