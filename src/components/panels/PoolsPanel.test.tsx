import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCurrentUser: vi.fn(async () => ({ sub: "u-ann", name: "Ann", roles: [], team: { id: "t-eng", name: "Eng", role: "member" } })),
    listRuntimePools: vi.fn(async () => []),
    listAgents: vi.fn(async () => []),
    createRuntimePool: vi.fn(async () => ({})),
    deleteRuntimePool: vi.fn(async () => undefined),
    joinRuntimePool: vi.fn(async () => ({})),
    leaveRuntimePool: vi.fn(async () => ({})),
  };
});

import { PoolsPanel } from "./PoolsPanel";
import {
  createRuntimePool, joinRuntimePool, leaveRuntimePool, listAgents, listRuntimePools,
  type AgentDefinition, type RuntimePool, type RuntimePoolMember,
} from "@/lib/api";
import { resetCurrentUserCache } from "../Visibility";

const member = (over: Partial<RuntimePoolMember>): RuntimePoolMember => ({
  agent_id: "ann-claude", name: "claude on ann-mbp", owner_name: "Ann", visibility: "private",
  runner_name: "ann-mbp", acp_agent: "claude", online: true, usable: true, limited_until: null,
  added_by_name: "Ann", added_at: null, runs: [], ...over,
});

const pool: RuntimePool = {
  id: "eng", name: "Engineering", description: null,
  visibility: "team", owner_id: "u-lead", owner_name: "Lead", team_id: "t-eng", team_name: "Eng", can_edit: false,
  members: [
    member({ runs: [{ run_id: "run-1", assigned_at: "2026-11-24T10:00:00Z", run_status: "running" }] }),
    member({ agent_id: "bob-codex", name: "codex on bob-box", owner_name: "Bob", runner_name: "bob-box",
      acp_agent: "codex", online: false }),
  ],
  member_count: 2, online_count: 1, available_count: 1,
};

const agent = (over: Partial<AgentDefinition>): AgentDefinition => ({
  id: "ann-codex", name: "codex on ann-mbp", description: null, default_runtime: "runner", agent_input: {},
  image: null, helm_chart: null, helm_values: {}, owner_id: "u-ann", ...over,
} as AgentDefinition);

beforeEach(() => {
  vi.clearAllMocks();
  resetCurrentUserCache();
  vi.mocked(listRuntimePools).mockResolvedValue([pool]);
  vi.mocked(listAgents).mockResolvedValue([
    agent({ id: "ann-claude" }),          // already a member
    agent({}),                            // joinable
    agent({ id: "bob-x", owner_id: "u-bob" }),  // someone else's (shared with Ann): not joinable by her
    agent({ id: "pod", default_runtime: "k8s" }),
  ]);
});

describe("PoolsPanel", () => {
  it("shows how many members are online and which runs hold them", async () => {
    render(<PoolsPanel onClose={vi.fn()} />);
    const card = await screen.findByTestId("pool-eng");
    expect(within(card).getByTestId("pool-online")).toHaveTextContent("1/2 online");
    const ann = within(card).getByTestId("member-ann-claude");
    expect(ann).toHaveTextContent("Claude on ann-mbp");
    expect(ann).toHaveTextContent("1 run");
    expect(within(card).getByTestId("member-bob-codex").querySelector('[aria-label="Offline"]')).not.toBeNull();
  });

  it("offers only the caller's own runner agents that are not members yet", async () => {
    render(<PoolsPanel onClose={vi.fn()} />);
    const select = await screen.findByLabelText("Add my agent to eng");
    const values = within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["", "ann-codex"]);
    fireEvent.change(select, { target: { value: "ann-codex" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(joinRuntimePool).toHaveBeenCalledWith("eng", "ann-codex"));
  });

  it("lets a member take their own agent out, not someone else's", async () => {
    render(<PoolsPanel onClose={vi.fn()} />);
    await screen.findByTestId("pool-eng");
    expect(screen.queryByLabelText("Remove bob-codex from eng")).toBeNull();
    fireEvent.click(screen.getByLabelText("Remove ann-claude from eng"));
    await waitFor(() => expect(leaveRuntimePool).toHaveBeenCalledWith("eng", "ann-claude"));
  });

  it("creates a team pool", async () => {
    vi.mocked(listRuntimePools).mockResolvedValue([]);
    render(<PoolsPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a pool" }));
    fireEvent.change(screen.getByLabelText("Pool id"), { target: { value: "Eng" } });
    fireEvent.change(screen.getByLabelText("Pool name"), { target: { value: "Engineering" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createRuntimePool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "eng", name: "Engineering", visibility: "team" })));
  });
});
