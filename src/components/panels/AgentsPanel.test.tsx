import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listAgentSummaries: vi.fn(async () => []),
    deleteAgent: vi.fn(async () => undefined),
  };
});

import { AgentsPanel } from "./AgentsPanel";
import { deleteAgent, listAgentSummaries, type AgentSummary } from "@/lib/api";

// A summary is all the panel gets: no agent_input, no addons.
const planner: AgentSummary = {
  id: "planner",
  name: "Planner",
  description: "Breaks a goal into steps",
  default_runtime: "local",
};

function renderPanel(props: Partial<React.ComponentProps<typeof AgentsPanel>> = {}) {
  const onOpen = vi.fn();
  const onNew = vi.fn();
  render(<AgentsPanel onClose={vi.fn()} onOpen={onOpen} onNew={onNew} {...props} />);
  return { onOpen, onNew };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAgentSummaries).mockResolvedValue([planner]);
});

describe("AgentsPanel", () => {
  it("lists agents by name and runtime", async () => {
    renderPanel();

    expect(await screen.findByText("Planner")).toBeInTheDocument();
    expect(screen.getByText("local")).toBeInTheDocument();
  });

  it("hands a clicked agent's id to the centre editor instead of opening a dialog", async () => {
    const { onOpen } = renderPanel();

    fireEvent.click(await screen.findByText("Planner"));

    // An id, not the row: the row is a summary and the editor needs the full
    // agent, which the caller fetches.
    expect(onOpen).toHaveBeenCalledWith("planner");
    // The editor lives in the main window now — nothing is layered over the app.
    expect(screen.queryByText("Edit Agent")).not.toBeInTheDocument();
  });

  it("asks the centre editor for a blank agent rather than a create dialog", async () => {
    const { onNew } = renderPanel();
    await screen.findByText("Planner");

    fireEvent.click(screen.getByTitle("New agent"));

    expect(onNew).toHaveBeenCalled();
    expect(screen.queryByText("Create Agent")).not.toBeInTheDocument();
  });

  it("marks the agent the centre editor is showing", async () => {
    renderPanel({ selectedId: "planner" });

    const row = (await screen.findByText("Planner")).closest("div.group");
    expect(row?.className).toContain("border-fuchsia-600");
  });

  it("asks before deleting, then reloads", async () => {
    renderPanel();
    await screen.findByText("Planner");

    fireEvent.click(screen.getByTitle("Delete"));
    expect(await screen.findByText("Delete agent?")).toBeInTheDocument();
    expect(deleteAgent).not.toHaveBeenCalled();

    // The dialog's Delete — the row's icon button carries the same label.
    const deletes = screen.getAllByRole("button", { name: /^Delete$/ });
    fireEvent.click(deletes[deletes.length - 1]);

    await waitFor(() => expect(deleteAgent).toHaveBeenCalledWith("planner"));
    expect(listAgentSummaries).toHaveBeenCalledTimes(2);
  });

  it("refetches when the centre editor reports a save", async () => {
    const { rerender } = render(
      <AgentsPanel onClose={vi.fn()} onOpen={vi.fn()} onNew={vi.fn()} reloadToken={0} />,
    );
    await screen.findByText("Planner");

    rerender(<AgentsPanel onClose={vi.fn()} onOpen={vi.fn()} onNew={vi.fn()} reloadToken={1} />);

    await waitFor(() => expect(listAgentSummaries).toHaveBeenCalledTimes(2));
  });

  it("surfaces a load failure instead of showing an empty list", async () => {
    vi.mocked(listAgentSummaries).mockRejectedValue(new Error("API 500: boom"));
    renderPanel();

    expect(await screen.findByText("API 500: boom")).toBeInTheDocument();
  });
});
