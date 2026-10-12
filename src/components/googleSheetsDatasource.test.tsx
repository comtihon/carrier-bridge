/**
 * Attaching a Google spreadsheet as a datasource.
 *
 * Access to a Google document is per document — it is granted by sharing the
 * document with the service account the backend impersonates — so the two
 * things these tests care about are: the editor never claims a spreadsheet
 * works until the backend has said so, and when it has not been shared yet the
 * user is told which address to share it with rather than shown an error.
 *
 * The Picker is deliberately absent here: it needs an OAuth client id that
 * this deployment may not have, so the paste-a-URL path has to work entirely
 * on its own and that is what is covered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type {
  GoogleFileResolution,
  GoogleSheetsTemplate,
  TryOperationResult,
} from "@/lib/api";

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
    getGoogleSheetsTemplate: vi.fn(),
    resolveGoogleFile: vi.fn(),
    tryDatasourceOperation: vi.fn(),
    createDatasource: vi.fn(async (p: unknown) => p),
    updateDatasource: vi.fn(async (_id: string, p: unknown) => p),
  };
});

import {
  createDatasource,
  getGoogleSheetsTemplate,
  resolveGoogleFile,
  tryDatasourceOperation,
} from "@/lib/api";
import { DatasourceEditor } from "./WorkflowEditor";

const SA = "copilot@example.iam.gserviceaccount.com";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;

const TEMPLATE: GoogleSheetsTemplate = {
  id: "google-sheets",
  name: "Google Sheets",
  description: `Read and write Google Sheets. Each spreadsheet must be shared with ${SA}.`,
  kind: "http",
  base_url: "https://sheets.googleapis.com",
  auth: { type: "google", scopes: ["https://www.googleapis.com/auth/spreadsheets"] },
  operations: [
    {
      name: "get_metadata",
      method: "GET",
      path: "/v4/spreadsheets/{params.spreadsheet_id}",
      query_params: { fields: "sheets(properties(sheetId,title,gridProperties))" },
      params: [{ name: "spreadsheet_id", type: "string", required: true, description: "File id" }],
      response_schema: null,
      mapping: null,
      description: "Tabs and named ranges of a spreadsheet",
    },
    {
      name: "append_values",
      method: "POST",
      path: "/v4/spreadsheets/{params.spreadsheet_id}/values/{params.range}:append",
      query_params: { valueInputOption: "{params.value_input_option}" },
      destructive: true,
      retries: { attempts: 1 },
      params: [
        { name: "spreadsheet_id", type: "string", required: true, description: "File id" },
        { name: "range", type: "string", required: true, description: "A1 notation" },
        { name: "values", type: "array", required: true, description: "Rows" },
        {
          name: "value_input_option", type: "string", required: false,
          description: "RAW (default)", default: "RAW",
        },
      ],
      response_schema: null,
      mapping: null,
      description: "Append rows after the last row of a range",
    },
  ],
  service_account: SA,
  default_value_input_option: "RAW",
};

const RESOLVED_OK: GoogleFileResolution = {
  status: "ok",
  error: null,
  file_id: SHEET_ID,
  name: "Q3 pipeline",
  mime_type: "application/vnd.google-apps.spreadsheet",
  can_edit: true,
  service_account: SA,
};

const RESOLVED_NO_ACCESS: GoogleFileResolution = {
  status: "no_access",
  error: `${SA} cannot see that document yet. Share it with that address (Editor, to allow writes) and verify again.`,
  file_id: SHEET_ID,
  service_account: SA,
};

const METADATA: TryOperationResult = {
  status: "ok",
  error: null,
  api_output: {
    sheets: [
      { properties: { sheetId: 0, title: "Pipeline", gridProperties: { rowCount: 500, columnCount: 12 } } },
      { properties: { sheetId: 7, title: "Notes", gridProperties: { rowCount: 100, columnCount: 4 } } },
    ],
  },
  suggested_mapping: null,
};

/** Pick "Google Sheets" in the Kind dropdown of a fresh editor. */
async function pickGoogleSheets() {
  render(<DatasourceEditor datasource={null} onSave={vi.fn()} onClose={vi.fn()} />);
  const kind = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
  fireEvent.change(kind, { target: { value: "google_sheets" } });
  await waitFor(() => expect(getGoogleSheetsTemplate).toHaveBeenCalled());
}

const urlField = () =>
  screen.getByPlaceholderText("https://docs.google.com/spreadsheets/d/…");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGoogleSheetsTemplate).mockResolvedValue(TEMPLATE);
  vi.mocked(resolveGoogleFile).mockResolvedValue(RESOLVED_OK);
  vi.mocked(tryDatasourceOperation).mockResolvedValue(METADATA);
});

describe("Google Sheets datasource preset", () => {
  it("fills the base URL, name and operations from the backend's template", async () => {
    await pickGoogleSheets();

    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText("https://api.example.com") as HTMLInputElement).value,
      ).toBe("https://sheets.googleapis.com"),
    );
    expect(await screen.findByText("get_metadata")).toBeInTheDocument();
    expect(screen.getByText("append_values")).toBeInTheDocument();
  });

  it("says there is no secret and names the account it reads as", async () => {
    await pickGoogleSheets();
    // The address shows in both the auth block and the spreadsheet panel —
    // both places where a user needs to know who carrier reads as.
    expect((await screen.findAllByText(SA)).length).toBeGreaterThan(0);
    expect(screen.getByText(/No secret to enter/i)).toBeInTheDocument();
  });

  it("does not offer a specification import — the operations are the backend's", async () => {
    await pickGoogleSheets();
    expect(
      screen.queryByPlaceholderText("https://api.example.com/openapi.json"),
    ).not.toBeInTheDocument();
  });
});

describe("Google Sheets: verifying a spreadsheet", () => {
  it("resolves a pasted URL through the backend and shows what it found", async () => {
    await pickGoogleSheets();

    fireEvent.change(urlField(), { target: { value: SHEET_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/i }));

    await waitFor(() => expect(resolveGoogleFile).toHaveBeenCalledWith(SHEET_URL));
    expect(await screen.findByText("Q3 pipeline")).toBeInTheDocument();
    expect(screen.getByText(/read and write it/i)).toBeInTheDocument();
    expect(screen.getByText("application/vnd.google-apps.spreadsheet")).toBeInTheDocument();
  });

  it("tells the user which address to share with when we cannot see it", async () => {
    vi.mocked(resolveGoogleFile).mockResolvedValue(RESOLVED_NO_ACCESS);
    await pickGoogleSheets();

    fireEvent.change(urlField(), { target: { value: SHEET_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/i }));

    // Instructions, not a failure: nobody has shared it yet, which is normal.
    expect(await screen.findByText(RESOLVED_NO_ACCESS.error!)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy/i })).toBeInTheDocument();
    expect(screen.getByText(SA, { selector: "code" })).toBeInTheDocument();
  });

  it("copies the address to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(resolveGoogleFile).mockResolvedValue(RESOLVED_NO_ACCESS);
    await pickGoogleSheets();

    fireEvent.change(urlField(), { target: { value: SHEET_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Copy/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SA));
  });

  it("says a Doc is a Doc rather than failing obscurely", async () => {
    vi.mocked(resolveGoogleFile).mockResolvedValue({
      status: "wrong_type",
      error: "That link points at a Google Doc, not a Google Sheet.",
      service_account: SA,
    });
    await pickGoogleSheets();

    fireEvent.change(urlField(), {
      target: { value: "https://docs.google.com/document/d/1AbCdEfGhIjKlMn/edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Verify/i }));

    expect(await screen.findByText(/not a Google Sheet/i)).toBeInTheDocument();
  });

  it("hides the Drive picker when no OAuth client id is configured", async () => {
    // GOOGLE_PICKER_CLIENT_ID is empty in tests, as it is in a deployment that
    // has not created one — the paste path must work without it.
    await pickGoogleSheets();
    expect(screen.queryByRole("button", { name: /Pick from Drive/i })).not.toBeInTheDocument();
  });
});

describe("Google Sheets: tab dropdown", () => {
  it("lists the tabs from get_metadata once the document resolves", async () => {
    await pickGoogleSheets();

    fireEvent.change(urlField(), { target: { value: SHEET_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/i }));

    await waitFor(() =>
      expect(tryDatasourceOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "get_metadata",
          params: { spreadsheet_id: SHEET_ID },
        }),
      ),
    );
    expect(await screen.findByRole("option", { name: /Pipeline/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Notes/ })).toBeInTheDocument();
  });
});

describe("Google Sheets: saving", () => {
  it("refuses to save before a spreadsheet has been verified", async () => {
    await pickGoogleSheets();

    fireEvent.change(screen.getByPlaceholderText("my-datasource"), {
      target: { value: "google-sheets" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create Datasource/i }));

    expect(await screen.findByText(/Verify a spreadsheet first/i)).toBeInTheDocument();
    expect(createDatasource).not.toHaveBeenCalled();
  });

  it("bakes the resolved file id and chosen tab onto the operations", async () => {
    await pickGoogleSheets();

    fireEvent.change(screen.getByPlaceholderText("my-datasource"), {
      target: { value: "google-sheets" },
    });
    fireEvent.change(urlField(), { target: { value: SHEET_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/i }));
    await screen.findByText("Q3 pipeline");
    await screen.findByRole("option", { name: /Pipeline/ });

    const tabSelect = screen.getAllByRole("combobox").at(-1) as HTMLSelectElement;
    fireEvent.change(tabSelect, { target: { value: "Pipeline" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Datasource/i }));

    await waitFor(() => expect(createDatasource).toHaveBeenCalled());
    const payload = vi.mocked(createDatasource).mock.calls[0][0];
    expect(payload.auth).toEqual({
      type: "google",
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });
    // Every operation knows which spreadsheet it is for, so a caller does not
    // have to be told the file id; the tab becomes the default A1 range.
    for (const op of payload.operations ?? []) {
      const fileId = op.params?.find((p) => p.name === "spreadsheet_id");
      expect(fileId?.default).toBe(SHEET_ID);
    }
    const append = (payload.operations ?? []).find((op) => op.name === "append_values");
    expect(append?.params?.find((p) => p.name === "range")?.default).toBe("Pipeline");
    // RAW survives the round trip — a value starting with "=" must stay text.
    expect(
      append?.params?.find((p) => p.name === "value_input_option")?.default,
    ).toBe("RAW");
  });
});
