import { describe, it, expect } from "vitest";

import { apiStepToConfig, configToApiStep } from "./WorkflowEditor";
import type { EditableNodeConfig } from "@/lib/types";

function config(overrides: Partial<EditableNodeConfig> = {}): EditableNodeConfig {
  return {
    id: "on_order",
    type: "pubsub",
    name: "Order events",
    ...overrides,
  } as EditableNodeConfig;
}

describe("pubsub trigger step serialisation", () => {
  it("writes topic, subscription, event and the parsed schema", () => {
    const step = configToApiStep(config({
      topic: "orders",
      subscription: "projects/p/subscriptions/mine",
      event: "orders-events",
      output_key: "event",
      request_template: "Handle order from {date}",
      event_schema_text: '{"type": "object", "required": ["order_id"]}',
    }));

    expect(step).toEqual({
      id: "on_order",
      type: "pubsub",
      name: "Order events",
      topic: "orders",
      subscription: "projects/p/subscriptions/mine",
      event: "orders-events",
      output_key: "event",
      request_template: "Handle order from {date}",
      schema: { type: "object", required: ["order_id"] },
    });
  });

  it("keeps writing the pre-events datasource key when that is all the step has", () => {
    const step = configToApiStep(config({ datasource: "pubsub-orders" }));

    expect(step).toEqual({
      id: "on_order", type: "pubsub", name: "Order events", datasource: "pubsub-orders",
    });
  });

  it("prefers the event over a leftover datasource reference", () => {
    const step = configToApiStep(config({ event: "orders-events", datasource: "pubsub-orders" }));

    expect(step.event).toBe("orders-events");
    expect(step.datasource).toBeUndefined();
  });

  it("omits what was left blank", () => {
    const step = configToApiStep(config({ topic: "orders" }));

    expect(step).toEqual({ id: "on_order", type: "pubsub", name: "Order events", topic: "orders" });
  });

  it("refuses to serialise a schema that is not JSON", () => {
    expect(() => configToApiStep(config({ topic: "orders", event_schema_text: "{not json" })))
      .toThrow(/event schema is not valid JSON/);
  });

  it("reads a stored step back into editable fields", () => {
    const parsed = apiStepToConfig({
      id: "on_order",
      type: "pubsub",
      name: "Order events",
      topic: "orders",
      event: "orders-events",
      output_key: "event",
      schema: { type: "object" },
    });

    expect(parsed.type).toBe("pubsub");
    expect(parsed.topic).toBe("orders");
    expect(parsed.event).toBe("orders-events");
    expect(parsed.output_key).toBe("event");
    // Kept as text so a half-written edit does not throw away the schema.
    expect(parsed.event_schema_text).toBe(JSON.stringify({ type: "object" }, null, 2));
  });

  it("round-trips through the API shape unchanged", () => {
    const original = config({
      topic: "projects/p/topics/orders",
      subscription: "projects/p/subscriptions/mine",
      output_key: "event",
      event_schema_text: JSON.stringify({ type: "object", required: ["order_id"] }, null, 2),
    });

    const back = apiStepToConfig(configToApiStep(original));

    expect(back.topic).toBe(original.topic);
    expect(back.subscription).toBe(original.subscription);
    expect(back.output_key).toBe(original.output_key);
    expect(back.event_schema_text).toBe(original.event_schema_text);
  });

  it("still reads a workflow written before events existed", () => {
    const parsed = apiStepToConfig({
      id: "on_order", type: "pubsub", datasource: "pubsub-orders",
    });

    expect(parsed.datasource).toBe("pubsub-orders");
    expect(parsed.event).toBeUndefined();
  });
});
