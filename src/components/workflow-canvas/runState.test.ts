import { describe, it, expect } from "vitest";
import { deriveNodeState, shouldAnimateEdge } from "./utils/runState";
import type { WorkflowRun, WorkflowStepDefinition } from "@/lib/types";

/** Reproduction of csm-deadline-watcher run 852831bc, whose canvas showed the
 *  wrong path: every operator (fan_out, join_sources, gate_compute, gate_export)
 *  reports `skipped` because control-flow nodes return nothing, while the steps
 *  on the branch that was never entered (post_digest, abort_without_saving, the
 *  save legs) stay `pending`. The old rule read those two the same way, so the
 *  taken path went dark at each operator and abort_without_saving — which never
 *  ran — animated its edge into `done`. */
const STEP_STATUS: Record<string, string> = {
  apply_slack_overrides: "finished",
  fan_out: "skipped",
  fetch_orders: "finished",
  fetch_cc: "finished",
  join_sources: "skipped",
  compute: "finished",
  gate_compute: "skipped",
  confirm_overrides: "finished",
  abort_without_saving: "pending",
  gate_export: "skipped",
  post_digest: "pending",
  dm_on_bad_export: "finished",
  serialise: "pending",
  done: "finished",
};

const STEP_TYPE: Record<string, string> = {
  apply_slack_overrides: "python",
  fan_out: "parallel",
  fetch_orders: "data_source",
  fetch_cc: "data_source",
  join_sources: "join",
  compute: "python",
  gate_compute: "switch",
  confirm_overrides: "slack",
  abort_without_saving: "python",
  gate_export: "switch",
  post_digest: "slack",
  dm_on_bad_export: "slack",
  serialise: "python",
  done: "python",
};

const ORDER = Object.keys(STEP_TYPE);

const run = {
  id: "852831bc",
  status: "completed",
  steps: ORDER.map(id => ({ id, status: STEP_STATUS[id] })),
} as unknown as WorkflowRun;

const stateOf = (id: string) =>
  deriveNodeState(
    { id, status: STEP_STATUS[id] } as unknown as WorkflowStepDefinition,
    run,
    STEP_TYPE[id],
  );

const edgeAnimates = (source: string, target: string) =>
  shouldAnimateEdge(
    stateOf(source),
    stateOf(target),
    ORDER.indexOf(target) > ORDER.indexOf(source),
  );

describe("run node state", () => {
  it("reads an operator's empty output as traversed, not as a dead branch", () => {
    expect(stateOf("fan_out")).toBe("completed");
    expect(stateOf("join_sources")).toBe("completed");
    expect(stateOf("gate_compute")).toBe("completed");
    expect(stateOf("gate_export")).toBe("completed");
  });

  it("keeps a never-entered step pending even once the run completes", () => {
    expect(stateOf("abort_without_saving")).toBe("pending");
    expect(stateOf("post_digest")).toBe("pending");
    expect(stateOf("serialise")).toBe("pending");
  });

  it("still marks a step the backend skipped by condition as skipped", () => {
    const step = { id: "maybe", status: "skipped" } as unknown as WorkflowStepDefinition;
    expect(deriveNodeState(step, run, "python")).toBe("skipped");
  });
});

describe("run edge animation", () => {
  it("animates into and out of every operator on the taken path", () => {
    expect(edgeAnimates("apply_slack_overrides", "fan_out")).toBe(true);
    expect(edgeAnimates("fan_out", "fetch_orders")).toBe(true);
    expect(edgeAnimates("fan_out", "fetch_cc")).toBe(true);
    expect(edgeAnimates("fetch_orders", "join_sources")).toBe(true);
    expect(edgeAnimates("fetch_cc", "join_sources")).toBe(true);
    expect(edgeAnimates("join_sources", "compute")).toBe(true);
    expect(edgeAnimates("compute", "gate_compute")).toBe(true);
    expect(edgeAnimates("gate_compute", "confirm_overrides")).toBe(true);
    expect(edgeAnimates("confirm_overrides", "gate_export")).toBe(true);
    expect(edgeAnimates("gate_export", "dm_on_bad_export")).toBe(true);
    expect(edgeAnimates("dm_on_bad_export", "done")).toBe(true);
  });

  it("leaves the branches the run never entered dark", () => {
    expect(edgeAnimates("gate_compute", "abort_without_saving")).toBe(false);
    expect(edgeAnimates("gate_export", "post_digest")).toBe(false);
    expect(edgeAnimates("post_digest", "serialise")).toBe(false);
  });

  it("does not animate out of a step that never ran", () => {
    // The old rule let this through: `pending` was rewritten to `skipped` once
    // the run completed, and a skipped source was treated as having handed
    // control on.
    expect(edgeAnimates("abort_without_saving", "done")).toBe(false);
  });

  it("keeps an untaken loop-back to a finished step dark", () => {
    expect(edgeAnimates("done", "compute")).toBe(false);
  });
});
