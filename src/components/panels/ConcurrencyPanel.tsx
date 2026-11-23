"use client";

import { useCallback, useEffect, useState } from "react";
import { EyeOff, Loader2 } from "lucide-react";
import {
  listAgentConcurrency, listRunners,
  type ConcurrencyEntry, type RuntimeConcurrency,
} from "@/lib/api";
import { formatAgo, runtimeKeyLabel } from "@/lib/runners";
import { PanelShell } from "./dock";

/**
 * Concurrency: every agent runtime that is limited or busy right now — its
 * effective limit, the runs holding a slot, and the runs queued for one, in
 * order. Runs in workflows the caller cannot see still count; they show as
 * "private run".
 *
 * Slots change by the second, so the list polls while the panel is open and
 * the tab is visible.
 */

export const CONCURRENCY_POLL_MS = 5_000;

export function ConcurrencyPanel({ onClose, onOpenRun, onOpenWorkflow, onOpenAgent }: {
  onClose: () => void;
  onOpenRun?: (runId: string) => void;
  onOpenWorkflow?: (workflowId: string) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const [keys, setKeys] = useState<RuntimeConcurrency[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runnerNames, setRunnerNames] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setKeys(await listAgentConcurrency());
      setError(null);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load concurrency");
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      load();
      timer = setInterval(load, CONCURRENCY_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? stop() : start());
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // Machine names for runner keys; the key alone only carries the id.
  useEffect(() => {
    let live = true;
    listRunners()
      .then((rs) => { if (live) setRunnerNames(Object.fromEntries(rs.map((r) => [r.id, r.name]))); })
      .catch(() => { /* ids are shown instead */ });
    return () => { live = false; };
  }, []);

  return (
    <PanelShell id="concurrency" onClose={onClose}
      actions={keys === null && !error ? <Loader2 className="w-3 h-3 text-slate-500 animate-spin" /> : null}>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {error && (
          <p role="alert" className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</p>
        )}
        {keys !== null && keys.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-6">No agent runtime is limited or busy.</p>
        )}
        {(keys ?? []).map((k) => (
          <RuntimeCard key={k.key} entry={k} now={now}
            label={runtimeKeyLabel(k, k.runner_id ? runnerNames[k.runner_id] : null)}
            onOpenRun={onOpenRun} onOpenWorkflow={onOpenWorkflow} onOpenAgent={onOpenAgent} />
        ))}
      </div>
    </PanelShell>
  );
}

function RuntimeCard({ entry, label, now, onOpenRun, onOpenWorkflow, onOpenAgent }: {
  entry: RuntimeConcurrency;
  label: string;
  now: number;
  onOpenRun?: (runId: string) => void;
  onOpenWorkflow?: (workflowId: string) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const links = { onOpenRun, onOpenWorkflow, onOpenAgent };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 space-y-1.5"
      data-testid={`concurrency-${entry.key}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <p className="flex-1 text-xs font-semibold text-slate-200 truncate" title={entry.key}>{label}</p>
        <span className="shrink-0 text-[10px] text-slate-400">
          {entry.holders.length}/{entry.limit ?? "∞"} running
        </span>
      </div>
      <p className="text-[10px] text-slate-500 font-mono truncate" title={entry.key}>{entry.key}</p>
      <p className="text-[10px] text-slate-400">
        Limit: <span className="text-slate-200">{entry.limit ?? "unlimited"}</span>
        {entry.queue.length > 0 && <> · <span className="text-violet-300">{entry.queue.length} queued</span></>}
      </p>

      {entry.holders.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-600">Running</p>
          <ul className="space-y-0.5">
            {entry.holders.map((h) => (
              <li key={h.id}>
                <EntryRow entry={h} {...links}
                  time={h.acquired_at ? `since ${formatAgo(h.acquired_at, now).replace(/ ago$/, "")}` : null} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry.queue.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-600">Queue</p>
          <ol className="space-y-0.5">
            {[...entry.queue].sort((a, b) => a.position - b.position).map((w) => (
              <li key={w.id} className="flex items-start gap-1">
                <span className="shrink-0 w-4 text-right text-[10px] text-violet-300 font-semibold">{w.position}.</span>
                <div className="min-w-0 flex-1">
                  <EntryRow entry={w} {...links}
                    time={w.enqueued_at ? `waiting ${formatAgo(w.enqueued_at, now).replace(/ ago$/, "")}` : null} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** One run holding or waiting for a slot: run · step, workflow, agent. */
function EntryRow({ entry, time, onOpenRun, onOpenWorkflow, onOpenAgent }: {
  entry: ConcurrencyEntry;
  time: string | null;
  onOpenRun?: (runId: string) => void;
  onOpenWorkflow?: (workflowId: string) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  if (entry.hidden || !entry.run_id) {
    return (
      <p className="flex items-center gap-1 text-[10px] text-slate-500 italic">
        <EyeOff className="w-3 h-3 shrink-0" />private run{time && <span className="not-italic"> · {time}</span>}
      </p>
    );
  }
  const runId = entry.run_id;
  return (
    <p className="text-[10px] text-slate-400 break-words">
      {onOpenRun ? (
        <button onClick={() => onOpenRun(runId)} title={`Open run ${runId}`}
          className="font-mono text-sky-300 hover:underline">{runId}</button>
      ) : <span className="font-mono">{runId}</span>}
      {entry.step_id && <> · step <span className="font-mono text-slate-300">{entry.step_id}</span></>}
      {entry.workflow_id && (
        <> · {onOpenWorkflow ? (
          <button onClick={() => onOpenWorkflow(entry.workflow_id!)} title={`Open workflow ${entry.workflow_id}`}
            className="text-violet-300 hover:underline">{entry.workflow_id}</button>
        ) : entry.workflow_id}</>
      )}
      {entry.agent_id && (
        <> · {onOpenAgent ? (
          <button onClick={() => onOpenAgent(entry.agent_id!)} title={`Open agent ${entry.agent_id}`}
            className="text-fuchsia-300 hover:underline">{entry.agent_id}</button>
        ) : entry.agent_id}</>
      )}
      {time && <> · {time}</>}
    </p>
  );
}
