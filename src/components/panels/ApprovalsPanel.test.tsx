/**
 * The approvals queue.
 *
 * A held deletion can be answered from two places — its own run, or here — and
 * a deletion an agent's tool call opened can only be answered here. So the
 * tests are about the queue staying honest: what each row shows, what a click
 * sends, and that the veto countdown is a countdown rather than a label.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listApprovals: vi.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
    decideApproval: vi.fn(async () => ({}) as never),
    vetoApproval: vi.fn(async () => ({}) as never),
  };
});

import { decideApproval, listApprovals, vetoApproval } from "@/lib/api";
import { ApprovalsPanel } from "./ApprovalsPanel";
import type { ApprovalCase } from "@/lib/types";

function makeCase(overrides: Partial<ApprovalCase> = {}): ApprovalCase {
  return {
    id: "apr_1",
    status: "pending",
    workflow_id: "wf-1",
    workflow_name: "Nightly cleanup",
    run_id: "run-1",
    step_id: "purge",
    agent_id: "",
    surface: "workflow",
    datasource_id: "files",
    datasource_name: "File store",
    operation: "drop_stale",
    method: "DELETE",
    endpoint: "DELETE https://files.test/files/f1",
    targets: [],
    params: {},
    affected_rows: 42,
    affected_sample: [],
    history_key: "wf-1|files|drop_stale",
    meta_llm: null,
    decision_source: null,
    decided_by_name: "",
    decided_by_id: "",
    decided_at: null,
    reason: "",
    veto_deadline: null,
    vetoed_by: "",
    slack_channel: "",
    slack_ts: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function serve(items: ApprovalCase[]) {
  vi.mocked(listApprovals).mockImplementation(async () => ({
    items, total: items.length, limit: 50, offset: 0,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  serve([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ApprovalsPanel", () => {
  it("opens on the pending queue, because that is what needs clearing", async () => {
    render(<ApprovalsPanel onClose={vi.fn()} />);
    await waitFor(() =>
      expect(listApprovals).toHaveBeenCalledWith({
        status: "pending", limit: 50, view: "summary",
      }),
    );
  });

  it("asks for summaries, not for every case in full", async () => {
    // The row shows a dozen short fields. A write case's affected_sample is a
    // before/after for every cell, and fifty of those made the panel slow to
    // open for no visible gain.
    render(<ApprovalsPanel onClose={vi.fn()} />);
    await waitFor(() =>
      expect(vi.mocked(listApprovals).mock.calls[0][0]).toMatchObject({ view: "summary" }),
    );
  });

  it("says so when nothing is waiting", async () => {
    render(<ApprovalsPanel onClose={vi.fn()} />);
    expect(await screen.findByText("Nothing waiting for approval.")).toBeInTheDocument();
  });

  it("shows the row count and the verb on every row", async () => {
    serve([makeCase()]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/42 rows/)).toBeInTheDocument();
    expect(screen.getByText("DELETE")).toBeInTheDocument();
  });

  it("marks a case an agent opened as one", async () => {
    serve([makeCase({ surface: "mcp", workflow_name: "" , workflow_id: ""})]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/agent tool call/)).toBeInTheDocument();
  });

  it("approving sends the decision and reloads", async () => {
    serve([makeCase()]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("Approve"));
    await waitFor(() =>
      expect(decideApproval).toHaveBeenCalledWith("apr_1", { approved: true }),
    );
    await waitFor(() => expect(listApprovals).toHaveBeenCalledTimes(2));
  });

  it("rejecting sends the opposite", async () => {
    serve([makeCase()]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("Reject"));
    await waitFor(() =>
      expect(decideApproval).toHaveBeenCalledWith("apr_1", { approved: false }),
    );
  });

  it("surfaces a failed decision instead of silently dropping it", async () => {
    serve([makeCase()]);
    vi.mocked(decideApproval).mockRejectedValueOnce(new Error("already decided"));
    render(<ApprovalsPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("Approve"));
    expect(await screen.findByText("already decided")).toBeInTheDocument();
  });

  it("offers no buttons on a case that is already answered", async () => {
    serve([makeCase({
      status: "approved", decision_source: "ui",
      decided_by_name: "ada", reason: "expected cleanup",
    })]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/approved by ada/)).toBeInTheDocument();
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
  });

  it("labels a meta-LLM recommendation as a suggestion until it is the decision", async () => {
    serve([makeCase({
      meta_llm: {
        decision: "approve", reason: "matches prior runs", model: "m",
        autonomous: false, history_size: 4, created_at: new Date().toISOString(),
      },
    })]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Meta-LLM suggests: approve/)).toBeInTheDocument();
  });

  it("says the meta-LLM decided when it did", async () => {
    serve([makeCase({
      status: "approved",
      decision_source: "meta_llm",
      meta_llm: {
        decision: "approve", reason: "ten identical prior decisions", model: "m",
        autonomous: true, history_size: 10, created_at: new Date().toISOString(),
      },
    })]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Meta-LLM decided: approve/)).toBeInTheDocument();
  });

  it("counts down the veto window and offers the cancel", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve([makeCase({
      status: "approved",
      decision_source: "meta_llm",
      veto_deadline: new Date(Date.now() + 30_000).toISOString(),
    })]);
    render(<ApprovalsPanel onClose={vi.fn()} />);

    expect(await screen.findByText(/Runs in 30s unless cancelled/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.getByText(/Runs in 27s unless cancelled/)).toBeInTheDocument();
  });

  it("cancelling inside the window calls the veto", async () => {
    serve([makeCase({
      status: "approved",
      decision_source: "meta_llm",
      veto_deadline: new Date(Date.now() + 30_000).toISOString(),
    })]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("Cancel"));
    await waitFor(() => expect(vetoApproval).toHaveBeenCalledWith("apr_1"));
  });

  it("shows no countdown once the window has closed", async () => {
    serve([makeCase({
      status: "approved",
      decision_source: "meta_llm",
      veto_deadline: new Date(Date.now() - 1_000).toISOString(),
    })]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    await screen.findByText(/42 rows/);
    expect(screen.queryByText(/unless cancelled/)).not.toBeInTheDocument();
  });

  it("clicking a row opens the case in the main window", async () => {
    const onOpen = vi.fn();
    serve([makeCase()]);
    render(<ApprovalsPanel onClose={vi.fn()} onOpen={onOpen} />);
    fireEvent.click(await screen.findByTitle("Open this case"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "apr_1" }));
  });

  it("deciding from the row does not also open the case", async () => {
    const onOpen = vi.fn();
    serve([makeCase()]);
    render(<ApprovalsPanel onClose={vi.fn()} onOpen={onOpen} />);
    fireEvent.click(await screen.findByText("Approve"));
    await waitFor(() => expect(decideApproval).toHaveBeenCalled());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks the row the main window is showing", async () => {
    serve([makeCase()]);
    render(<ApprovalsPanel onClose={vi.fn()} onOpen={vi.fn()} selectedId="apr_1" />);
    const row = await screen.findByTitle("Open this case");
    expect(row.className).toContain("border-amber-500");
  });

  it("the All filter drops the status query entirely", async () => {
    serve([makeCase()]);
    render(<ApprovalsPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("All"));
    await waitFor(() =>
      expect(listApprovals).toHaveBeenLastCalledWith({
        status: undefined, limit: 50, view: "summary",
      }),
    );
  });
});
