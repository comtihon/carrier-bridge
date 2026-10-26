"use client";

import { useEffect, useState } from "react";
import { Gauge, Laptop } from "lucide-react";
import { quotaWaitOf, quotaWaitText, runnerWaitOf } from "@/lib/runners";

/**
 * Why an agent step is parked rather than running: its agent hit a usage limit
 * (`_quota_wait_<step>`), or the machine it runs on is offline
 * (`_runner_wait_<step>`). Nothing renders when neither key is in the state.
 *
 * The countdown re-renders every 30 s — minute precision is all it shows.
 */
export function StepWaitNotice({ state, stepId }: {
  state: Record<string, unknown> | null | undefined;
  stepId: string;
}) {
  const quota = quotaWaitOf(state, stepId);
  const runner = runnerWaitOf(state, stepId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!quota?.resume_at) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [quota?.resume_at]);

  if (!quota && !runner) return null;
  return (
    <div className="space-y-2" data-testid="step-wait-notice">
      {quota && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2">
          <Gauge className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-semibold text-amber-200">{quotaWaitText(quota, now)}</p>
            {quota.message && (
              <p className="text-[11px] text-amber-300/80 break-words">{quota.message}</p>
            )}
          </div>
        </div>
      )}
      {runner && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-sky-800/60 bg-sky-950/30 px-3 py-2">
          <Laptop className="w-4 h-4 shrink-0 text-sky-400 animate-pulse" />
          <p className="text-xs text-sky-200">
            Waiting for machine <span className="font-semibold">{runner.runner_name || runner.runner_id}</span> to come online
          </p>
        </div>
      )}
    </div>
  );
}
