"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getRunTrace } from "@/lib/api";
import type { RunTraceResponse } from "@/lib/types";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLL_INTERVAL_MS = 2000;
const ERROR_RETRY_MS = 6000;

/**
 * Polls GET /workflows/runs/{runId}/trace every 2 seconds while the run is
 * active.  Stops automatically when the run reaches a terminal status.
 */
export function useRunTrace(
  runId: string | null,
  runStatus: string,
): RunTraceResponse | null {
  const [traceData, setTraceData] = useState<RunTraceResponse | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the runId we last started polling for so we can reset on change
  const pollingRunIdRef = useRef<string | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const fetchTrace = useCallback(async (id: string) => {
    try {
      const data = await getRunTrace(id);
      setTraceData(data);
      if (!TERMINAL_STATUSES.has(data.status)) {
        timerRef.current = setTimeout(() => fetchTrace(id), POLL_INTERVAL_MS);
      }
    } catch {
      // Keep stale data; retry with a longer back-off
      timerRef.current = setTimeout(() => fetchTrace(id), ERROR_RETRY_MS);
    }
  }, []);

  useEffect(() => {
    if (!runId) {
      clearTimer();
      setTraceData(null);
      pollingRunIdRef.current = null;
      return;
    }

    // Reset when runId changes
    if (pollingRunIdRef.current !== runId) {
      clearTimer();
      setTraceData(null);
      pollingRunIdRef.current = runId;
      fetchTrace(runId);
    }

    return clearTimer;
  }, [runId, fetchTrace]);

  // Stop polling immediately when run reaches a terminal state
  useEffect(() => {
    if (TERMINAL_STATUSES.has(runStatus)) {
      clearTimer();
    }
  }, [runStatus]);

  return traceData;
}
