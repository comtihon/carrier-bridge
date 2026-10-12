import { describe, it, expect } from "vitest";
import { configToRFNode } from "./utils/nodeUtils";
import { sharedOperatorNodeTypes } from "./nodes";
import { TYPE_COLORS } from "./constants";
import type { EditableNodeConfig } from "@/lib/types";

/** Proceed (Or) is an operator node, so it must reach the operator renderer.
 *
 * The mapping in configToRFNode is an explicit allow-list: a type missing from it
 * silently falls back to "editorNode" and renders as an ordinary rectangular step
 * instead of a fan-in bar, which is easy to miss by eye and hard to spot in review.
 */
describe("Proceed (Or) canvas node", () => {
  const cfg = (type: string): EditableNodeConfig =>
    ({ id: "gate", type, name: "gate" } as EditableNodeConfig);

  it("maps to its own react-flow node type, not the generic step node", () => {
    expect(configToRFNode(cfg("proceed_or"), { x: 0, y: 0 }).type).toBe("proceed_or");
  });

  it("keeps join on its own renderer too", () => {
    expect(configToRFNode(cfg("join"), { x: 0, y: 0 }).type).toBe("join");
  });

  it("has a renderer registered for that type", () => {
    expect(sharedOperatorNodeTypes).toHaveProperty("proceed_or");
  });

  it("is not coloured like join — the two must be tellable apart at a glance", () => {
    expect(TYPE_COLORS.proceed_or).toBeDefined();
    expect(TYPE_COLORS.proceed_or.border).not.toBe(TYPE_COLORS.join.border);
  });
});
