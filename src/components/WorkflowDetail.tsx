"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  RefreshCw,
  Clock,
  AlertTriangle,
  GitBranch,
  ExternalLink,
  MessageSquare,
  Wrench,
  X,
  RotateCcw,
  Square,
  Hourglass,
  Activity,
  Download,
} from "lucide-react";
import { clsx } from "clsx";
import { apiWorkflowToEditable } from "./WorkflowEditor";
import { WorkflowRunCanvas } from "./workflow-canvas/WorkflowRunCanvas";
import { DynamicRunView, hasDynamicDag } from "./dynamic/DynamicRunView";
import { DynamicDecisionPanel } from "./dynamic/DynamicDecisionPanel";
import { isDynamicWorkflow } from "./dynamic/dynamicWorkflow";
import type { EditableNodeConfig, EditableWorkflowDefinition } from "@/lib/types";
import { ApprovalPanel } from "./ApprovalPanel";
import { StatusBadge } from "./StatusBadge";
import { TracePanel } from "./TracePanel";
import { RunDataPanel } from "./RunDataPanel";
import { StoredOutputRef } from "./StoredOutputRef";
import { isOutputRef } from "@/lib/outputRef";
import { CombinedPartsList } from "./workflow-canvas/nodes/CombinedPartsList";
import { effectiveStatus } from "@/lib/types";
import { MarkdownView } from "./Markdown";
import { retryWorkflowRun, restartFromStep, agentReply, getWorkflowDefinition, terminateWorkflowRun, listS3AddonFiles, getS3SignedUrl } from "@/lib/api";
import type { S3FileEntry } from "@/lib/api";
import { useRunTrace } from "@/hooks/useRunTrace";
import type { WorkflowRun } from "@/lib/types";
import { formatWaitDuration as formatWait } from "./workflow-canvas/utils/formatWait";
import { formatTokensK } from "@/lib/formatTokens";

interface Props {
  run: WorkflowRun;
  onUpdate: (run: WorkflowRun) => void;
  onRefresh: () => void;
}

function Section({
  title,
  icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors rounded-xl"
      >
        <span className="text-slate-400">{icon}</span>
        <span className="text-sm font-semibold text-slate-200 flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-xs text-slate-500 px-1.5 py-0.5 bg-slate-800 rounded">
            {count}
          </span>
        )}
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="text-xs text-slate-600 italic">{label}</p>;
}

// ─── Waiting-transition banner ────────────────────────────────────────────────

function WaitingTransitionBanner({
  waiting,
}: {
  waiting: NonNullable<WorkflowRun["waiting_transition"]>;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const startedMs = Date.parse(waiting.started_at);
  const remaining = Number.isNaN(startedMs)
    ? waiting.wait_seconds
    : Math.max(0, waiting.wait_seconds - (nowMs - startedMs) / 1000);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-700/50 bg-amber-900/20 px-4 py-2 text-sm text-amber-200">
      <Hourglass className="w-4 h-4 animate-pulse" />
      <span>
        Waiting <span className="font-semibold tabular-nums">{formatWait(remaining)}</span>{" "}
        before transitioning <span className="font-mono text-xs">{waiting.source}</span> →{" "}
        <span className="font-mono text-xs">{waiting.target}</span>
      </span>
    </div>
  );
}

// ─── Step detail panel ────────────────────────────────────────────────────────

const STEP_TYPE_LABELS: Record<string, string> = {
  llm: "LLM",
  fetch: "Fetch",
  approval: "Approval",
  execute: "Execute",
  workflow: "Workflow",
  plan: "Plan",
  action: "Action",
  http: "HTTP Trigger",
  cron: "Cron Trigger",
  result: "Result",
};

/** Best-effort: return the subset of intermediate_outputs that this step wrote. */
function getStepOutput(
  stepId: string,
  outputs: Record<string, unknown>,
): { key: string; value: unknown }[] | null {
  // 1. Direct key match (e.g. step "plan" → outputs["plan"])
  if (stepId in outputs) return [{ key: stepId, value: outputs[stepId] }];

  // 2. Common suffixed variants
  const suffixes = ["_result", "_output", "_context", "_data", "_summary"];
  for (const suffix of suffixes) {
    const k = `${stepId}${suffix}`;
    if (k in outputs) return [{ key: k, value: outputs[k] }];
  }

  // 3. Prefix match — step "fetch_jira" → outputs["jira_context"]
  const prefix = stepId.replace(/^(fetch_|resolve_|analyze_|deliver_)/, "");
  const prefixMatches = Object.entries(outputs).filter(([k]) =>
    k.startsWith(prefix) && k !== "request" && k !== "approved" && k !== "reject_reason",
  );
  if (prefixMatches.length > 0) return prefixMatches.map(([k, v]) => ({ key: k, value: v }));

  return null;
}

function LiveProgressView({ progress, title = "Full context" }: { progress: string[]; title?: string }) {
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [progress, autoScroll]);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-0.5">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[9px] text-slate-600 uppercase font-medium">{title}</p>
        <button
          onClick={() => setAutoScroll(v => !v)}
          title={autoScroll ? "Disable autoscroll" : "Enable autoscroll"}
          className={clsx(
            "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
            autoScroll
              ? "text-sky-400 bg-sky-900/30 hover:bg-sky-900/50"
              : "text-slate-600 hover:text-slate-400"
          )}
        >
          <ChevronsDown className="w-3 h-3" />
          {autoScroll ? "auto" : "manual"}
        </button>
      </div>
      <div ref={containerRef} className="max-h-48 overflow-y-auto space-y-0.5">
        {progress.map((msg, i) => (
          <p key={i} className="text-[10px] text-slate-400 font-mono leading-relaxed whitespace-pre-wrap break-words">{msg}</p>
        ))}
      </div>
    </div>
  );
}

function StepDetail({
  run,
  stepId,
  onClose,
  onUpdate,
  traceResponse,
  definition,
}: {
  run: WorkflowRun;
  stepId: string;
  /** The step as the workflow defines it, when the definition loaded. */
  definition?: EditableNodeConfig;
  onClose: () => void;
  onUpdate?: (run: WorkflowRun) => void;
  traceResponse?: ReturnType<typeof useRunTrace>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  async function handleRestart() {
    setShowRestartConfirm(false);
    setRestarting(true);
    try {
      const updated = await restartFromStep(run.id, stepId);
      onUpdate?.(updated);
      onClose();
    } finally {
      setRestarting(false);
    }
  }
  const step = run.steps?.find((s) => s.id === stepId);
  if (!step) return null;

  // Use the per-step output stored by the backend during streaming.
  // Fall back to the heuristic lookup for runs created before this was added.
  // Strip internal sentinel keys (__ prefix) and bookkeeping-only keys.
  // _meta_llm_rejection → shown in the amber verdict box below.
  // error               → shown via stepError.
  const _HIDDEN_OUTPUT_KEYS = new Set(["_meta_llm_rejection", "_meta_llm_result", "error"]);
  const directOutput = step.output && Object.keys(step.output).filter(k => !k.startsWith("__") && !_HIDDEN_OUTPUT_KEYS.has(k)).length > 0
    ? Object.entries(step.output).filter(([k]) => !k.startsWith("__") && !_HIDDEN_OUTPUT_KEYS.has(k))
    : null;
  const fallbackOutput = !directOutput
    ? getStepOutput(stepId, run.intermediate_outputs ?? {})
    : null;
  const stepOutputEntries = directOutput ?? (fallbackOutput?.map(({ key, value }) => [key, value]) ?? null);

  // Entries to show when "show all" is toggled (exclude boring fields)
  const allEntries = Object.entries(run.intermediate_outputs ?? {}).filter(
    ([k, v]) => v !== null && v !== "" && !["metadata"].includes(k),
  );

  // Meta-LLM rejection verdict — present when quality gate rejected the output
  const metaLLMRejection = (step.output as Record<string, unknown> | undefined)?._meta_llm_rejection as string | undefined;
  // Full meta-LLM evaluation result — present on every agent step (pass or fail)
  const metaLLMResult = (step.output as Record<string, unknown> | undefined)?._meta_llm_result as { passed: boolean; reason: string } | undefined;

  // Error to show for failed steps: prefer per-step error, fall back to run-level.
  // When the failure came from a meta-LLM rejection, the backend's error string
  // is identical to the rejection reason already rendered in the quality-gate
  // box below — skip the generic Error box entirely to avoid showing the same
  // text twice.
  const isMetaLLMFailure = !!metaLLMRejection || (!!metaLLMResult && !metaLLMResult.passed);
  const stepError = step.status === "failed" && !isMetaLLMFailure
    ? (step.error ?? (run.intermediate_outputs as Record<string, unknown>)?.error as string | undefined ?? null)
    : null;
  // Full agent output — every tool invocation and turn of text the spawned
  // k8s agent produced (jira/github MCP calls, results, final answer), not
  // just a truncated final snippet. Same field the live view polls while running.
  const agentProgress = step.type === "agent"
    ? (run.intermediate_outputs as Record<string, unknown> | undefined)?.[`_agent_progress_${step.id}`] as string[] | undefined
    : undefined;

  const renderValue = (value: unknown) => {
    if (isOutputRef(value)) {
      return <StoredOutputRef value={value} />;
    }
    if (typeof value === "string") {
      return <MarkdownView text={value} />;
    }
    return (
      <pre className="text-xs text-slate-200 whitespace-pre-wrap break-words bg-slate-800/60 rounded-lg px-3 py-2 max-h-64 overflow-y-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/80">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold text-slate-200 flex-1">
          {step.name ?? step.id}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono uppercase">
          {STEP_TYPE_LABELS[step.type] ?? step.type}
        </span>
        {step.type === "agent" && (() => {
          const io = run.intermediate_outputs as Record<string, unknown> | undefined;
          const usage = io?.[`_agent_token_usage_${step.id}`] as { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined;
          if (!usage?.total_tokens) return null;
          const metaUsage = io?.[`_meta_token_usage_${step.id}`] as { total_tokens?: number } | undefined;
          return (
            <span className="text-[10px] text-slate-500 font-mono ml-1">
              {formatTokensK(usage.total_tokens)}
              {metaUsage?.total_tokens ? `; ${formatTokensK(metaUsage.total_tokens)}` : ""}
              {" tok"}
            </span>
          );
        })()}
        {step.status && (
          <span
            className={clsx(
              "text-[10px] px-1.5 py-0.5 rounded font-medium",
              step.status === "finished" && "bg-emerald-900/50 text-emerald-300",
              step.status === "failed"   && "bg-red-900/50 text-red-300",
              step.status === "skipped"  && "bg-slate-800 text-slate-500",
              step.status === "running"  && "bg-sky-900/50 text-sky-300",
              step.status === "pending"  && "bg-slate-800 text-slate-500",
            )}
          >
            {step.status}
          </span>
        )}
        <button
          onClick={() => setShowRestartConfirm(true)}
          disabled={restarting}
          className="flex items-center gap-1 px-2 py-1 text-xs text-orange-600 border border-orange-300 rounded hover:bg-orange-50 disabled:opacity-50"
        >
          ↺ Restart from here
        </button>
        <button
          onClick={onClose}
          className="ml-1 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Restart confirmation */}
        {showRestartConfirm && (
          <div className="flex items-center gap-2 mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <span className="text-sm text-yellow-800 flex-1">
              Restart from this step? All results from this step onwards will be cleared.
            </span>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="px-3 py-1 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
            >
              {restarting ? 'Restarting…' : 'Confirm'}
            </button>
            <button
              onClick={() => setShowRestartConfirm(false)}
              className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}
        {step.status === "running" && (() => {
          const progress = (run.intermediate_outputs as Record<string, unknown>)?.[`_agent_progress_${step.id}`] as string[] | undefined;
          const liveTokens = (run.intermediate_outputs as Record<string, unknown>)?.[`_live_token_usage_${step.id}`] as { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined;
          if (!progress?.length && !liveTokens) return null;
          return (
            <div className="space-y-2 mb-4">
              {liveTokens && (
                <div className="flex gap-3 text-[10px] font-mono text-slate-400 bg-slate-800/60 rounded px-3 py-1.5">
                  <span>in: {liveTokens.input_tokens?.toLocaleString() ?? 0}</span>
                  <span>out: {liveTokens.output_tokens?.toLocaleString() ?? 0}</span>
                  <span className="text-slate-300 font-semibold">total: {liveTokens.total_tokens?.toLocaleString() ?? 0}</span>
                </div>
              )}
              {progress && progress.length > 0 && (
                <LiveProgressView progress={progress} />
              )}
            </div>
          );
        })()}
        {stepError && (
          <div className="rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2.5">
            <p className="text-[10px] text-red-400 uppercase font-semibold tracking-wide mb-1">Error</p>
            <pre className="text-xs text-red-300 whitespace-pre-wrap break-words font-mono">
              {stepError}
            </pre>
          </div>
        )}

        {/* Quality gate verdict — shown whenever meta-LLM ran (pass or fail) */}
        {metaLLMResult && (
          <div className={`rounded-lg border px-3 py-2 space-y-1 ${metaLLMResult.passed ? "border-emerald-800/50 bg-emerald-950/30" : "border-amber-800/50 bg-amber-950/30"}`}>
            <p className={`text-[10px] uppercase font-semibold tracking-wide ${metaLLMResult.passed ? "text-emerald-400" : "text-amber-400"}`}>
              Quality gate — {metaLLMResult.passed ? "passed ✓" : "rejected ✗"}
            </p>
            <pre className={`text-xs whitespace-pre-wrap break-words font-mono ${metaLLMResult.passed ? "text-emerald-300" : "text-amber-300"}`}>{metaLLMResult.reason}</pre>
          </div>
        )}
        {/* Legacy rejection field (before _meta_llm_result was added) */}
        {!metaLLMResult && metaLLMRejection && (
          <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 space-y-1">
            <p className="text-[10px] text-amber-400 uppercase font-semibold tracking-wide">Quality gate — rejected</p>
            <pre className="text-xs text-amber-300 whitespace-pre-wrap break-words font-mono">{metaLLMRejection}</pre>
          </div>
        )}

        {step.status !== "running" && agentProgress && agentProgress.length > 0 && (
          <LiveProgressView progress={agentProgress} title="Full context" />
        )}

        {(step.parts?.length || definition?.type === "combined_datasource") && (
          <div className="space-y-1" data-testid="step-detail-parts">
            <p className="text-[10px] text-slate-500 uppercase font-medium tracking-wide">Parts</p>
            <CombinedPartsList
              parts={definition?.parts}
              output={definition?.output_part}
              runParts={step.parts}
              runOutputPart={step.output_part}
              showErrors
            />
          </div>
        )}

        {stepOutputEntries ? (
          <>
            <p className="text-[10px] text-slate-500 uppercase font-medium tracking-wide">
              {metaLLMRejection ? "Agent output (before rejection)" : "Output"}
            </p>
            {stepOutputEntries.map(([key, value]) => {
              const displayKey = (key as string).startsWith("_mcp_output_") ? "Tool output" : (key as string);
              const showKey = stepOutputEntries.length > 1 || (key as string).startsWith("_mcp_output_");
              return (
                <div key={key as string}>
                  {showKey && (
                    <p className="text-[10px] text-slate-500 font-mono mb-1">{displayKey}</p>
                  )}
                  {renderValue(value)}
                </div>
              );
            })}
          </>
        ) : (
          <p className="text-xs text-slate-500 italic">
            {step.status === "pending" || step.status === "running"
              ? "Step has not produced output yet."
              : "No output recorded for this step."}
          </p>
        )}

        {/* Full context toggle */}
        {allEntries.length > 0 && (
          <div>
            <button
              onClick={() => setShowAll((v) => !v)}
              className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1"
            >
              {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showAll ? "Hide" : "Show"} full context ({allEntries.length} fields)
            </button>
            {showAll && (
              <div className="mt-2 space-y-2">
                {allEntries.map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[10px] text-slate-500 font-mono mb-0.5">{k}</p>
                    {renderValue(v)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Trace panel — shown for LLM/agent steps while active or after completion */}
        {traceResponse &&
          (step.type === "llm" || step.type === "action") && (
            <div className="border-t border-slate-800 pt-3">
              <TracePanel
                trace={traceResponse}
                live={step.status === "running" || step.status === "pending"}
              />
            </div>
          )}

        {/* Embedded approval / clarification when this is the active waiting step */}
        {run.current_step === stepId && (effectiveStatus(run) === "waiting_approval" || effectiveStatus(run) === "asking_context") && (
          <div className="border-t border-slate-700 pt-3 mt-3">
            <ApprovalPanel run={run} onUpdate={(r) => onUpdate?.(r)} />
          </div>
        )}

        {/* Embedded agent clarification when this is the active waiting agent step */}
        {run.current_step === stepId && run.status === "waiting_agent" && run.pending_question && (
          <div className="border-t border-slate-700 pt-3 mt-3">
            <AgentQuestionCard run={run} onUpdate={(r) => onUpdate?.(r)} />
          </div>
        )}
      </div>
    </div>
  );
}

function AgentQuestionCard({ run, onUpdate }: { run: WorkflowRun; onUpdate: (r: WorkflowRun) => void }) {
  const q = run.pending_question;
  if (!q) return null;
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(value: string) {
    setLoading(true);
    try {
      await agentReply(run.id, value);
      onUpdate({ ...run, pending_question: null });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-sky-700/60 bg-sky-950/30 px-4 py-4 space-y-3">
      <h3 className="text-sm font-semibold text-sky-300 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
        Agent needs clarification
      </h3>
      <p className="text-xs text-slate-300">{q.question}</p>
      {q.options && q.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {q.options.map((opt) => (
            <button key={opt} onClick={() => submit(opt)} disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-medium transition-colors disabled:opacity-50">
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-2">
          <input type="text" value={answer} onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && answer.trim() && submit(answer.trim())}
            placeholder="Type your answer…"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500" />
          <button onClick={() => submit(answer.trim())} disabled={loading || !answer.trim()}
            className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-medium disabled:opacity-50">
            Send
          </button>
        </div>
      )}
    </div>
  );
}

// ─── S3 File Browser Modal ────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function S3FileBrowserModal({
  agentId,
  runId,
  bucket,
  path,
  onClose,
}: {
  agentId: string;
  runId: string;
  bucket: string;
  path: string;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<S3FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listS3AddonFiles(agentId, runId)
      .then(res => { if (!cancelled) { setFiles(res.files); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(String(err)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [agentId, runId]);

  async function handleDownload(filePath: string) {
    setDownloadingPath(filePath);
    try {
      const { url } = await getS3SignedUrl(agentId, runId, filePath);
      window.open(url, "_blank");
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloadingPath(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">S3 Storage</h2>
          <p className="text-xs text-slate-400 font-mono mt-0.5">{bucket}/{path}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {!loading && !error && files.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-8">No files found at this path.</p>
      )}

      {!loading && !error && files.length > 0 && (
        <div className="divide-y divide-slate-800">
          {files.map(f => (
            <div key={f.path} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 truncate">{f.name}</p>
                <p className="text-xs text-slate-500 font-mono truncate">{f.path}</p>
              </div>
              <span className="text-xs text-slate-400 flex-shrink-0">{formatBytes(f.size)}</span>
              {f.updated && (
                <span className="text-xs text-slate-500 flex-shrink-0 hidden sm:block">
                  {new Date(f.updated).toLocaleDateString()}
                </span>
              )}
              <button
                onClick={() => handleDownload(f.path)}
                disabled={downloadingPath === f.path}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-900/40 hover:bg-sky-900/70 border border-sky-700/50 text-sky-300 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {downloadingPath === f.path ? (
                  <div className="w-3 h-3 border border-sky-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <ExternalLink className="w-3 h-3" />
                )}
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Popup modal ──────────────────────────────────────────────────────────────

function PopupModal({ open, onClose, children, size = "md" }: { open: boolean; onClose: () => void; children: React.ReactNode; size?: "md" | "lg" }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className={clsx(
          "bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-y-auto max-h-[85vh]",
          size === "lg" ? "w-full max-w-2xl" : "w-full max-w-lg"
        )}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Action indicator ─────────────────────────────────────────────────────────

function ActionIndicator({ color, label, onClick }: { color: "amber" | "sky"; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold border shadow-lg backdrop-blur-sm transition-transform hover:scale-105",
        color === "amber"
          ? "bg-amber-900/80 border-amber-600/60 text-amber-200"
          : "bg-sky-900/80 border-sky-600/60 text-sky-200"
      )}
    >
      <span className={clsx(
        "w-2 h-2 rounded-full flex-shrink-0",
        color === "amber" ? "bg-amber-400 animate-pulse" : "bg-sky-400 animate-pulse"
      )} />
      {label}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkflowDetail({ run, onUpdate, onRefresh }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [editableWf, setEditableWf] = useState<EditableWorkflowDefinition | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [s3Browser, setS3Browser] = useState<{ agentId: string; bucket: string; path: string } | null>(null);
  // Opened on demand rather than fetched on mount: most runs have no data
  // step, and an empty manifest is not worth a request on every run view.
  const [dataOpen, setDataOpen] = useState(false);
  const showRawEnv = process.env.NEXT_PUBLIC_SHOW_RAW_JSON === "true";
  // Dynamic workflows: the designer has no graph, so the run shows the agent
  // DAG the dispatcher built. A static workflow with a dynamic stage gets both.
  const [view, setView] = useState<"agents" | "steps">("agents");

  // Poll trace endpoint during active runs; also fetches once for completed runs
  const traceResponse = useRunTrace(run.id, run.status);

  // Fetch workflow definition to build the editable workflow for the run canvas
  useEffect(() => {
    let cancelled = false;
    getWorkflowDefinition(run.workflow_id)
      .then(wf => {
        if (cancelled) return;
        try {
          const editable = apiWorkflowToEditable(wf as unknown as Record<string, unknown>);
          setEditableWf(editable);
        } catch {
          // editableWf stays null; canvas will not render
        }
        setLayoutReady(true);
      })
      .catch(() => { if (!cancelled) setLayoutReady(true); });
    return () => { cancelled = true; };
  }, [run.workflow_id]);

  const pureDynamic = !!editableWf && isDynamicWorkflow(editableWf);
  const mixedDynamic = !pureDynamic && hasDynamicDag(run);
  const showAgentDag = pureDynamic || (mixedDynamic && view === "agents");
  const dynamicGate = run.interrupt_payload?.type === "dynamic_approval"
    ? run.dynamic?.[String(run.interrupt_payload?.step_id ?? "")]
    : undefined;

  async function handleRetry() {
    setRetrying(true);
    try {
      const updated = await retryWorkflowRun(run.id);
      onUpdate(updated);
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setRetrying(false);
    }
  }

  async function handleTerminate() {
    if (!confirm("Terminate this agent run?")) return;
    setTerminating(true);
    try {
      const updated = await terminateWorkflowRun(run.id);
      onUpdate(updated);
    } catch (err) {
      console.error("Terminate failed:", err);
    } finally {
      setTerminating(false);
    }
  }

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Floating header */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-slate-950/80 backdrop-blur-sm border-b border-slate-800">
          <span className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-slate-200 truncate">{run.workflow_name ?? run.workflow_id}</span>
            <span className="text-[10px] font-mono text-slate-500 truncate flex-shrink-0">ID: {run.id}</span>
          </span>
          <StatusBadge status={effectiveStatus(run)} />
          {(() => {
            const judgeUsage = (run.intermediate_outputs as Record<string, unknown> | undefined)
              ?._judge_token_usage as { total_tokens?: number } | undefined;
            if (!judgeUsage?.total_tokens) return null;
            return (
              <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">
                judge: {formatTokensK(judgeUsage.total_tokens)} tok
              </span>
            );
          })()}
          {run.current_step && (
            <span className="text-[10px] text-slate-500 font-mono truncate max-w-[120px]">{run.current_step}</span>
          )}
          {(run.status === "running" || run.status === "waiting_agent") && (
            <button
              onClick={handleTerminate}
              disabled={terminating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-900/70 border border-red-700/50 text-red-300 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              title="Terminate running agent"
            >
              <Square className={clsx("w-3.5 h-3.5", terminating && "animate-pulse")} />
              {terminating ? "Stopping…" : "Terminate"}
            </button>
          )}
          {run.status === "failed" && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/40 hover:bg-amber-900/70 border border-amber-700/50 text-amber-300 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              title="Retry from last completed step"
            >
              <RotateCcw className={clsx("w-3.5 h-3.5", retrying && "animate-spin")} />
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
          <button
            onClick={() => setDataOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium transition-colors flex-shrink-0"
            title="Files this run's data steps captured"
          >
            <Download className="w-3.5 h-3.5" />
            Data
          </button>
          <button
            onClick={onRefresh}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors flex-shrink-0"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {/* User request - collapsed hint */}
        <div className="mx-4 mt-1 pointer-events-auto">
          <p className="text-xs text-slate-500 truncate">{run.user_request}</p>
        </div>
      </div>

      {/* Graph — fills remaining space; gate on layoutReady so ReactFlow mounts
          with the real saved positions and its built-in fitView fires correctly */}
      <div className={clsx("flex-1 min-h-0 flex flex-col", (pureDynamic || mixedDynamic) && "pt-16")}>
        {mixedDynamic && (
          <div className="flex gap-1 px-4 pb-1">
            {(["agents", "steps"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={clsx("text-xs px-2.5 py-1 rounded-lg", view === v ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200")}
              >
                {v === "agents" ? "Agents" : "Workflow"}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 min-h-0">
          {showAgentDag ? (
            <DynamicRunView run={run} onUpdate={onUpdate} />
          ) : (
            layoutReady && editableWf && (
              <WorkflowRunCanvas
                workflow={editableWf}
                run={run}
                selectedStepId={selectedStep}
                onStepClick={setSelectedStep}
                onS3AddonClick={setS3Browser}
              />
            )
          )}
        </div>
      </div>

      {/* Bottom-right: action indicators */}
      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-2">
        {effectiveStatus(run) === "asking_context" && (
          <ActionIndicator color="sky" label="Needs Clarification" onClick={() => setApprovalOpen(true)} />
        )}
        {effectiveStatus(run) !== "asking_context" && (run.status === "waiting_approval" || run.approval_status === "pending" || (run.approval_gates ?? []).length > 0) && (
          <ActionIndicator color="amber" label="Approval Required" onClick={() => setApprovalOpen(true)} />
        )}
        {run.status === "waiting_agent" && run.pending_question && (
          <ActionIndicator color="sky" label="Agent needs clarification" onClick={() => setQuestionOpen(true)} />
        )}
        {run.waiting_transition && (
          <WaitingTransitionBanner waiting={run.waiting_transition} />
        )}
      </div>

      {/* Bottom-right: error (sits above action indicators) */}
      {run.error && (
        <div className="absolute bottom-24 right-4 z-10 max-w-sm">
          <div className="flex items-start gap-2 bg-red-950/80 border border-red-800 rounded-xl px-4 py-3 backdrop-blur-sm">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{run.error}</p>
          </div>
        </div>
      )}

      {/* Popups */}
      <PopupModal open={!!selectedStep} onClose={() => setSelectedStep(null)} size="lg">
        {selectedStep && (
          <StepDetail run={run} stepId={selectedStep} definition={editableWf?.nodes.find((n) => n.id === selectedStep)} onClose={() => setSelectedStep(null)} onUpdate={onUpdate} traceResponse={traceResponse ?? undefined} />
        )}
      </PopupModal>

      <PopupModal open={approvalOpen} onClose={() => setApprovalOpen(false)} size={dynamicGate ? "lg" : "md"}>
        {dynamicGate ? (
          <DynamicDecisionPanel run={run} state={dynamicGate} onUpdate={(r) => { onUpdate(r); setApprovalOpen(false); }} />
        ) : (
          <ApprovalPanel run={run} onUpdate={(r) => { onUpdate(r); setApprovalOpen(false); }} />
        )}
      </PopupModal>

      <PopupModal open={questionOpen} onClose={() => setQuestionOpen(false)}>
        <AgentQuestionCard run={run} onUpdate={(r) => { onUpdate(r); setQuestionOpen(false); }} />
      </PopupModal>

      <PopupModal open={dataOpen} onClose={() => setDataOpen(false)} size="lg">
        {dataOpen && <RunDataPanel runId={run.id} onClose={() => setDataOpen(false)} />}
      </PopupModal>

      <PopupModal open={s3Browser !== null} onClose={() => setS3Browser(null)} size="lg">
        {s3Browser !== null && (
          <S3FileBrowserModal
            agentId={s3Browser.agentId}
            runId={run.id}
            bucket={s3Browser.bucket}
            path={s3Browser.path}
            onClose={() => setS3Browser(null)}
          />
        )}
      </PopupModal>
    </div>
  );
}
