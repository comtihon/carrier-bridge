/**
 * One held deletion at full size.
 *
 * The queue's row was never enough to decide on: these tests are about the
 * things a reviewer cannot get from it — the values the call would send, where
 * it came from, what was decided the last times the same operation asked — and
 * about the page not lying once the decision is recorded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getApproval: vi.fn(),
    getApprovalHistory: vi.fn(),
    decideApproval: vi.fn(),
    vetoApproval: vi.fn(),
  };
});

import {
  decideApproval, getApproval, getApprovalHistory, vetoApproval,
} from "@/lib/api";
import { ApprovalDetail } from "./ApprovalDetail";
import type { ApprovalCase, ApprovalHistoryResponse } from "@/lib/types";

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
    endpoint: "DELETE https://files.test/files",
    targets: ["files/a", "files/b"],
    params: { older_than: "30d", filter: { owner: "ada", archived: true } },
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
    created_at: new Date("2026-09-01T10:00:00Z").toISOString(),
    updated_at: new Date("2026-09-01T10:00:00Z").toISOString(),
    ...overrides,
  };
}

function history(overrides: Partial<ApprovalHistoryResponse> = {}): ApprovalHistoryResponse {
  return {
    history_key: "wf-1|files|drop_stale",
    items: [],
    streak: 0,
    streak_decision: null,
    threshold: 10,
    autonomous_next: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApproval).mockImplementation(async (id: string) => makeCase({ id }));
  vi.mocked(getApprovalHistory).mockResolvedValue(history());
});

describe("ApprovalDetail", () => {
  it("re-reads the case, because the queue row can be stale", async () => {
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    await waitFor(() => expect(getApproval).toHaveBeenCalledWith("apr_1"));
  });

  it("keeps the row count the largest thing on the page", async () => {
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText(/would be deleted/)).toBeInTheDocument();
  });

  it("shows the data source, the operation and the endpoint the call would hit", async () => {
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(await screen.findByText("Endpoint")).toBeInTheDocument();
    expect(screen.getByText("DELETE https://files.test/files")).toBeInTheDocument();
    expect(screen.getAllByText(/drop_stale/).length).toBeGreaterThan(0);
  });

  it("shows every value the call sends, objects included", async () => {
    const { container } = render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(await screen.findByText("older_than")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
    expect(screen.getByText("filter")).toBeInTheDocument();
    // An object value is a foldable tree, so its text is spread over rows.
    expect(container.textContent).toContain("owner");
    expect(container.textContent).toContain("ada");
    expect(container.textContent).toContain("archived");
  });

  it("unfolds a JSON body that reached the parameter as a string", async () => {
    const item = makeCase({ params: { body: '{"ids":[1,2,3],"hard":true}' } });
    vi.mocked(getApproval).mockResolvedValue(item);
    const { container } = render(<ApprovalDetail caseItem={item} onClose={vi.fn()} />);
    await screen.findByText("body");
    expect(screen.getByText("JSON")).toBeInTheDocument();
    expect(container.textContent).toContain("ids");
    expect(container.textContent).toContain("hard");
  });

  it("waits for the full read before saying anything about the values", async () => {
    // The queue hands over a summary row: no params key at all. Saying "the
    // call sends no parameters" there would be a lie about a deletion.
    const { params, targets, affected_sample, ...summary } = makeCase();
    void params; void targets; void affected_sample;
    let release: (c: ApprovalCase) => void = () => {};
    vi.mocked(getApproval).mockImplementation(
      () => new Promise<ApprovalCase>((res) => { release = res; }),
    );

    render(<ApprovalDetail caseItem={summary} onClose={vi.fn()} />);

    expect(await screen.findByText("Loading the values…")).toBeInTheDocument();
    expect(screen.queryByText("The call sends no parameters.")).not.toBeInTheDocument();

    release(makeCase());
    expect(await screen.findByText("older_than")).toBeInTheDocument();
  });

  it("says so rather than leaving the section blank when there are no values", async () => {
    const item = makeCase({ params: {} });
    vi.mocked(getApproval).mockResolvedValue(item);
    render(<ApprovalDetail caseItem={item} onClose={vi.fn()} />);
    expect(await screen.findByText("The call sends no parameters.")).toBeInTheDocument();
  });

  it("surfaces the context the backend attached, generated values included", async () => {
    const item = makeCase({
      change_kind: "write",
      details: { Document: "Q3 targets", Values: "produced by generated code" },
    });
    vi.mocked(getApproval).mockResolvedValue(item);
    render(<ApprovalDetail caseItem={item} onClose={vi.fn()} />);
    expect(await screen.findByText("Context")).toBeInTheDocument();
    expect(screen.getByText("produced by generated code")).toBeInTheDocument();
  });

  it("says written, not deleted, for a write case", async () => {
    const item = makeCase({ change_kind: "write" });
    vi.mocked(getApproval).mockResolvedValue(item);
    render(<ApprovalDetail caseItem={item} onClose={vi.fn()} />);
    expect(await screen.findByText(/would be written/)).toBeInTheDocument();
  });

  it("names the workflow, run and step the call came from", async () => {
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(await screen.findByText("Nightly cleanup")).toBeInTheDocument();
    expect(screen.getByText("run-1")).toBeInTheDocument();
    expect(screen.getByText("purge")).toBeInTheDocument();
  });

  it("offers a way through to the workflow and the run", async () => {
    const onOpenWorkflow = vi.fn();
    const onOpenRun = vi.fn();
    render(
      <ApprovalDetail
        caseItem={makeCase()}
        onClose={vi.fn()}
        onOpenWorkflow={onOpenWorkflow}
        onOpenRun={onOpenRun}
      />,
    );
    fireEvent.click(await screen.findByText("Open workflow"));
    expect(onOpenWorkflow).toHaveBeenCalledWith("wf-1");
    fireEvent.click(screen.getByText("Open run"));
    expect(onOpenRun).toHaveBeenCalledWith("run-1");
  });

  it("labels the meta-LLM verdict as a recommendation while it is advice", async () => {
    const item = makeCase({
      meta_llm: {
        decision: "reject", reason: "twice the usual scope", model: "m",
        autonomous: false, history_size: 3, created_at: new Date().toISOString(),
      },
    });
    vi.mocked(getApproval).mockResolvedValue(item);
    render(<ApprovalDetail caseItem={item} onClose={vi.fn()} />);
    expect(await screen.findByText("Recommended action")).toBeInTheDocument();
    expect(screen.getByText(/Meta-LLM would reject/)).toBeInTheDocument();
    expect(screen.getByText(/twice the usual scope/)).toBeInTheDocument();
  });

  it("says the meta-LLM decided when the verdict was the decision", async () => {
    const item = makeCase({
      status: "approved",
      decision_source: "meta_llm",
      meta_llm: {
        decision: "approve", reason: "ten identical prior decisions", model: "m",
        autonomous: true, history_size: 10, created_at: new Date().toISOString(),
      },
    });
    vi.mocked(getApproval).mockResolvedValue(item);
    render(<ApprovalDetail caseItem={item} onClose={vi.fn()} />);
    expect(await screen.findByText("Decision made by the meta-LLM")).toBeInTheDocument();
    expect(screen.getByText(/Meta-LLM decided to approve/)).toBeInTheDocument();
  });

  it("admits when there is no recommendation instead of implying one", async () => {
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(await screen.findByText(/the meta-LLM did not weigh in/)).toBeInTheDocument();
  });

  it("loads prior decisions on the same operation", async () => {
    vi.mocked(getApprovalHistory).mockResolvedValue(history({
      streak: 3,
      streak_decision: "approved",
      items: [
        makeCase({
          id: "apr_0", status: "approved", affected_rows: 40,
          decided_by_name: "ada", reason: "routine", decision_source: "ui",
          decided_at: new Date("2026-08-30T09:00:00Z").toISOString(),
        }),
      ],
    }));
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(getApprovalHistory).toHaveBeenCalledWith({
        workflowId: "wf-1", datasourceId: "files", operation: "drop_stale",
        limit: 20, view: "summary",
      }),
    );
    expect(await screen.findByText(/40 rows · by ada/)).toBeInTheDocument();
    expect(screen.getByText(/3 identical approved decisions in a row/)).toBeInTheDocument();
  });

  it("leaves the current case out of its own history", async () => {
    vi.mocked(getApprovalHistory).mockResolvedValue(history({
      items: [makeCase({ id: "apr_1" })],
    }));
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(await screen.findByText(/this is the first time it has asked/)).toBeInTheDocument();
  });

  it("warns when the next identical call is decided without a human", async () => {
    vi.mocked(getApprovalHistory).mockResolvedValue(history({
      streak: 10, streak_decision: "approved", autonomous_next: true,
    }));
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(
      await screen.findByText(/decided by the meta-LLM without asking/),
    ).toBeInTheDocument();
  });

  it("keeps the page readable when the history call fails", async () => {
    vi.mocked(getApprovalHistory).mockRejectedValue(new Error("no history backend"));
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(
      await screen.findByText(/Prior decisions unavailable — no history backend/),
    ).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("approving sends the typed reason with the decision", async () => {
    vi.mocked(decideApproval).mockResolvedValue(makeCase({
      status: "approved", decided_by_name: "ada", reason: "expected cleanup",
    }));
    const onDecided = vi.fn();
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} onDecided={onDecided} />);
    fireEvent.change(
      await screen.findByPlaceholderText("Reason (recorded with the decision)"),
      { target: { value: "expected cleanup" } },
    );
    fireEvent.click(screen.getByText("Approve 42 rows"));
    await waitFor(() =>
      expect(decideApproval).toHaveBeenCalledWith("apr_1", {
        approved: true, reason: "expected cleanup",
      }),
    );
    expect(onDecided).toHaveBeenCalled();
  });

  it("shows the recorded decision instead of the buttons once it is answered", async () => {
    vi.mocked(decideApproval).mockResolvedValue(makeCase({
      status: "rejected", decided_by_name: "ada", reason: "too broad",
      decided_at: new Date("2026-09-01T11:00:00Z").toISOString(),
    }));
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("Reject"));
    await waitFor(() => expect(screen.queryByText("Reject")).not.toBeInTheDocument());
    expect(screen.getByText(/rejected by ada/)).toBeInTheDocument();
    expect(screen.getByText(/too broad/)).toBeInTheDocument();
  });

  it("surfaces a failed decision rather than pretending it landed", async () => {
    vi.mocked(decideApproval).mockRejectedValue(new Error("already decided"));
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("Approve 42 rows"));
    expect(await screen.findByText("already decided")).toBeInTheDocument();
    expect(screen.getByText("Approve 42 rows")).toBeInTheDocument();
  });

  it("offers the veto while an autonomous decision's window is open", async () => {
    const item = makeCase({
      status: "approved",
      decision_source: "meta_llm",
      veto_deadline: new Date(Date.now() + 30_000).toISOString(),
    });
    vi.mocked(getApproval).mockResolvedValue(item);
    vi.mocked(vetoApproval).mockResolvedValue(makeCase({ status: "cancelled", vetoed_by: "ada" }));
    render(<ApprovalDetail caseItem={item} onClose={vi.fn()} />);
    expect(await screen.findByText(/Runs in 30s unless cancelled/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(vetoApproval).toHaveBeenCalledWith("apr_1"));
  });

  it("offers no decision on a case that is already answered", async () => {
    const item = makeCase({
      status: "approved", decision_source: "ui", decided_by_name: "ada",
      decided_at: new Date("2026-09-01T11:00:00Z").toISOString(),
    });
    vi.mocked(getApproval).mockResolvedValue(item);
    render(<ApprovalDetail caseItem={item} onClose={vi.fn()} />);
    expect(await screen.findByText(/approved by ada/)).toBeInTheDocument();
    expect(screen.queryByText("Approve 42 rows")).not.toBeInTheDocument();
    expect(screen.getByText(/were in scope/)).toBeInTheDocument();
  });

  it("still renders the handed-over row when the re-read fails", async () => {
    vi.mocked(getApproval).mockRejectedValue(new Error("case not found"));
    render(<ApprovalDetail caseItem={makeCase()} onClose={vi.fn()} />);
    expect(await screen.findByText("case not found")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
