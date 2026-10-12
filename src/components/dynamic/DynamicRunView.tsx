"use client";

/**
 * The agent DAG of a running dynamic workflow.
 *
 * The designer only shows configuration; this is where the graph the
 * dispatcher actually built is visible — every job, the agent filling it, its
 * attempts, handbacks (validator → producer loops), delegations (a job asking
 * another agent for help) and the live state of each attempt's child run.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { clsx } from "clsx";
import { Bot, MessageCircleQuestion, RotateCcw, X, Send, Loader2, ShieldCheck, ListChecks } from "lucide-react";
import type {
  DynamicJob,
  DynamicJobRunSummary,
  DynamicRunState,
  JobCategory,
  WorkflowRun,
} from "@/lib/types";
import { agentReply } from "@/lib/api";
import { ValueView } from "../ValueView";
import { CATEGORY_LABELS } from "./dynamicWorkflow";
import { layoutDag, latestChildRunId } from "./dagLayout";
import { DynamicDecisionPanel } from "./DynamicDecisionPanel";

const CATEGORY_CLS: Record<JobCategory, string> = {
  planning: "text-sky-300 border-sky-700/60 bg-sky-950/40",
  execution: "text-violet-300 border-violet-700/60 bg-violet-950/40",
  validation: "text-emerald-300 border-emerald-700/60 bg-emerald-950/40",
  integration: "text-amber-300 border-amber-700/60 bg-amber-950/40",
};

const STATUS_CLS: Record<string, string> = {
  pending: "border-slate-700",
  running: "border-violet-500 shadow-[0_0_0_2px_rgba(139,92,246,0.25)]",
  finished: "border-emerald-600",
  failed: "border-red-600",
  waiting: "border-amber-500",
  skipped: "border-slate-700 opacity-60",
  cancelled: "border-slate-700 opacity-60",
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-slate-500",
  running: "bg-violet-400 animate-pulse",
  finished: "bg-emerald-400",
  failed: "bg-red-400",
  waiting: "bg-amber-400",
  skipped: "bg-slate-600",
  cancelled: "bg-slate-600",
};

interface JobNodeData extends Record<string, unknown> {
  job: DynamicJob;
  live?: DynamicJobRunSummary;
  selected: boolean;
}

function JobNode({ data }: NodeProps<Node<JobNodeData>>) {
  const { job, live, selected } = data;
  const handbacks = job.attempts.filter((a) => a.reason === "handback").length;
  const lastLine = live?.progress?.[live.progress.length - 1];
  return (
    <div
      className={clsx(
        "w-[250px] rounded-xl border-2 bg-slate-900 px-3 py-2 text-left cursor-pointer",
        STATUS_CLS[job.status] ?? "border-slate-700",
        selected && "ring-2 ring-white/40",
      )}
      data-testid={`job-node-${job.id}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-600 !w-2 !h-2" />
      <div className="flex items-center gap-1.5">
        <span className={clsx("w-2 h-2 rounded-full flex-shrink-0", STATUS_DOT[job.status])} />
        <span className="text-xs font-semibold text-slate-100 truncate flex-1">{job.title || job.id}</span>
        <span className={clsx("text-[9px] px-1.5 py-px rounded border", CATEGORY_CLS[job.category])}>{CATEGORY_LABELS[job.category]}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400">
        <Bot className="w-3 h-3 text-violet-400" />
        <span className="font-mono truncate">{job.agent_id}</span>
        <span className="flex-1" />
        {job.attempts.length > 1 && (
          <span className="flex items-center gap-0.5" title={`${job.attempts.length} attempts${handbacks ? `, ${handbacks} handback(s)` : ""}`}>
            <RotateCcw className="w-3 h-3" />×{job.attempts.length}
          </span>
        )}
        {live?.pending_question && (
          <span title="Agent asks a question"><MessageCircleQuestion className="w-3.5 h-3.5 text-sky-400" /></span>
        )}
      </div>
      {job.status === "running" && lastLine && (
        <p className="mt-1 text-[10px] text-slate-500 truncate" title={lastLine}>{lastLine}</p>
      )}
      {job.owns.length > 0 && (
        <p className="mt-1 text-[10px] font-mono text-slate-500 truncate" title={job.owns.join(", ")}>owns: {job.owns.join(", ")}</p>
      )}
      <Handle type="source" position={Position.Right} className="!bg-slate-600 !w-2 !h-2" />
    </div>
  );
}

const NODE_TYPES = { job: JobNode };

function edgeStyle(kind: string, active: boolean) {
  if (kind === "handback") return { stroke: "#f87171", strokeDasharray: "6 4", strokeWidth: 1.5 };
  if (kind === "delegate") return { stroke: "#38bdf8", strokeDasharray: "4 4", strokeWidth: 1.5 };
  return { stroke: active ? "#a78bfa" : "#475569", strokeWidth: 1.5 };
}

function DagCanvas({ state, liveByJob, selectedJob, onSelect }: {
  state: DynamicRunState;
  liveByJob: Record<string, DynamicJobRunSummary | undefined>;
  selectedJob: string | null;
  onSelect: (id: string | null) => void;
}) {
  const layout = useMemo(() => layoutDag(state), [state]);
  const nodes: Node<JobNodeData>[] = useMemo(
    () => state.jobs.map((job) => ({
      id: job.id,
      type: "job",
      position: layout.positions[job.id],
      data: { job, live: liveByJob[job.id], selected: job.id === selectedJob },
      draggable: false,
    })),
    [state.jobs, layout, liveByJob, selectedJob],
  );
  const edges: Edge[] = useMemo(
    () => layout.edges.map((e) => {
      const target = state.jobs.find((j) => j.id === e.target);
      const active = e.kind === "depends" && target?.status === "running";
      const color = edgeStyle(e.kind, active).stroke;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: active,
        style: edgeStyle(e.kind, active),
        markerEnd: { type: MarkerType.ArrowClosed, color },
        label: e.kind === "handback" ? `handback ×${e.count}` : e.kind === "delegate" ? "delegate" : undefined,
        labelStyle: { fill: color, fontSize: 10 },
        labelBgStyle: { fill: "#0f172a" },
        // Loops drawn backwards read better as curves.
        type: e.kind === "depends" ? "smoothstep" : "default",
      } satisfies Edge;
    }),
    [layout.edges, state.jobs],
  );

  const { fitView } = useReactFlow();
  const jobCount = state.jobs.length;
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50);
    return () => clearTimeout(t);
  }, [jobCount, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      nodesConnectable={false}
      fitView
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1e293b" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function AttemptRow({ n, attempt }: { n: number; attempt: DynamicJob["attempts"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <span className={clsx("w-2 h-2 rounded-full", STATUS_DOT[attempt.status === "needs_input" ? "waiting" : attempt.status] ?? "bg-slate-500")} />
        <span className="text-xs text-slate-200">Attempt {n}</span>
        <span className="text-[10px] text-slate-500">{attempt.reason.replace(/_/g, " ")}</span>
        <span className="flex-1" />
        <span className="text-[10px] text-slate-500">{attempt.status}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {attempt.feedback && (
            <div>
              <p className="text-[10px] uppercase text-slate-500 mb-0.5">Feedback given</p>
              <p className="text-slate-300 whitespace-pre-wrap">{attempt.feedback}</p>
            </div>
          )}
          {attempt.error && <p className="text-red-300 whitespace-pre-wrap">{attempt.error}</p>}
          {attempt.output && <ValueView value={attempt.output} />}
          {attempt.child_run_id && <p className="text-[10px] font-mono text-slate-600">run {attempt.child_run_id}</p>}
        </div>
      )}
    </div>
  );
}

function QuestionReply({ childRunId, question }: { childRunId: string; question: { question: string; options?: string[] | null } }) {
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(text: string) {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await agentReply(childRunId, text);
      setSent(true);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSending(false);
    }
  }
  if (sent) return <p className="text-xs text-emerald-300">Answer sent.</p>;
  return (
    <div className="rounded-lg border border-sky-800 bg-sky-950/30 p-2.5 space-y-2">
      <p className="text-xs text-sky-200 flex items-start gap-1.5"><MessageCircleQuestion className="w-3.5 h-3.5 mt-px flex-shrink-0" />{question.question}</p>
      {question.options?.length ? (
        <div className="flex flex-wrap gap-1">
          {question.options.map((o) => (
            <button key={o} disabled={sending} onClick={() => send(o)} className="text-[11px] px-2 py-0.5 rounded border border-sky-700 text-sky-200 hover:bg-sky-900/50">{o}</button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1.5">
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(answer); }}
          placeholder="Answer…"
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
        />
        <button disabled={sending || !answer.trim()} onClick={() => send(answer)} className="px-2 rounded bg-sky-700 text-white disabled:opacity-50">
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

function JobDetail({ job, live, onClose }: { job: DynamicJob; live?: DynamicJobRunSummary; onClose: () => void }) {
  const childId = latestChildRunId(job);
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <span className={clsx("w-2 h-2 rounded-full", STATUS_DOT[job.status])} />
        <span className="text-sm font-semibold text-slate-100 truncate flex-1">{job.title || job.id}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400" aria-label="Close job details"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs">
        <div className="flex flex-wrap gap-1.5">
          <span className={clsx("text-[10px] px-1.5 py-px rounded border", CATEGORY_CLS[job.category])}>{CATEGORY_LABELS[job.category]}</span>
          <span className="text-[10px] px-1.5 py-px rounded border border-slate-700 text-slate-300 font-mono">{job.agent_id}</span>
          <span className="text-[10px] px-1.5 py-px rounded border border-slate-700 text-slate-400">{job.status}</span>
          <span className="text-[10px] px-1.5 py-px rounded border border-slate-700 text-slate-500">by {job.created_by}</span>
          {job.delegated_by && <span className="text-[10px] px-1.5 py-px rounded border border-sky-800 text-sky-300">helps {job.delegated_by}</span>}
        </div>
        {live?.pending_question && childId && <QuestionReply childRunId={childId} question={live.pending_question} />}
        <div>
          <p className="text-[10px] uppercase text-slate-500 mb-0.5">Brief</p>
          <p className="text-slate-300 whitespace-pre-wrap">{job.prompt}</p>
        </div>
        {job.owns.length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-slate-500 mb-0.5">Owns</p>
            <p className="font-mono text-slate-300">{job.owns.join(", ")}</p>
          </div>
        )}
        {job.depends_on.length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-slate-500 mb-0.5">Depends on</p>
            <p className="font-mono text-slate-300">{job.depends_on.join(", ")}</p>
          </div>
        )}
        {live && live.progress.length > 0 && job.status === "running" && (
          <div>
            <p className="text-[10px] uppercase text-slate-500 mb-0.5">Live</p>
            <ul className="space-y-0.5 text-slate-400">
              {live.progress.map((p, i) => <li key={i} className="truncate" title={p}>{p}</li>)}
            </ul>
          </div>
        )}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase text-slate-500">Attempts</p>
          {job.attempts.length === 0 && <p className="text-slate-500">Not started.</p>}
          {job.attempts.map((a, i) => <AttemptRow key={i} n={a.n} attempt={a} />)}
        </div>
      </div>
    </div>
  );
}

function StepDag({ run, state, onUpdate }: { run: WorkflowRun; state: DynamicRunState; onUpdate: (r: WorkflowRun) => void }) {
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const [showDecision, setShowDecision] = useState(false);

  // Live child-run info keyed by job id (latest attempt).
  const liveByJob = useMemo(() => {
    const out: Record<string, DynamicJobRunSummary | undefined> = {};
    for (const job of state.jobs) {
      const child = latestChildRunId(job);
      if (child) out[job.id] = run.dynamic_jobs?.[child];
    }
    return out;
  }, [state.jobs, run.dynamic_jobs]);

  const open = state.decisions.filter((d) => !d.resolved);
  const job = selectedJob ? state.jobs.find((j) => j.id === selectedJob) : undefined;
  const counts = state.jobs.reduce<Record<string, number>>((acc, j) => ({ ...acc, [j.status]: (acc[j.status] ?? 0) + 1 }), {});

  return (
    <div className="relative h-full flex">
      <div className="flex-1 relative min-w-0">
        <div className="absolute top-2 left-3 right-3 z-10 flex items-center gap-2 pointer-events-none">
          <span className="pointer-events-auto text-[11px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-900/90 text-slate-300">
            {state.step_id}: <span className="font-semibold">{state.status.replace("_", " ")}</span>
          </span>
          <span className="pointer-events-auto text-[11px] text-slate-500">
            {state.jobs.length} jobs
            {Object.entries(counts).map(([k, v]) => ` · ${v} ${k}`).join("")}
            {state.usage?.total_tokens ? ` · dispatcher ${Math.round(state.usage.total_tokens / 1000)}k tok` : ""}
          </span>
          <span className="flex-1" />
          <button onClick={() => setShowEvents((v) => !v)} className="pointer-events-auto flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800">
            <ListChecks className="w-3.5 h-3.5" />Timeline
          </button>
          {open.length > 0 && (
            <button onClick={() => setShowDecision(true)} className="pointer-events-auto flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-amber-600 bg-amber-900/60 text-amber-100 hover:bg-amber-800/70">
              <ShieldCheck className="w-3.5 h-3.5" />{open.length} decision{open.length > 1 ? "s" : ""} to review
            </button>
          )}
        </div>

        {state.jobs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-500 gap-2">
            {state.status === "planning" && <Loader2 className="w-4 h-4 animate-spin" />}
            {state.status === "planning" ? "The dispatcher is planning…" : open.length ? "The plan is waiting for review." : "No jobs."}
          </div>
        ) : (
          <ReactFlowProvider>
            <DagCanvas state={state} liveByJob={liveByJob} selectedJob={selectedJob} onSelect={setSelectedJob} />
          </ReactFlowProvider>
        )}

        {state.error && (
          <div className="absolute bottom-3 left-3 max-w-lg z-10 rounded-lg border border-red-800 bg-red-950/80 px-3 py-2 text-xs text-red-200">{state.error}</div>
        )}
        {state.status === "completed" && state.summary && (
          <details className="absolute bottom-3 left-3 max-w-xl z-10 rounded-lg border border-emerald-800 bg-slate-950/90 px-3 py-2 text-xs text-slate-300">
            <summary className="cursor-pointer text-emerald-300">Summary</summary>
            <pre className="whitespace-pre-wrap mt-1">{state.summary}</pre>
          </details>
        )}
      </div>

      {(job || showEvents) && (
        <aside className="w-[360px] flex-shrink-0 border-l border-slate-800 bg-slate-950">
          {job ? (
            <JobDetail job={job} live={liveByJob[job.id]} onClose={() => setSelectedJob(null)} />
          ) : (
            <div className="h-full flex flex-col">
              <div className="flex items-center px-4 py-3 border-b border-slate-800">
                <span className="text-sm font-semibold text-slate-100 flex-1">Timeline</span>
                <button onClick={() => setShowEvents(false)} className="p-1 rounded hover:bg-slate-800 text-slate-400" aria-label="Close timeline"><X className="w-4 h-4" /></button>
              </div>
              <ol className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5 text-[11px]">
                {[...state.events].reverse().map((e, i) => (
                  <li key={i} className="text-slate-400">
                    <span className="text-slate-600 font-mono">{new Date(e.ts).toLocaleTimeString()}</span>{" "}
                    <span className="text-slate-300">{e.kind}</span>
                    {e.job_id && <button className="ml-1 font-mono text-violet-300 hover:underline" onClick={() => setSelectedJob(e.job_id!)}>{e.job_id}</button>}
                    {e.detail && <span className="block text-slate-500 truncate" title={e.detail}>{e.detail}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      )}

      {showDecision && open.length > 0 && (
        <div className="absolute inset-0 z-20 bg-slate-950/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto" onClick={() => setShowDecision(false)}>
          <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <DynamicDecisionPanel run={run} state={state} onUpdate={(r) => { onUpdate(r); setShowDecision(false); }} onClose={() => setShowDecision(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function hasDynamicDag(run: Pick<WorkflowRun, "dynamic">): boolean {
  return !!run.dynamic && Object.keys(run.dynamic).length > 0;
}

/** Every dynamic step of the run; tabs when a workflow has more than one. */
export function DynamicRunView({ run, onUpdate }: { run: WorkflowRun; onUpdate: (r: WorkflowRun) => void }) {
  const states = Object.values(run.dynamic ?? {});
  const [active, setActive] = useState(0);
  if (states.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-slate-500">The orchestrator has not started yet.</div>;
  }
  const current = states[Math.min(active, states.length - 1)];
  return (
    <div className="h-full flex flex-col">
      {states.length > 1 && (
        <div className="flex gap-1 px-3 pt-2">
          {states.map((s, i) => (
            <button key={s.step_id} onClick={() => setActive(i)} className={clsx("text-xs px-2 py-1 rounded", i === active ? "bg-slate-800 text-white" : "text-slate-400")}>{s.step_id}</button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <StepDag run={run} state={current} onUpdate={onUpdate} />
      </div>
    </div>
  );
}
