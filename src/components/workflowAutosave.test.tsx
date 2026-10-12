import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// React Flow measures its pane; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor(_t?: string) {} });

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listAgents: vi.fn(async () => []),
    listDatasources: vi.fn(async () => []),
    listEvents: vi.fn(async () => []),
    listMcpIntegrations: vi.fn(async () => []),
    listAgentTools: vi.fn(async () => []),
    listConfigKeys: vi.fn(async () => []),
    listServiceIdentities: vi.fn(async () => ({
      enabled: false, identities: [], default_identity: null, error: null,
    })),
  };
});

import { WorkflowEditor } from "./WorkflowEditor";
import type { EditableWorkflowDefinition } from "@/lib/types";

const emptyWorkflow: EditableWorkflowDefinition = {
  id: "workflow-1",
  name: "New Workflow",
  description: "",
  nodes: [],
  edges: [],
  isNew: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adding a node auto-saves the workflow", () => {
  it("saves without the author clicking Save", async () => {
    const onSave = vi.fn();
    render(<WorkflowEditor workflow={emptyWorkflow} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: /Pub\/Sub Trigger/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as EditableWorkflowDefinition;
    // The node that was just added is in the payload, not the canvas as it was.
    expect(saved.nodes).toHaveLength(1);
    expect(saved.nodes[0].type).toBe("pubsub");
    expect(saved.isNew).toBe(true);
  });

  it("does not save a read-only workflow", async () => {
    const onSave = vi.fn();
    render(
      <WorkflowEditor
        workflow={{ ...emptyWorkflow, nodes: [{ id: "n1", type: "llm", name: "LLM" }] }}
        onSave={onSave}
        readonly
      />,
    );

    // Nothing can be added while read-only, and the initial render must not save.
    await new Promise((r) => setTimeout(r, 0));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save on the initial render of an existing workflow", async () => {
    const onSave = vi.fn();
    render(
      <WorkflowEditor
        workflow={{
          ...emptyWorkflow,
          isNew: false,
          nodes: [{ id: "n1", type: "llm", name: "LLM" }],
        }}
        onSave={onSave}
      />,
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(onSave).not.toHaveBeenCalled();
  });
});
