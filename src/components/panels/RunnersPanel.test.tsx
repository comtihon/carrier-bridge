import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCurrentUser: vi.fn(async () => null),
    listRunners: vi.fn(async () => []),
    updateRunner: vi.fn(async () => ({})),
    deleteRunner: vi.fn(async () => undefined),
    addRunnerAgent: vi.fn(async () => ({})),
  };
});

import { RunnersPanel } from "./RunnersPanel";
import { addRunnerAgent, deleteRunner, listRunners, updateRunner, type Runner } from "@/lib/api";
import { resetCurrentUserCache } from "../Visibility";

const base: Runner = {
  id: "r1",
  name: "valerii-mbp",
  hostname: "valerii-mbp.local",
  os: "darwin",
  arch: "arm64",
  tz: "Europe/Berlin",
  version: "0.4.0",
  agents: ["claude", "codex"],
  default_agent: "claude",
  labels: {},
  online: true,
  last_seen: null,
  connected_at: null,
  created_at: null,
  approved_by_name: "Valerii",
  visibility: "private",
  owner_id: "u-1",
  owner_name: "Valerii",
  team_id: null,
  team_name: null,
  can_edit: true,
  limits: {},
  agent_definitions: [{ id: "claude-mbp", name: "Claude on mbp", acp_agent: "claude" }],
};

function renderPanel(props: Partial<React.ComponentProps<typeof RunnersPanel>> = {}) {
  const onConnect = vi.fn();
  const onOpenAgent = vi.fn();
  render(<RunnersPanel onClose={vi.fn()} onConnect={onConnect} onOpenAgent={onOpenAgent} {...props} />);
  return { onConnect, onOpenAgent };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCurrentUserCache();
  vi.mocked(listRunners).mockResolvedValue([base]);
});

describe("RunnersPanel", () => {
  it("shows online and offline machines with what they run", async () => {
    vi.mocked(listRunners).mockResolvedValue([
      base,
      { ...base, id: "r2", name: "build-box", online: false, os: "linux", arch: "x64",
        last_seen: new Date(Date.now() - 5 * 60_000).toISOString(), agent_definitions: [] },
    ]);
    renderPanel();

    const online = await screen.findByTestId("runner-r1");
    expect(within(online).getByTestId("runner-status")).toHaveAttribute("aria-label", "Online");
    expect(online).toHaveTextContent("darwin/arm64");
    expect(online).toHaveTextContent("v0.4.0");
    expect(online).toHaveTextContent("Owned by Valerii");

    const offline = screen.getByTestId("runner-r2");
    expect(within(offline).getByTestId("runner-status")).toHaveAttribute("aria-label", "Offline");
    expect(offline).toHaveTextContent("last seen 5m ago");
  });

  it("links an agent that is already a carrier agent and offers to add the rest", async () => {
    const { onOpenAgent } = renderPanel();
    const card = await screen.findByTestId("runner-r1");

    fireEvent.click(within(card).getByText("Claude on mbp"));
    expect(onOpenAgent).toHaveBeenCalledWith("claude-mbp");

    // Codex has no definition yet: one button, for it only.
    fireEvent.click(within(card).getByRole("button", { name: "Add as agent" }));
    await waitFor(() => expect(addRunnerAgent).toHaveBeenCalledWith("r1", { acp_agent: "codex" }));
    await waitFor(() => expect(listRunners).toHaveBeenCalledTimes(2));
  });

  it("says until when an agent is limited", async () => {
    const until = new Date();
    until.setHours(15, 42, 0, 0);
    vi.mocked(listRunners).mockResolvedValue([
      { ...base, limits: { claude: { until: until.toISOString(), kind: "usage_limit", message: "resets 3:42pm" } } },
    ]);
    renderPanel();

    expect(await screen.findByText("Claude limited until 15:42")).toBeInTheDocument();
  });

  it("asks before revoking a machine", async () => {
    renderPanel();
    await screen.findByTestId("runner-r1");

    fireEvent.click(screen.getByTitle("Disconnect / revoke"));
    expect(deleteRunner).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(deleteRunner).toHaveBeenCalledWith("r1"));
  });

  it("renames a machine", async () => {
    renderPanel();
    await screen.findByTestId("runner-r1");

    fireEvent.click(screen.getByTitle("Rename / visibility"));
    fireEvent.change(screen.getByLabelText("Runner name"), { target: { value: "laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateRunner).toHaveBeenCalledWith("r1", { name: "laptop", visibility: "private" }));
  });

  it("offers no edits on someone else's machine", async () => {
    vi.mocked(listRunners).mockResolvedValue([{ ...base, can_edit: false, agent_definitions: [] }]);
    renderPanel();
    await screen.findByTestId("runner-r1");

    expect(screen.queryByTitle("Disconnect / revoke")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add as agent" })).toBeNull();
  });

  it("opens the connect dialog from the header", async () => {
    const { onConnect } = renderPanel();
    await screen.findByTestId("runner-r1");

    fireEvent.click(screen.getByTitle("Connect a machine"));
    expect(onConnect).toHaveBeenCalled();
  });
});
