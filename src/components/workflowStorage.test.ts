import { describe, it, expect } from "vitest";
import { configToApiStep } from "./WorkflowEditor";
import type { EditableNodeConfig } from "@/lib/types";

/** Storage steps must serialise their action, and never an owner.
 *
 * The backend takes the owning workflow id from the runner, so there is no
 * `workflow_id` on the step. If one ever appears in this payload it means the
 * UI grew a way to point a step at another workflow's state — which is exactly
 * what the design forbids.
 */
describe("storage step serialisation", () => {
  const cfg = (extra: Partial<EditableNodeConfig>): EditableNodeConfig =>
    ({ id: "load", type: "storage", name: "load", ...extra } as EditableNodeConfig);

  it("always sends an action, defaulting to get", () => {
    expect(configToApiStep(cfg({}))).toMatchObject({ action: "get" });
  });

  it("sends key and output_key for a read", () => {
    const step = configToApiStep(cfg({ action: "get", key: "alert-state", output_key: "alert_state" }));
    expect(step).toMatchObject({ action: "get", key: "alert-state", output_key: "alert_state" });
  });

  it("sends value only for set", () => {
    const asSet = configToApiStep(cfg({ action: "set", key: "k", value: { a: 1 } }));
    expect(asSet).toMatchObject({ action: "set", value: { a: 1 } });

    const asGet = configToApiStep(cfg({ action: "get", key: "k", value: { a: 1 } }));
    expect(asGet).not.toHaveProperty("value");
  });

  it("never serialises an owner field", () => {
    const step = configToApiStep(cfg({ action: "get", key: "k" }));
    for (const forbidden of ["workflow_id", "graph_id", "owner"]) {
      expect(step).not.toHaveProperty(forbidden);
    }
  });
});
