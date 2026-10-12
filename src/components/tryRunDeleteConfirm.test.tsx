/**
 * The two-step Try run on a destructive operation.
 *
 * Try run is one click from deleting live data, and the operator who clicks it
 * is usually the person who just wrote the operation — so the first click can
 * never delete. These tests are about that: what the refused call puts on
 * screen, and that only a second, explicit click carries the confirmation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { DataSourceDefinition, TryOperationResult } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listConfigKeys: vi.fn(async () => []),
    listServiceIdentities: vi.fn(async () => ({
      enabled: false, identities: [], default_identity: null, error: null,
    })),
    listDatasources: vi.fn(async () => []),
    probeDatasource: vi.fn(async () => ({
      url_status: "ok" as const, auth_status: "skipped" as const,
      error: null, discovered: null,
    })),
    tryDatasourceOperation: vi.fn(),
    createDatasource: vi.fn(async (p: unknown) => p),
    updateDatasource: vi.fn(async (_id: string, p: unknown) => p),
  };
});

import { tryDatasourceOperation } from "@/lib/api";
import { DatasourceEditor } from "./WorkflowEditor";

const REFUSED: TryOperationResult = {
  status: "confirmation_required",
  error: null,
  api_output: null,
  suggested_mapping: null,
  destructive: {
    operation: "drop_stale",
    method: "DELETE",
    affected_rows: 1240,
    targets: ["DELETE https://files.test/files/f1"],
    affected_sample: ["f1", "f2", "f3", "f4", "f5", "f6"],
  },
};

const RAN: TryOperationResult = {
  status: "ok",
  error: null,
  api_output: { deleted: true },
  suggested_mapping: null,
};

const source: DataSourceDefinition = {
  id: "files",
  name: "File store",
  description: null,
  kind: "http",
  base_url: "https://files.test",
  auth: { type: "none" },
  default_headers: {},
  operations: [
    {
      name: "drop_stale",
      method: "DELETE",
      path: "/files/{params.id}",
      query: null,
      variables: null,
      params: [],
      response_schema: null,
      mapping: null,
    },
  ],
};

function openOperation() {
  render(<DatasourceEditor datasource={source} onSave={vi.fn()} onClose={vi.fn()} />);
  // Operations start folded.
  fireEvent.click(screen.getByText("drop_stale"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Try run on a destructive operation", () => {
  it("sends the first call unconfirmed", async () => {
    vi.mocked(tryDatasourceOperation).mockResolvedValue(REFUSED);
    openOperation();

    fireEvent.click(screen.getByText("Try run"));

    await waitFor(() =>
      expect(vi.mocked(tryDatasourceOperation).mock.calls[0][0])
        .toMatchObject({ operation: "drop_stale", confirm_destructive: false }),
    );
  });

  it("shows the row count instead of running", async () => {
    vi.mocked(tryDatasourceOperation).mockResolvedValue(REFUSED);
    openOperation();

    fireEvent.click(screen.getByText("Try run"));

    expect(await screen.findByText("Running this deletes 1,240 rows.")).toBeInTheDocument();
    expect(screen.getByText("f1")).toBeInTheDocument();
    expect(screen.getByText("…and 1,235 more")).toBeInTheDocument();
    expect(tryDatasourceOperation).toHaveBeenCalledTimes(1);
  });

  it("says the confirmation is recorded", async () => {
    vi.mocked(tryDatasourceOperation).mockResolvedValue(REFUSED);
    openOperation();
    fireEvent.click(screen.getByText("Try run"));

    expect(await screen.findByText(/recorded in the approvals log/)).toBeInTheDocument();
  });

  it("spells the row count into the confirm button", async () => {
    vi.mocked(tryDatasourceOperation).mockResolvedValue(REFUSED);
    openOperation();
    fireEvent.click(screen.getByText("Try run"));

    expect(await screen.findByText("Delete 1,240 rows")).toBeInTheDocument();
  });

  it("only the second click carries the confirmation", async () => {
    vi.mocked(tryDatasourceOperation)
      .mockResolvedValueOnce(REFUSED)
      .mockResolvedValueOnce(RAN);
    openOperation();

    fireEvent.click(screen.getByText("Try run"));
    fireEvent.click(await screen.findByText("Delete 1,240 rows"));

    await waitFor(() =>
      expect(vi.mocked(tryDatasourceOperation).mock.calls[1][0])
        .toMatchObject({ confirm_destructive: true }),
    );
  });

  it("cancelling sends nothing and clears the prompt", async () => {
    vi.mocked(tryDatasourceOperation).mockResolvedValue(REFUSED);
    openOperation();
    fireEvent.click(screen.getByText("Try run"));

    // Scoped: the editor's own footer carries a Cancel too, and clicking that
    // one would close the form rather than decline the deletion.
    const prompt = (await screen.findByText("Running this deletes 1,240 rows."))
      .closest("div")!;
    fireEvent.click(within(prompt).getByText("Cancel"));

    await waitFor(() =>
      expect(screen.queryByText("Running this deletes 1,240 rows.")).not.toBeInTheDocument(),
    );
    expect(tryDatasourceOperation).toHaveBeenCalledTimes(1);
  });

  it("a single-row deletion is not pluralised", async () => {
    vi.mocked(tryDatasourceOperation).mockResolvedValue({
      ...REFUSED,
      destructive: { ...REFUSED.destructive!, affected_rows: 1, affected_sample: ["f1"] },
    });
    openOperation();
    fireEvent.click(screen.getByText("Try run"));

    expect(await screen.findByText("Running this deletes 1 row.")).toBeInTheDocument();
  });

  it("a non-destructive run never asks", async () => {
    vi.mocked(tryDatasourceOperation).mockResolvedValue(RAN);
    openOperation();

    fireEvent.click(screen.getByText("Try run"));

    await waitFor(() => expect(screen.getByText(/Ran OK/)).toBeInTheDocument());
    expect(screen.queryByText(/Running this deletes/)).not.toBeInTheDocument();
  });

  it("re-running after a confirmation asks again", async () => {
    vi.mocked(tryDatasourceOperation)
      .mockResolvedValueOnce(REFUSED)
      .mockResolvedValueOnce(RAN)
      .mockResolvedValueOnce(REFUSED);
    openOperation();

    fireEvent.click(screen.getByText("Try run"));
    fireEvent.click(await screen.findByText("Delete 1,240 rows"));
    await waitFor(() => expect(screen.getByText(/Ran OK/)).toBeInTheDocument());

    // One confirmation buys one deletion, not a session's worth.
    fireEvent.click(screen.getByText("Try run"));
    expect(await screen.findByText("Running this deletes 1,240 rows.")).toBeInTheDocument();
  });
});
