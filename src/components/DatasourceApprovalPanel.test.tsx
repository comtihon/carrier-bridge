/**
 * The panel a paused deletion shows.
 *
 * The tests are about what a reviewer can see before they click and what the
 * click sends. Everything else on the card is decoration; the row count, the
 * targets and the "advisory, not a verdict" framing of the meta-LLM line are
 * the reasons the gate exists at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    approveWorkflowRun: vi.fn(async () => ({}) as never),
    rejectWorkflowRun: vi.fn(async () => ({}) as never),
  };
});

import { approveWorkflowRun, rejectWorkflowRun } from "@/lib/api";
import { DatasourceApprovalPanel } from "./DatasourceApprovalPanel";
import type { DatasourceApprovalPayload, WorkflowRun } from "@/lib/types";

function payload(overrides: Partial<DatasourceApprovalPayload> = {}): DatasourceApprovalPayload {
  return {
    type: "datasource_approval",
    case_id: "apr_1",
    datasource_id: "files",
    datasource_name: "File store",
    operation: "drop_stale",
    method: "DELETE",
    endpoint: "DELETE https://files.test/files/f1",
    affected_rows: 1240,
    affected_sample: ["f1", "f2", "f3", "f4", "f5", "f6", "f7"],
    targets: ["DELETE https://files.test/files/f1"],
    params: { bucket: "archive", olderThanDays: 30 },
    meta_llm: null,
    ...overrides,
  };
}

function makeRun(p: DatasourceApprovalPayload): WorkflowRun {
  return {
    id: "run-1",
    workflow_id: "wf-1",
    workflow_name: "Nightly cleanup",
    user_request: "clean up",
    status: "waiting_approval",
    steps: [],
    approval_status: "pending",
    approval_gates: [],
    tool_call_results: [],
    llm_agent_results: [],
    action_results: [],
    execution_results: [],
    intermediate_outputs: {},
    interrupt_payload: p as unknown as Record<string, unknown>,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function renderPanel(p: DatasourceApprovalPayload = payload()) {
  const onUpdate = vi.fn();
  render(<DatasourceApprovalPanel run={makeRun(p)} onUpdate={onUpdate} />);
  return onUpdate;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DatasourceApprovalPanel", () => {
  it("leads with the row count, formatted for a number that large", () => {
    renderPanel();
    expect(screen.getByText("1,240")).toBeInTheDocument();
    expect(screen.getByText("rows will be deleted")).toBeInTheDocument();
  });

  it("says 'row' for a single-row deletion", () => {
    renderPanel(payload({ affected_rows: 1, affected_sample: ["f1"] }));
    expect(screen.getByText("row will be deleted")).toBeInTheDocument();
  });

  it("names the data source, the operation and its verb", () => {
    renderPanel();
    expect(screen.getByText("File store")).toBeInTheDocument();
    expect(screen.getByText(/drop_stale/)).toBeInTheDocument();
    expect(screen.getByText("[DELETE]")).toBeInTheDocument();
  });

  it("shows the inputs the operation was called with", () => {
    renderPanel();
    expect(screen.getByText("bucket")).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(screen.getByText("olderThanDays")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows six targets and offers the rest behind one click", () => {
    renderPanel();
    expect(screen.getByText("f6")).toBeInTheDocument();
    expect(screen.queryByText("f7")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Show 1 more"));
    expect(screen.getByText("f7")).toBeInTheDocument();
  });

  it("says how many rows the sample does not cover", () => {
    renderPanel();
    expect(screen.getByText("…and 1,233 more not sampled")).toBeInTheDocument();
  });

  it("frames the meta-LLM as advice, not as the decision", () => {
    renderPanel(payload({
      meta_llm: {
        decision: "approve",
        reason: "matches nine prior nightly cleanups",
        model: "claude-test",
        autonomous: false,
        history_size: 9,
        created_at: new Date().toISOString(),
      },
    }));
    expect(screen.getByText("Meta-LLM would approve")).toBeInTheDocument();
    expect(screen.getByText(/matches nine prior nightly cleanups/)).toBeInTheDocument();
    expect(screen.getByText(/Advisory — you decide/)).toBeInTheDocument();
  });

  it("draws no recommendation when the meta-LLM abstained", () => {
    renderPanel(payload({
      meta_llm: {
        decision: "abstain", reason: "", model: "", autonomous: false,
        history_size: 0, created_at: new Date().toISOString(),
      },
    }));
    expect(screen.queryByText(/Meta-LLM would/)).not.toBeInTheDocument();
  });

  it("spells the row count into the approve button", () => {
    renderPanel();
    expect(screen.getByText("Delete 1,240 rows")).toBeInTheDocument();
  });

  it("approving resumes the run", async () => {
    const onUpdate = renderPanel();
    fireEvent.click(screen.getByText("Delete 1,240 rows"));
    await waitFor(() => expect(approveWorkflowRun).toHaveBeenCalledWith("run-1"));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });

  it("rejecting carries the typed reason", async () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(/Reason/), {
      target: { value: "wrong bucket" },
    });
    fireEvent.click(screen.getByText("Keep the data"));
    await waitFor(() =>
      expect(rejectWorkflowRun).toHaveBeenCalledWith("run-1", { reason: "wrong bucket" }),
    );
  });

  it("sends no reason when the field was left empty", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("Keep the data"));
    await waitFor(() =>
      expect(rejectWorkflowRun).toHaveBeenCalledWith("run-1", { reason: undefined }),
    );
  });

  it("hides the buttons the instant one is clicked", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("Delete 1,240 rows"));
    // Double-clicking a deletion must not be able to send it twice while the
    // resume is in flight.
    await waitFor(() =>
      expect(screen.getByText("Approving the deletion…")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Keep the data")).not.toBeInTheDocument();
  });

  it("puts the buttons back when the decision fails to reach the backend", async () => {
    vi.mocked(approveWorkflowRun).mockRejectedValueOnce(new Error("network down"));
    renderPanel();
    fireEvent.click(screen.getByText("Delete 1,240 rows"));
    await waitFor(() => expect(screen.getByText("network down")).toBeInTheDocument());
    expect(screen.getByText("Delete 1,240 rows")).toBeInTheDocument();
  });
});
