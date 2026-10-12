import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SchemaImportResult, DataSourceDefinition } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listConfigKeys: vi.fn(async () => []),
    listServiceIdentities: vi.fn(async () => ({
      enabled: false,
      identities: [],
      default_identity: null,
      error: null,
    })),
    listDatasources: vi.fn(async () => []),
    probeDatasource: vi.fn(async () => ({
      url_status: "ok" as const,
      auth_status: "skipped" as const,
      error: null,
      discovered: null,
    })),
    fetchDatasourceSchema: vi.fn(),
    uploadDatasourceSchema: vi.fn(),
    createDatasource: vi.fn(async (payload: unknown) => payload),
    updateDatasource: vi.fn(async (_id: string, payload: unknown) => payload),
  };
});

import {
  fetchDatasourceSchema,
  uploadDatasourceSchema,
  probeDatasource,
  createDatasource,
} from "@/lib/api";
import { DatasourceModal, DatasourceEditor } from "./WorkflowEditor";

const IMPORT_RESULT: SchemaImportResult = {
  kind: "openapi",
  source: "petstore.json",
  base_url: "https://api.test/v1",
  operations: [
    {
      name: "listpets",
      method: "GET",
      path: "/pets?limit={params.limit}",
      params: [{ name: "limit", type: "number", required: false, description: "" }],
      response_schema: { type: "array" },
      mapping: null,
      summary: "List pets",
    },
    {
      name: "deletepet",
      method: "DELETE",
      path: "/pets/{params.id}",
      params: [{ name: "id", type: "string", required: true, description: "" }],
      response_schema: null,
      mapping: null,
      summary: "",
    },
  ],
};

function renderModal() {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<DatasourceModal datasource={null} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

const schemaUrlField = () => screen.getByPlaceholderText("https://api.example.com/openapi.json");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(probeDatasource).mockResolvedValue({
    url_status: "ok",
    auth_status: "skipped",
    error: null,
    discovered: null,
  });
});

describe("DatasourceModal specification import", () => {
  it("offers a schema URL field instead of guessing from the base URL", () => {
    renderModal();
    expect(schemaUrlField()).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing is guessed from the base URL/i),
    ).toBeInTheDocument();
  });

  it("fetches the schema through the backend and lists the operations to pick", async () => {
    vi.mocked(fetchDatasourceSchema).mockResolvedValue(IMPORT_RESULT);
    renderModal();

    fireEvent.change(schemaUrlField(), { target: { value: "https://api.test/openapi.json" } });
    fireEvent.click(screen.getByRole("button", { name: /Fetch/i }));

    await waitFor(() =>
      expect(fetchDatasourceSchema).toHaveBeenCalledWith({
        schema_url: "https://api.test/openapi.json",
        kind: "http",
        auth: null,
      }),
    );
    expect(await screen.findByText("listpets")).toBeInTheDocument();
    expect(screen.getByText("deletepet")).toBeInTheDocument();
    // Nothing is pre-selected — the user picks what this datasource needs.
    expect(
      screen.getByRole("button", { name: /Select the operations this datasource needs/i }),
    ).toBeDisabled();
  });

  it("fills the base URL from the specification when it is still empty", async () => {
    vi.mocked(fetchDatasourceSchema).mockResolvedValue(IMPORT_RESULT);
    renderModal();

    fireEvent.change(schemaUrlField(), { target: { value: "https://api.test/openapi.json" } });
    fireEvent.click(screen.getByRole("button", { name: /Fetch/i }));

    const baseUrl = screen.getByPlaceholderText("https://api.example.com") as HTMLInputElement;
    await waitFor(() => expect(baseUrl.value).toBe("https://api.test/v1"));
  });

  it("does not overwrite a base URL the user already typed", async () => {
    vi.mocked(fetchDatasourceSchema).mockResolvedValue(IMPORT_RESULT);
    renderModal();

    const baseUrl = screen.getByPlaceholderText("https://api.example.com") as HTMLInputElement;
    fireEvent.change(baseUrl, { target: { value: "https://staging.api.test" } });
    fireEvent.change(schemaUrlField(), { target: { value: "https://api.test/openapi.json" } });
    fireEvent.click(screen.getByRole("button", { name: /Fetch/i }));

    await screen.findByText("listpets");
    expect(baseUrl.value).toBe("https://staging.api.test");
  });

  it("adds only the selected operations to the draft", async () => {
    vi.mocked(fetchDatasourceSchema).mockResolvedValue(IMPORT_RESULT);
    renderModal();

    fireEvent.change(schemaUrlField(), { target: { value: "https://api.test/openapi.json" } });
    fireEvent.click(screen.getByRole("button", { name: /Fetch/i }));
    await screen.findByText("listpets");

    fireEvent.click(screen.getByRole("checkbox", { name: /listpets/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add 1 selected operation/i }));

    // Imported operations land folded — the name shows, the fields do not.
    expect(screen.queryByPlaceholderText("list_projects")).not.toBeInTheDocument();
    const folded = screen.getAllByTitle("Expand operation");
    expect(folded).toHaveLength(1);
    // …and is marked as already added in the pick-list.
    expect(screen.getByText("already added")).toBeInTheDocument();

    // Expanding reveals the operation's fields, filled from the specification.
    fireEvent.click(folded[0]);
    const opNameFields = screen.getAllByPlaceholderText("list_projects") as HTMLInputElement[];
    expect(opNameFields.map((f) => f.value)).toEqual(["listpets"]);
  });

  it("opens a manually added operation, and folds it again on demand", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /Add operation/i }));
    // A hand-added operation starts expanded — it has nothing to show folded.
    const opName = screen.getByPlaceholderText("list_projects") as HTMLInputElement;
    expect(opName.value).toBe("");
    fireEvent.change(opName, { target: { value: "list_projects" } });

    fireEvent.click(screen.getByTitle("Collapse operation"));
    expect(screen.queryByPlaceholderText("list_projects")).not.toBeInTheDocument();
    // Folded, the operation is still identifiable by its name.
    expect(screen.getByTitle("Expand operation")).toHaveTextContent("list_projects");
  });

  it("filters the pick-list", async () => {
    vi.mocked(fetchDatasourceSchema).mockResolvedValue(IMPORT_RESULT);
    renderModal();

    fireEvent.change(schemaUrlField(), { target: { value: "https://api.test/openapi.json" } });
    fireEvent.click(screen.getByRole("button", { name: /Fetch/i }));
    await screen.findByText("listpets");

    fireEvent.change(screen.getByPlaceholderText("filter operations…"), {
      target: { value: "delete" },
    });
    expect(screen.queryByText("listpets")).not.toBeInTheDocument();
    expect(screen.getByText("deletepet")).toBeInTheDocument();
  });

  it("shows the backend's message when the schema cannot be read", async () => {
    vi.mocked(fetchDatasourceSchema).mockRejectedValue(
      new Error("Schema URL returned HTTP 404 (request failed)"),
    );
    renderModal();

    fireEvent.change(schemaUrlField(), { target: { value: "https://api.test/nope.json" } });
    fireEvent.click(screen.getByRole("button", { name: /Fetch/i }));

    expect(
      await screen.findByText("Schema URL returned HTTP 404 (request failed)"),
    ).toBeInTheDocument();
  });

  it("imports an uploaded specification file", async () => {
    vi.mocked(uploadDatasourceSchema).mockResolvedValue(IMPORT_RESULT);
    renderModal();

    const file = new File(["{}"], "petstore.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadDatasourceSchema).toHaveBeenCalledWith(file, "http"));
    expect(await screen.findByText("listpets")).toBeInTheDocument();
  });

  it("saves only the operations that were added", async () => {
    vi.mocked(fetchDatasourceSchema).mockResolvedValue(IMPORT_RESULT);
    renderModal();

    fireEvent.change(screen.getByPlaceholderText("my-datasource"), { target: { value: "petstore" } });
    fireEvent.change(schemaUrlField(), { target: { value: "https://api.test/openapi.json" } });
    fireEvent.click(screen.getByRole("button", { name: /Fetch/i }));
    await screen.findByText("listpets");

    fireEvent.click(screen.getByRole("checkbox", { name: /deletepet/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add 1 selected operation/i }));
    fireEvent.click(screen.getByRole("button", { name: /Create Datasource/i }));

    await waitFor(() => expect(createDatasource).toHaveBeenCalled());
    const payload = vi.mocked(createDatasource).mock.calls[0][0];
    expect(payload.id).toBe("petstore");
    expect(payload.base_url).toBe("https://api.test/v1");
    expect(payload.operations?.map((o) => o.name)).toEqual(["deletepet"]);
    // Params and the request path are carried through unchanged.
    expect(payload.operations?.[0].path).toBe("/pets/{params.id}");
    expect(payload.operations?.[0].params.map((p) => p.name)).toEqual(["id"]);
  });
});

describe("DatasourceModal probing", () => {
  it("does not announce a schema hunt for HTTP sources", async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("https://api.example.com"), {
      target: { value: "https://api.test" },
    });
    await waitFor(() => expect(probeDatasource).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryByText(/Introspecting the GraphQL schema/i)).not.toBeInTheDocument();
  });
});

describe("DatasourceModal kinds", () => {
  it("offers HTTP, GraphQL and Google Sheets — topics are events now", () => {
    renderModal();

    const kind = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    const values = Array.from(kind.options).map((o) => o.value);

    // "google_sheets" is an editor-only preset: it stores an `http` source
    // whose auth type is `google`. There is still no `pubsub` kind.
    expect(values).toEqual(["http", "graphql", "google_sheets"]);
  });
});

describe("DatasourceEditor surface", () => {
  const petstore: DataSourceDefinition = {
    id: "petstore",
    name: "Petstore",
    description: null,
    kind: "graphql",
    base_url: "https://api.test/v1",
    auth: { type: "none" },
    default_headers: {},
    operations: [
      {
        name: "listpets",
        method: "POST",
        path: null,
        query: "query pets { pets { id } }",
        variables: null,
        params: [],
        response_schema: { type: "object" },
        mapping: null,
      },
    ],
  };

  it("renders in the main window rather than over it", () => {
    render(<DatasourceEditor datasource={petstore} onSave={vi.fn()} onClose={vi.fn()} />);

    // The overlay is what made this a popup — the centre surface has none.
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
    expect(screen.getByText("Edit Datasource")).toBeInTheDocument();
    // The id identifies which source is open now that there is no dialog title.
    expect(screen.getByText("petstore")).toBeInTheDocument();
  });

  it("highlights the GraphQL query and the response schema", () => {
    render(<DatasourceEditor datasource={petstore} onSave={vi.fn()} onClose={vi.fn()} />);

    // Operations start folded, so open the one carrying the code-shaped fields.
    fireEvent.click(screen.getByText("listpets"));

    // react-simple-code-editor paints a Prism <pre> behind each textarea.
    const tokens = Array.from(document.querySelectorAll("pre .token"));
    expect(tokens.some((t) => t.className.includes("definition-query"))).toBe(true);
    expect(tokens.some((t) => t.className.includes("property"))).toBe(true);
  });
});
