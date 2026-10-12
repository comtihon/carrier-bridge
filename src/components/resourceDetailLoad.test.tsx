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
    // The panels list summaries…
    listAgentSummaries: vi.fn(async () => []),
    listDatasourceSummaries: vi.fn(async () => []),
    listEventSummaries: vi.fn(async () => []),
    listScriptSummaries: vi.fn(async () => []),
    // …and the centre editor fetches the full definition.
    getAgent: vi.fn(),
    getDatasource: vi.fn(),
    getEvent: vi.fn(),
    getScript: vi.fn(),
    // Everything the dashboard touches on mount.
    fetchWorkflows: vi.fn(async () => []),
    listWorkflowRuns: vi.fn(async () => ({ runs: [], total: 0 })),
    getWorkflowRun: vi.fn(),
    listAgents: vi.fn(async () => []),
    listDatasources: vi.fn(async () => []),
    listEvents: vi.fn(async () => []),
    listMcpIntegrations: vi.fn(async () => []),
    listAgentTools: vi.fn(async () => []),
    listConfigKeys: vi.fn(async () => []),
    listServiceIdentities: vi.fn(async () => ({
      enabled: false, identities: [], default_identity: null, error: null,
    })),
    checkBackendHealth: vi.fn(async () => true),
  };
});

import { Dashboard } from "./Dashboard";
import {
  listScriptSummaries, getScript,
  listEventSummaries, getEvent,
  type ScriptDefinition,
} from "@/lib/api";

const SCRIPT: ScriptDefinition = {
  id: "normalize",
  name: "Normalize",
  description: "flattens the body",
  code: 'output = state["payload"]',
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

/**
 * The dock panels list summaries, so a row carries no `code`, no `event_schema`,
 * no `auth`. Every editor here saves with a whole-document PUT, so opening one
 * on a summary would write the missing fields back as empty. The centre editor
 * must therefore fetch the full definition, and must not appear until it has.
 */
describe("opening a resource from a dock panel", () => {
  it("fetches the full script before the editor appears", async () => {
    vi.mocked(listScriptSummaries).mockResolvedValue([
      { id: SCRIPT.id, name: SCRIPT.name, description: SCRIPT.description },
    ]);
    let release: (s: ScriptDefinition) => void = () => {};
    vi.mocked(getScript).mockImplementation(
      () => new Promise<ScriptDefinition>((resolve) => { release = resolve; }),
    );

    render(<Dashboard />);
    fireEvent.click(screen.getByTitle("Open Library"));
    fireEvent.click(await screen.findByText("Normalize"));

    // Mid-flight: a spinner, not an editor holding partial data.
    await waitFor(() => expect(getScript).toHaveBeenCalledWith("normalize"));
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    release(SCRIPT);
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument(),
    );
    // The body arrived from the detail call, not from the list row.
    expect(await screen.findByDisplayValue("Normalize")).toBeInTheDocument();
  });

  it("refuses to open an editor when the detail fetch fails", async () => {
    vi.mocked(listEventSummaries).mockResolvedValue([
      { id: "orders", name: "Order events", description: null, topic: "orders" },
    ]);
    vi.mocked(getEvent).mockRejectedValue(new Error("API 500: boom"));

    render(<Dashboard />);
    fireEvent.click(screen.getByTitle("Open Events"));
    fireEvent.click(await screen.findByText("Order events"));

    // Falling back to the summary would hand the editor an event with no
    // schema, and saving would erase the real one.
    expect(await screen.findByText("Could not open this item")).toBeInTheDocument();
    expect(screen.getByText("API 500: boom")).toBeInTheDocument();
  });
});
