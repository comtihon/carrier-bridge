/**
 * combined_datasource in the UI: the parts pyramid on the canvas node, the
 * run-status colouring, the properties panel editing, the save round-trip
 * that must not drop `parts` / `output`, and stored-output refs.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { CombinedPart, EditableNodeConfig, RunPartStatus } from "@/lib/types";

vi.mock("@/hooks/useDatasources", () => ({
  useDatasources: () => ({
    datasources: [
      { id: "afp-projects", name: "AFP projects", operations: [{ name: "list_projects_operations", method: "GET", params: [] }] },
    ],
    byId: new Map(),
    error: undefined,
    isLoading: false,
    reload: () => {},
  }),
}));

const downloadMock = vi.fn(async () => {});
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  downloadRunDataArtifact: (...args: unknown[]) => downloadMock(...(args as [])),
}));

import { CombinedPartsList } from "./workflow-canvas/nodes/CombinedPartsList";
import { WorkflowStepNode } from "./workflow-canvas/nodes/WorkflowStepNode";
import { CombinedDatasourceFields, parsePartsJson } from "./CombinedDatasourceFields";
import { StoredOutputRef } from "./StoredOutputRef";
import { ValueView } from "./ValueView";
import { apiStepToConfig, configToApiStep, workflowToYaml, yamlToWorkflow } from "./WorkflowEditor";

const PARTS: CombinedPart[] = [
  { id: "fetch_at", type: "data_source", source: "afp-projects", operation: "list_projects_operations", params: { status: [10], page_size: 50 } },
  { id: "sel_at", type: "python", script_id: "einzelrechnung-sel", stream: "fetch_at" },
  { id: "cand", type: "python", code: "output = {'project_ids': parts['sel_at']['ids']}" },
  {
    id: "nested",
    type: "combined_datasource",
    parts: [
      { id: "inner_a", type: "python", code: "output = 1" },
      { id: "inner_b", type: "data_source", source: "x", operation: "y" },
    ],
  },
];

const API_STEP = {
  id: "invoice_candidates",
  type: "combined_datasource",
  name: "Invoice candidates",
  output_key: "invoice_candidates",
  output: "cand",
  parts: PARTS,
  future_field: { kept: true },
};

const rows = () => screen.getAllByTestId("combined-part").filter((el) => !el.parentElement?.closest("[data-testid=combined-part]"));

describe("CombinedPartsList", () => {
  it("renders the ordered parts with a kind (icon) and subtitle per type", () => {
    render(<CombinedPartsList parts={PARTS} />);
    const top = rows();
    expect(top.map((r) => r.getAttribute("data-part-id"))).toEqual(["fetch_at", "sel_at", "cand", "nested"]);
    expect(top.map((r) => r.getAttribute("data-kind"))).toEqual(["datasource", "python", "python", "combined"]);
    expect(within(top[0]).getByText("afp-projects.list_projects_operations")).toBeInTheDocument();
    expect(within(top[1]).getByText("einzelrechnung-sel")).toBeInTheDocument();
    expect(within(top[2]).getByText("inline code")).toBeInTheDocument();
    expect(within(top[0]).getByLabelText("datasource")).toBeInTheDocument();
    expect(within(top[1]).getByLabelText("python")).toBeInTheDocument();
    expect(within(top[3]).getByLabelText("combined")).toBeInTheDocument();
  });

  it("collapses nested combined parts by default and expands on click", () => {
    render(<CombinedPartsList parts={PARTS} />);
    expect(screen.queryByText("inner_a")).not.toBeInTheDocument();
    const toggle = screen.getByTestId("toggle-nested");
    expect(toggle).toHaveTextContent("2 parts");
    fireEvent.click(toggle);
    expect(screen.getByText("inner_a")).toBeInTheDocument();
    expect(screen.getByText("inner_b")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText("inner_a")).not.toBeInTheDocument();
  });

  it("badges the last part as output by default", () => {
    render(<CombinedPartsList parts={PARTS} />);
    const badged = rows().filter((r) => r.getAttribute("data-output") === "true");
    expect(badged.map((r) => r.getAttribute("data-part-id"))).toEqual(["nested"]);
  });

  it("badges the explicit output, and the run's output_part wins", () => {
    const { rerender } = render(<CombinedPartsList parts={PARTS} output="cand" />);
    expect(rows().find((r) => r.getAttribute("data-output"))?.getAttribute("data-part-id")).toBe("cand");
    rerender(<CombinedPartsList parts={PARTS} output="cand" runOutputPart="sel_at" />);
    expect(rows().find((r) => r.getAttribute("data-output"))?.getAttribute("data-part-id")).toBe("sel_at");
  });

  it("colours rows by run status and shows compact stats and errors", () => {
    const runParts: RunPartStatus[] = [
      { id: "fetch_at", status: "finished", duration_ms: 1500, records: 50, calls: 1, error_count: 0, errors: [] },
      { id: "sel_at", status: "failed", duration_ms: 20, records: null, calls: 1, error_count: 1, errors: ["boom"] },
      { id: "cand", status: "skipped" },
      { id: "nested", status: "running", parts: [{ id: "inner_a", status: "finished" }] },
    ];
    render(<CombinedPartsList parts={PARTS} runParts={runParts} showErrors />);
    expect(rows().map((r) => r.getAttribute("data-run-state"))).toEqual(["completed", "failed", "skipped", "active"]);
    expect(within(rows()[0]).getByTestId("part-stats")).toHaveTextContent("1.5s · 50 rec");
    expect(within(rows()[1]).getByTestId("part-stats")).toHaveTextContent("1 err");
    expect(screen.getByText("boom")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-nested"));
    const inner = screen.getAllByTestId("combined-part").find((r) => r.getAttribute("data-part-id") === "inner_a");
    expect(inner?.getAttribute("data-run-state")).toBe("completed");
  });

  it("falls back to the run's parts when the definition has none", () => {
    render(<CombinedPartsList parts={[]} runParts={[{ id: "only", type: "python", status: "finished" }]} />);
    expect(rows().map((r) => r.getAttribute("data-part-id"))).toEqual(["only"]);
  });
});

describe("WorkflowStepNode for combined_datasource", () => {
  it("draws the pyramid: title, output key, part count and the parts", () => {
    const data = { ...apiStepToConfig(API_STEP), label: "Invoice candidates", stepType: "combined_datasource" };
    render(
      <ReactFlowProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <WorkflowStepNode {...({ id: "invoice_candidates", data, selected: false } as any)} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("Invoice candidates")).toBeInTheDocument();
    const body = screen.getByTestId("combined-body");
    expect(body).toHaveTextContent("→ invoice_candidates");
    expect(body).toHaveTextContent("4 parts");
    expect(rows().find((r) => r.getAttribute("data-output"))?.getAttribute("data-part-id")).toBe("cand");
  });
});

describe("save round-trip", () => {
  it("keeps parts (unknown keys included) and output through config ↔ API", () => {
    const cfg = apiStepToConfig(API_STEP);
    expect(cfg.output_part).toBe("cand");
    expect(cfg.output_fields).toBeUndefined();
    const back = configToApiStep(cfg);
    expect(back.parts).toEqual(PARTS);
    expect(back.output).toBe("cand");
    expect(back.output_key).toBe("invoice_candidates");
  });

  it("survives YAML export/import", () => {
    const wf = {
      id: "wf", name: "wf", nodes: [apiStepToConfig(API_STEP)], edges: [],
    };
    const yaml = workflowToYaml(wf);
    const again = yamlToWorkflow(yaml, { id: "wf", name: "wf" });
    expect(again.nodes[0].parts).toEqual(PARTS);
    expect(again.nodes[0].output_part).toBe("cand");
  });

  it("refuses to save duplicate part ids", () => {
    const cfg: EditableNodeConfig = { id: "s", type: "combined_datasource", name: "s", parts: [{ id: "a", type: "python" }, { id: "a", type: "python" }] };
    expect(() => configToApiStep(cfg)).toThrow(/duplicate/);
  });

  it("does not break llm_structured output field lists", () => {
    const cfg = apiStepToConfig({ id: "x", type: "llm_structured", output: [{ name: "ok", type: "bool" }] });
    expect(cfg.output_fields).toEqual([{ name: "ok", type: "bool" }]);
    expect(cfg.output_part).toBeUndefined();
  });
});

function Harness({ initial }: { initial: EditableNodeConfig }) {
  const [config, setConfig] = useState(initial);
  return (
    <>
      <CombinedDatasourceFields config={config} onChange={(p) => setConfig((c) => ({ ...c, ...p }))} />
      <pre data-testid="state">{JSON.stringify(configToApiStep(config))}</pre>
    </>
  );
}
const saved = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}");

describe("CombinedDatasourceFields", () => {
  const base = (): EditableNodeConfig => ({ ...apiStepToConfig(API_STEP), output_part: undefined });

  it("adds, reorders and deletes parts", () => {
    render(<Harness initial={{ id: "s", type: "combined_datasource", name: "s", parts: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Datasource/ }));
    fireEvent.click(screen.getByRole("button", { name: /Python/ }));
    expect(saved().parts.map((p: CombinedPart) => p.type)).toEqual(["data_source", "python"]);
    fireEvent.click(screen.getAllByTitle("Move up")[1]);
    expect(saved().parts.map((p: CombinedPart) => p.type)).toEqual(["python", "data_source"]);
    fireEvent.click(screen.getAllByTitle("Delete part")[0]);
    expect(saved().parts.map((p: CombinedPart) => p.type)).toEqual(["data_source"]);
  });

  it("edits output key and output part", () => {
    render(<Harness initial={base()} />);
    fireEvent.change(screen.getByLabelText("Output key"), { target: { value: "cands" } });
    fireEvent.change(screen.getByLabelText("Output part"), { target: { value: "sel_at" } });
    expect(saved().output_key).toBe("cands");
    expect(saved().output).toBe("sel_at");
  });

  it("edits parts as JSON and only commits valid arrays", () => {
    render(<Harness initial={base()} />);
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    const ta = screen.getByLabelText("Parts JSON");
    fireEvent.change(ta, { target: { value: "{not json" } });
    expect(screen.getByTestId("parts-json-error")).toHaveTextContent(/Invalid JSON/);
    expect(saved().parts).toEqual(PARTS);
    fireEvent.change(ta, { target: { value: JSON.stringify([{ id: "only", type: "python", code: "x" }]) } });
    expect(screen.queryByTestId("parts-json-error")).not.toBeInTheDocument();
    expect(saved().parts).toEqual([{ id: "only", type: "python", code: "x" }]);
  });

  it("parsePartsJson rejects non-arrays and duplicate ids", () => {
    expect(parsePartsJson("{}").error).toMatch(/array/);
    expect(parsePartsJson('[{"id":"a","type":"python"},{"id":"a","type":"python"}]').error).toMatch(/duplicate/);
  });
});

describe("stored output refs", () => {
  const ref = { __ref__: true as const, key: "runs/r1/cand.md", bytes: 2048, preview: "first lines", kind: "list", download_url: "/runs/r1/outputs/cand.md" };

  it("renders size, preview and a download using the bearer download helper", async () => {
    render(<StoredOutputRef value={ref} />);
    expect(screen.getByText(/2.0 KB, list/)).toBeInTheDocument();
    expect(screen.getByText(/first lines/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Download/ }));
    expect(downloadMock).toHaveBeenCalledWith({ filename: "cand.md", download_url: "/runs/r1/outputs/cand.md" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Download/ })).not.toBeDisabled());
  });

  it("ValueView shows a ref compactly instead of raw JSON", () => {
    render(<ValueView value={ref} />);
    expect(screen.getByTestId("stored-output-ref")).toBeInTheDocument();
    expect(screen.queryByText(/__ref__/)).not.toBeInTheDocument();
  });
});
