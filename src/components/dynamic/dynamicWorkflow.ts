import type {
  AutomationMode,
  DynamicStepConfig,
  EditableNodeConfig,
  EditableWorkflowDefinition,
  JobCategory,
  JobSlot,
} from "@/lib/types";

/** The step id a dynamic workflow's orchestrator step is saved under. */
export const DYNAMIC_STEP_ID = "orchestrator";

const TRIGGER_TYPES = new Set(["http", "cron", "pubsub"]);

export const DEFAULT_SLOTS: Record<JobCategory, JobSlot> = {
  planning: { min: 0, max: 3 },
  execution: { min: 1, max: 8 },
  validation: { min: 0, max: 3 },
  integration: { min: 0, max: 1 },
};

export const DEFAULT_LIMITS = {
  max_total_jobs: 30,
  max_handbacks: 3,
  max_delegations: 5,
  max_replans: 2,
  max_parallel: 4,
};

export const AUTOMATION_MODES: Array<{ value: AutomationMode; label: string; description: string }> = [
  { value: "ask", label: "Ask", description: "Approve the job plan, every handback, delegation and escalation." },
  { value: "plan", label: "Plan", description: "Approve the job plan once; then run unattended. Escalations and agent questions still ask." },
  { value: "auto", label: "Auto", description: "Run unattended. Only escalations (a job that keeps failing) and agent questions ask." },
  { value: "bypass", label: "Bypass", description: "Never ask. Escalations fail the run; questions are answered with “use your best judgement”." },
];

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  planning: "Planning",
  execution: "Execution",
  validation: "Validation",
  integration: "Integration",
};

export function defaultDynamicConfig(): DynamicStepConfig {
  return {
    agent_pool: [],
    jobs: { ...DEFAULT_SLOTS },
    automation: "plan",
    limits: { ...DEFAULT_LIMITS },
  };
}

/**
 * A dynamic workflow is one whose only working step is a `dynamic` step
 * (optionally behind a trigger). The designer shows its configuration instead
 * of a canvas; a workflow mixing static steps with a dynamic stage stays on
 * the canvas.
 */
export function isDynamicWorkflow(wf: Pick<EditableWorkflowDefinition, "nodes">): boolean {
  const steps = wf.nodes.filter((n) => !String(n.type).endsWith("-addon"));
  const dynamic = steps.filter((n) => n.type === "dynamic");
  return dynamic.length === 1 && steps.every((n) => n.type === "dynamic" || TRIGGER_TYPES.has(n.type));
}

export function dynamicNode(wf: Pick<EditableWorkflowDefinition, "nodes">): EditableNodeConfig | undefined {
  return wf.nodes.find((n) => n.type === "dynamic");
}

export function newDynamicWorkflow(id: string): EditableWorkflowDefinition {
  return {
    id,
    name: "New Dynamic Workflow",
    description: "",
    nodes: [{ id: DYNAMIC_STEP_ID, type: "dynamic", name: "Orchestrator", dynamic: defaultDynamicConfig() }],
    edges: [],
    isNew: true,
  };
}

/** Fields of a raw API step that belong to the dynamic config. */
export function pickDynamicConfig(step: Record<string, unknown>): DynamicStepConfig {
  const { id: _id, type: _type, name: _name, description: _desc, next: _next, routes: _routes, when: _when, ...rest } = step;
  void _id; void _type; void _name; void _desc; void _next; void _routes; void _when;
  return { agent_pool: [], ...(rest as Partial<DynamicStepConfig>) } as DynamicStepConfig;
}

/** Problems that would make the backend refuse the config (mirrors validate_dynamic_steps). */
export function dynamicConfigProblems(cfg: DynamicStepConfig): string[] {
  const problems: string[] = [];
  if (!cfg.agent_pool.length) problems.push("Select at least one agent for the pool.");
  const canExecute = cfg.agent_pool.some((a) => !a.categories?.length || a.categories.includes("execution"));
  if (cfg.agent_pool.length && !canExecute) problems.push("No agent in the pool may fill execution jobs.");
  for (const [cat, slot] of Object.entries(cfg.jobs ?? {})) {
    if (slot && slot.min > slot.max) problems.push(`${CATEGORY_LABELS[cat as JobCategory]}: min exceeds max.`);
  }
  if ((cfg.jobs?.execution?.min ?? 1) < 1) problems.push("At least one execution job is required (execution min ≥ 1).");
  if (cfg.repo && !cfg.repo.url.trim()) problems.push("Repository URL is empty.");
  return problems;
}
