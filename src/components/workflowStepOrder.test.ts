import { describe, it, expect } from "vitest";
import { editableToApiPayload } from "./WorkflowEditor";
import type { EditableNodeConfig, EditableWorkflowDefinition } from "@/lib/types";

/** The saved step array must be a topological order of the canvas.
 *
 * The backend gives a step that declares no outgoing edge an implicit
 * fall-through to whatever sits next in this array. That makes array position
 * load-bearing for any step the user leaves unconnected on its outgoing side —
 * in practice the convergence node every branch routes into. Serialising with a
 * breadth-first walk emitted such a node at its shallowest arrival, dropping it
 * mid-array right in front of a branch, where the backend wired it into a cycle
 * nobody drew. The digest step of the CSM deadline watcher ran eleven times on
 * one cron tick that way.
 */
describe("step order serialisation", () => {
  const node = (id: string, type = "python"): EditableNodeConfig =>
    ({ id, type, name: id } as EditableNodeConfig);

  const wf = (
    nodes: EditableNodeConfig[],
    edges: Array<{ source: string; target: string }>,
  ): EditableWorkflowDefinition =>
    ({
      id: "t",
      name: "t",
      description: "",
      isNew: false,
      nodes,
      edges: edges.map((e, i) => ({ id: `e${i}`, ...e })),
    } as unknown as EditableWorkflowDefinition);

  const idsOf = (def: EditableWorkflowDefinition) =>
    (editableToApiPayload(def).steps as Array<{ id: string }>).map((s) => s.id);

  it("emits a convergence node last, not at its shallowest arrival", () => {
    // `done` is reachable in one hop from `abort`, and in four from `save`.
    // A BFS emits it right after `abort`; a topological sort waits for `save`.
    const ids = idsOf(
      wf(
        [
          node("start"), node("gate", "switch"), node("abort"), node("post"),
          node("serialise"), node("save"), node("done"),
        ],
        [
          { source: "start", target: "gate" },
          { source: "gate", target: "post" },
          { source: "gate", target: "abort" },
          { source: "abort", target: "done" },
          { source: "post", target: "serialise" },
          { source: "serialise", target: "save" },
          { source: "save", target: "done" },
        ],
      ),
    );

    expect(ids[ids.length - 1]).toBe("done");
    for (const pred of ["abort", "save", "serialise", "post"]) {
      expect(ids.indexOf(pred)).toBeLessThan(ids.indexOf("done"));
    }
  });

  it("keeps a straight chain in drawn order", () => {
    const ids = idsOf(
      wf(
        [node("c"), node("a"), node("b")],
        [
          { source: "a", target: "b" },
          { source: "b", target: "c" },
        ],
      ),
    );

    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("keeps every node when the canvas contains a cycle", () => {
    const ids = idsOf(
      wf(
        [node("a"), node("b"), node("c")],
        [
          { source: "a", target: "b" },
          { source: "b", target: "c" },
          { source: "c", target: "b" },
        ],
      ),
    );

    expect(ids.slice().sort()).toEqual(["a", "b", "c"]);
  });

  it("writes an explicit END for a node with nothing drawn leaving it", () => {
    // The prevention. An unconnected output on the canvas means "ends here",
    // but omitting `next` means "fall through to the next step in the array" —
    // which is how a convergence node acquired an edge into a branch and looped
    // the tail of the graph. The editor now says what it drew.
    const steps = editableToApiPayload(
      wf([node("a"), node("b")], [{ source: "a", target: "b" }]),
    ).steps as Array<{ id: string; next?: string }>;

    expect(steps.find((s) => s.id === "a")?.next).toBe("b");
    expect(steps.find((s) => s.id === "b")?.next).toBe("END");
  });

  it("appends disconnected nodes rather than dropping them", () => {
    const ids = idsOf(
      wf([node("a"), node("orphan"), node("b")], [{ source: "a", target: "b" }]),
    );

    expect(ids).toContain("orphan");
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
  });
});
