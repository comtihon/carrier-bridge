/**
 * gbrain (shared company memory): the status icon beside the backend status,
 * and the brain_access setting on agents and workflows.
 *
 * The setting must survive every save path — a workflow saved without anyone
 * touching it keeps what it had, the same bug `use_storage` once had.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor(_t?: string) {} });

vi.mock("@/lib/oidc", () => ({ getAccessToken: vi.fn(async () => undefined) }));
vi.mock("@/hooks/useLlmProviders", () => ({
  useLlmProviders: () => ({ providers: [], defaultProvider: null, getDefaultModel: () => "", isLoading: false, error: null }),
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    // Overridden per test where the status matters; the editors only need an answer.
    checkBrainHealth: vi.fn(async () => ({ status: "ok", detail: null })),
    updateAgent: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    createAgent: vi.fn(async (p: Record<string, unknown>) => p),
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

import * as api from "@/lib/api";
import { BrainHealthIndicator, BRAIN_REFRESH_MS } from "./BrainAccess";
import { AgentModal, WorkflowEditor, editableToApiPayload, yamlToWorkflow, workflowToYaml } from "./WorkflowEditor";
import type { AgentDefinition } from "@/lib/api";
import type { EditableWorkflowDefinition } from "@/lib/types";

const actualApi = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor(_t?: string) {} });
  vi.useRealTimers();
});

// ─── checkBrainHealth ─────────────────────────────────────────────────────────

describe("checkBrainHealth", () => {
  const respond = (status: number, body?: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })));

  it("passes the backend's status and detail through", async () => {
    respond(200, { status: "unavailable", detail: "connection refused" });
    expect(await actualApi.checkBrainHealth()).toEqual({ status: "unavailable", detail: "connection refused" });
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/health\/brain$/));
  });

  it("treats an older backend without the route (404) as not configured", async () => {
    respond(404, { detail: "Not Found" });
    expect(await actualApi.checkBrainHealth()).toEqual({ status: "not_configured", detail: null });
  });

  it("is unknown when the backend is unreachable or answers nonsense", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect((await actualApi.checkBrainHealth()).status).toBe("unknown");
    respond(200, { status: "sideways" });
    expect((await actualApi.checkBrainHealth()).status).toBe("unknown");
    respond(500);
    expect((await actualApi.checkBrainHealth()).status).toBe("unknown");
  });
});

// ─── Indicator ────────────────────────────────────────────────────────────────

describe("BrainHealthIndicator", () => {
  const withStatus = (h: api.BrainHealth) => vi.mocked(api.checkBrainHealth).mockResolvedValue(h);
  const icon = async () => {
    const el = await screen.findByTestId("brain-health");
    return { el, svg: el.querySelector("svg")! };
  };

  it("is green when connected", async () => {
    withStatus({ status: "ok", detail: null });
    render(<BrainHealthIndicator compact />);
    const { el, svg } = await icon();
    expect(svg).toHaveClass("text-emerald-400");
    expect(el).toHaveAttribute("title", "Brain: connected");
  });

  it("is red with the detail when configured but unavailable", async () => {
    withStatus({ status: "unavailable", detail: "timeout" });
    render(<BrainHealthIndicator compact />);
    const { el, svg } = await icon();
    expect(svg).toHaveClass("text-red-400");
    expect(el).toHaveAttribute("title", "Brain: unavailable — timeout");
  });

  it("is gray when not configured", async () => {
    withStatus({ status: "not_configured", detail: null });
    render(<BrainHealthIndicator compact />);
    const { el, svg } = await icon();
    expect(svg).toHaveClass("text-slate-500");
    expect(svg).not.toHaveClass("text-red-400");
    expect(el).toHaveAttribute("title", "Brain: not configured");
  });

  it("is gray for a 404 and for an unreachable backend", async () => {
    vi.mocked(api.checkBrainHealth).mockImplementation(actualApi.checkBrainHealth);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const first = render(<BrainHealthIndicator compact />);
    expect((await icon()).svg).toHaveClass("text-slate-500");
    first.unmount();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<BrainHealthIndicator compact />);
    const { el, svg } = await icon();
    expect(svg).toHaveClass("text-slate-500");
    expect(el.getAttribute("title")).toMatch(/^Brain: /);
  });

  it("shows a label in the full variant", async () => {
    withStatus({ status: "ok", detail: null });
    render(<BrainHealthIndicator />);
    expect(await screen.findByText("Brain connected")).toBeInTheDocument();
  });

  it("re-checks every minute and stops when unmounted", async () => {
    vi.useFakeTimers();
    withStatus({ status: "ok", detail: null });
    const { unmount } = render(<BrainHealthIndicator compact />);
    expect(api.checkBrainHealth).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(BRAIN_REFRESH_MS); });
    expect(api.checkBrainHealth).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { vi.advanceTimersByTime(BRAIN_REFRESH_MS * 3); });
    expect(api.checkBrainHealth).toHaveBeenCalledTimes(2);
  });
});

// ─── Agent editor ─────────────────────────────────────────────────────────────

describe("agent brain access", () => {
  const agent: AgentDefinition = {
    id: "pi", name: "Pi", description: "coder", default_runtime: "k8s", agent_input: {},
    image: null, helm_chart: "oci://x", helm_values: {},
  };

  it("defaults to none for an agent saved before the setting existed", async () => {
    render(<AgentModal agent={agent} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Brain access")).toHaveValue("none");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenLastCalledWith("pi", expect.objectContaining({ brain_access: "none" }));
  });

  it("loads the stored value and saves a change", async () => {
    render(<AgentModal agent={{ ...agent, brain_access: "read" }} onSave={vi.fn()} onClose={vi.fn()} />);
    const select = screen.getByLabelText("Brain access");
    expect(select).toHaveValue("read");
    fireEvent.change(select, { target: { value: "write" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenLastCalledWith("pi", expect.objectContaining({ brain_access: "write" }));
  });

  it("keeps an untouched stored value on save", async () => {
    render(<AgentModal agent={{ ...agent, brain_access: "write" }} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenLastCalledWith("pi", expect.objectContaining({ brain_access: "write" }));
  });

  it("notes when gbrain is not configured, but stays editable", async () => {
    vi.mocked(api.checkBrainHealth).mockResolvedValue({ status: "not_configured", detail: null });
    render(<AgentModal agent={agent} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("gbrain not configured on this backend")).toBeInTheDocument();
    expect(screen.getByLabelText("Brain access")).not.toBeDisabled();
  });
});

// ─── Workflow settings ────────────────────────────────────────────────────────

describe("workflow brain access", () => {
  const wf: EditableWorkflowDefinition = {
    id: "wf-1", name: "WF", description: "", nodes: [], edges: [],
  };

  it("serialises brain_access, defaulting to none", () => {
    expect(editableToApiPayload(wf)).toMatchObject({ brain_access: "none" });
    expect(editableToApiPayload({ ...wf, brain_access: "read" })).toMatchObject({ brain_access: "read" });
  });

  it("survives a YAML round trip", () => {
    const back = yamlToWorkflow(workflowToYaml({ ...wf, brain_access: "write", use_storage: true }), wf);
    expect(back.brain_access).toBe("write");
    expect(back.use_storage).toBe(true);
  });

  it("keeps the stored value when saved untouched", async () => {
    const onSave = vi.fn();
    render(<WorkflowEditor workflow={{ ...wf, brain_access: "write" }} onSave={onSave} />);
    expect(screen.getByLabelText("Brain access")).toHaveValue("write");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0] as EditableWorkflowDefinition;
    expect(saved.brain_access).toBe("write");
    expect(editableToApiPayload(saved)).toMatchObject({ brain_access: "write" });
  });

  it("saves a changed value", async () => {
    const onSave = vi.fn();
    render(<WorkflowEditor workflow={wf} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Brain access"), { target: { value: "read" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(editableToApiPayload(onSave.mock.calls[0][0])).toMatchObject({ brain_access: "read" });
  });
});
