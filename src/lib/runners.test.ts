import { describe, it, expect } from "vitest";
import {
  formatSpan, normalizeApprovalCode, queueWaitOf, queueWaitText, quotaWaitOf, quotaWaitText, runnerWaitOf,
  runtimeKeyLabel,
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

describe("queue waits", () => {
  it("reads the step's queue wait and says where it stands", () => {
    const wait = { key: "agent:pi", limit: null, position: 3, holders: 2, since: "" };
    expect(queueWaitOf({ _queue_wait_s1: wait }, "s1")).toEqual(wait);
    expect(queueWaitOf({ _queue_wait_s1: wait }, "s2")).toBeNull();
    expect(queueWaitText(wait)).toBe("Queued for agent:pi: position 3, limit unlimited, 2 running");
  });
});

describe("runtimeKeyLabel", () => {
  it("names a machine's agent and a plain agent", () => {
    const runner = { key: "runner:r1:claude", kind: "runner", runner_id: "r1", acp_agent: "claude", agent_id: null };
    expect(runtimeKeyLabel(runner, "mbp")).toBe("Claude on mbp");
    expect(runtimeKeyLabel(runner)).toBe("Claude on r1");
    expect(runtimeKeyLabel({ key: "agent:pi", kind: "agent", runner_id: null, acp_agent: null, agent_id: "pi" })).toBe("agent pi");
  });
});
