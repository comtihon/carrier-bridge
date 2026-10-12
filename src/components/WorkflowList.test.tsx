import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkflowList } from "./WorkflowList";
import type { WorkflowRun } from "@/lib/types";

function makeRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflow_id: "wf-1",
    workflow_name: "Test Workflow",
    user_request: "do something",
    status: "completed",
    steps: [],
    approval_status: "not_required",
    approval_gates: [],
    tool_call_results: [],
    llm_agent_results: [],
    action_results: [],
    execution_results: [],
    intermediate_outputs: {},
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const noop = vi.fn();

const baseProps = {
  selectedRunId: null as string | null,
  onSelect: noop,
  onRemove: noop,
};

describe("WorkflowList", () => {
  it("shows empty state when there are no runs", () => {
    render(<WorkflowList {...baseProps} runIds={[]} runs={{}} />);
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
  });

  it("renders a run card", () => {
    const runs = { r1: makeRun("r1", { workflow_name: "My Workflow" }) };
    render(<WorkflowList {...baseProps} runIds={["r1"]} runs={runs} />);
    expect(screen.getByText("My Workflow")).toBeInTheDocument();
  });

  it("filters by workflow_name (case-insensitive)", () => {
    const runs = {
      r1: makeRun("r1", { workflow_name: "Feature Flow" }),
      r2: makeRun("r2", { workflow_name: "Bug Fix" }),
    };
    render(<WorkflowList {...baseProps} runIds={["r1", "r2"]} runs={runs} />);

    fireEvent.change(screen.getByPlaceholderText("Search runs…"), {
      target: { value: "feature" },
    });

    expect(screen.getByText("Feature Flow")).toBeInTheDocument();
    expect(screen.queryByText("Bug Fix")).not.toBeInTheDocument();
  });

  it("filters by user_request (case-insensitive)", () => {
    const runs = {
      r1: makeRun("r1", { user_request: "add dark mode support" }),
      r2: makeRun("r2", { user_request: "fix login bug" }),
    };
    render(<WorkflowList {...baseProps} runIds={["r1", "r2"]} runs={runs} />);

    fireEvent.change(screen.getByPlaceholderText("Search runs…"), {
      target: { value: "dark" },
    });

    expect(screen.getByText("add dark mode support")).toBeInTheDocument();
    expect(screen.queryByText("fix login bug")).not.toBeInTheDocument();
  });

  it("search is case-insensitive", () => {
    const runs = { r1: makeRun("r1", { workflow_name: "UPPERCASE FLOW" }) };
    render(<WorkflowList {...baseProps} runIds={["r1"]} runs={runs} />);

    fireEvent.change(screen.getByPlaceholderText("Search runs…"), {
      target: { value: "uppercase" },
    });

    expect(screen.getByText("UPPERCASE FLOW")).toBeInTheDocument();
  });

  it("filters by status pill", () => {
    const runs = {
      r1: makeRun("r1", { workflow_name: "Running Flow", status: "running" }),
      r2: makeRun("r2", { workflow_name: "Done Flow", status: "completed" }),
    };
    render(<WorkflowList {...baseProps} runIds={["r1", "r2"]} runs={runs} />);

    fireEvent.click(screen.getByRole("button", { name: "Running" }));

    expect(screen.getByText("Running Flow")).toBeInTheDocument();
    expect(screen.queryByText("Done Flow")).not.toBeInTheDocument();
  });

  it("combines search and status filters", () => {
    const runs = {
      r1: makeRun("r1", { workflow_name: "Alpha", status: "running", user_request: "build alpha" }),
      r2: makeRun("r2", { workflow_name: "Beta", status: "running", user_request: "build beta" }),
      r3: makeRun("r3", { workflow_name: "Alpha Done", status: "completed", user_request: "build alpha" }),
    };
    render(<WorkflowList {...baseProps} runIds={["r1", "r2", "r3"]} runs={runs} />);

    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    fireEvent.change(screen.getByPlaceholderText("Search runs…"), {
      target: { value: "alpha" },
    });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Alpha Done")).not.toBeInTheDocument();
  });

  it("shows empty filter message when nothing matches", () => {
    const runs = { r1: makeRun("r1", { status: "completed" }) };
    render(<WorkflowList {...baseProps} runIds={["r1"]} runs={runs} />);

    fireEvent.click(screen.getByRole("button", { name: "Running" }));

    expect(screen.getByText("No runs match your filter.")).toBeInTheDocument();
  });

  it("clears all filters via 'Clear filters' link", () => {
    const runs = { r1: makeRun("r1", { workflow_name: "Flow X", status: "completed" }) };
    render(<WorkflowList {...baseProps} runIds={["r1"]} runs={runs} />);

    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    fireEvent.click(screen.getByText("Clear filters"));

    expect(screen.getByText("Flow X")).toBeInTheDocument();
  });

  it("clears search text with the × button", () => {
    const runs = {
      r1: makeRun("r1", { workflow_name: "Alpha Flow" }),
      r2: makeRun("r2", { workflow_name: "Beta Flow" }),
    };
    render(<WorkflowList {...baseProps} runIds={["r1", "r2"]} runs={runs} />);

    fireEvent.change(screen.getByPlaceholderText("Search runs…"), {
      target: { value: "alpha" },
    });
    expect(screen.queryByText("Beta Flow")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.getByText("Beta Flow")).toBeInTheDocument();
  });

  it("shows run count when a filter is active", () => {
    const runs = {
      r1: makeRun("r1", { status: "running" }),
      r2: makeRun("r2", { status: "completed" }),
    };
    render(<WorkflowList {...baseProps} runIds={["r1", "r2"]} runs={runs} />);

    fireEvent.click(screen.getByRole("button", { name: "Running" }));

    expect(screen.getByText("1 of 2 runs")).toBeInTheDocument();
  });

  it("resets to all runs when 'All' pill is clicked", () => {
    const runs = {
      r1: makeRun("r1", { workflow_name: "Flow X", status: "completed" }),
    };
    render(<WorkflowList {...baseProps} runIds={["r1"]} runs={runs} />);

    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    expect(screen.queryByText("Flow X")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Flow X")).toBeInTheDocument();
  });
});
