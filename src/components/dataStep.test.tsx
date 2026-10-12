/**
 * The `data` step in the editor.
 *
 * Two properties these tests exist to hold:
 *
 *   1. **A name is a filename.** Blank or duplicated names cannot reach the
 *      backend, because two selections resolving to one file means one export
 *      silently overwrites the other. The form says so, and the serialiser
 *      refuses rather than trusting the form to have been shown.
 *
 *   2. **The node does not change anything.** Users read "data" as a verb and
 *      assume the step filters or transforms. The panel has to say, on screen
 *      and not in a tooltip, that it only copies state into files.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { DataSelection, EditableNodeConfig } from "@/lib/types";
import {
  DataStepFields,
  dataStepProblem,
  selectionErrors,
  upstreamStatePaths,
} from "./DataStepFields";
import { apiStepToConfig, configToApiStep } from "./WorkflowEditor";

function baseConfig(overrides: Partial<EditableNodeConfig> = {}): EditableNodeConfig {
  return { id: "export_rows", type: "data", name: "Data", ...overrides };
}

function sel(overrides: Partial<DataSelection> = {}): DataSelection {
  return { name: "open_projects", from: "state.projects", format: "jsonl", ...overrides };
}

/**
 * The panel is controlled, so add/remove only shows up through a parent that
 * holds the config. This is the same wiring the properties panel does.
 */
function Harness({
  initial,
  nodes = [],
  edges = [],
}: {
  initial: EditableNodeConfig;
  nodes?: EditableNodeConfig[];
  edges?: Array<{ id: string; source: string; target: string }>;
}) {
  const [config, setConfig] = useState(initial);
  return (
    <DataStepFields
      config={config}
      nodes={nodes}
      edges={edges}
      onChange={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
    />
  );
}

// ─── The mental model ────────────────────────────────────────────────────────

describe("what the node is not", () => {
  it("states on screen that the step changes neither the data nor the state", () => {
    render(<DataStepFields config={baseConfig()} onChange={() => {}} />);
    expect(screen.getByText(/This step changes nothing/)).toBeInTheDocument();
    expect(screen.getByText(/passes the run's state through untouched/)).toBeInTheDocument();
    expect(screen.getByText(/does not filter, transform or reshape/)).toBeInTheDocument();
  });

  it("says plainly that a step with no selections exports nothing", () => {
    render(<DataStepFields config={baseConfig()} onChange={() => {}} />);
    expect(screen.getByText(/this step exports nothing/)).toBeInTheDocument();
  });
});

// ─── The selection form ──────────────────────────────────────────────────────

describe("selection rows", () => {
  it("adds a row, defaulting the format to jsonl", () => {
    render(<Harness initial={baseConfig()} />);
    fireEvent.click(screen.getByText("Add selection"));

    const format = screen.getByLabelText("Selection 1 format") as HTMLSelectElement;
    expect(format.value).toBe("jsonl");
    expect(screen.getByLabelText("Selection 1 name")).toBeInTheDocument();
    expect(screen.getByLabelText("Selection 1 state path")).toBeInTheDocument();
  });

  it("edits a row's name, path and format", () => {
    render(<Harness initial={baseConfig({ selections: [sel({ name: "", from: "" })] })} />);

    fireEvent.change(screen.getByLabelText("Selection 1 name"), {
      target: { value: "summary" },
    });
    fireEvent.change(screen.getByLabelText("Selection 1 state path"), {
      target: { value: "state.summary" },
    });
    fireEvent.change(screen.getByLabelText("Selection 1 format"), {
      target: { value: "csv" },
    });

    expect((screen.getByLabelText("Selection 1 name") as HTMLInputElement).value).toBe("summary");
    expect((screen.getByLabelText("Selection 1 state path") as HTMLInputElement).value)
      .toBe("state.summary");
    // The filename the name produces is shown, since that is what it becomes.
    expect(screen.getByText("summary.csv")).toBeInTheDocument();
  });

  it("removes the row that was asked for, not the last one", () => {
    render(
      <Harness
        initial={baseConfig({
          selections: [sel({ name: "first" }), sel({ name: "second" }), sel({ name: "third" })],
        })}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove selection 2"));

    expect((screen.getByLabelText("Selection 1 name") as HTMLInputElement).value).toBe("first");
    expect((screen.getByLabelText("Selection 2 name") as HTMLInputElement).value).toBe("third");
    expect(screen.queryByLabelText("Selection 3 name")).not.toBeInTheDocument();
  });

  it("offers upstream state paths as suggestions, keeping the field free text", () => {
    const nodes: EditableNodeConfig[] = [
      { id: "fetch", type: "data_source", name: "Fetch", output_key: "projects" },
      { id: "summarise", type: "llm", name: "Summarise", output_key: "summary" },
      { id: "export_rows", type: "data", name: "Data", selections: [sel()] },
      // Downstream of the data step, so not a path it can read.
      { id: "notify", type: "slack", name: "Notify", output_key: "posted" },
    ];
    const edges = [
      { id: "e1", source: "fetch", target: "summarise" },
      { id: "e2", source: "summarise", target: "export_rows" },
      { id: "e3", source: "export_rows", target: "notify" },
    ];
    const { container } = render(<Harness initial={nodes[2]} nodes={nodes} edges={edges} />);

    const options = [...container.querySelectorAll("datalist option")].map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toEqual(["state.projects", "state.summary"]);

    // A suggestion list, not a constraint: the input still takes anything.
    const input = screen.getByLabelText("Selection 1 state path") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "state.something_undeclared" } });
    expect(input.value).toBe("state.something_undeclared");
  });

  it("says there is nothing to suggest when no upstream step declares an output", () => {
    render(<Harness initial={baseConfig({ selections: [sel()] })} />);
    expect(screen.getByText(/No upstream step declares an output key/)).toBeInTheDocument();
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe("name validation", () => {
  it("requires a name, because the name is the filename", () => {
    expect(selectionErrors([sel({ name: "" })])[0]).toMatch(/name is required/i);
    expect(selectionErrors([sel({ name: "   " })])[0]).toMatch(/name is required/i);
  });

  it("rejects a second selection reusing a name, and blames the second one", () => {
    const errors = selectionErrors([sel({ name: "rows" }), sel({ name: "rows" })]);
    expect(errors[0]).toBeNull();
    expect(errors[1]).toMatch(/already uses this name/i);
  });

  it("treats a case-only difference as a duplicate — one file on most machines", () => {
    const errors = selectionErrors([sel({ name: "Rows" }), sel({ name: "rows" })]);
    expect(errors[1]).toMatch(/already uses this name/i);
  });

  it("rejects a name that cannot be a filename", () => {
    expect(selectionErrors([sel({ name: "open/projects" })])[0]).toMatch(/becomes a filename/i);
    expect(selectionErrors([sel({ name: "../etc/passwd" })])[0]).toMatch(/becomes a filename/i);
  });

  it("requires a state path to read", () => {
    expect(selectionErrors([sel({ from: "" })])[0]).toMatch(/state path/i);
  });

  it("accepts a well-formed pair", () => {
    expect(selectionErrors([sel(), sel({ name: "summary", from: "state.summary" })]))
      .toEqual([null, null]);
  });

  it("shows the duplicate on screen, next to the row that is wrong", () => {
    render(
      <Harness initial={baseConfig({ selections: [sel({ name: "rows" }), sel({ name: "rows" })] })} />,
    );
    expect(screen.getByText(/already uses this name/i)).toBeInTheDocument();
  });
});

// ─── Serialisation ───────────────────────────────────────────────────────────

describe("configToApiStep", () => {
  it("writes selections through, trimmed", () => {
    const step = configToApiStep(
      baseConfig({
        selections: [
          sel({ name: " open_projects ", from: " state.projects " }),
          sel({ name: "summary", from: "state.summary", format: "json" }),
        ],
      }),
    );
    expect(step).toEqual({
      id: "export_rows",
      type: "data",
      name: "Data",
      selections: [
        { name: "open_projects", from: "state.projects", format: "jsonl" },
        { name: "summary", from: "state.summary", format: "json" },
      ],
    });
  });

  it("stores no output_key: the step writes nothing back into state", () => {
    const step = configToApiStep(baseConfig({ selections: [sel()] }));
    expect(step).not.toHaveProperty("output_key");
  });

  it("refuses to serialise a duplicated name rather than dropping one file", () => {
    expect(() =>
      configToApiStep(baseConfig({ selections: [sel({ name: "rows" }), sel({ name: "rows" })] })),
    ).toThrow(/already uses this name/i);
  });

  it("refuses to serialise a blank name", () => {
    expect(() => configToApiStep(baseConfig({ selections: [sel({ name: "" })] })))
      .toThrow(/name is required/i);
  });

  it("accepts a step with no selections — a node just dropped on the canvas", () => {
    const step = configToApiStep(baseConfig());
    expect(step).toEqual({ id: "export_rows", type: "data", name: "Data" });
    expect(dataStepProblem(baseConfig())).toBeNull();
  });

  it("round-trips through apiStepToConfig", () => {
    const config = baseConfig({ selections: [sel(), sel({ name: "summary", format: "csv" })] });
    const back = apiStepToConfig(configToApiStep(config));
    expect(back.type).toBe("data");
    expect(back.selections).toEqual(config.selections);
  });
});

// ─── Upstream paths ──────────────────────────────────────────────────────────

describe("upstreamStatePaths", () => {
  const nodes: EditableNodeConfig[] = [
    { id: "a", type: "python", name: "A", output_key: "rows" },
    { id: "b", type: "langgraph-agent", name: "B", output_mapping: { verdict: "x", notes: "y" } },
    { id: "c", type: "data", name: "C" },
    { id: "d", type: "llm", name: "D", output_key: "later" },
  ];
  const edges = [
    { id: "1", source: "a", target: "b" },
    { id: "2", source: "b", target: "c" },
    { id: "3", source: "c", target: "d" },
  ];

  it("collects every ancestor's keys, sorted, and nothing downstream", () => {
    expect(upstreamStatePaths(nodes, edges, "c")).toEqual([
      "state.notes",
      "state.rows",
      "state.verdict",
    ]);
  });

  it("returns nothing for a node with no ancestors", () => {
    expect(upstreamStatePaths(nodes, edges, "a")).toEqual([]);
  });

  it("terminates on a cycle rather than walking it forever", () => {
    const cyclic = [...edges, { id: "4", source: "d", target: "a" }];
    expect(upstreamStatePaths(nodes, cyclic, "c")).toContain("state.rows");
  });
});

// ─── Readonly ────────────────────────────────────────────────────────────────

describe("readonly", () => {
  it("offers no way to add or remove a selection", () => {
    render(
      <DataStepFields
        config={baseConfig({ selections: [sel()] })}
        onChange={vi.fn()}
        readonly
      />,
    );
    expect(screen.queryByText("Add selection")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Remove selection 1")).toBeDisabled();
    expect(screen.getByLabelText("Selection 1 name")).toBeDisabled();
  });
});
