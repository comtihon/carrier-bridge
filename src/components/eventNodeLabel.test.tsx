import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

// React Flow measures its pane; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor(_t?: string) {} });

// Hoisted: vi.mock's factory is lifted above the module body.
const { listEvents } = vi.hoisted(() => ({ listEvents: vi.fn(async () => [] as unknown[]) }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listAgents: vi.fn(async () => []),
    listDatasources: vi.fn(async () => []),
    listEvents,
    listMcpIntegrations: vi.fn(async () => []),
    listAgentTools: vi.fn(async () => []),
    listConfigKeys: vi.fn(async () => []),
    listServiceIdentities: vi.fn(async () => ({
      enabled: false, identities: [], default_identity: null, error: null,
    })),
  };
});

import { WorkflowEditor } from "./WorkflowEditor";
import type { EditableNodeConfig, EditableWorkflowDefinition } from "@/lib/types";

const savedEvent = {
  id: "when_project_requested",
  name: "when_project_requested",
  description: null,
  topic: "projects",
  subscription: "",
  project_id: "p",
  event_schema: null,
};

function renderCanvas(node: Partial<EditableNodeConfig>) {
  const workflow: EditableWorkflowDefinition = {
    id: "workflow-1",
    name: "Project intake",
    description: "",
    nodes: [node as EditableNodeConfig],
    edges: [],
  };
  // A private SWR cache per render, so one case's events list is not still
  // sitting in the shared one when the next case renders.
  const { container } = render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <WorkflowEditor workflow={workflow} onSave={vi.fn()} />
    </SWRConfig>,
  );
  /** What the canvas writes on the single step, palette buttons excluded. */
  return async () => {
    let text = "";
    await waitFor(() => {
      const el = container.querySelector(".react-flow__node");
      expect(el).not.toBeNull();
      text = el?.textContent ?? "";
      expect(text).not.toBe("");
    });
    return text;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a step bound to an event is labelled by the event", () => {
  it("shows the event name instead of the generic node name", async () => {
    listEvents.mockResolvedValue([savedEvent]);
    const nodeText = renderCanvas({
      id: "on_request", type: "pubsub", name: "Pub/Sub Trigger", event: "when_project_requested",
    });

    await waitFor(async () => expect(await nodeText()).toContain("when_project_requested"));
    expect(await nodeText()).not.toContain("Pub/Sub Trigger");
  });

  it("keeps the node name when the bound event cannot be resolved", async () => {
    listEvents.mockResolvedValue([]);
    const nodeText = renderCanvas({
      id: "on_request", type: "pubsub", name: "Pub/Sub Trigger", event: "deleted_server_side",
    });

    await waitFor(async () => expect(await nodeText()).toContain("Pub/Sub Trigger"));
  });

  it("keeps the node name when no event is bound", async () => {
    listEvents.mockResolvedValue([savedEvent]);
    const nodeText = renderCanvas({
      id: "on_request", type: "pubsub", name: "Inline trigger", topic: "orders",
    });

    await waitFor(async () => expect(await nodeText()).toContain("Inline trigger"));
  });
});
