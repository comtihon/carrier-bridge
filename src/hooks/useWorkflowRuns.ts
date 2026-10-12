"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { getWorkflowRun, listWorkflowRuns } from "@/lib/api";
import type { WorkflowRun } from "@/lib/types";


const STORAGE_KEY = "copilot_ui_run_ids_v2";
// The v1 key held a bare id array that only ever grew — every run the tab had
// ever seen — and those ids were carried onto every page, so the list drew far
// more rows than the pager claimed and fetched one run each. Its contents are
// not worth migrating: a run old enough to be in there is one the backend page
// already knows about.
const LEGACY_STORAGE_KEY = "copilot_ui_run_ids";
const DISMISSED_KEY = "copilot_ui_dismissed_run_ids";
const POLL_INTERVAL_MS = 3000;
// How long a run started in this tab is carried on top of the backend page
// while waiting to appear on it. Long enough to cover the 10 s list sync and
// a slow first write; short enough that a stale id cannot outlive the session
// it belongs to.
const CARRY_TTL_MS = 15 * 60 * 1000;
const CARRY_MAX = 20;

// ─── Persist run IDs in localStorage ─────────────────────────────────────────

type CarriedRun = { id: string; ts: number };

function readCarried(): CarriedRun[] {
  if (typeof window === "undefined") return [];
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CarriedRun[];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - CARRY_TTL_MS;
    return parsed
      .filter((e) => e && typeof e.id === "string" && typeof e.ts === "number" && e.ts > cutoff)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, CARRY_MAX);
  } catch {
    return [];
  }
}

function saveRunIds(ids: string[]) {
  if (typeof window === "undefined") return;
  // Keep the timestamp a run was first carried with, so a run cannot renew its
  // own TTL every time the list syncs.
  const known = new Map(readCarried().map((e) => [e.id, e.ts]));
  const now = Date.now();
  const entries: CarriedRun[] = ids
    .slice(0, CARRY_MAX)
    .map((id) => ({ id, ts: known.get(id) ?? now }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function loadDismissedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
}

/** Same ids in the same order. Used to keep the array identity stable so the
 *  10 s backend sync does not re-trigger every effect that depends on it. */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// ─── Hook: single run with polling ───────────────────────────────────────────

export function useWorkflowRun(runId: string | null) {
  const shouldPoll = useCallback(
    (run?: WorkflowRun) =>
      !run || (run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled"),
    []
  );

  const { data, error, mutate } = useSWR<WorkflowRun>(runId, getWorkflowRun, {
    refreshInterval: (run) => (shouldPoll(run) ? POLL_INTERVAL_MS : 0),
    revalidateOnFocus: false,
  });

  return { run: data, error, refresh: mutate };
}

// ─── Hook: manage the list of tracked run IDs + their latest data ─────────────

export function useWorkflowRuns(opts?: { pageSize?: number; excludeWorkflowIds?: string[] }) {
  const pageSize = opts?.pageSize ?? 20;
  const excludeWorkflowIds = opts?.excludeWorkflowIds ?? [];
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [runIds, setRunIds] = useState<string[]>([]);
  // Runs as the list endpoint returned them. `GET /workflows/runs` already
  // answers with fully-formed run objects, so handing them straight to
  // useRunList spares it one GET per row for data we are already holding.
  const [listedRuns, setListedRuns] = useState<Record<string, WorkflowRun>>({});
  const dismissedRef = useRef<Set<string>>(new Set());
  // Runs started from this tab. These are the only ids worth persisting: they
  // are the ones a reload would otherwise lose before the backend page catches
  // up with them.
  // id → when it was first carried, so an id that never shows up on a backend
  // page still leaves the tracked set instead of accumulating for the session.
  const startedRef = useRef<Map<string, number>>(new Map());

  // Reset to page 0 when filters/pageSize change
  const excludeKey = excludeWorkflowIds.join(",");
  useEffect(() => { setPage(0); }, [excludeKey, pageSize]);

  // Hydrate from localStorage, then keep syncing with backend every 10s
  useEffect(() => {
    dismissedRef.current = loadDismissedIds();
    const stored = readCarried();
    stored.forEach((e) => startedRef.current.set(e.id, e.ts));
    setRunIds(stored.map((e) => e.id));
  }, []);

  useEffect(() => {
    const offset = page * pageSize;
    const excluded = excludeWorkflowIds.length ? excludeWorkflowIds : undefined;

    const sync = () => {
      listWorkflowRuns(pageSize, offset, undefined, excluded).then(({ runs, total: t }) => {
        setTotal(t);
        setListedRuns(Object.fromEntries(runs.map((r) => [r.id, r])));
        setRunIds((prev) => {
          const backendIds = runs
            .map((r) => r.id)
            .filter((id) => !dismissedRef.current.has(id));
          // The page the backend just gave us, plus the runs this tab started
          // that have not shown up on it yet. Anything else is dropped.
          //
          // This used to union the page with *everything ever seen* and write
          // that back to localStorage, so the tracked set only ever grew — at
          // a few runs an hour it reaches hundreds of ids in a day. Every one
          // of them became a `GET /workflows/runs/{id}` on load, and the burst
          // queued every other request behind it (25 concurrent calls measured
          // 341 ms p50 against 50 ms for a lone one), which is what made
          // clicking a resource tab feel slow. It also broke the pager, which
          // renders `runIds` in full while claiming to show one page of them.
          const backendSet = new Set(backendIds);
          const cutoff = Date.now() - CARRY_TTL_MS;
          for (const [id, ts] of [...startedRef.current]) {
            // Adopted by the page, or too old to still be waiting for it.
            if (backendSet.has(id) || ts <= cutoff) startedRef.current.delete(id);
          }
          const carried = [...startedRef.current]
            .filter(([id]) => !dismissedRef.current.has(id))
            .sort((a, b) => b[1] - a[1])
            .slice(0, CARRY_MAX)
            .map(([id]) => id);
          const merged = [...backendIds, ...carried];
          // Only persist the tab's own runs, and only while the backend page
          // has not adopted them — that is the whole job of this key.
          saveRunIds(carried);
          // Bail out on an unchanged page so downstream effects (the pollers in
          // useRunList) do not re-run every 10 s on a fresh array identity.
          return sameIds(prev, merged) ? prev : merged;
        });
      }).catch(() => { /* backend unavailable — keep current list */ });
    };

    sync();
    const interval = setInterval(sync, 10_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, excludeKey]);

  const addRunId = useCallback((id: string) => {
    startedRef.current.set(id, Date.now());
    setRunIds((prev) => {
      const next = [id, ...prev.filter((r) => r !== id)];
      saveRunIds([...startedRef.current.keys()]);
      return next;
    });
  }, []);

  const removeRunId = useCallback((id: string) => {
    dismissedRef.current.add(id);
    saveDismissedIds(dismissedRef.current);
    startedRef.current.delete(id);
    setRunIds((prev) => {
      const next = prev.filter((r) => r !== id);
      saveRunIds([...startedRef.current.keys()]);
      return next;
    });
  }, []);

  return {
    runIds,
    listedRuns,
    addRunId,
    removeRunId,
    page,
    total,
    pageSize,
    hasNext: (page + 1) * pageSize < total,
    hasPrev: page > 0,
    nextPage: () => setPage((p) => p + 1),
    prevPage: () => setPage((p) => Math.max(0, p - 1)),
  };
}

// ─── Hook: poll a list of runs ────────────────────────────────────────────────

const isTerminal = (run: WorkflowRun) =>
  run.status === "completed" || run.status === "failed" || run.status === "cancelled";

/**
 * Keep a map of run id -> latest run, polling the ones that are still moving.
 *
 * `seed` is what the list endpoint already returned for these ids. A seeded run
 * needs no fetch at all when it is terminal, and a non-terminal one starts from
 * real data instead of a blank row — so opening the app costs one list call
 * rather than one call per row.
 *
 * Those seeds are rows: the list answers with `partial: true` and empty
 * per-step payloads, because reading them for every row is what made the call
 * ship megabytes. `detailId` is the one run being rendered in full, and it is
 * read back by id whenever what we hold for it is a row.
 */
export function useRunList(
  runIds: string[],
  seed?: Record<string, WorkflowRun>,
  detailId?: string | null,
) {
  const [runs, setRuns] = useState<Record<string, WorkflowRun>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Ids with a request in flight. A pending fetch has no timer yet, so without
  // this the guard below re-issues it every time the effect re-runs.
  const inFlightRef = useRef<Set<string>>(new Set());

  const fetchRun = useCallback(async (id: string) => {
    inFlightRef.current.add(id);
    try {
      const run = await getWorkflowRun(id);
      setRuns((prev) => ({ ...prev, [id]: run }));
      // Continue polling if not terminal
      if (!isTerminal(run)) {
        timersRef.current[id] = setTimeout(() => fetchRun(id), POLL_INTERVAL_MS);
      }
    } catch {
      // keep stale data, retry
      timersRef.current[id] = setTimeout(() => fetchRun(id), POLL_INTERVAL_MS * 3);
    } finally {
      inFlightRef.current.delete(id);
    }
  }, []);

  // Adopt whatever the list endpoint gave us. This is the same payload
  // `GET /workflows/runs/{id}` would return, so a terminal run listed here is
  // final and never needs fetching.
  useEffect(() => {
    if (!seed) return;
    const fresh = Object.values(seed);
    if (fresh.length === 0) return;
    setRuns((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const run of fresh) {
        const known = prev[run.id];
        if (!known || known.status !== run.status || known.updated_at !== run.updated_at) {
          // A row must not blank out a run we already hold in full unless it
          // actually moved; otherwise the 10 s sync would strip the open run's
          // outputs on every tick and force a re-read each time.
          next[run.id] = known && !known.partial && run.partial ? { ...known, ...run } : run;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [seed]);

  useEffect(() => {
    runIds.forEach((id) => {
      // Terminal runs are done — whether we learned that from the list payload
      // or from a fetch, there is nothing left to poll.
      const existing = runs[id] ?? seed?.[id];
      if (existing && isTerminal(existing)) return;
      if (timersRef.current[id] || inFlightRef.current.has(id)) return;
      fetchRun(id);
    });
    // Cleanup timers for removed IDs
    const timers = timersRef.current;
    Object.keys(timers).forEach((id) => {
      if (!runIds.includes(id)) {
        clearTimeout(timers[id]);
        delete timers[id];
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, seed]);

  // The run on screen needs the payloads the list leaves behind.
  useEffect(() => {
    if (!detailId) return;
    // The seed counts: it lands in `runs` a commit later, and reading only
    // `runs` here would fetch a run the list already delivered in full.
    const held = runs[detailId] ?? seed?.[detailId];
    if (held && !held.partial) return;
    if (inFlightRef.current.has(detailId)) return;
    fetchRun(detailId);
  }, [detailId, runs, seed, fetchRun]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const refresh = useCallback(
    (id: string) => {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
      fetchRun(id);
    },
    [fetchRun]
  );

  return { runs, refresh };
}
