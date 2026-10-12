import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listDatasourceSummaries: vi.fn(async () => []),
    deleteDatasource: vi.fn(async () => undefined),
  };
});

import { DatasourcesPanel } from "./DatasourcesPanel";
import { deleteDatasource, listDatasourceSummaries, type DataSourceSummary } from "@/lib/api";

// A summary is all the panel gets: no auth, and operations trimmed to the
// name+method the risk badge aggregates.
const petstore: DataSourceSummary = {
  id: "petstore",
  name: "Petstore",
  description: null,
  kind: "http",
  base_url: "https://api.test/v1",
  operations: [],
};

function renderPanel(props: Partial<React.ComponentProps<typeof DatasourcesPanel>> = {}) {
  const onOpen = vi.fn();
  const onNew = vi.fn();
  render(<DatasourcesPanel onClose={vi.fn()} onOpen={onOpen} onNew={onNew} {...props} />);
  return { onOpen, onNew };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDatasourceSummaries).mockResolvedValue([petstore]);
});

describe("DatasourcesPanel", () => {
  it("lists sources by name and base URL", async () => {
    renderPanel();

    expect(await screen.findByText("Petstore")).toBeInTheDocument();
    expect(screen.getByText("https://api.test/v1")).toBeInTheDocument();
  });

  it("hands a clicked source's id to the centre editor instead of opening a dialog", async () => {
    const { onOpen } = renderPanel();

    fireEvent.click(await screen.findByText("Petstore"));

    // An id, not the row: the row is a summary with no auth and no operation
    // bodies, and the editor saves a whole document.
    expect(onOpen).toHaveBeenCalledWith("petstore");
    // The editor lives in the main window now — nothing is layered over the app.
    expect(screen.queryByText("Edit Datasource")).not.toBeInTheDocument();
  });

  it("asks the centre editor for a blank source rather than a create dialog", async () => {
    const { onNew } = renderPanel();
    await screen.findByText("Petstore");

    fireEvent.click(screen.getByTitle("New datasource"));

    expect(onNew).toHaveBeenCalled();
    expect(screen.queryByText("Create Datasource")).not.toBeInTheDocument();
  });

  it("marks the source the centre editor is showing", async () => {
    renderPanel({ selectedId: "petstore" });

    const row = (await screen.findByText("Petstore")).closest("div.group");
    expect(row?.className).toContain("border-cyan-600");
  });

  it("asks before deleting, then reloads", async () => {
    renderPanel();
    await screen.findByText("Petstore");

    fireEvent.click(screen.getByTitle("Delete"));
    expect(await screen.findByText("Delete datasource?")).toBeInTheDocument();
    expect(deleteDatasource).not.toHaveBeenCalled();

    // The dialog's Delete — the row's icon button carries the same label.
    const deletes = screen.getAllByRole("button", { name: /^Delete$/ });
    fireEvent.click(deletes[deletes.length - 1]);

    await waitFor(() => expect(deleteDatasource).toHaveBeenCalledWith("petstore"));
    expect(listDatasourceSummaries).toHaveBeenCalledTimes(2);
  });

  // The badge answers "can running this destroy something?", so the worst verb
  // in the set decides the colour — a source is not "mostly safe".
  describe("aggregate risk badge", () => {
    // The summary carries name+method only — that is exactly what the badge
    // reads, which is why those two fields survive the projection.
    const op = (name: string, method: string) => ({ name, method });

    async function badgeFor(operations: { name: string; method: string }[]) {
      vi.mocked(listDatasourceSummaries).mockResolvedValue([{ ...petstore, operations }]);
      renderPanel();
      const row = (await screen.findByText("Petstore")).closest("div.group")!;
      return row.querySelector("span.font-mono.rounded")!;
    }

    it("is green when every operation only reads", async () => {
      const badge = await badgeFor([op("list", "GET"), op("head", "HEAD")]);
      expect(badge.className).toContain("text-emerald-300");
      expect(badge.getAttribute("title")).toBe("Read-only (2 operations)");
    });

    it("is orange when one operation writes", async () => {
      const badge = await badgeFor([op("list", "GET"), op("add", "POST")]);
      expect(badge.className).toContain("text-amber-300");
      expect(badge.getAttribute("title")).toBe("1 write operation");
    });

    it("is red when one operation deletes, whatever else is there", async () => {
      const badge = await badgeFor([op("list", "GET"), op("add", "POST"), op("drop", "DELETE")]);
      expect(badge.className).toContain("text-red-300");
      expect(badge.getAttribute("title")).toBe("Contains a delete operation");
    });

    it("stays neutral rather than red when there are no operations", async () => {
      const badge = await badgeFor([]);
      expect(badge.className).toContain("text-slate-400");
      expect(badge.getAttribute("title")).toBe("No operations — risk unknown");
    });
  });

  it("surfaces a load failure instead of showing an empty list", async () => {
    vi.mocked(listDatasourceSummaries).mockRejectedValue(new Error("API 500: boom"));
    renderPanel();

    expect(await screen.findByText("API 500: boom")).toBeInTheDocument();
  });
});
