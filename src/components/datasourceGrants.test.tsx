import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listDatasourceGrants: vi.fn(),
    listDatasourceGrantCandidates: vi.fn(),
    grantDatasource: vi.fn(),
    revokeDatasourceGrant: vi.fn(),
  };
});

import * as api from "@/lib/api";
import type { DataSourceDefinition, DataSourceGrant } from "@/lib/api";
import { DatasourceGrants } from "./DatasourceGrants";
import { grantedAccess, scopeConflict } from "./Visibility";

const SOURCE: DataSourceDefinition = {
  id: "crm", name: "CRM", description: null, kind: "http", base_url: "https://crm",
  auth: { type: "none" }, default_headers: {}, operations: [],
  visibility: "team", team_id: "red", owner_id: "alice", can_share: true,
};

const CAROL: DataSourceGrant = {
  id: "g1", grantee_type: "user", grantee_id: "carol", grantee_name: "Carol", access: "read",
  granted_by_name: "Alice",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listDatasourceGrants).mockResolvedValue([CAROL]);
  vi.mocked(api.listDatasourceGrantCandidates).mockResolvedValue({
    users: [{ id: "dave", name: "Dave", email: "dave@example.com" }],
    workflows: [],
  });
  vi.mocked(api.grantDatasource).mockResolvedValue(CAROL);
  vi.mocked(api.revokeDatasourceGrant).mockResolvedValue(undefined);
});

describe("DatasourceGrants", () => {
  it("lists grants and revokes one", async () => {
    render(<DatasourceGrants datasource={SOURCE} />);
    expect(await screen.findByText("Carol")).toBeTruthy();
    vi.mocked(api.listDatasourceGrants).mockResolvedValue([]);
    fireEvent.click(screen.getByLabelText("Revoke access for Carol"));
    await waitFor(() => expect(api.revokeDatasourceGrant).toHaveBeenCalledWith("crm", "g1"));
    expect(await screen.findByText("Not shared beyond its visibility.")).toBeTruthy();
  });

  it("grants a user read & write access", async () => {
    render(<DatasourceGrants datasource={SOURCE} />);
    await screen.findByText("Carol");
    fireEvent.change(screen.getByLabelText("User id"), { target: { value: "dave" } });
    fireEvent.change(screen.getByLabelText("Access"), { target: { value: "read_write" } });
    fireEvent.click(screen.getByText("Grant"));
    await waitFor(() => expect(api.grantDatasource).toHaveBeenCalledWith("crm", {
      grantee_type: "user", grantee_id: "dave", access: "read_write",
    }));
  });

  it("grants a workflow by id", async () => {
    render(<DatasourceGrants datasource={SOURCE} />);
    await screen.findByText("Carol");
    fireEvent.click(screen.getByRole("radio", { name: "Workflow" }));
    const input = screen.getByLabelText("Workflow id");
    fireEvent.change(input, { target: { value: "report" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.grantDatasource).toHaveBeenCalledWith("crm", {
      grantee_type: "workflow", grantee_id: "report", access: "read",
    }));
  });

  it("changes an existing grant's access", async () => {
    render(<DatasourceGrants datasource={SOURCE} />);
    await screen.findByText("Carol");
    fireEvent.change(screen.getByLabelText("Access for Carol"), { target: { value: "read_write" } });
    await waitFor(() => expect(api.grantDatasource).toHaveBeenCalledWith("crm", {
      grantee_type: "user", grantee_id: "carol", access: "read_write",
    }));
  });

  it("shows a grantee their own access and nothing else", () => {
    render(<DatasourceGrants datasource={{ ...SOURCE, can_share: false, granted_access: "read" }} />);
    expect(screen.getByText(/Shared with you/)).toBeTruthy();
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.queryByText("Grant")).toBeNull();
    expect(api.listDatasourceGrants).not.toHaveBeenCalled();
  });

  it("has nothing to grant on a public source", async () => {
    render(<DatasourceGrants datasource={{ ...SOURCE, visibility: "public" }} />);
    expect(screen.getByText(/open to everyone/)).toBeTruthy();
  });
});

describe("grant-aware scope checks", () => {
  const priv = { visibility: "private" as const, teamId: null };

  it("a workflow grant counts in that workflow's editor only", () => {
    const used = { visibility: "private" as const, owner_id: "alice", granted_to_workflow: "read" as const };
    expect(grantedAccess({ ...priv, workflowId: "report" }, used)).toBe("read");
    expect(scopeConflict({ visibility: "team", teamId: "blue", workflowId: "report" }, used)).toBeNull();
  });

  it("a user grant counts in private resources only", () => {
    const used = { visibility: "team" as const, team_id: "red", granted_access: "read_write" as const };
    expect(grantedAccess(priv, used)).toBe("read_write");
    expect(scopeConflict(priv, used)).toBeNull();
    expect(grantedAccess({ visibility: "team", teamId: "blue" }, used)).toBeNull();
    expect(scopeConflict({ visibility: "team", teamId: "blue" }, used)).not.toBeNull();
  });
});
