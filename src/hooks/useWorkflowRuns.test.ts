import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listWorkflowRuns: vi.fn(),
    getWorkflowRun: vi.fn(),
  };
});

import { listWorkflowRuns, getWorkflowRun } from "@/lib/api";
import { useWorkflowRuns, useRunList } from "./useWorkflowRuns";
import type { WorkflowRun, WorkflowStatus } from "@/lib/types";

const KEY = "copilot_ui_run_ids_v2";
const carriedIds = () =>
  (JSON.parse(localStorage.getItem(KEY) ?? "[]") as { id: string }[]).map((e) => e.id);

function run(id: string, status: WorkflowStatus = "completed"): WorkflowRun {
  return {
    id,
    workflow_id: "wf",
    workflow_name: "Workflow",
    user_request: "go",
    status,
    steps: [],
    approval_status: "not_required",
    approval_gates: [],
    tool_call_results: [],
    llm_agent_results: [],
    action_results: [],
    execution_results: [],
    intermediate_outputs: {},
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const listed = (runs: WorkflowRun[], total = runs.length) => ({ runs, total });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(getWorkflowRun).mockImplementation(async (id: string) => run(id));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── The tracked set ─────────────────────────────────────────────────────────
//
// This used to be the union of the backend page with every id ever seen, written
// back to localStorage on each sync. At a few runs an hour that grows without
// bound, and every id in it became one `GET /workflows/runs/{id}` on load.

describe("useWorkflowRuns", () => {
  it("tracks the backend page and does not persist it", async () => {
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("a"), run("b")]));

    const { result } = renderHook(() => useWorkflowRuns({ pageSize: 20 }));

    await waitFor(() => expect(result.current.runIds).toEqual(["a", "b"]));
    // Nothing to remember: the next load gets the same page from the backend.
    expect(carriedIds()).toEqual([]);
  });

  it("drops ids the backend page no longer carries instead of accumulating them", async () => {
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("a")]));
    const now = Date.now();
    localStorage.setItem(KEY, JSON.stringify(
      ["old-1", "old-2", "old-3"].map((id) => ({ id, ts: now })),
    ));

    const { result } = renderHook(() => useWorkflowRuns({ pageSize: 20 }));

    // The stored ids are carried once (they were this tab's own runs) but a page
    // that has moved on does not keep growing the set.
    await waitFor(() => expect(result.current.runIds).toContain("a"));
    expect(result.current.runIds.length).toBeLessThanOrEqual(4);
  });

  it("ignores the v1 key, whose ids only ever grew", async () => {
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("a")]));
    const legacy = Array.from({ length: 120 }, (_, i) => `legacy-${i}`);
    localStorage.setItem("copilot_ui_run_ids", JSON.stringify(legacy));

    const { result } = renderHook(() => useWorkflowRuns({ pageSize: 20 }));

    // Every one of those ids used to be drawn as a row and fetched one by one,
    // so the list showed far more than the page it claimed.
    await waitFor(() => expect(result.current.runIds).toEqual(["a"]));
    expect(localStorage.getItem("copilot_ui_run_ids")).toBeNull();
  });

  it("forgets a carried run once it is older than the carry window", async () => {
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("a")]));
    localStorage.setItem(KEY, JSON.stringify([
      { id: "stale", ts: Date.now() - 60 * 60 * 1000 },
      { id: "fresh", ts: Date.now() },
    ]));

    const { result } = renderHook(() => useWorkflowRuns({ pageSize: 20 }));

    await waitFor(() => expect(result.current.runIds).toContain("a"));
    expect(result.current.runIds).toContain("fresh");
    expect(result.current.runIds).not.toContain("stale");
  });

  it("caps what it carries so the list cannot outgrow its page", async () => {
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("a")], 90));
    const now = Date.now();
    localStorage.setItem(KEY, JSON.stringify(
      Array.from({ length: 80 }, (_, i) => ({ id: `mine-${i}`, ts: now - i })),
    ));

    const { result } = renderHook(() => useWorkflowRuns({ pageSize: 13 }));

    await waitFor(() => expect(result.current.runIds).toContain("a"));
    expect(result.current.runIds.length).toBeLessThanOrEqual(21);
  });

  it("keeps a run started in this tab until the backend page shows it", async () => {
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("a")]));
    const { result } = renderHook(() => useWorkflowRuns({ pageSize: 20 }));
    await waitFor(() => expect(result.current.runIds).toEqual(["a"]));

    act(() => result.current.addRunId("mine"));

    await waitFor(() => expect(result.current.runIds).toContain("mine"));
    // Persisted, because a reload would otherwise lose it.
    expect(carriedIds()).toEqual(["mine"]);

    // Once the backend page carries it, it is no longer special.
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("mine"), run("a")]));
    const { result: reloaded } = renderHook(() => useWorkflowRuns({ pageSize: 20 }));
    await waitFor(() => expect(reloaded.current.runIds).toEqual(["mine", "a"]));
  });

  it("keeps the runIds identity stable when a sync returns the same page", async () => {
    vi.useFakeTimers();
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("a"), run("b")]));

    const { result } = renderHook(() => useWorkflowRuns({ pageSize: 20 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.runIds).toEqual(["a", "b"]);
    const first = result.current.runIds;

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    // A fresh array each sync would re-run every effect keyed on it — which is
    // what re-issued the per-run fetches every 10 seconds.
    expect(result.current.runIds).toBe(first);
  });

  it("surfaces the listed runs so callers need not re-fetch them", async () => {
    vi.mocked(listWorkflowRuns).mockResolvedValue(listed([run("a"), run("b")]));

    const { result } = renderHook(() => useWorkflowRuns({ pageSize: 20 }));

    await waitFor(() => expect(Object.keys(result.current.listedRuns)).toEqual(["a", "b"]));
  });
});

// ─── The poller ──────────────────────────────────────────────────────────────

describe("useRunList", () => {
  it("does not fetch a run the list already delivered as terminal", async () => {
    const seed = { a: run("a", "completed"), b: run("b", "failed") };

    const { result } = renderHook(() => useRunList(["a", "b"], seed));

    await waitFor(() => expect(Object.keys(result.current.runs).sort()).toEqual(["a", "b"]));
    // `GET /workflows/runs` returns the same payload as `GET .../{id}`, so
    // re-fetching a finished run is one wasted request per row.
    expect(getWorkflowRun).not.toHaveBeenCalled();
  });

  it("still polls a listed run that is not finished", async () => {
    const seed = { a: run("a", "running") };

    renderHook(() => useRunList(["a"], seed));

    await waitFor(() => expect(getWorkflowRun).toHaveBeenCalledWith("a"));
  });

  it("fetches a run the list did not carry", async () => {
    const { result } = renderHook(() => useRunList(["orphan"], {}));

    await waitFor(() => expect(getWorkflowRun).toHaveBeenCalledWith("orphan"));
    await waitFor(() => expect(result.current.runs.orphan).toBeDefined());
  });

  it("does not re-issue a request that is still in flight", async () => {
    let release: (r: WorkflowRun) => void = () => {};
    vi.mocked(getWorkflowRun).mockImplementation(
      () => new Promise<WorkflowRun>((resolve) => { release = resolve; }),
    );

    // A re-render with an equal-but-new seed object re-runs the effect. A
    // pending fetch has no timer yet, so only the in-flight set stops it from
    // being issued a second time.
    const { rerender } = renderHook(
      ({ seed }: { seed: Record<string, WorkflowRun> }) => useRunList(["a"], seed),
      { initialProps: { seed: {} as Record<string, WorkflowRun> } },
    );
    await waitFor(() => expect(getWorkflowRun).toHaveBeenCalledTimes(1));

    rerender({ seed: {} });
    rerender({ seed: {} });

    expect(getWorkflowRun).toHaveBeenCalledTimes(1);
    await act(async () => { release(run("a")); });
  });

  // ─── Rows vs. whole runs ───────────────────────────────────────────────────
  //
  // The list answers with rows: `partial: true`, no per-step inputs, outputs
  // or state, because reading those for every row is what made one page of
  // runs weigh megabytes. Only the run on screen is read in full.

  it("reads the open run in full when the list only gave it a row", async () => {
    const row = { ...run("a", "completed"), partial: true };
    vi.mocked(getWorkflowRun).mockResolvedValue({
      ...run("a", "completed"),
      intermediate_outputs: { answer: "42" },
    });

    const { result } = renderHook(() => useRunList(["a"], { a: row }, "a"));

    await waitFor(() => expect(getWorkflowRun).toHaveBeenCalledWith("a"));
    await waitFor(() =>
      expect(result.current.runs.a.intermediate_outputs).toEqual({ answer: "42" }),
    );
  });

  it("does not read the open run again once it is held in full", async () => {
    const full = { ...run("a", "completed"), partial: false };

    renderHook(() => useRunList(["a"], { a: full }, "a"));

    await waitFor(() => expect(Object.keys(full).length).toBeGreaterThan(0));
    expect(getWorkflowRun).not.toHaveBeenCalled();
  });

  it("leaves the rows of a page unread, however many there are", async () => {
    const ids = Array.from({ length: 13 }, (_, i) => `r${i}`);
    const seed = Object.fromEntries(
      ids.map((id) => [id, { ...run(id, "completed"), partial: true }]),
    );

    renderHook(() => useRunList(ids, seed, null));

    await waitFor(() => expect(seed.r0).toBeDefined());
    expect(getWorkflowRun).not.toHaveBeenCalled();
  });

  it("keeps the run it holds in full when an unchanged row syncs over it", async () => {
    const row = { ...run("a", "completed"), partial: true };
    vi.mocked(getWorkflowRun).mockResolvedValue({
      ...run("a", "completed"),
      intermediate_outputs: { answer: "42" },
    });

    const { result, rerender } = renderHook(
      ({ seed }: { seed: Record<string, WorkflowRun> }) => useRunList(["a"], seed, "a"),
      { initialProps: { seed: { a: row } as Record<string, WorkflowRun> } },
    );
    await waitFor(() =>
      expect(result.current.runs.a.intermediate_outputs).toEqual({ answer: "42" }),
    );

    // The 10 s list sync hands the same row over again. Taking it would blank
    // the open run and force a re-read on every tick.
    rerender({ seed: { a: { ...row } } });

    expect(result.current.runs.a.intermediate_outputs).toEqual({ answer: "42" });
    expect(getWorkflowRun).toHaveBeenCalledTimes(1);
  });

  it("re-reads the open run when a row says it moved", async () => {
    const row = { ...run("a", "running"), partial: true };
    vi.mocked(getWorkflowRun).mockResolvedValue({
      ...run("a", "running"),
      intermediate_outputs: { step: 1 },
    });

    const { result, rerender } = renderHook(
      ({ seed }: { seed: Record<string, WorkflowRun> }) => useRunList(["a"], seed, "a"),
      { initialProps: { seed: { a: row } as Record<string, WorkflowRun> } },
    );
    await waitFor(() => expect(result.current.runs.a).toBeDefined());

    vi.mocked(getWorkflowRun).mockResolvedValue({
      ...run("a", "completed"),
      intermediate_outputs: { step: 2 },
    });
    rerender({ seed: { a: { ...row, status: "completed", updated_at: "2026-01-01T00:01:00Z" } } });

    await waitFor(() =>
      expect(result.current.runs.a.intermediate_outputs).toEqual({ step: 2 }),
    );
  });
});
