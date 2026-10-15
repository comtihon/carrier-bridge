import { describe, it, expect } from "vitest";
import { formatBytes, isOutputRef, outputRefFilename } from "./outputRef";

describe("isOutputRef", () => {
  it("detects stored-output references", () => {
    expect(isOutputRef({ __ref__: true, key: "runs/r1/step.md", bytes: 10 })).toBe(true);
  });
  it("ignores ordinary values", () => {
    expect(isOutputRef(null)).toBe(false);
    expect(isOutputRef("x")).toBe(false);
    expect(isOutputRef([{ __ref__: true }])).toBe(false);
    expect(isOutputRef({ __ref__: "true" })).toBe(false);
    expect(isOutputRef({ uri: "gs://x" })).toBe(false);
  });
});

describe("outputRefFilename / formatBytes", () => {
  it("prefers the download_url basename, then the key", () => {
    expect(outputRefFilename({ __ref__: true, download_url: "/runs/r1/outputs/cand.md", key: "runs/r1/other.md" })).toBe("cand.md");
    expect(outputRefFilename({ __ref__: true, key: "runs/r1/step.md" })).toBe("step.md");
    expect(outputRefFilename({ __ref__: true, field: "invoice" })).toBe("invoice.md");
  });
  it("formats sizes", () => {
    expect(formatBytes(1234)).toBe("1.2 KB");
    expect(formatBytes(12)).toBe("12 bytes");
    expect(formatBytes(undefined)).toBe("? bytes");
  });
});
