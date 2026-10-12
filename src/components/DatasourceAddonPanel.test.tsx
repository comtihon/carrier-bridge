/**
 * The datasource addon's two controls.
 *
 * What matters here is that the panel stores exactly what the operator ticked,
 * because that stored list IS the authorization the backend enforces — there is
 * no second confirmation anywhere downstream. So the tests are about the shape
 * of what reaches `updateAgentAddons`, plus the one thing the operator needs to
 * see before ticking: which operations are writes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listDatasources: vi.fn(async () => []),
    getAgent: vi.fn(),
    updateAgentAddons: vi.fn(async () => ({}) as never),
    listMcpIntegrations: vi.fn(async () => []),
    listAgentTools: vi.fn(async () => []),
  };
});

import {
  getAgent,
  listDatasources,
  updateAgentAddons,
  type AgentAddonEntry,
  type AgentDefinition,
  type DataSourceDefinition,
} from "@/lib/api";
import {
  apiWorkflowToEditable,
  DatasourceAddonPanel,
  editableToApiPayload,
} from "./WorkflowEditor";

const PROJECTS: DataSourceDefinition = {
  id: "projects-api",
  name: "Projects API",
  kind: "http",
  base_url: "https://projects.example",
  auth: { type: "none" },
  default_headers: {},
  operations: [
    { name: "get_project", method: "GET", path: "/projects/{params.id}", params: [{ name: "id", type: "string", required: true, description: "" }] },
    { name: "deliver_project", method: "POST", path: "/projects/{params.id}/deliver", params: [] },
    { name: "delete_project", method: "DELETE", path: "/projects/{params.id}", params: [] },
  ],
} as unknown as DataSourceDefinition;

const CRM: DataSourceDefinition = {
  id: "hubspot-crm",
  name: "HubSpot",
  kind: "http",
  base_url: "https://crm.example",
  auth: { type: "none" },
  default_headers: {},
  operations: [
    { name: "list_contacts", method: "GET", path: "/contacts", params: [] },
  ],
} as unknown as DataSourceDefinition;

/** A source with no operations — nothing to grant, so it must not be offered. */
const TOPIC: DataSourceDefinition = {
  id: "orders-topic",
  name: "Orders topic",
  kind: "http",
  base_url: "",
  auth: { type: "none" },
  default_headers: {},
  operations: [],
} as unknown as DataSourceDefinition;

const AGENT: AgentDefinition = {
  id: "planner",
  name: "Planner",
  default_runtime: "k8s",
  agent_input: {},
  addons: [],
} as unknown as AgentDefinition;

function renderPanel(props: Partial<React.ComponentProps<typeof DatasourceAddonPanel>> = {}) {
  const onChange = vi.fn();
  const view = render(
    // Fresh SWR cache per render, so one test's datasource list is not another's.
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DatasourceAddonPanel
        sourceId=""
        allowedOperations={[]}
        attachedTo="agent-1"
        agentId="planner"
        readonly={false}
        onChange={onChange}
        {...props}
      />
    </SWRConfig>,
  );
  return { ...view, onChange };
}

/** The addon list the panel last PUT to the agent. */
function lastPut(): AgentAddonEntry[] {
  const calls = vi.mocked(updateAgentAddons).mock.calls;
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDatasources).mockResolvedValue([PROJECTS, CRM, TOPIC]);
  vi.mocked(getAgent).mockResolvedValue(AGENT);
});

describe("DatasourceAddonPanel", () => {
  it("tells the operator to attach it before showing any control", async () => {
    renderPanel({ attachedTo: null });
    await waitFor(() =>
      expect(screen.getByText(/Drag this node onto an agent node/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Datasource")).not.toBeInTheDocument();
  });

  it("offers every datasource that has operations, and no others", async () => {
    renderPanel();
    const select = await screen.findByLabelText("Datasource");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Projects API/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: /HubSpot/ })).toBeInTheDocument();
    // No operations means nothing to grant, so it is not selectable.
    expect(screen.queryByRole("option", { name: /Orders topic/ })).not.toBeInTheDocument();
    expect(select).toHaveValue("");
  });

  it("shows no operation list until a datasource is chosen", async () => {
    renderPanel();
    await screen.findByLabelText("Datasource");
    expect(screen.queryByText("get_project")).not.toBeInTheDocument();
  });

  it("lists the chosen datasource's operations with their method badges", async () => {
    renderPanel({ sourceId: "projects-api" });
    await waitFor(() => expect(screen.getByText("get_project")).toBeInTheDocument());
    // The badge is what tells the operator a grant is a write before ticking it.
    expect(screen.getByTitle("HTTP method: GET")).toBeInTheDocument();
    expect(screen.getByTitle("HTTP method: POST")).toBeInTheDocument();
    expect(screen.getByTitle("HTTP method: DELETE")).toBeInTheDocument();
  });

  it("counts the writes among the ticked operations", async () => {
    renderPanel({
      sourceId: "projects-api",
      allowedOperations: ["get_project", "delete_project"],
    });
    await waitFor(() =>
      expect(screen.getByText(/2 of 3 selected · 1 write/)).toBeInTheDocument(),
    );
  });

  it("says so plainly when nothing is ticked", async () => {
    renderPanel({ sourceId: "projects-api" });
    await waitFor(() =>
      expect(screen.getByText(/this addon grants nothing/i)).toBeInTheDocument(),
    );
  });

  it("stores a ticked operation on the agent", async () => {
    renderPanel({ sourceId: "projects-api" });
    await waitFor(() => expect(screen.getByText("get_project")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() => expect(updateAgentAddons).toHaveBeenCalled());
    expect(lastPut()).toEqual([
      { type: "datasource", source_id: "projects-api", allowed_operations: ["get_project"] },
    ]);
  });

  it("stores a ticked write with no extra confirmation", async () => {
    renderPanel({ sourceId: "projects-api" });
    await waitFor(() => expect(screen.getByText("delete_project")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("checkbox")[2]);

    await waitFor(() => expect(updateAgentAddons).toHaveBeenCalled());
    expect(lastPut()).toEqual([
      { type: "datasource", source_id: "projects-api", allowed_operations: ["delete_project"] },
    ]);
  });

  it("un-ticking removes the operation from the grant", async () => {
    renderPanel({ sourceId: "projects-api", allowedOperations: ["get_project"] });
    await waitFor(() => expect(screen.getByText("get_project")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() => expect(updateAgentAddons).toHaveBeenCalled());
    expect(lastPut()).toEqual([
      { type: "datasource", source_id: "projects-api", allowed_operations: [] },
    ]);
  });

  it("clears the ticked operations when the datasource changes", async () => {
    const { onChange } = renderPanel({
      sourceId: "projects-api",
      allowedOperations: ["get_project", "delete_project"],
    });
    const select = await screen.findByLabelText("Datasource");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /HubSpot/ })).toBeInTheDocument(),
    );
    fireEvent.change(select, { target: { value: "hubspot-crm" } });

    // Not intersected by name: two sources can share an operation name, and
    // carrying a tick across would grant something nobody chose.
    expect(onChange).toHaveBeenCalledWith("hubspot-crm", []);
    await waitFor(() => expect(updateAgentAddons).toHaveBeenCalled());
    expect(lastPut()).toEqual([
      { type: "datasource", source_id: "hubspot-crm", allowed_operations: [] },
    ]);
  });

  it("switching datasource leaves no grant behind for the old one", async () => {
    vi.mocked(getAgent).mockResolvedValue({
      ...AGENT,
      addons: [
        { type: "datasource", source_id: "projects-api", allowed_operations: ["delete_project"] },
      ],
    } as unknown as AgentDefinition);

    renderPanel({ sourceId: "projects-api", allowedOperations: ["delete_project"] });
    const select = await screen.findByLabelText("Datasource");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /HubSpot/ })).toBeInTheDocument(),
    );
    fireEvent.change(select, { target: { value: "hubspot-crm" } });

    await waitFor(() => expect(updateAgentAddons).toHaveBeenCalled());
    expect(lastPut()).toEqual([
      { type: "datasource", source_id: "hubspot-crm", allowed_operations: [] },
    ]);
  });

  it("keeps the agent's other addons, including other datasource grants", async () => {
    vi.mocked(getAgent).mockResolvedValue({
      ...AGENT,
      addons: [
        { type: "mcp", servers: { github: true } },
        { type: "datasource", source_id: "hubspot-crm", allowed_operations: ["list_contacts"] },
      ],
    } as unknown as AgentDefinition);

    renderPanel({ sourceId: "projects-api" });
    await waitFor(() => expect(screen.getByText("get_project")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() => expect(updateAgentAddons).toHaveBeenCalled());
    // Merging keys on (type, source_id), so the sibling datasource survives.
    expect(lastPut()).toEqual([
      { type: "mcp", servers: { github: true } },
      { type: "datasource", source_id: "hubspot-crm", allowed_operations: ["list_contacts"] },
      { type: "datasource", source_id: "projects-api", allowed_operations: ["get_project"] },
    ]);
  });

  it("select all grants every operation, none grants nothing", async () => {
    renderPanel({ sourceId: "projects-api" });
    await waitFor(() => expect(screen.getByText("get_project")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /select all/i }));
    await waitFor(() => expect(updateAgentAddons).toHaveBeenCalled());
    expect(lastPut()[0]).toMatchObject({
      allowed_operations: ["get_project", "deliver_project", "delete_project"],
    });

    fireEvent.click(screen.getByRole("button", { name: "none" }));
    await waitFor(() => expect(vi.mocked(updateAgentAddons).mock.calls.length).toBe(2));
    expect(lastPut()[0]).toMatchObject({ allowed_operations: [] });
  });

  it("filters the operation list without dropping ticks outside the filter", async () => {
    renderPanel({ sourceId: "projects-api", allowedOperations: ["get_project"] });
    const filter = await screen.findByLabelText("Filter operations");
    fireEvent.change(filter, { target: { value: "delete" } });

    expect(screen.getByText("delete_project")).toBeInTheDocument();
    expect(screen.queryByText("get_project")).not.toBeInTheDocument();

    // "select shown" adds the visible ones and keeps the hidden tick.
    fireEvent.click(screen.getByRole("button", { name: /select shown/i }));
    await waitFor(() => expect(updateAgentAddons).toHaveBeenCalled());
    expect(lastPut()[0]).toMatchObject({
      allowed_operations: ["get_project", "delete_project"],
    });
  });

  it("warns when the selected datasource no longer exists", async () => {
    renderPanel({ sourceId: "deleted-source", allowedOperations: ["whatever"] });
    await waitFor(() =>
      expect(screen.getByText(/no longer exists/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/grants nothing/i)).toBeInTheDocument();
  });

  it("flags a ticked operation the datasource no longer declares", async () => {
    renderPanel({
      sourceId: "projects-api",
      allowedOperations: ["get_project", "archive_project"],
    });
    await waitFor(() =>
      expect(screen.getByText(/No longer in this datasource/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("archive_project")).toBeInTheDocument();
  });

  it("writes nothing when read-only", async () => {
    renderPanel({ sourceId: "projects-api", readonly: true });
    await waitFor(() => expect(screen.getByText("get_project")).toBeInTheDocument());
    expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();
    expect(screen.getByLabelText("Datasource")).toBeDisabled();
    expect(updateAgentAddons).not.toHaveBeenCalled();
  });
});

/**
 * The grant also has to survive a save and a reload.
 *
 * An addon node that fails to serialise is not merely lost UI state: the grant
 * it carries disappears with it, and a node that leaks into the step list turns
 * into a bogus workflow step.
 */
describe("datasource addon round-trip through the workflow payload", () => {
  const wf = {
    id: "wf",
    name: "WF",
    nodes: [
      { id: "agent-1", type: "langgraph-agent", name: "Planner", agent_id: "planner" },
      {
        id: "datasource-1",
        type: "datasource-addon",
        name: "Datasource",
        attachedTo: "agent-1",
        datasource_id: "projects-api",
        allowed_operations: ["get_project", "delete_project"],
      },
    ],
    edges: [],
    layout: { "agent-1": { x: 0, y: 0 }, "datasource-1": { x: 0, y: 48 } },
  } as unknown as import("@/lib/types").EditableWorkflowDefinition;

  it("keeps the addon out of the step list and in ui.addons", () => {
    const payload = editableToApiPayload(wf) as Record<string, unknown>;
    const steps = payload.steps as Array<Record<string, unknown>>;
    expect(steps.map((s) => s.id)).toEqual(["agent-1"]);

    const addons = (payload.ui as Record<string, unknown>).addons as Array<Record<string, unknown>>;
    expect(addons).toEqual([
      {
        id: "datasource-1",
        type: "datasource",
        attachedTo: "agent-1",
        position: { x: 0, y: 48 },
        datasource_id: "projects-api",
        allowed_operations: ["get_project", "delete_project"],
      },
    ]);
  });

  it("restores the same grant on reload", () => {
    const payload = editableToApiPayload(wf) as Record<string, unknown>;
    const reloaded = apiWorkflowToEditable({ id: "wf", name: "WF", ...payload });
    const node = reloaded.nodes.find((n) => n.id === "datasource-1") as unknown as Record<string, unknown>;
    expect(node.type).toBe("datasource-addon");
    expect(node.attachedTo).toBe("agent-1");
    expect(node.datasource_id).toBe("projects-api");
    expect(node.allowed_operations).toEqual(["get_project", "delete_project"]);
  });
});
