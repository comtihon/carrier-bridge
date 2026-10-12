"use client";

import { useState, useEffect, useRef } from "react";
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Pencil, Eye } from "lucide-react";
import { clsx } from "clsx";
import { approveGate, rejectGate, approveWorkflowRun, rejectWorkflowRun } from "@/lib/api";
import type { WorkflowRun, ApprovalGate } from "@/lib/types";
import { Markdown } from "./Markdown";
import { DatasourceApprovalPanel } from "./DatasourceApprovalPanel";

function AutoTextarea({
  value,
  onChange,
  className,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);
  useEffect(() => {
    if (autoFocus && ref.current) {
      const el = ref.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={className}
    />
  );
}

function MarkdownEditableField({
  value,
  onChange,
  textareaClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  textareaClassName: string;
}) {
  // Default to preview when there's content; edit mode when empty so the user can type immediately.
  const [editing, setEditing] = useState(value.trim() === "");

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={value.trim() === ""}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={value.trim() === "" ? "Add content to preview" : "Preview rendered markdown"}
          >
            <Eye className="w-3 h-3" />
            Preview
          </button>
        </div>
        <AutoTextarea
          value={value}
          onChange={onChange}
          autoFocus
          className={textareaClassName}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="block w-full text-left bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-2 transition-colors cursor-text"
        title="Click to edit"
      >
        <Markdown>{value}</Markdown>
      </button>
    </div>
  );
}

interface Props {
  run: WorkflowRun;
  onUpdate: (run: WorkflowRun) => void;
}

function AskContextPanel({ run, onUpdate }: Props) {
  const questions = (run.interrupt_payload?.questions as string[]) ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((_, i) => [String(i), ""]))
  );
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Once the backend has moved past this interrupt, clear the optimistic
  // overlay so a later waiting_approval (a new interrupt) reveals the form
  // again — without forcing the user to reload the page.
  useEffect(() => {
    if (submitted && run.status !== "waiting_approval") {
      setSubmitted(false);
    }
  }, [run.status, submitted]);

  const allAnswered = questions.length > 0 && questions.every((_, i) => (answers[String(i)] ?? "").trim() !== "");

  async function handleSubmit() {
    setLoading(true);
    setSubmitted(true);
    try {
      const updated = await approveWorkflowRun(run.id, { corrections: answers });
      onUpdate(updated);
    } catch (err) {
      setSubmitted(false);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-fuchsia-700/60 bg-fuchsia-950/30 px-4 py-3 text-xs text-fuchsia-300">
        Submitting answers…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-fuchsia-700/60 bg-fuchsia-950/30 px-4 py-4 space-y-4">
      <h3 className="text-sm font-semibold text-fuchsia-300 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-fuchsia-400 animate-pulse" />
        Questions
      </h3>
      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={i}>
            <div className="text-xs text-slate-300 mb-1.5">
              <Markdown>{q}</Markdown>
            </div>
            <MarkdownEditableField
              value={answers[String(i)] ?? ""}
              onChange={(v) => setAnswers((prev) => ({ ...prev, [String(i)]: v }))}
              textareaClassName="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200 resize-none focus:outline-none focus:border-fuchsia-500"
            />
          </div>
        ))}
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading || !allAnswered}
        className="w-full py-2 rounded-lg bg-fuchsia-700 hover:bg-fuchsia-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
      >
        {loading ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}

function GateCard({
  gate,
  runId,
  onUpdate,
}: {
  gate: ApprovalGate;
  runId: string;
  onUpdate: (run: WorkflowRun) => void;
}) {
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [expanded, setExpanded] = useState(gate.status === "pending");

  const isPending = gate.status === "pending";

  async function handleApprove() {
    setLoading("approve");
    try {
      const updated = await approveGate(runId, gate.id, {});
      onUpdate(updated);
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    setLoading("reject");
    try {
      const updated = await rejectGate(runId, gate.id, {});
      onUpdate(updated);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      className={clsx(
        "rounded-lg border",
        gate.status === "pending" && "border-amber-700/60 bg-amber-950/30",
        gate.status === "approved" && "border-emerald-800/50 bg-emerald-950/20",
        gate.status === "rejected" && "border-red-800/50 bg-red-950/20"
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {gate.status === "approved" && <CheckCircle className="w-4 h-4 text-emerald-400" />}
          {gate.status === "rejected" && <XCircle className="w-4 h-4 text-red-400" />}
          {gate.status === "pending" && (
            <span className="w-4 h-4 rounded-full border-2 border-amber-400 animate-pulse" />
          )}
          <span className="text-sm font-medium text-slate-200">
            Gate: {gate.step_id}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              gate.status === "pending" && "bg-amber-900/50 text-amber-300",
              gate.status === "approved" && "bg-emerald-900/50 text-emerald-300",
              gate.status === "rejected" && "bg-red-900/50 text-red-300"
            )}
          >
            {gate.status}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {gate.metadata?.description != null && (
            <p className="text-xs text-slate-400">{String(gate.metadata.description)}</p>
          )}
          {gate.feedback && (
            <p className="text-xs text-emerald-400">Feedback: {gate.feedback}</p>
          )}
          {gate.reason && (
            <p className="text-xs text-red-400">Reason: {gate.reason}</p>
          )}

          {isPending && (
            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={loading !== null}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {loading === "approve" ? "Approving…" : "Approve"}
              </button>
              <button
                onClick={handleReject}
                disabled={loading !== null}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                {loading === "reject" ? "Rejecting…" : "Reject"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ApprovalPanel({ run, onUpdate }: Props) {
  if (run.interrupt_payload?.type === "ask_context") {
    return <AskContextPanel run={run} onUpdate={onUpdate} />;
  }
  // A destructive data_source step pauses with its own payload: the generic
  // correction-fields card would render the row count as one more editable
  // string, which is exactly the wrong shape for the one number that decides
  // the answer.
  if (run.interrupt_payload?.type === "datasource_approval") {
    return <DatasourceApprovalPanel run={run} onUpdate={onUpdate} />;
  }
  // waiting_agent interrupt — agent is running, no approval needed
  if (run.interrupt_payload?.type === "waiting_agent") {
    return null;
  }

  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  // Optimistic flag: once a click goes out, hide the action card immediately
  // (well before the polled run.status leaves waiting_approval) so users can't
  // double-click during the resume's network/backend round-trip.
  const [submitted, setSubmitted] = useState<"approve" | "reject" | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(run.interrupt_payload ?? {}).map(([k, v]) => [k, String(v)])
    )
  );

  // Once the backend has moved past this interrupt, clear the overlay. If the
  // run later cycles back to waiting_approval that's a new interrupt and the
  // action card should reappear without requiring a page reload.
  useEffect(() => {
    if (submitted && run.status !== "waiting_approval") {
      setSubmitted(null);
    }
  }, [run.status, submitted]);

  const gates = run.approval_gates ?? [];
  const pendingGates = gates.filter((g) => g.status === "pending");
  const hasMultipleGates = gates.length > 1;
  const interruptFields = Object.entries(run.interrupt_payload ?? {});

  async function handleApproveAll() {
    setLoading("approve");
    setSubmitted("approve");
    try {
      const updated = await approveWorkflowRun(run.id, {
        corrections: interruptFields.length > 0 ? corrections : undefined,
      });
      onUpdate(updated);
    } catch (err) {
      setSubmitted(null);
      throw err;
    } finally {
      setLoading(null);
    }
  }

  async function handleRejectAll() {
    setLoading("reject");
    setSubmitted("reject");
    try {
      const updated = await rejectWorkflowRun(run.id, {});
      onUpdate(updated);
    } catch (err) {
      setSubmitted(null);
      throw err;
    } finally {
      setLoading(null);
    }
  }

  const isWaitingApproval =
    run.status === "waiting_approval" || run.approval_status === "pending";

  if (gates.length === 0 && !isWaitingApproval) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
        {isWaitingApproval && (
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
        {gates.length > 0 ? "Approval Gates" : "Approval Required"}
      </h3>

      {/* Per-gate cards */}
      {gates.map((gate) => (
        <GateCard
          key={gate.id}
          gate={gate}
          runId={run.id}
          onUpdate={onUpdate}
        />
      ))}

      {/* Bulk gate actions */}
      {hasMultipleGates && pendingGates.length > 1 && !submitted && (
        <div className="border-t border-slate-800 pt-3 space-y-2">
          <p className="text-xs text-slate-400">Act on all pending gates at once:</p>
          <div className="flex gap-2">
            <button
              onClick={handleApproveAll}
              disabled={loading !== null}
              className="flex-1 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {loading === "approve" ? "Approving all…" : `Approve all (${pendingGates.length})`}
            </button>
            <button
              onClick={handleRejectAll}
              disabled={loading !== null}
              className="flex-1 py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {loading === "reject" ? "Rejecting all…" : `Reject all`}
            </button>
          </div>
        </div>
      )}

      {/* In-flight submission feedback (replaces the action card while we wait
          for the polled run state to leave waiting_approval). */}
      {submitted && (
        <div
          className={clsx(
            "rounded-lg border px-4 py-3 text-xs",
            submitted === "approve"
              ? "border-emerald-700/60 bg-emerald-950/20 text-emerald-300"
              : "border-red-700/60 bg-red-950/20 text-red-300",
          )}
        >
          {submitted === "approve" ? "Approving…" : "Rejecting…"}
        </div>
      )}

      {/* Status-based approval (no gates, but run is waiting) */}
      {gates.length === 0 && isWaitingApproval && !submitted && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-4 space-y-3">
          {interruptFields.length > 0 ? (
            <div className="space-y-2">
              {interruptFields.map(([key]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-slate-300 capitalize">{key}</label>
                  <div className="mt-1">
                    <MarkdownEditableField
                      value={corrections[key] ?? ""}
                      onChange={(v) => setCorrections((prev) => ({ ...prev, [key]: v }))}
                      textareaClassName="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200 resize-none focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              This workflow is paused and waiting for your approval to continue.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleApproveAll}
              disabled={loading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {loading === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              onClick={handleRejectAll}
              disabled={loading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              {loading === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
