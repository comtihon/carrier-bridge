import { describe, it, expect } from "vitest";
import {
  formatSpan, normalizeApprovalCode, quotaWaitOf, quotaWaitText, runnerWaitOf,
} from "./runners";

describe("normalizeApprovalCode", () => {
  it("accepts the number however the machine's output was copied", () => {
    expect(normalizeApprovalCode("482913")).toBe("482913");
    expect(normalizeApprovalCode("482 913")).toBe("482913");
    expect(normalizeApprovalCode(" 482-913 ")).toBe("482913");
  });

  it("refuses anything that is not exactly six digits", () => {
    expect(normalizeApprovalCode("")).toBeNull();
    expect(normalizeApprovalCode("48291")).toBeNull();
    expect(normalizeApprovalCode("4829134")).toBeNull();
    expect(normalizeApprovalCode("482a13")).toBeNull();
    expect(normalizeApprovalCode("482.913")).toBeNull();
  });
});

describe("formatSpan", () => {
  it("rounds down to minutes and drops zero parts", () => {
    expect(formatSpan(30_000)).toBe("under a minute");
    expect(formatSpan(45 * 60_000)).toBe("45m");
    expect(formatSpan(72 * 60_000)).toBe("1h 12m");
    expect(formatSpan(120 * 60_000)).toBe("2h");
    expect(formatSpan((27 * 60 + 5) * 60_000)).toBe("1d 3h");
  });
});

describe("waits in a run's state", () => {
  const now = new Date(2026, 9, 26, 14, 30).getTime();

  it("reads the per-step keys and ignores other steps", () => {
    const state = {
      _quota_wait_review: { resume_at: null, kind: "usage_limit", message: "", agent_id: "claude", since: "x" },
      _runner_wait_build: { runner_id: "r1", runner_name: "laptop", since: "x" },
    };
    expect(quotaWaitOf(state, "review")?.agent_id).toBe("claude");
    expect(quotaWaitOf(state, "build")).toBeNull();
    expect(runnerWaitOf(state, "build")?.runner_name).toBe("laptop");
    expect(runnerWaitOf(undefined, "build")).toBeNull();
  });

  it("counts down to the reset time", () => {
    const resume = new Date(2026, 9, 26, 15, 42).toISOString();
    expect(quotaWaitText({ kind: "usage_limit", resume_at: resume }, now))
      .toBe("Usage limit reached — resumes at 15:42 (in 1h 12m)");
  });

  it("says it waits for the reset when there is no time", () => {
    expect(quotaWaitText({ kind: "usage_limit", resume_at: null }, now))
      .toBe("Usage limit reached — resumes when the limit resets");
  });
});
