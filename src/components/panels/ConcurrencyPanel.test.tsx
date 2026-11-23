import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listAgentConcurrency: vi.fn(async () => []),
    listRunners: vi.fn(async () => []),
  };
});

import { ConcurrencyPanel, CONCURRENCY_POLL_MS } from "./ConcurrencyPanel";
import { listAgentConcurrency, listRunners, type Runner, type RuntimeConcurrency } from "@/lib/api";

const busy: RuntimeConcurrency = {
  key: "runner:r_abc:claude",
  kind: "runner",
  runner_id: "r_abc",
  acp_agent: "claude",
  agent_id: null,
  limit: 1,
  holders: [
    { id: "t1", run_id: "run_1", step_id: "write", agent_id: "claude-on-mbp", workflow_id: "wf_1",
      acquired_at: new Date().toISOString(), hidden: false },
  ],
  queue: [
    { id: "t3", position: 2, run_id: null, step_id: null, agent_id: null, workflow_id: null,
      enqueued_at: new Date().toISOString(), hidden: true },
    { id: "t2", position: 1, run_id: "run_2", step_id: "review", agent_id: "claude-on-mbp", workflow_id: "wf_2",
      enqueued_at: new Date().toISOString(), hidden: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAgentConcurrency).mockResolvedValue([busy]);
  vi.mocked(listRunners).mockResolvedValue([{ id: "r_abc", name: "valerii-mbp" } as Runner]);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPanel() {
  const props = { onClose: vi.fn(), onOpenRun: vi.fn(), onOpenWorkflow: vi.fn(), onOpenAgent: vi.fn() };
  render(<ConcurrencyPanel {...props} />);
  return props;
}

describe("ConcurrencyPanel", () => {
  it("lists each runtime's limit, holders and queue in order", async () => {
    renderPanel();
    const card = await screen.findByTestId("concurrency-runner:r_abc:claude");

    expect(await within(card).findByText("Claude on valerii-mbp")).toBeInTheDocument();
    expect(card).toHaveTextContent("1/1 running");
    expect(card).toHaveTextContent("Limit: 1");
    expect(card).toHaveTextContent("2 queued");

    const queue = within(card).getAllByRole("listitem").slice(1);
    expect(queue[0]).toHaveTextContent("1.run_2 · step review");
    expect(queue[1]).toHaveTextContent("2.private run");
  });

  it("opens the run, workflow and agent behind a slot", async () => {
    const { onOpenRun, onOpenWorkflow, onOpenAgent } = renderPanel();
    await screen.findByTestId("concurrency-runner:r_abc:claude");

    fireEvent.click(screen.getByRole("button", { name: "run_1" }));
    expect(onOpenRun).toHaveBeenCalledWith("run_1");
    fireEvent.click(screen.getByRole("button", { name: "wf_2" }));
    expect(onOpenWorkflow).toHaveBeenCalledWith("wf_2");
    fireEvent.click(screen.getAllByRole("button", { name: "claude-on-mbp" })[0]);
    expect(onOpenAgent).toHaveBeenCalledWith("claude-on-mbp");
  });

  it("says so when nothing is limited or busy", async () => {
    vi.mocked(listAgentConcurrency).mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText("No agent runtime is limited or busy.")).toBeInTheDocument();
  });

  it("shows an unlimited runtime", async () => {
    vi.mocked(listAgentConcurrency).mockResolvedValue([
      { ...busy, key: "agent:pi", kind: "agent", runner_id: null, acp_agent: null, agent_id: "pi", limit: null, queue: [] },
    ]);
    renderPanel();
    const card = await screen.findByTestId("concurrency-agent:pi");

    expect(card).toHaveTextContent("agent pi");
    expect(card).toHaveTextContent("1/∞ running");
    expect(card).toHaveTextContent("Limit: unlimited");
  });

  it("polls while open and stops once closed", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<ConcurrencyPanel onClose={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(listAgentConcurrency).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(CONCURRENCY_POLL_MS); });
    expect(listAgentConcurrency).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => { vi.advanceTimersByTime(CONCURRENCY_POLL_MS * 3); });
    expect(listAgentConcurrency).toHaveBeenCalledTimes(2);
  });

  it("shows the backend's refusal", async () => {
    vi.mocked(listAgentConcurrency).mockRejectedValue(new Error("Not authenticated"));
    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent("Not authenticated");
  });
});
