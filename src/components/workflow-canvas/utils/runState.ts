import type { WorkflowRun, WorkflowStepDefinition, StepStatus } from "@/lib/types";

export type NodeState =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * Step types that are pure control flow: they route the run and always return
 * an empty output.
 *
 * The backend infers a step's status from what its node returned — an empty
 * dict becomes `skipped` (see `step_status_from_output` in yaml_graph.py). An
 * operator therefore reports `skipped` on every run it took part in, which is
 * not the same thing as a branch that was never entered. Treating them as
 * completed keeps the traversal readable: a fan-out between two green steps has
 * to look like it ran, because it did.
 */
const PASS_THROUGH_TYPES = new Set(["parallel", "join", "switch", "proceed_or"]);

/**
 * States that mean "control flow reached this node".
 *
 * `skipped` belongs here: the backend only records a status for a node it
 * actually invoked, so a skipped step is one that ran and produced nothing (an
 * operator, or a step whose `when` was falsy). A node that was never reached
 * keeps its initial `pending` status and stays out of this set.
 */
const VISITED_STATES = new Set<string>(["completed", "active", "failed", "skipped"]);

export function deriveNodeState(
  step: WorkflowStepDefinition,
  run: WorkflowRun,
  stepType?: string,
): NodeState {
  const backendStatus: StepStatus | undefined = step.status;
  if (backendStatus) {
    switch (backendStatus) {
      case "running":               return "active";
      case "waiting_clarification": return "active";
      case "waiting_approval":      return "active";
      case "finished": return "completed";
      case "failed":   return "failed";
      case "skipped":
        return PASS_THROUGH_TYPES.has(stepType ?? "") ? "completed" : "skipped";
      case "pending":
        // Never reached. A finished run does not turn that into "skipped" —
        // the two look alike but only one of them may animate its edges.
        return "pending";
      default:
        break;
    }
  }

  const steps = run.steps ?? [];
  const stepIdx = steps.findIndex((s) => s.id === step.id);
  const currentIdx = run.current_step
    ? steps.findIndex((s) => s.id === run.current_step)
    : -1;

  // No per-step status at all (runs recorded before step_statuses existed).
  if (run.status === "completed") return "completed";

  if (run.status === "cancelled") {
    const approvalIdx = steps.findIndex((s) => s.type === "approval");
    const cancelBoundary = approvalIdx > -1 ? approvalIdx : 0;
    if (stepIdx >= cancelBoundary) return "cancelled";
    if (currentIdx > -1 && stepIdx < cancelBoundary) return "completed";
    return "completed";
  }

  if (run.status === "failed") {
    if (run.current_step === step.id) return "failed";
    if (currentIdx > -1 && stepIdx > currentIdx) return "pending";
  }
  if (run.current_step === step.id) return "active";
  if (currentIdx > -1 && stepIdx < currentIdx) return "completed";

  if (run.status === "running" && currentIdx === -1 && stepIdx === 0) {
    return "active";
  }

  return "pending";
}

/**
 * Whether an edge is part of the path the run actually took.
 *
 * Both ends have to have been reached: an untaken branch stays dark even though
 * its source completed, and a step that was never entered must not animate the
 * edge leading out of it. Backward/loop edges animate only while the loop is
 * being re-entered (target currently active); an untaken loop-back to an
 * already-completed step stays dark.
 */
export function shouldAnimateEdge(
  srcState: string | undefined,
  tgtState: string | undefined,
  isForward: boolean,
): boolean {
  if (!VISITED_STATES.has(tgtState ?? "")) return false;
  // A source that is still active or failed has not handed control on yet.
  if (srcState !== "completed" && srcState !== "skipped") return false;
  return isForward || tgtState === "active";
}
