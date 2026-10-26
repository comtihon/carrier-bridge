import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepWaitNotice } from "./StepWaitNotice";

afterEach(() => {
  vi.useRealTimers();
});

describe("StepWaitNotice", () => {
  it("shows when a step parked on a usage limit resumes, and the agent's message", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 14, 30));
    const state = {
      _quota_wait_review: {
        resume_at: new Date(2026, 9, 26, 15, 42).toISOString(),
        kind: "usage_limit",
        message: "You've hit your limit · resets 3:42pm",
        agent_id: "claude-laptop",
        since: new Date(2026, 9, 26, 14, 0).toISOString(),
      },
    };
    render(<StepWaitNotice state={state} stepId="review" />);

    expect(screen.getByText("Usage limit reached — resumes at 15:42 (in 1h 12m)")).toBeInTheDocument();
    expect(screen.getByText("You've hit your limit · resets 3:42pm")).toBeInTheDocument();
  });

  it("waits for the reset when the limit gave no time", () => {
    const state = {
      _quota_wait_review: { resume_at: null, kind: "usage_limit", message: "", agent_id: "a", since: "" },
    };
    render(<StepWaitNotice state={state} stepId="review" />);

    expect(screen.getByText("Usage limit reached — resumes when the limit resets")).toBeInTheDocument();
  });

  it("names the machine a step is waiting for", () => {
    const state = { _runner_wait_review: { runner_id: "r1", runner_name: "valerii-mbp", since: "" } };
    render(<StepWaitNotice state={state} stepId="review" />);

    expect(screen.getByRole("status")).toHaveTextContent("Waiting for machine valerii-mbp to come online");
  });

  it("renders nothing for a step that is not waiting", () => {
    const state = { _runner_wait_other: { runner_id: "r1", runner_name: "x", since: "" } };
    const { container } = render(<StepWaitNotice state={state} stepId="review" />);

    expect(container).toBeEmptyDOMElement();
  });
});
