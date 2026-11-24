import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor(_t?: string) {} });

const runner = {
  id: "r1", name: "ann-mbp", hostname: "h", os: "linux", arch: "x64", tz: "UTC", version: "1",
  agents: ["claude", "codex"], default_agent: "claude", labels: {}, online: true, last_seen: null,
  connected_at: null, created_at: null, approved_by_name: null, limits: {}, agent_definitions: [],
};
const pool = {
  id: "eng", name: "Engineering", description: null, members: [], member_count: 4, online_count: 3, available_count: 3,
  visibility: "team", owner_id: "u", owner_name: "U", team_id: "t", team_name: "T",
  platforms: { linux: 3, win32: 1 }, agents: { claude: 3, codex: 1 }, agents_online: { claude: 2, codex: 1 },
};
const agents = [
  { id: "coder", name: "Coder", description: "Writes code", default_runtime: "k8s", agent_input: { system_prompt: "code" },
    image: null, helm_chart: null, helm_values: {}, addons: [{ type: "tools", tools: { gh: true } }] },
  { id: "ann-claude", name: "claude on ann-mbp", description: "machine", default_runtime: "runner", runner_id: "r1",
    agent_input: {}, image: null, helm_chart: null, helm_values: {}, addons: [] },
];

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCurrentUser: vi.fn(async () => null),
    listAgents: vi.fn(async () => agents),
    listAgentSummaries: vi.fn(async () => agents.map(({ agent_input, ...a }) => ({ ...a, has_prompt: !!agent_input.system_prompt }))),
    listRunners: vi.fn(async () => [runner]),
    listRuntimePools: vi.fn(async () => [pool]),
    listMcpIntegrations: vi.fn(async () => [{ name: "jira", enabled: true, transport: "streamable_http", configured: true }]),
    listAgentTools: vi.fn(async () => [{ name: "gh", label: "GitHub CLI", description: "", command: "gh", env_keys: [] }]),
    listDatasources: vi.fn(async () => [{ id: "jira-flow", name: "Jira flow", operations: [{ name: "get_issue", method: "GET" }, { name: "transition_issue", method: "POST" }] }]),
    updateAgent: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    listLlmProviders: vi.fn(async () => []),
  };
});
vi.mock("@/hooks/useLlmProviders", () => ({ useLlmProviders: () => ({ providers: [], defaultProvider: null }) }));

import * as api from "@/lib/api";
import {
  countsText, isRoleAgent, mergeAddons, platformLabel, runtimeFromKey, runtimeKey,
} from "@/lib/agentUsage";
import { runIdFromHash } from "@/lib/runDeepLink";
import { RuntimeSelect } from "./RuntimeSelect";
import { AddonsEditor } from "./AddonsEditor";
import { AgentModal, WorkflowEditor, apiStepToConfig, editableToApiPayload } from "./WorkflowEditor";
import { AgentsPanel } from "./panels/AgentsPanel";
import { PoolsPanel } from "./panels/PoolsPanel";
import { newDynamicWorkflow } from "./dynamic/dynamicWorkflow";
import type { AgentDefinition } from "@/lib/api";
import type { EditableWorkflowDefinition } from "@/lib/types";
import { resetCurrentUserCache } from "./Visibility";

beforeEach(() => { vi.clearAllMocks(); resetCurrentUserCache(); });

describe("agent usage helpers", () => {
  it("tells roles from a machine's own agents", () => {
    expect(isRoleAgent({ default_runtime: "k8s" })).toBe(true);
    expect(isRoleAgent({ default_runtime: "pool" })).toBe(true);
    expect(isRoleAgent({ default_runtime: "runner", agent_input: {} })).toBe(false);
    expect(isRoleAgent({ default_runtime: "runner", has_prompt: true })).toBe(true);
  });

  it("round-trips runtime selections through select keys", () => {
    for (const sel of [{ kind: "k8s" }, { kind: "runner", runner_id: "r1", acp_agent: "codex" }, { kind: "pool", pool_id: "eng" }] as const) {
      expect(runtimeFromKey(runtimeKey(sel))).toEqual(sel.kind === "k8s" ? { kind: "k8s" } : sel);
    }
    expect(runtimeFromKey("default")).toBeUndefined();
  });

  it("formats platforms and counts", () => {
    expect(countsText({ codex: 1, claude: 3 })).toBe("3 claude, 1 codex");
    expect(countsText({ linux: 2, win32: 1 }, platformLabel)).toBe("2 Linux, 1 Windows");
  });

  it("merges addons like carrier: same type replaced, data sources by source", () => {
    const merged = mergeAddons(
      [{ type: "s3", bucket: "a", path: "p" }, { type: "datasource", source_id: "x", allowed_operations: ["get"] }, { type: "datasource", source_id: "y", allowed_operations: [] }],
      [{ type: "s3", bucket: "b", path: "q" }, { type: "datasource", source_id: "x", allowed_operations: ["get", "put"] }],
    );
    expect(merged).toHaveLength(3);
    expect(merged.find((a) => a.type === "s3")).toEqual({ type: "s3", bucket: "b", path: "q" });
  });

  it("reads #run=<id> deep links", () => {
    expect(runIdFromHash("#run=fb80a8ae-5d3e")).toBe("fb80a8ae-5d3e");
    expect(runIdFromHash("#approve-runner")).toBeNull();
    expect(runIdFromHash("#run=../evil")).toBeNull();
  });
});

describe("RuntimeSelect", () => {
  it("offers runtimes, each machine's agents and runtime pools", async () => {
    const onChange = vi.fn();
    render(<RuntimeSelect value={undefined} onChange={onChange} />);
    expect(await screen.findByRole("option", { name: "ann-mbp · Codex" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Engineering (3/4 online)" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Runtime"), { target: { value: "pool:eng" } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "pool", pool_id: "eng" });
    fireEvent.change(screen.getByLabelText("Runtime"), { target: { value: "runner:r1:codex" } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "runner", runner_id: "r1", acp_agent: "codex" });
    fireEvent.change(screen.getByLabelText("Runtime"), { target: { value: "default" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("AddonsEditor", () => {
  it("adds a data source addon and grants operations", async () => {
    let value: import("@/lib/api").AgentAddonEntry[] = [];
    const { rerender } = render(<AddonsEditor value={value} onChange={(v) => { value = v; }} />);
    fireEvent.change(screen.getByLabelText("Addon type"), { target: { value: "datasource" } });
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    rerender(<AddonsEditor value={value} onChange={(v) => { value = v; }} />);
    await screen.findByRole("option", { name: "Jira flow" });
    fireEvent.change(screen.getByLabelText("Data source"), { target: { value: "jira-flow" } });
    rerender(<AddonsEditor value={value} onChange={(v) => { value = v; }} />);
    fireEvent.click(await screen.findByLabelText(/transition_issue/));
    expect(value).toEqual([{ type: "datasource", source_id: "jira-flow", allowed_operations: ["transition_issue"] }]);
  });
});

describe("agent editor addons", () => {
  it("saves the agent's addons", async () => {
    const onSave = vi.fn();
    render(<AgentModal agent={agents[0] as unknown as AgentDefinition} onSave={onSave} onClose={vi.fn()} />);
    expect(await screen.findByTestId("addon-tools")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Tools addon"));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenCalledWith("coder", expect.objectContaining({ addons: [] }));
  });
});

describe("agents vs runtimes", () => {
  it("lists only roles in the Agents panel", async () => {
    render(<AgentsPanel onClose={vi.fn()} onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(await screen.findByText("Coder")).toBeTruthy();
    expect(screen.queryByText("claude on ann-mbp")).toBeNull();
  });

  it("shows a pool's online/total, platforms and agents", async () => {
    render(<PoolsPanel onClose={vi.fn()} />);
    const card = await screen.findByTestId("pool-eng");
    expect(within(card).getByTestId("pool-online")).toHaveTextContent("3/4 online");
    expect(within(card).getByTestId("pool-summary")).toHaveTextContent("3 Linux, 1 Windows");
    expect(within(card).getByTestId("pool-summary")).toHaveTextContent("3 claude, 1 codex");
  });

  it("saves a static agent step's runtime and addons, and reads legacy runtime_override", () => {
    const cfg = apiStepToConfig({ id: "a", type: "langgraph-agent", agent_id: "coder", runtime_override: "docker" });
    expect(cfg.runtime).toEqual({ kind: "docker" });
    const wf: EditableWorkflowDefinition = {
      id: "w", name: "w", nodes: [{ ...apiStepToConfig({ id: "a", type: "langgraph-agent", agent_id: "coder" }),
        runtime: { kind: "pool", pool_id: "eng" }, addons: [{ type: "s3", bucket: "b", path: "p" }] }],
      edges: [],
    } as unknown as EditableWorkflowDefinition;
    const step = editableToApiPayload(wf).steps[0] as Record<string, unknown>;
    expect(step.runtime).toEqual({ kind: "pool", pool_id: "eng" });
    expect(step.addons).toEqual([{ type: "s3", bucket: "b", path: "p" }]);
    expect(step.runtime_override).toBeUndefined();
  });

  it("dynamic pool: roles only, runtime per agent, Slack notifications", async () => {
    const onSave = vi.fn();
    render(<WorkflowEditor workflow={newDynamicWorkflow("w1")} onSave={onSave} />);
    await waitFor(() => expect(screen.getByTestId("pool-agent-coder")).toBeTruthy());
    expect(screen.queryByTestId("pool-agent-ann-claude")).toBeNull();
    fireEvent.click(screen.getByLabelText("Use Coder"));
    await screen.findByRole("option", { name: "Engineering (3/4 online)" });
    fireEvent.change(screen.getByLabelText("Runtime for Coder"), { target: { value: "pool:eng" } });
    fireEvent.click(screen.getByLabelText("Send decisions to Slack"));
    fireEvent.change(screen.getByLabelText("Slack channel"), { target: { value: "C123" } });
    const save = screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    const saved = onSave.mock.calls[0][0] as EditableWorkflowDefinition;
    const dyn = saved.nodes[0].dynamic!;
    expect(dyn.agent_pool[0].runtime).toEqual({ kind: "pool", pool_id: "eng" });
    expect(dyn.slack_notifications).toBe(true);
    expect(dyn.slack_channel).toBe("C123");
  });
});
