/**
 * Which datasources a datasource addon offers depends on whose grant it edits.
 *
 * Attached to an agent, the addon is the agent's own grant (saved with
 * updateAgentAddons), so the agent's visibility decides — not that of the
 * workflow it happens to be edited from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    listDatasources: vi.fn(),
    getAgent: vi.fn(),
    updateAgentAddons: vi.fn(async () => ({}) as never),
  };
});

import * as api from "@/lib/api";
import type { AgentDefinition, DataSourceDefinition } from "@/lib/api";
import { DatasourceAddonPanel } from "./WorkflowEditor";
import { UsageScopeProvider, resetCurrentUserCache, type UsageScope } from "./Visibility";

function source(id: string, name: string, extra: Partial<DataSourceDefinition>): DataSourceDefinition {
  return {
    id, name, kind: "http", base_url: "https://example.test", auth: { type: "none" }, default_headers: {},
    operations: [{ name: "get", method: "GET", path: "/", params: [] }],
    ...extra,
  } as unknown as DataSourceDefinition;
}

const OPEN = source("open", "Open", { visibility: "public" });
const ALPHA = source("alpha", "Alpha CRM", { visibility: "team", team_id: "t-alpha", team_name: "Alpha" });
const BETA = source("beta", "Beta CRM", { visibility: "team", team_id: "t-beta", team_name: "Beta" });
const MINE = source("mine", "Mine", { visibility: "private" });

const TEAM_AGENT = {
  id: "planner", name: "Planner", default_runtime: "local", agent_input: {}, addons: [],
  visibility: "team", team_id: "t-alpha", team_name: "Alpha",
} as unknown as AgentDefinition;

function renderPanel(workflowScope: UsageScope, agentId: string | null) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <UsageScopeProvider scope={workflowScope}>
        <DatasourceAddonPanel
          sourceId="" allowedOperations={[]} attachedTo="agent-1" agentId={agentId}
          readonly={false} onChange={vi.fn()}
        />
      </UsageScopeProvider>
    </SWRConfig>,
  );
}

const option = (name: RegExp) => screen.getByRole("option", { name });

beforeEach(() => {
  vi.clearAllMocks();
  resetCurrentUserCache();
  vi.mocked(api.getCurrentUser).mockResolvedValue({
    sub: "u-me", name: "Me", is_admin: false, auth_enabled: true, team: { id: "t-alpha", name: "Alpha", role: "member" },
  });
  vi.mocked(api.listDatasources).mockResolvedValue([OPEN, ALPHA, BETA, MINE]);
  vi.mocked(api.getAgent).mockResolvedValue(TEAM_AGENT);
});

describe("datasource addon scope", () => {
  it("follows the agent's team scope, even inside a public workflow", async () => {
    renderPanel({ visibility: "public", teamId: null }, "planner");
    await waitFor(() => expect(option(/^Beta CRM/)).toBeDisabled());
    expect(api.getAgent).toHaveBeenCalledWith("planner");
    expect(option(/^Open/)).toBeEnabled();
    // Public workflow, but the grant is the team agent's: its team's source is fine…
    expect(option(/^Alpha CRM/)).toBeEnabled();
    // …another team's and a private one are not.
    expect(option(/^Mine/)).toBeDisabled();
  });

  it("follows a public agent's scope inside a private workflow", async () => {
    vi.mocked(api.getAgent).mockResolvedValue({ ...TEAM_AGENT, visibility: "public", team_id: null, team_name: null });
    renderPanel({ visibility: "private", teamId: "t-alpha" }, "planner");
    await waitFor(() => expect(option(/^Alpha CRM/)).toBeDisabled());
    expect(option(/^Open/)).toBeEnabled();
    expect(option(/^Mine/)).toBeDisabled();
  });

  it("uses the workflow's scope when no agent is attached", async () => {
    renderPanel({ visibility: "public", teamId: null }, null);
    await waitFor(() => expect(option(/^Alpha CRM/)).toBeDisabled());
    expect(api.getAgent).not.toHaveBeenCalled();
    expect(option(/^Open/)).toBeEnabled();
  });
});
