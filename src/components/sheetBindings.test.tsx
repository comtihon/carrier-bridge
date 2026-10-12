/**
 * Authoring a sheet binding in the form.
 *
 * The claim these tests hold the panel to is that the form is correct by
 * construction: every column comes from the probe, so no screen offers a way
 * to name a column the sheet does not have. Plus the two properties a person
 * has to be able to see before trusting a write — that a column left alone is
 * absent from the plan, and that the before/after of each cell is shown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { PreviewBindingResult, ProbeSheetResult, SheetBinding } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    probeSheet: vi.fn(),
    listSheetBindings: vi.fn(async () => []),
    createSheetBinding: vi.fn(async (_id: string, b: unknown) => b),
    updateSheetBinding: vi.fn(async (_id: string, _n: string, b: unknown) => b),
    deleteSheetBinding: vi.fn(async () => undefined),
    previewSheetBinding: vi.fn(),
  };
});

import {
  createSheetBinding,
  deleteSheetBinding,
  listSheetBindings,
  previewSheetBinding,
  probeSheet,
  updateSheetBinding,
} from "@/lib/api";
import { SheetBindingsPanel } from "./SheetBindingsPanel";

const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const HEADERS = ["project_id", "status", "owner", "rtk_flag", "notes"];

const PROBE: ProbeSheetResult = {
  status: "ok",
  error: null,
  file_id: FILE_ID,
  tabs: [
    { sheet_id: 1234567, title: "Projects" },
    { sheet_id: 99, title: "Archive" },
  ],
  named_ranges: [{ name: "monthly_total", range: {} }],
  sheet: "Projects",
  sheet_id: 1234567,
  header_row: 1,
  headers: HEADERS,
  sample_rows: [
    ["P-1", "open", "ann", "yes", "first note"],
    ["P-2", "closed", "", "", ""],
  ],
  fingerprint: "sha256:abc123",
  range: "Projects!A1:Z6",
};

function storedWriteBinding(): SheetBinding {
  return {
    version: 1,
    name: "update_project",
    document: {
      provider: "google_sheets",
      file_id: FILE_ID,
      name: "RC Projects Tracker",
      sheet: "Projects",
      sheet_id: 1234567,
    },
    schema: { header_row: 1, headers: HEADERS, fingerprint: "sha256:abc123" },
    operation: "write",
    write: {
      mode: "update_by_key",
      key_column: "project_id",
      key_value: { from: "state.project.id" },
      on_missing: "error",
      value_input_option: "RAW",
      blank_policy: "skip",
      columns: { status: { from: "state.classification.status" } },
    },
    compiled_operation: "update_project",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(probeSheet).mockResolvedValue(PROBE);
  vi.mocked(listSheetBindings).mockResolvedValue([]);
});

describe("the bindings list", () => {
  it("says what to do first when the source has not been saved", () => {
    render(<SheetBindingsPanel sourceId={null} fileId={FILE_ID} />);

    expect(screen.getByText(/Save the data source first/i)).toBeInTheDocument();
    expect(probeSheet).not.toHaveBeenCalled();
  });

  it("asks for a spreadsheet before offering to author against one", async () => {
    render(<SheetBindingsPanel sourceId="google-sheets" fileId="" />);

    // findBy so the panel's own list fetch settles before the assertion.
    expect(
      await screen.findByText(/Attach and verify a spreadsheet above/i),
    ).toBeInTheDocument();
  });

  it("lists stored bindings with their direction and columns", async () => {
    vi.mocked(listSheetBindings).mockResolvedValue([storedWriteBinding()]);

    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);

    expect(await screen.findByText("update_project")).toBeInTheDocument();
    expect(screen.getByText("write")).toBeInTheDocument();
    expect(screen.getByText(/Projects · update_by_key · status/)).toBeInTheDocument();
  });

  it("deletes a binding and reloads the list", async () => {
    vi.mocked(listSheetBindings).mockResolvedValue([storedWriteBinding()]);
    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    await screen.findByText("update_project");

    fireEvent.click(screen.getByLabelText("Delete update_project"));

    await waitFor(() => {
      expect(deleteSheetBinding).toHaveBeenCalledWith("google-sheets", "update_project");
    });
    // Reloaded rather than mutated locally, so the compiled operation list the
    // backend actually holds is what is shown.
    expect(vi.mocked(listSheetBindings).mock.calls.length).toBeGreaterThan(1);
  });
});

describe("the probe drives the form", () => {
  it("fills the tab dropdown and shows the headers with real sample rows", async () => {
    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /New binding/i }));

    await waitFor(() => expect(probeSheet).toHaveBeenCalled());
    expect(probeSheet).toHaveBeenCalledWith({
      file_id: FILE_ID, sheet: null, header_row: 1, source_id: "google-sheets",
    });

    const tabSelect = await screen.findByLabelText("Tab");
    expect(within(tabSelect).getByRole("option", { name: "Projects" })).toBeInTheDocument();
    expect(within(tabSelect).getByRole("option", { name: "Archive" })).toBeInTheDocument();

    // The detected schema screen: the user's own headers, over their own data.
    for (const header of HEADERS) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("first note")).toBeInTheDocument();
    expect(screen.getByText(/5 columns on row 1/)).toBeInTheDocument();
  });

  it("re-probes when the tab changes", async () => {
    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /New binding/i }));
    const tabSelect = await screen.findByLabelText("Tab");

    fireEvent.change(tabSelect, { target: { value: "Archive" } });

    await waitFor(() => {
      expect(probeSheet).toHaveBeenCalledWith({
        file_id: FILE_ID, sheet: "Archive", header_row: 1, source_id: "google-sheets",
      });
    });
  });

  it("reports a probe failure instead of an empty form", async () => {
    vi.mocked(probeSheet).mockResolvedValue({
      status: "error",
      error: "copilot@… cannot see that document yet.",
    });

    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /New binding/i }));

    expect(await screen.findByText(/cannot see that document yet/)).toBeInTheDocument();
  });
});

describe("the read form", () => {
  it("insists on a column projection", async () => {
    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /New binding/i }));
    await screen.findByLabelText("Tab");

    // Nothing is selected to begin with, and the form says why.
    expect(screen.getByText(/Pick at least one/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "status", pressed: false }));

    expect(screen.getByRole("button", { name: "status", pressed: true })).toBeInTheDocument();
    expect(screen.queryByText(/Pick at least one/i)).not.toBeInTheDocument();
  });

  it("builds a filter whose column comes from the headers, with a value toggle", async () => {
    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /New binding/i }));
    await screen.findByLabelText("Tab");

    fireEvent.click(screen.getByRole("button", { name: /clause/i }));

    const column = screen.getByLabelText("Clause 1 column");
    // Every option is a real column of the sheet — there is no text input.
    const options = within(column).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(HEADERS);

    // The value toggles between a literal and a state path.
    fireEvent.change(screen.getByLabelText("Clause 1 value kind"), { target: { value: "state" } });
    expect(screen.getByLabelText("Clause 1 state path")).toHaveValue("state.");
  });

  it("saves a read binding carrying the probe's fingerprint and sheet_id", async () => {
    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} fileName="RC Projects Tracker" />);
    fireEvent.click(screen.getByRole("button", { name: /New binding/i }));
    await screen.findByLabelText("Tab");

    fireEvent.change(screen.getByLabelText("Binding name"), {
      target: { value: "read_open_projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: "project_id", pressed: false }));
    fireEvent.click(screen.getByRole("button", { name: "status", pressed: false }));
    fireEvent.change(screen.getByLabelText("Output key"), { target: { value: "projects" } });
    fireEvent.click(screen.getByRole("button", { name: /Create binding/i }));

    await waitFor(() => expect(createSheetBinding).toHaveBeenCalled());
    const [, binding] = vi.mocked(createSheetBinding).mock.calls[0];
    expect(binding.name).toBe("read_open_projects");
    expect(binding.operation).toBe("read");
    expect(binding.read?.columns).toEqual(["project_id", "status"]);
    expect(binding.schema.fingerprint).toBe("sha256:abc123");
    expect(binding.schema.headers).toEqual(HEADERS);
    // The numeric tab id survives a rename; the title is display only.
    expect(binding.document.sheet_id).toBe(1234567);
    expect(binding.document.sheet).toBe("Projects");
  });
});

describe("the write form", () => {
  async function openWriteForm() {
    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /New binding/i }));
    await screen.findByLabelText("Tab");
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "write" } });
    fireEvent.change(screen.getByLabelText("Binding name"), {
      target: { value: "update_project" },
    });
  }

  it("lists every detected header with 'leave unchanged' as the default", async () => {
    await openWriteForm();

    for (const header of HEADERS) {
      const kind = screen.getByLabelText(`${header} value kind`);
      expect(kind).toHaveValue("unchanged");
      expect(within(kind).getByRole("option", { name: "leave unchanged" })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/not written — the cell keeps whatever is in it/).length)
      .toBe(HEADERS.length);
  });

  it("omits an unchanged column from the saved map entirely", async () => {
    await openWriteForm();
    fireEvent.change(screen.getByLabelText("Write key column"), {
      target: { value: "project_id" },
    });
    fireEvent.change(screen.getByLabelText("status value kind"), { target: { value: "state" } });
    fireEvent.change(screen.getByLabelText("status state path"), {
      target: { value: "state.classification.status" },
    });
    fireEvent.change(screen.getByLabelText("notes value kind"), { target: { value: "literal" } });
    fireEvent.change(screen.getByLabelText("notes literal"), {
      target: { value: "Reviewed automatically" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create binding/i }));

    await waitFor(() => expect(createSheetBinding).toHaveBeenCalled());
    const [, binding] = vi.mocked(createSheetBinding).mock.calls[0];
    // Only the two columns that were given a value. owner and rtk_flag are
    // absent from the map, which is what "never touched" means.
    expect(Object.keys(binding.write!.columns).sort()).toEqual(["notes", "status"]);
    expect(binding.write!.columns.status).toEqual({ from: "state.classification.status" });
    expect(binding.write!.columns.notes).toEqual({ literal: "Reviewed automatically" });
  });

  it("defaults to RAW and makes USER_ENTERED an explicit, labelled opt-in", async () => {
    await openWriteForm();

    const parse = screen.getByLabelText(/Let Sheets parse values/i);
    expect(parse).not.toBeChecked();
    expect(screen.getByText(/stored as inert text/i)).toBeInTheDocument();
    // The formula opt-out is not even offered until USER_ENTERED is chosen.
    expect(screen.queryByLabelText("Allow formulas")).not.toBeInTheDocument();

    fireEvent.click(parse);

    expect(screen.getByText(/becomes a live\s+formula/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Allow formulas")).not.toBeChecked();
  });

  it("keeps allow_formulas off when USER_ENTERED is turned back off", async () => {
    await openWriteForm();
    const parse = screen.getByLabelText(/Let Sheets parse values/i);
    fireEvent.click(parse);
    fireEvent.click(screen.getByLabelText("Allow formulas"));
    fireEvent.click(parse);

    fireEvent.change(screen.getByLabelText("Write key column"), {
      target: { value: "project_id" },
    });
    fireEvent.change(screen.getByLabelText("status value kind"), { target: { value: "literal" } });
    fireEvent.click(screen.getByRole("button", { name: /Create binding/i }));

    await waitFor(() => expect(createSheetBinding).toHaveBeenCalled());
    const [, binding] = vi.mocked(createSheetBinding).mock.calls[0];
    // The backend refuses allow_formulas with RAW, so the form must not send it.
    expect(binding.write!.value_input_option).toBe("RAW");
    expect(binding.write!.allow_formulas).toBe(false);
  });

  it("spells out what each blank policy does", async () => {
    await openWriteForm();

    expect(screen.getByText("A blank value leaves the cell exactly as it was.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Blank policy"), { target: { value: "clear" } });

    expect(
      screen.getByText("A blank value writes an empty cell, erasing what was there."),
    ).toBeInTheDocument();
  });

  it("offers all three on_missing choices for update_by_key", async () => {
    await openWriteForm();

    const onMissing = screen.getByLabelText("Write on missing");
    expect(onMissing).toHaveValue("error");
    expect(within(onMissing).getAllByRole("option").map((o) => (o as HTMLOptionElement).value))
      .toEqual(["error", "append", "skip"]);
  });
});

describe("preview", () => {
  const READY: PreviewBindingResult = {
    status: "ready",
    error: null,
    binding: "update_project",
    operation: "write",
    mode: "update_by_key",
    row_number: 2,
    range: "Projects!B2",
    value_input_option: "RAW",
    blank_policy: "skip",
    cells: [
      { a1: "Projects!B2", column: "status", value: "closed", action: "write", before: "open", after: "closed" },
      { a1: "Projects!D2", column: "rtk_flag", value: "", action: "skip", before: "yes", after: "yes" },
    ],
    changes: [
      "Projects!B2 (status): 'open' → 'closed'",
      "Projects!D2 (rtk_flag): left unchanged ('yes')",
    ],
  };

  async function openStoredBinding() {
    vi.mocked(listSheetBindings).mockResolvedValue([storedWriteBinding()]);
    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByLabelText("Tab");
  }

  it("shows the target range and each cell's before and after", async () => {
    vi.mocked(previewSheetBinding).mockResolvedValue(READY);
    await openStoredBinding();

    fireEvent.change(screen.getByLabelText("Sample state"), {
      target: { value: '{"project": {"id": "P-1"}, "classification": {"status": "closed"}}' },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));

    await waitFor(() => expect(previewSheetBinding).toHaveBeenCalledWith(
      "google-sheets",
      "update_project",
      { state: { project: { id: "P-1" }, classification: { status: "closed" } } },
    ));
    // Twice on purpose: once as the target line, once in the cell table.
    expect(await screen.findAllByText("Projects!B2")).toHaveLength(2);
    expect(screen.getByText(/row 2/)).toBeInTheDocument();

    // Scoped to their own rows: the sample-rows table above shows the same
    // values, and it is the change table that has to be right here.
    const cell = (a1: string) =>
      within(screen.getAllByText(a1).find((el) => el.tagName === "TD")!.closest("tr")!);
    const status = cell("Projects!B2");
    expect(status.getByText("status")).toBeInTheDocument();
    expect(status.getByText("open")).toBeInTheDocument();
    expect(status.getByText("closed")).toBeInTheDocument();

    // A skipped cell is shown as skipped rather than omitted, so the policy is
    // visible instead of looking like a bug.
    const skipped = cell("Projects!D2");
    expect(skipped.getByText("yes")).toBeInTheDocument();
    expect(skipped.getByText("(unchanged)")).toBeInTheDocument();

    expect(screen.getByText("Columns not listed are not touched.")).toBeInTheDocument();
  });

  it("surfaces header drift as the error it is", async () => {
    vi.mocked(previewSheetBinding).mockResolvedValue({
      status: "error",
      error: "the sheet's header row has changed since this binding was saved…",
      binding: "update_project",
      cells: [],
      changes: [],
    });
    await openStoredBinding();

    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));

    expect(await screen.findByText(/header row has changed/)).toBeInTheDocument();
  });

  it("refuses invalid sample state without calling the backend", async () => {
    await openStoredBinding();

    fireEvent.change(screen.getByLabelText("Sample state"), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));

    expect(await screen.findByText("Sample state is not valid JSON")).toBeInTheDocument();
    expect(previewSheetBinding).not.toHaveBeenCalled();
  });

  it("edits an existing binding through the update endpoint", async () => {
    await openStoredBinding();

    fireEvent.change(screen.getByLabelText("notes value kind"), { target: { value: "literal" } });
    fireEvent.change(screen.getByLabelText("notes literal"), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: /Save binding/i }));

    await waitFor(() => expect(updateSheetBinding).toHaveBeenCalled());
    const [, name, binding] = vi.mocked(updateSheetBinding).mock.calls[0];
    expect(name).toBe("update_project");
    expect(binding.write!.columns.notes).toEqual({ literal: "done" });
    // The pre-existing mapping survives the edit.
    expect(binding.write!.columns.status).toEqual({ from: "state.classification.status" });
  });
});

describe("stale columns", () => {
  it("warns when a stored binding names a column the sheet no longer has", async () => {
    vi.mocked(listSheetBindings).mockResolvedValue([storedWriteBinding()]);
    vi.mocked(probeSheet).mockResolvedValue({
      ...PROBE,
      headers: ["project_id", "state", "owner"],
      sample_rows: [["P-1", "open", "ann"]],
      fingerprint: "sha256:different",
    });

    render(<SheetBindingsPanel sourceId="google-sheets" fileId={FILE_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(await screen.findByText(/no longer has/)).toBeInTheDocument();
    expect(screen.getByText(/nothing will write by position/)).toBeInTheDocument();
  });
});
