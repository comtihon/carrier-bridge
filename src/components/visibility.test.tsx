import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    createAgent: vi.fn(async (p: Record<string, unknown>) => ({ ...p })),
    updateAgent: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    createScript: vi.fn(async (p: Record<string, unknown>) => ({ id: "s1", ...p })),
    updateScript: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    listAgentSummaries: vi.fn(),
    listLlmProviders: vi.fn(async () => []),
  };
});
vi.mock("@/hooks/useLlmProviders", () => ({ useLlmProviders: () => ({ providers: [], defaultProvider: null }) }));

import * as api from "@/lib/api";
import type { AgentDefinition, CurrentUser } from "@/lib/api";
import { AgentModal } from "./WorkflowEditor";
import { ScriptEditor } from "./ScriptEditor";
import { AgentsPanel } from "./panels/AgentsPanel";
import { WorkflowDefinitionCard } from "./Dashboard";
import { resetCurrentUserCache } from "./Visibility";

const ME: CurrentUser = { sub: "u-me", name: "Me", is_admin: false, auth_enabled: true };

const base: AgentDefinition = {
  id: "pi", name: "Pi", description: "coder", default_runtime: "local", agent_input: {},
  image: null, helm_chart: null, helm_values: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCurrentUserCache();
  vi.mocked(api.getCurrentUser).mockResolvedValue(ME);
});

async function createAgentWithId(id: string) {
  fireEvent.change(screen.getByPlaceholderText("my-agent"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
  await waitFor(() => expect(api.createAgent).toHaveBeenCalled());
}

describe("creating a resource", () => {
  it("defaults a new agent to private", async () => {
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("radio", { name: /Private/ })).toHaveAttribute("aria-checked", "true");
    await createAgentWithId("helper");
    expect(api.createAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "helper", visibility: "private" }));
  });

  it("sends public when the author picks it", async () => {
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Public/ }));
    await createAgentWithId("helper");
    expect(api.createAgent).toHaveBeenCalledWith(expect.objectContaining({ visibility: "public" }));
  });

  it("defaults a new library script to private too", async () => {
    render(<ScriptEditor draft={{ id: null, name: "", description: "", code: "" }} onSaved={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("radio", { name: /Private/ });
    fireEvent.change(screen.getByPlaceholderText(/Normalize/), { target: { value: "Tidy" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(api.createScript).toHaveBeenCalled());
    expect(api.createScript).toHaveBeenCalledWith(expect.objectContaining({ name: "Tidy", visibility: "private" }));
  });
});

describe("editing a resource", () => {
  it("lets the owner change visibility and sends it with the save", async () => {
    const mine = { ...base, visibility: "private" as const, owner_id: "u-me", owner_name: "Me", can_edit: true };
    render(<AgentModal agent={mine} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("You")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Public/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenCalledWith("pi", expect.objectContaining({ visibility: "public" }));
  });

  it("is read-only when the backend says the caller cannot edit", async () => {
    const theirs = { ...base, visibility: "public" as const, owner_id: "u-alice", owner_name: "Alice", can_edit: false };
    render(<AgentModal agent={theirs} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText(/Read-only: this agent belongs to/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    expect(screen.getByRole("radio", { name: /Private/ })).toBeDisabled();
    expect(screen.getByDisplayValue("Pi")).toBeDisabled();
  });

  it("shows the backend's reason when a save is refused", async () => {
    vi.mocked(api.updateAgent).mockRejectedValueOnce(
      new Error("Cannot make this agent private: workflow 'nightly' (public) uses it"),
    );
    const mine = { ...base, visibility: "public" as const, owner_id: "u-me", can_edit: true };
    render(<AgentModal agent={mine} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Private/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText(/workflow 'nightly' \(public\) uses it/)).toBeInTheDocument();
  });
});

describe("a backend without visibility", () => {
  beforeEach(() => {
    vi.mocked(api.getCurrentUser).mockResolvedValue(null);
  });

  it("offers no control and sends no visibility on create", async () => {
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(api.getCurrentUser).toHaveBeenCalled());
    expect(screen.queryByRole("radiogroup", { name: "Visibility" })).toBeNull();
    await createAgentWithId("helper");
    expect(vi.mocked(api.createAgent).mock.calls[0][0]).not.toHaveProperty("visibility");
  });

  it("edits an agent with no ownership fields exactly as before", async () => {
    render(<AgentModal agent={base} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("radiogroup", { name: "Visibility" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(vi.mocked(api.updateAgent).mock.calls[0][1]).not.toHaveProperty("visibility");
  });

  it("offers no control when /me says auth is disabled", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ ...ME, sub: null, auth_enabled: false });
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(api.getCurrentUser).toHaveBeenCalled());
    expect(screen.queryByRole("radiogroup", { name: "Visibility" })).toBeNull();
  });
});

describe("lists", () => {
  it("marks private agents and offers delete only where the caller may", async () => {
    vi.mocked(api.listAgentSummaries).mockResolvedValue([
      { id: "a", name: "Mine", description: null, default_runtime: "local", visibility: "private", can_edit: true },
      { id: "b", name: "Theirs", description: null, default_runtime: "local", visibility: "public", can_edit: false },
      { id: "c", name: "Legacy", description: null, default_runtime: "local" },
    ]);
    render(<AgentsPanel onClose={vi.fn()} onOpen={vi.fn()} onNew={vi.fn()} />);
    await screen.findByText("Mine");
    expect(screen.getAllByLabelText("Private")).toHaveLength(1);
    expect(screen.getAllByTitle("Delete")).toHaveLength(2);
  });

  it("treats someone else's workflow like a read-only one", () => {
    render(
      <WorkflowDefinitionCard
        workflow={{ id: "w", name: "Nightly", description: "", steps: [], visibility: "public", can_edit: false }}
        selected={false} loading={false} hidden={false} disabled={false}
        onEdit={vi.fn()} onDelete={vi.fn()} onToggleHidden={vi.fn()} onToggleEnabled={vi.fn()}
      />,
    );
    expect(screen.queryByTitle("Edit")).toBeNull();
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.getByTitle("Read-only")).toBeInTheDocument();
  });
});
