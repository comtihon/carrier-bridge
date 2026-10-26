import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    updateAgent: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    listRunners: vi.fn(async () => []),
    listLlmProviders: vi.fn(async () => []),
  };
});
vi.mock("@/hooks/useLlmProviders", () => ({ useLlmProviders: () => ({ providers: [], defaultProvider: null }) }));

import * as api from "@/lib/api";
import { AgentModal } from "./WorkflowEditor";
import type { AgentDefinition, Runner } from "@/lib/api";

const agent: AgentDefinition = {
  id: "pi", name: "Pi", description: "coder", default_runtime: "k8s", agent_input: {},
  image: null, helm_chart: "oci://x", helm_values: {},
};

const runner = (over: Partial<Runner>): Runner => ({
  id: "r1", name: "mbp", hostname: "mbp", os: "darwin", arch: "arm64", tz: "UTC", version: "0.4.0",
  agents: ["claude", "codex"], default_agent: "claude", labels: {}, online: true,
  last_seen: null, connected_at: null, created_at: null, approved_by_name: null,
  limits: {}, agent_definitions: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listRunners).mockResolvedValue([
    runner({}),
    runner({ id: "r2", name: "build-box", online: false, agents: ["codex"], default_agent: "codex" }),
  ]);
});

describe("agent on a runner", () => {
  it("picks a machine and one of its agents, and saves them as an ACP agent", async () => {
    const onSave = vi.fn();
    render(<AgentModal agent={agent} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("oci://registry/chart:1.0.0")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Default Runtime"), { target: { value: "runner" } });

    // Offline machines are offered too, and say so.
    expect(await screen.findByRole("option", { name: "build-box (offline)" })).toBeInTheDocument();
    // Neither the protocol choice nor the k8s fields apply to a runner.
    expect(screen.queryByLabelText("Protocol")).toBeNull();
    expect(screen.queryByPlaceholderText("oci://registry/chart:1.0.0")).toBeNull();

    fireEvent.change(screen.getByLabelText("Runner"), { target: { value: "r1" } });
    // Starts on the machine's default agent.
    expect(screen.getByLabelText("Agent on that machine")).toHaveValue("claude");
    fireEvent.change(screen.getByLabelText("Agent on that machine"), { target: { value: "codex" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenCalledWith("pi", expect.objectContaining({
      default_runtime: "runner",
      runner_id: "r1",
      acp_agent: "codex",
      protocol: "acp",
      helm_chart: null,
    }));
  });

  it("will not save a runner agent without a machine", async () => {
    render(<AgentModal agent={agent} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Default Runtime"), { target: { value: "runner" } });
    await screen.findByRole("option", { name: "mbp" });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Choose the machine this agent runs on.")).toBeInTheDocument();
    expect(api.updateAgent).not.toHaveBeenCalled();
  });

  it("opens an existing runner agent on its machine and agent", async () => {
    render(<AgentModal
      agent={{ ...agent, default_runtime: "runner", protocol: "acp", runner_id: "r2", acp_agent: "codex" }}
      onSave={vi.fn()} onClose={vi.fn()} />);

    await screen.findByRole("option", { name: "build-box (offline)" });
    expect(screen.getByLabelText("Runner")).toHaveValue("r2");
    expect(screen.getByLabelText("Agent on that machine")).toHaveValue("codex");
  });

  it("leaves other runtimes without a runner", async () => {
    render(<AgentModal agent={agent} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(api.updateAgent).toHaveBeenLastCalledWith("pi", expect.objectContaining({
      default_runtime: "k8s", runner_id: null, protocol: "http-poll",
    }));
    expect(api.listRunners).not.toHaveBeenCalled();
  });
});
