import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    updateAgent: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    listLlmProviders: vi.fn(async () => []),
  };
});
vi.mock("@/hooks/useLlmProviders", () => ({ useLlmProviders: () => ({ providers: [], defaultProvider: null }) }));

import * as api from "@/lib/api";
import { AgentModal } from "./WorkflowEditor";
import type { AgentDefinition } from "@/lib/api";

const agent: AgentDefinition = {
  id: "pi", name: "Pi", description: "coder", default_runtime: "k8s", agent_input: {},
  image: null, helm_chart: "oci://x", helm_values: {},
};

describe("agent protocol", () => {
  it("saves an ACP agent with its proxy agent name", async () => {
    const onSave = vi.fn();
    render(<AgentModal agent={agent} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("ACP agent")).toBeNull();
    fireEvent.change(screen.getByLabelText("Protocol"), { target: { value: "acp" } });
    fireEvent.change(screen.getByLabelText("ACP agent"), { target: { value: "claude" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenCalledWith("pi", expect.objectContaining({ protocol: "acp", acp_agent: "claude" }));
  });

  it("keeps the poll protocol by default and sends no ACP agent", async () => {
    render(<AgentModal agent={agent} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenLastCalledWith("pi", expect.objectContaining({ protocol: "http-poll", acp_agent: null }));
  });
});
