import { describe, it, expect } from "vitest";

import { stepDisplayLabel } from "./nodeUtils";
import type { EditableNodeConfig } from "@/lib/types";

function config(overrides: Partial<EditableNodeConfig> = {}): EditableNodeConfig {
  return {
    id: "on_request",
    type: "pubsub",
    name: "Pub/Sub Trigger",
    ...overrides,
  } as EditableNodeConfig;
}

const eventNames = new Map([["when_project_requested", "when_project_requested"]]);

describe("the canvas label of a step", () => {
  it("names a bound event instead of the generic node name", () => {
    const label = stepDisplayLabel(config({ event: "when_project_requested" }), eventNames);

    expect(label).toBe("when_project_requested");
  });

  it("keeps the event name verbatim, underscores and all", () => {
    const label = stepDisplayLabel(
      config({ event: "ev1" }),
      new Map([["ev1", "when_project_requested"]]),
    );

    expect(label).toBe("when_project_requested");
  });

  it("falls back to the node name when no event is bound", () => {
    expect(stepDisplayLabel(config(), eventNames)).toBe("Pub/Sub Trigger");
  });

  it("falls back to the node name while the events list is still loading", () => {
    expect(stepDisplayLabel(config({ event: "when_project_requested" }))).toBe("Pub/Sub Trigger");
    expect(stepDisplayLabel(config({ event: "when_project_requested" }), new Map()))
      .toBe("Pub/Sub Trigger");
  });

  it("falls back to the node name for an event that no longer exists", () => {
    expect(stepDisplayLabel(config({ event: "deleted_server_side" }), eventNames))
      .toBe("Pub/Sub Trigger");
  });

  it("leaves a step of another type alone", () => {
    const label = stepDisplayLabel(
      config({ type: "llm", name: "Draft reply", event: "when_project_requested" }),
      eventNames,
    );

    expect(label).toBe("Draft reply");
  });

  it("ignores the pre-events datasource binding, which names no event", () => {
    const label = stepDisplayLabel(config({ datasource: "pubsub-orders" } as Partial<EditableNodeConfig>), eventNames);

    expect(label).toBe("Pub/Sub Trigger");
  });
});
