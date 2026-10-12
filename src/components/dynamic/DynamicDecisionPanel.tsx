"use client";

/**
 * Review the decisions a dynamic run paused on.
 *
 * Every open decision is resolved by one approve/reject: the engine waits for
 * in-flight jobs before pausing, so whatever piled up meanwhile is decided in
 * one go. Corrections are kind-specific — an edited job list for a plan,
 * answers for an agent's questions, rewritten feedback for a handback, a
 * rewritten brief for a delegation.
 */

import React, { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Check, X, Loader2, Pencil } from "lucide-react";
import { approveWorkflowRun, rejectWorkflowRun } from "@/lib/api";
import type { DynamicDecision, DynamicRunState, WorkflowRun } from "@/lib/types";
import { CATEGORY_LABELS } from "./dynamicWorkflow";

const KIND_LABEL: Record<DynamicDecision["kind"], string> = {
  plan: "Job plan",
  handback: "Handback",
  delegate: "Delegation",
  escalation: "Escalation",
  question: "Agent question",
};

const KIND_HINT: Record<DynamicDecision["kind"], string> = {
  plan: "Approve to start these jobs. Reject with a reason to have the dispatcher re-plan.",
  handback: "Approve to send the work back with this feedback. Reject to accept the validator's result as is.",
  delegate: "Approve to start a helper job. Reject to tell the asking job to continue without help.",
  escalation: "A job used up its retries. Approve to grant one more round; reject to fail the run.",
  question: "Answer, then approve. Rejecting tells the agent to proceed on its own judgement.",
};

interface PlanJob {
  id: string;
  category: keyof typeof CATEGORY_LABELS;
  agent_id: string;
  title?: string;
  prompt: string;
  depends_on?: string[];
  owns?: string[];
}

function PlanTable({ jobs }: { jobs: PlanJob[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-500">
          <th className="font-medium pb-1 pr-2">Job</th>
          <th className="font-medium pb-1 pr-2">Category</th>
          <th className="font-medium pb-1 pr-2">Agent</th>
          <th className="font-medium pb-1">After</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="align-top border-t border-slate-800">
            <td className="py-1.5 pr-2">
              <div className="font-mono text-slate-200">{j.id}</div>
              <div className="text-slate-400 line-clamp-3" title={j.prompt}>{j.title || j.prompt}</div>
              {j.owns?.length ? <div className="font-mono text-[10px] text-slate-500">owns {j.owns.join(", ")}</div> : null}
            </td>
            <td className="py-1.5 pr-2 text-slate-300">{CATEGORY_LABELS[j.category] ?? j.category}</td>
            <td className="py-1.5 pr-2 font-mono text-slate-300">{j.agent_id}</td>
            <td className="py-1.5 font-mono text-slate-500">{j.depends_on?.join(", ") || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DynamicDecisionPanel({ run, state, onUpdate, onClose }: {
  run: WorkflowRun;
  state: DynamicRunState;
  onUpdate: (run: WorkflowRun) => void;
  onClose?: () => void;
}) {
  const open = useMemo(() => state.decisions.filter((d) => !d.resolved), [state.decisions]);
  const plan = open.find((d) => d.kind === "plan");
  const planJobs = (plan?.payload.jobs as PlanJob[] | undefined) ?? [];
  const questions = open.filter((d) => d.kind === "question").flatMap((d) => (d.payload.questions as string[] | undefined) ?? []);
  const handback = open.find((d) => d.kind === "handback");
  const delegate = open.find((d) => d.kind === "delegate");

  const [editingPlan, setEditingPlan] = useState(false);
  const [planText, setPlanText] = useState(() => JSON.stringify(planJobs, null, 2));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string>(String(handback?.payload.feedback ?? ""));
  const [prompt, setPrompt] = useState<string>(String(delegate?.payload.prompt ?? ""));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const planError = useMemo(() => {
    if (!editingPlan) return null;
    try {
      const v = JSON.parse(planText);
      return Array.isArray(v) ? null : "The plan must be a JSON array of jobs.";
    } catch (e) {
      return (e as Error).message;
    }
  }, [editingPlan, planText]);

  async function approve() {
    const corrections: Record<string, unknown> = {};
    if (plan && editingPlan) corrections.jobs = JSON.parse(planText);
    if (questions.length) corrections.answers = Object.fromEntries(questions.map((q) => [q, answers[q] ?? ""]).filter(([, a]) => a));
    if (handback && feedback !== String(handback.payload.feedback ?? "")) corrections.feedback = feedback;
    if (delegate && prompt !== String(delegate.payload.prompt ?? "")) corrections.prompt = prompt;
    setBusy("approve");
    setError(null);
    try {
      onUpdate(await approveWorkflowRun(run.id, Object.keys(corrections).length ? { corrections } : {}));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    try {
      onUpdate(await rejectWorkflowRun(run.id, { reason: reason || undefined }));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  if (open.length === 0) {
    return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">Nothing to decide.</div>;
  }

  return (
    <div className="rounded-xl border border-amber-700/60 bg-slate-900 shadow-xl" data-testid="dynamic-decision-panel">
      <div className="flex items-center px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold text-amber-100 flex-1">
          {open.length === 1 ? KIND_LABEL[open[0].kind] : `${open.length} decisions`} — {state.step_id}
        </span>
        {onClose && <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400" aria-label="Close"><X className="w-4 h-4" /></button>}
      </div>
      <div className="px-4 py-3 space-y-4 max-h-[70vh] overflow-y-auto">
        {open.length > 1 && (
          <p className="text-[11px] text-slate-400">One decision covers all of these: approve applies every one, reject rejects every one.</p>
        )}
        {open.map((d) => (
          <div key={d.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={clsx("text-[10px] px-1.5 py-px rounded border", d.kind === "escalation" ? "border-red-700 text-red-300" : "border-amber-700 text-amber-200")}>
                {KIND_LABEL[d.kind]}
              </span>
              <span className="text-xs text-slate-200">{d.summary}</span>
            </div>
            <p className="text-[11px] text-slate-500">{KIND_HINT[d.kind]}</p>

            {d.kind === "plan" && (
              <div className="space-y-2">
                {!!d.payload.summary && <p className="text-xs text-slate-300 whitespace-pre-wrap">{String(d.payload.summary)}</p>}
                {editingPlan ? (
                  <>
                    <textarea
                      aria-label="Edit plan JSON"
                      className="w-full min-h-[260px] font-mono text-[11px] bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                      value={planText}
                      onChange={(e) => setPlanText(e.target.value)}
                    />
                    {planError && <p className="text-[11px] text-red-400">{planError}</p>}
                  </>
                ) : (
                  <PlanTable jobs={(d.payload.jobs as PlanJob[] | undefined) ?? []} />
                )}
                <button onClick={() => setEditingPlan((v) => !v)} className="flex items-center gap-1 text-[11px] text-violet-300 hover:underline">
                  <Pencil className="w-3 h-3" />{editingPlan ? "Back to table (discard edits)" : "Edit jobs"}
                </button>
              </div>
            )}

            {d.kind === "question" && ((d.payload.questions as string[] | undefined) ?? []).map((q) => (
              <div key={q}>
                <p className="text-xs text-sky-200 mb-1">{q}</p>
                <input
                  aria-label={`Answer: ${q}`}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  value={answers[q] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))}
                />
              </div>
            ))}

            {d.kind === "handback" && d.id === handback?.id && (
              <textarea
                aria-label="Handback feedback"
                className="w-full min-h-[90px] text-xs bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            )}

            {d.kind === "delegate" && d.id === delegate?.id && (
              <div>
                <p className="text-[11px] text-slate-400 mb-1">
                  <span className="font-mono">{String(d.payload.job_id)}</span> asks <span className="font-mono">{String(d.payload.agent_id)}</span>:
                  {" "}{String(d.payload.request ?? "")}
                </p>
                <textarea
                  aria-label="Delegate brief"
                  className="w-full min-h-[80px] text-xs bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            )}

            {d.kind === "escalation" && !!d.payload.error && (
              <pre className="text-[11px] text-red-300 whitespace-pre-wrap bg-red-950/30 rounded p-2">{String(d.payload.error)}</pre>
            )}
          </div>
        ))}

        <div>
          <p className="text-[10px] uppercase text-slate-500 mb-1">Reason (sent with a rejection)</p>
          <textarea
            aria-label="Reason"
            className="w-full min-h-[50px] text-xs bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={plan ? "e.g. Split the API work from the UI work" : ""}
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-800">
        <button
          onClick={reject}
          disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-700 text-red-200 text-xs hover:bg-red-900/40 disabled:opacity-50"
        >
          {busy === "reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}Reject
        </button>
        <button
          onClick={approve}
          disabled={!!busy || !!planError}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
        >
          {busy === "approve" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}Approve
        </button>
      </div>
    </div>
  );
}
