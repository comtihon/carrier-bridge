import { describe, it, expect } from "vitest";
import { deriveEdges } from "./graphEdges";

/** The canvas must draw the edges the engine will build — no more, no fewer.
 *
 * These cases are the ones where the two used to disagree. The front end
 * suppressed a fall-through whenever the neighbouring step was already some
 * other step's target; the engine wired it regardless. Nothing on screen showed
 * the difference, and a workflow ran a loop nobody drew.
 */
describe("deriveEdges", () => {
  const ids = (steps: Array<Record<string, unknown>>) =>
    steps.map((s) => String(s.id));

  const pairs = (steps: Array<Record<string, unknown>>) =>
    deriveEdges(steps, ids(steps)).map((e) => `${e.source}->${e.target}`);

  it("falls through to the next step when nothing is declared", () => {
    const steps = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(pairs(steps)).toEqual(["a->b", "b->c"]);
  });

  it("still falls through when the neighbour is another step's target", () => {
    // `code-review-loop`: plan falls through to execute, which the router also
    // loops back to. Dropping this edge strands everything after plan.
    const steps = [
      { id: "plan" },
      { id: "execute" },
      { id: "review", routes: [{ next: "notify", when: "passed" }, { next: "execute" }] },
      { id: "notify", next: "END" },
    ];
    expect(pairs(steps)).toContain("plan->execute");
    expect(pairs(steps)).toContain("execute->review");
    expect(pairs(steps)).toContain("review->execute");
  });

  it("treats a next that names no step as a terminus, not an edge", () => {
    // The fix applied to both production workflows: `done` sits mid-array in
    // front of a branch and must not acquire an edge into it.
    const steps = [
      { id: "gate", routes: [{ next: "branch" }] },
      { id: "done", next: "END" },
      { id: "branch", next: "done" },
    ];
    expect(pairs(steps)).toEqual(["gate->branch", "branch->done"]);
  });

  it("emits one edge per parallel target", () => {
    const steps = [
      { id: "fan", type: "parallel", targets: ["x", "y"] },
      { id: "x", next: "END" },
      { id: "y", next: "END" },
    ];
    expect(pairs(steps)).toEqual(["fan->x", "fan->y"]);
  });

  it("carries route conditions and waits onto the edge", () => {
    const steps = [
      { id: "gate", routes: [{ next: "slow", when: "ready", wait_seconds: 30 }] },
      { id: "slow", next: "END" },
    ];
    const [edge] = deriveEdges(steps, ids(steps));
    expect(edge.data).toMatchObject({ condition: "ready", wait_seconds: 30 });
  });

  it("ignores destinations that name no known step", () => {
    const steps = [{ id: "a", next: "ghost" }, { id: "b", next: "END" }];
    expect(pairs(steps)).toEqual([]);
  });
});
