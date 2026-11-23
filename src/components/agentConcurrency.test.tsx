import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    updateAgent: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    createAgent: vi.fn(async (p: Record<string, unknown>) => p),
    listLlmProviders: vi.fn(async () => []),
    getCurrentUser: vi.fn(async () => ({ sub: "u-me", name: "Me", is_admin: false, auth_enabled: true })),
  };
});
vi.mock("@/hooks/useLlmProviders", () => ({ useLlmProviders: () => ({ providers: [], defaultProvider: null }) }));

import * as api from "@/lib/api";
import { AgentModal } from "./WorkflowEditor";
import { resetCurrentUserCache } from "./Visibility";
import type { AgentDefinition } from "@/lib/api";

const agent: AgentDefinition = {
  id: "pi", name: "Pi", description: "coder", default_runtime: "k8s", agent_input: {},
  image: null, helm_chart: "oci://x", helm_values: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCurrentUserCache();
});

describe("agent max concurrency", () => {
  it("saves a limit", async () => {
    const onSave = vi.fn();
    render(<AgentModal agent={agent} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Max concurrent runs/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenCalledWith("pi", expect.objectContaining({ max_concurrency: 2 }));
  });

  it("shows the stored limit and clears it with null when emptied", async () => {
    render(<AgentModal agent={{ ...agent, max_concurrency: 3 }} onSave={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByLabelText(/Max concurrent runs/);
    expect(field).toHaveValue(3);

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenCalledWith("pi", expect.objectContaining({ max_concurrency: null }));
  });

  it("refuses a limit below one", async () => {
    render(<AgentModal agent={agent} onSave={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByLabelText(/Max concurrent runs/);
    fireEvent.change(field, { target: { value: "0" } });
    // Past the browser's own min=1 check, the form still refuses it.
    fireEvent.submit(field.closest("form")!);

    expect(await screen.findByText(/at least 1/)).toBeInTheDocument();
    expect(api.updateAgent).not.toHaveBeenCalled();
  });

  it("creates an agent with a limit", async () => {
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("my-agent"), { target: { value: "new-one" } });
    fireEvent.change(screen.getByLabelText(/Max concurrent runs/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));

    await waitFor(() => expect(api.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-one", max_concurrency: 1 }),
    ));
  });
});
