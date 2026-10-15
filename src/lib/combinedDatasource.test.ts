import { describe, it, expect } from "vitest";
import {
  combinedPartsProblem,
  formatDurationMs,
  outputPartId,
  partKind,
  partRunState,
  partRunStats,
  partSubtitle,
} from "./combinedDatasource";
import type { CombinedPart } from "./types";

const PARTS: CombinedPart[] = [
  { id: "fetch_at", type: "data_source", source: "afp-projects", operation: "list_projects_operations", params: { status: [10] } },
  { id: "sel_at", type: "python", script_id: "einzelrechnung-sel", stream: "fetch_at" },
  { id: "cand", type: "python", code: "output = {}" },
  { id: "nested", type: "combined_datasource", parts: [{ id: "a", type: "python", code: "" }, { id: "b", type: "python", code: "" }] },
];

describe("partKind / partSubtitle", () => {
  it("maps each part type to its icon family", () => {
    expect(PARTS.map(partKind)).toEqual(["datasource", "python", "python", "combined"]);
    expect(partKind({ type: "whatever" })).toBe("unknown");
  });

  it("describes datasource as source.operation, python as script or inline, combined as a count", () => {
    expect(PARTS.map(partSubtitle)).toEqual([
      "afp-projects.list_projects_operations",
      "einzelrechnung-sel",
      "inline code",
      "2 parts",
    ]);
  });
});

describe("outputPartId", () => {
  it("defaults to the last part", () => {
    expect(outputPartId(PARTS)).toBe("nested");
    expect(outputPartId(PARTS, "")).toBe("nested");
  });
  it("honours an explicit output that names a part", () => {
    expect(outputPartId(PARTS, "cand")).toBe("cand");
  });
  it("falls back to the last part when output names nothing", () => {
    expect(outputPartId(PARTS, "gone")).toBe("nested");
  });
  it("is undefined with no parts", () => {
    expect(outputPartId([])).toBeUndefined();
    expect(outputPartId(undefined)).toBeUndefined();
  });
});

describe("partRunState / partRunStats", () => {
  it("maps backend part status onto canvas run states", () => {
    expect(partRunState("finished")).toBe("completed");
    expect(partRunState("failed")).toBe("failed");
    expect(partRunState("skipped")).toBe("skipped");
    expect(partRunState("running")).toBe("active");
    expect(partRunState("pending")).toBe("pending");
    expect(partRunState(undefined)).toBeUndefined();
    expect(partRunState("weird")).toBeUndefined();
  });

  it("summarises duration, records, calls and errors compactly", () => {
    expect(partRunStats({ id: "x", duration_ms: 1234, records: 50, calls: 3, error_count: 2 }))
      .toEqual(["1.2s", "50 rec", "3 calls", "2 err"]);
    expect(partRunStats({ id: "x", duration_ms: 80, records: null, calls: 1, error_count: 0 }))
      .toEqual(["80ms"]);
    expect(partRunStats(undefined)).toEqual([]);
    expect(formatDurationMs(125_000)).toBe("2m5s");
  });
});

describe("combinedPartsProblem", () => {
  it("accepts a valid list and an empty one", () => {
    expect(combinedPartsProblem(PARTS, "cand")).toBeNull();
    expect(combinedPartsProblem([])).toBeNull();
  });
  it("rejects blank and duplicate ids, nested ones included", () => {
    expect(combinedPartsProblem([{ id: "", type: "python" }])).toMatch(/needs an id/);
    expect(combinedPartsProblem([{ id: "a", type: "python" }, { id: "a", type: "python" }])).toMatch(/duplicate/);
    expect(
      combinedPartsProblem([{ id: "n", type: "combined_datasource", parts: [{ id: "x", type: "python" }, { id: "x", type: "python" }] }]),
    ).toMatch(/"n".*duplicate part id "x"/);
  });
  it("rejects an output that is not a part id", () => {
    expect(combinedPartsProblem(PARTS, "missing")).toMatch(/not a part id/);
  });
});
