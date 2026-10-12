"use client";

import { clsx } from "clsx";
import type { WorkflowStatus, ApprovalStatus } from "@/lib/types";

const STATUS_STYLES: Record<WorkflowStatus, string> = {
  pending: "bg-slate-700 text-slate-300",
  running: "bg-sky-900/60 text-sky-300 animate-pulse",
  waiting_approval: "bg-amber-900/60 text-amber-300",
  waiting_agent: "bg-sky-900/60 text-sky-300 animate-pulse",
  asking_context: "bg-fuchsia-900/60 text-fuchsia-300",
  completed: "bg-emerald-900/60 text-emerald-300",
  failed: "bg-red-900/60 text-red-300",
  cancelled: "bg-slate-800 text-slate-400",
};

const STATUS_DOTS: Record<WorkflowStatus, string> = {
  pending: "bg-slate-400",
  running: "bg-sky-400 animate-ping",
  waiting_approval: "bg-amber-400",
  waiting_agent: "bg-sky-400 animate-pulse",
  asking_context: "bg-fuchsia-400 animate-pulse",
  completed: "bg-emerald-400",
  failed: "bg-red-400",
  cancelled: "bg-slate-500",
};

const STATUS_LABELS: Partial<Record<WorkflowStatus, string>> = {
  asking_context: "context needed",
  waiting_approval: "waiting approval",
};

export function StatusBadge({
  status,
  size = "sm",
}: {
  status: WorkflowStatus;
  size?: "xs" | "sm" | "md";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        STATUS_STYLES[status],
        size === "xs" && "px-2 py-0.5 text-xs",
        size === "sm" && "px-2.5 py-1 text-xs",
        size === "md" && "px-3 py-1.5 text-sm"
      )}
    >
      <span
        className={clsx(
          "rounded-full flex-shrink-0",
          STATUS_DOTS[status],
          size === "xs" && "w-1.5 h-1.5",
          size === "sm" && "w-2 h-2",
          size === "md" && "w-2.5 h-2.5"
        )}
      />
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

const APPROVAL_STYLES: Record<ApprovalStatus, string> = {
  not_required: "bg-slate-800 text-slate-400",
  pending: "bg-amber-900/60 text-amber-300",
  approved: "bg-emerald-900/60 text-emerald-300",
  rejected: "bg-red-900/60 text-red-300",
};

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        APPROVAL_STYLES[status]
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
