"use client";

import { ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import type { RunTraceResponse, TraceLlmCall, TraceToolCall } from "@/lib/types";

// ─── Agent progress ───────────────────────────────────────────────────────────

function AgentProgressRow({ message }: { message: string }) {
  return (
    <p className="text-[10px] font-mono text-slate-300 break-words bg-slate-800/50 rounded px-2 py-1">
      {message}
    </p>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LlmCallRow({ call }: { call: TraceLlmCall }) {
  return (
    <div className="rounded-lg bg-slate-800/50 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sky-400 truncate">{call.model}</span>
        <span className="text-slate-500 shrink-0">{relativeTime(call.timestamp)}</span>
      </div>
      <p className="text-slate-400 line-clamp-2 break-words">{call.prompt_summary}</p>
      {call.response_summary && (
        <p className="text-slate-300 line-clamp-2 break-words border-t border-slate-700/50 pt-1">
          {call.response_summary}
        </p>
      )}
      {call.total_tokens !== undefined && (
        <div className="flex gap-3 text-[10px] text-slate-500 pt-0.5">
          <span>in: {call.input_tokens ?? "—"}</span>
          <span>out: {call.output_tokens ?? "—"}</span>
          <span>total: {call.total_tokens}</span>
        </div>
      )}
    </div>
  );
}

function ToolCallRow({ call }: { call: TraceToolCall }) {
  return (
    <div className="rounded-lg bg-slate-800/50 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-amber-400 truncate">{call.tool_name}</span>
        <span className="text-slate-500 shrink-0">{relativeTime(call.timestamp)}</span>
      </div>
      <p className="text-slate-400 line-clamp-2 break-words font-mono text-[10px]">
        {call.input_summary}
      </p>
      {call.output_summary && (
        <p className="text-slate-300 line-clamp-2 break-words border-t border-slate-700/50 pt-1 text-[10px] font-mono">
          {call.output_summary}
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  trace: RunTraceResponse;
  /** When true the run is still executing — show live data emphasis */
  live?: boolean;
}

export function TracePanel({ trace, live = false }: Props) {
  const { trace_data: rawTd, agent_progress, langsmith_url } = trace;
  const td = {
    llm_calls: rawTd?.llm_calls ?? [],
    tool_calls: rawTd?.tool_calls ?? [],
    state_transitions: rawTd?.state_transitions ?? [],
    token_usage: rawTd?.token_usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    latency_ms: rawTd?.latency_ms ?? null,
    errors: rawTd?.errors ?? [],
  };
  const agentProgress = agent_progress ?? [];

  const hasLlm = td.llm_calls.length > 0;
  const hasTool = td.tool_calls.length > 0;
  const hasErrors = td.errors.length > 0;
  const hasTokens = td.token_usage.total_tokens > 0;
  const hasAgentProgress = agentProgress.length > 0;

  if (!hasLlm && !hasTool && !hasErrors && !hasAgentProgress && !live) return null;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Trace
          </span>
          {live && (
            <span className="flex items-center gap-1 text-[10px] text-sky-400">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping inline-block" />
              live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          {td.latency_ms !== null && (
            <span>latency: {formatLatency(td.latency_ms)}</span>
          )}
          {langsmith_url && (
            <a
              href={langsmith_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sky-500 hover:text-sky-400 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              LangSmith
            </a>
          )}
        </div>
      </div>

      {/* Token usage totals */}
      {hasTokens && (
        <div className="flex gap-4 text-[10px] text-slate-400 bg-slate-800/30 rounded-lg px-3 py-2">
          <span>input tokens: <span className="text-slate-200">{td.token_usage.input_tokens}</span></span>
          <span>output tokens: <span className="text-slate-200">{td.token_usage.output_tokens}</span></span>
          <span>total: <span className="text-slate-200">{td.token_usage.total_tokens}</span></span>
        </div>
      )}

      {/* Agent progress (spawned k8s agent's own tool-call trail, e.g. MCP calls) */}
      {hasAgentProgress && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            Agent progress ({agentProgress.length})
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {agentProgress.map((message, i) => (
              <AgentProgressRow key={i} message={message} />
            ))}
          </div>
        </div>
      )}

      {/* LLM calls */}
      {hasLlm && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            LLM calls ({td.llm_calls.length})
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {td.llm_calls.map((call, i) => (
              <LlmCallRow key={i} call={call} />
            ))}
          </div>
        </div>
      )}

      {/* Tool calls */}
      {hasTool && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            Tool calls ({td.tool_calls.length})
          </p>
          <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
            {td.tool_calls.map((call, i) => (
              <ToolCallRow key={i} call={call} />
            ))}
          </div>
        </div>
      )}

      {/* State transitions (completed runs only) */}
      {!live && td.state_transitions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            State transitions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {td.state_transitions.map((t, i) => (
              <span
                key={i}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400"
              >
                {t.node}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {hasErrors && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-red-500">
            Errors ({td.errors.length})
          </p>
          {td.errors.map((err, i) => (
            <p key={i} className="text-[10px] text-red-400 bg-red-950/30 rounded px-2 py-1 break-words">
              {err}
            </p>
          ))}
        </div>
      )}

      {/* Empty live state */}
      {live && !hasLlm && !hasTool && !hasAgentProgress && (
        <p className="text-[10px] text-slate-600 italic">
          Waiting for LLM and tool calls…
        </p>
      )}
    </div>
  );
}
