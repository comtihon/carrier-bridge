import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor(_t?: string) {} });

const agents = [
  {
    id: "coder", name: "Coder", description: "Writes code in the repo", default_runtime: "k8s",
    agent_input: {}, image: null, helm_chart: null, helm_values: {},
    addons: [{ type: "tools", tools: { gh: true, kubectl: false } }],
  },
  {
    id: "validator", name: "Validator", description: null, default_runtime: "k8s",
    agent_input: {}, image: null, helm_chart: null, helm_values: {},
    addons: [
      { type: "datasource", source_id: "survey", allowed_operations: ["get"] },
      { type: "mcp", servers: { blender: true } },
    ],
  },
];

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listAgents: vi.fn(async () => agents),
    approveWorkflowRun: vi.fn(async (id: string) => ({ id })),
    rejectWorkflowRun: vi.fn(async (id: string) => ({ id })),
    agentReply: vi.fn(async () => undefined),
  };
});

import * as api from "@/lib/api";
import { WorkflowEditor, apiStepToConfig, editableToApiPayload } from "../WorkflowEditor";
import { DynamicDecisionPanel } from "./DynamicDecisionPanel";
import { DynamicRunView } from "./DynamicRunView";
import { addonBadges } from "./DynamicWorkflowEditor";
import { layoutDag } from "./dagLayout";
import { dynamicConfigProblems, isDynamicWorkflow, newDynamicWorkflow } from "./dynamicWorkflow";
import type { DynamicRunState, EditableWorkflowDefinition, WorkflowRun } from "@/lib/types";

beforeEach(() => vi.clearAllMocks());

describe("dynamic workflow model", () => {
  it("recognises a dynamic workflow, with or without a trigger", () => {
    const wf = newDynamicWorkflow("w1");
    expect(isDynamicWorkflow(wf)).toBe(true);
    expect(isDynamicWorkflow({ nodes: [{ id: "t", type: "http", name: "t" }, ...wf.nodes] })).toBe(true);
    expect(isDynamicWorkflow({ nodes: [{ id: "x", type: "llm", name: "x" }, ...wf.nodes] })).toBe(false);
    expect(isDynamicWorkflow({ nodes: [] })).toBe(false);
  });

  it("round-trips the dynamic config through the API step format", () => {
    const wf = newDynamicWorkflow("w1");
    wf.nodes[0].dynamic = { ...wf.nodes[0].dynamic!, agent_pool: [{ agent_id: "coder", max_instances: 3, categories: ["execution"] }], automation: "auto" };
    const payload = editableToApiPayload(wf);
    const step = (payload.steps as Record<string, unknown>[])[0];
    expect(step).toMatchObject({ id: "orchestrator", type: "dynamic", automation: "auto", next: "END" });
    expect(step.agent_pool).toEqual([{ agent_id: "coder", max_instances: 3, categories: ["execution"] }]);
    const back = apiStepToConfig(step);
    expect(back.dynamic?.automation).toBe("auto");
    expect(back.dynamic?.agent_pool[0].agent_id).toBe("coder");
    expect((back.dynamic as unknown as Record<string, unknown>).next).toBeUndefined();
  });

  it("reports config problems the backend would refuse", () => {
    expect(dynamicConfigProblems({ agent_pool: [] })).toContain("Select at least one agent for the pool.");
    expect(dynamicConfigProblems({ agent_pool: [{ agent_id: "v", categories: ["validation"] }] }).join()).toMatch(/execution/);
    expect(dynamicConfigProblems({ agent_pool: [{ agent_id: "c" }] })).toEqual([]);
  });

  it("summarises addons as badges", () => {
    expect(addonBadges(agents[1].addons as never)).toEqual(["Datasource: survey (1 ops)", "MCP: blender"]);
    expect(addonBadges(agents[0].addons as never)).toEqual(["Tools: gh"]);
  });
});

describe("dynamic designer", () => {
  it("shows configuration instead of a canvas and saves the selected pool", async () => {
    const onSave = vi.fn();
    render(<WorkflowEditor workflow={newDynamicWorkflow("w1")} onSave={onSave} />);
    await waitFor(() => expect(screen.getByTestId("pool-agent-coder")).toBeTruthy());
    // The validator has no description: the author is told why that matters.
    expect(screen.getByText(/picks agents by their description/)).toBeTruthy();

    const save = screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // empty pool

    fireEvent.click(screen.getByLabelText("Use Coder"));
    fireEvent.change(screen.getByLabelText("Automation mode"), { target: { value: "ask" } });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);

    const saved = onSave.mock.calls[0][0] as EditableWorkflowDefinition;
    expect(saved.nodes).toHaveLength(1);
    expect(saved.nodes[0].dynamic?.agent_pool).toEqual([{ agent_id: "coder", max_instances: 1, categories: [] }]);
    expect(saved.nodes[0].dynamic?.automation).toBe("ask");
  });
});

const dag: DynamicRunState = {
  step_id: "orchestrator",
  status: "waiting_approval",
  jobs: [
    { id: "code", category: "execution", agent_id: "coder", title: "Code", prompt: "do it", depends_on: [], owns: ["src/**"], status: "finished", attempts: [{ n: 1, child_run_id: "c1", status: "finished", started_at: "2026-10-07T10:00:00Z", reason: "initial" }, { n: 2, child_run_id: "c2", status: "running", started_at: "2026-10-07T10:05:00Z", reason: "handback", feedback: "fix tests" }], awaiting: [], created_by: "dispatcher" },
    { id: "test", category: "validation", agent_id: "validator", title: "Test", prompt: "check", depends_on: ["code"], owns: [], status: "pending", attempts: [], awaiting: [], created_by: "dispatcher" },
    { id: "code-help", category: "planning", agent_id: "coder", title: "Help", prompt: "find api", depends_on: [], owns: [], status: "finished", attempts: [], delegated_by: "code", awaiting: [], created_by: "delegation" },
  ],
  decisions: [
    { id: "d1", kind: "handback", summary: "test → code", payload: { by: "test", targets: ["code"], feedback: "fix" }, created_at: "", resolved: true, approved: true },
    { id: "d2", kind: "question", summary: "code asks", payload: { job_id: "code", questions: ["Which DB?"] }, created_at: "", resolved: false },
  ],
  events: [],
  replans: 0,
  delegations: 1,
  expanded: true,
  usage: {},
};

describe("agent DAG layout", () => {
  it("places jobs by dependency depth and draws handback and delegation edges", () => {
    const l = layoutDag(dag);
    expect(l.depth).toEqual({ code: 0, test: 1, "code-help": 1 });
    const kinds = l.edges.map((e) => `${e.kind}:${e.source}->${e.target}`).sort();
    expect(kinds).toEqual(["delegate:code->code-help", "depends:code->test", "handback:test->code"]);
    expect(l.edges.find((e) => e.kind === "handback")?.count).toBe(1);
  });
});

const run = {
  id: "r1", workflow_id: "w", workflow_name: "w", user_request: "x", status: "waiting_approval",
  steps: [], approval_status: "pending", approval_gates: [], tool_call_results: [], llm_agent_results: [],
  action_results: [], execution_results: [], intermediate_outputs: {}, metadata: {}, created_at: "", updated_at: "",
  dynamic: { orchestrator: dag },
  dynamic_jobs: { c2: { status: "running", job_id: "code", progress: ["editing src/a.ts"], pending_question: null } },
} as unknown as WorkflowRun;

describe("run view", () => {
  it("renders the agent DAG with a review button for open decisions", async () => {
    render(<div style={{ width: 800, height: 600 }}><DynamicRunView run={run} onUpdate={vi.fn()} /></div>);
    expect(screen.getByText(/1 decision to review/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("job-node-code")).toBeTruthy());
  });

  it("approves with the answers typed for an agent question", async () => {
    const onUpdate = vi.fn();
    render(<DynamicDecisionPanel run={run} state={dag} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Answer: Which DB?"), { target: { value: "postgres" } });
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(api.approveWorkflowRun).toHaveBeenCalledWith("r1", { corrections: { answers: { "Which DB?": "postgres" } } });
  });

  it("rejects with a reason", async () => {
    render(<DynamicDecisionPanel run={run} state={dag} onUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "no" } });
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    await waitFor(() => expect(api.rejectWorkflowRun).toHaveBeenCalledWith("r1", { reason: "no" }));
  });
});
