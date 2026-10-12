// ─── Trace types ─────────────────────────────────────────────────────────────

export interface TraceLlmCall {
  model: string;
  prompt_summary: string;
  response_summary?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  timestamp: string;
}

export interface TraceToolCall {
  tool_name: string;
  input_summary: string;
  output_summary?: string;
  timestamp: string;
}

export interface TraceStateTransition {
  node: string;
  timestamp: string;
}

export interface TraceTokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface TraceData {
  llm_calls: TraceLlmCall[];
  tool_calls: TraceToolCall[];
  state_transitions: TraceStateTransition[];
  token_usage: TraceTokenUsage;
  latency_ms: number | null;
  errors: string[];
}

export interface RunTraceResponse {
  run_id: string;
  status: string;
  trace_data: TraceData;
  /** Progress messages reported by spawned k8s agents (pi-agent), e.g. each MCP tool call/result. */
  agent_progress?: string[];
  langsmith_run_id?: string;
  langsmith_url?: string;
}

// ─── Enums ───────────────────────────────────────────────────────────────────

export type WorkflowStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "waiting_agent"
  | "asking_context"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected";

export type ApprovalGateStatus = "pending" | "approved" | "rejected";

// ─── Data-source deletion approvals ──────────────────────────────────────────

/**
 * One destructive data-source call held for a decision.
 *
 * Mirrors `ApprovalCase` in the backend. The field that matters most is
 * `affected_rows`: the whole gate exists so nobody approves a deletion without
 * seeing how much of it there is.
 */
export type ApprovalCaseStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export type ApprovalDecisionSource = "ui" | "slack" | "meta_llm" | "timeout" | "api";

export interface MetaLlmVerdict {
  decision: "approve" | "reject" | "abstain";
  reason: string;
  confidence?: number | null;
  model: string;
  /** True when this verdict *was* the decision — no human was asked. */
  autonomous: boolean;
  history_size: number;
  created_at: string;
}

export interface ApprovalCase {
  id: string;
  status: ApprovalCaseStatus;
  workflow_id: string;
  workflow_name: string;
  run_id: string;
  step_id?: string | null;
  agent_id: string;
  surface: "workflow" | "mcp" | "try_run";
  datasource_id: string;
  datasource_name: string;
  operation: string;
  method: string;
  endpoint: string;
  targets: string[];
  params: Record<string, unknown>;
  affected_rows: number;
  affected_sample: string[];
  /** Which rows, stated without their contents ("row 7"). */
  affected_rows_label?: string;
  /** A delete and a write ask the reviewer a different question. */
  change_kind?: "delete" | "write" | "other";
  /**
   * Label → value context the backend attaches: which document a write
   * targets, and — the one that changes a decision — whether generated code
   * produced the values.
   */
  details?: Record<string, string>;
  history_key: string;
  meta_llm?: MetaLlmVerdict | null;
  decision_source?: ApprovalDecisionSource | null;
  decided_by_name: string;
  decided_by_id: string;
  decided_at?: string | null;
  reason: string;
  /** Set only on an autonomous decision: cancellable until this instant. */
  veto_deadline?: string | null;
  vetoed_by: string;
  slack_channel: string;
  slack_ts: string;
  created_at: string;
  updated_at: string;
  /** Server-rendered one-liner: "<source>.<op> [METHOD] — N rows". */
  summary?: string;
}

/**
 * A queue row: an approval case without the fields nobody reads in a list.
 *
 * The API answers `view=summary` with the case minus its inputs, its resolved
 * targets, its affected sample and its details map. Every one of those is
 * unbounded — on a write case the sample carries a before/after for each cell
 * — so fifty of them crossed the wire to draw fifty one-line rows. They are
 * absent rather than empty, which is why they are optional here: a row cannot
 * claim a case has no parameters, only that it did not ask for them.
 */
export type ApprovalCaseSummary =
  Omit<ApprovalCase, "params" | "targets" | "affected_sample" | "details"> &
  Partial<Pick<ApprovalCase, "params" | "targets" | "affected_sample" | "details">>;

export interface ApprovalListResponse {
  items: ApprovalCaseSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApprovalHistoryResponse {
  history_key: string;
  items: ApprovalCaseSummary[];
  /** Unbroken identical human decisions at the head of the history. */
  streak: number;
  streak_decision: "approved" | "rejected" | null;
  /** How long the streak must get before the meta-LLM decides alone. */
  threshold: number;
  autonomous_next: boolean;
}

/**
 * The `datasource_approval` interrupt payload, as the paused run reports it.
 * Flat by design — the panel renders it without fetching the case.
 */
export interface DatasourceApprovalPayload {
  type: "datasource_approval";
  case_id: string;
  datasource_id: string;
  datasource_name: string;
  operation: string;
  method: string;
  endpoint: string;
  affected_rows: number;
  affected_sample: string[];
  targets: string[];
  params: Record<string, unknown>;
  meta_llm: MetaLlmVerdict | null;
}

// ─── Sub-models ───────────────────────────────────────────────────────────────

export interface ApprovalGate {
  id: string;
  step_id: string;
  status: ApprovalGateStatus;
  feedback?: string;
  reason?: string;
  created_at: string;
  resolved_at?: string;
  metadata?: Record<string, unknown>;
}

export interface PlanTask {
  repository: string;
  description: string;
  priority?: number;
}

export interface PlanResult {
  repositories: string[];
  tasks: PlanTask[];
  summary?: string;
  raw?: string;
}

export interface ToolCallResult {
  step_id: string;
  tool_name: string;
  output?: unknown;
  error?: string;
}

export interface LlmMessage {
  role: "human" | "ai" | "tool";
  content: string;
}

export interface LlmAgentStepResult {
  step_id: string;
  messages: LlmMessage[];
  final_output?: string;
  error?: string;
}

export interface ActionStepResult {
  step_id: string;
  handler?: string;
  url?: string;
  status_code?: number;
  output?: unknown;
  error?: string;
}

export interface ExecutionStepResult {
  step_id: string;
  repository: string;
  status: "completed" | "failed" | "skipped";
  branch?: string;
  pr_url?: string;
  summary?: string;
  error?: string;
}

// ─── WorkflowRun ─────────────────────────────────────────────────────────────

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  workflow_name: string;
  user_request: string;
  session_id?: string;
  user_id?: string;
  status: WorkflowStatus;
  current_step?: string;
  steps: WorkflowStepDefinition[];
  approval_status: ApprovalStatus;
  approval_gates: ApprovalGate[];
  plan?: PlanResult;
  tool_call_results: ToolCallResult[];
  llm_agent_results: LlmAgentStepResult[];
  action_results: ActionStepResult[];
  execution_results: ExecutionStepResult[];
  intermediate_outputs: Record<string, unknown>;
  interrupt_payload?: Record<string, unknown>;
  pending_question?: { question: string; options?: string[] | null } | null;
  /** Set while the orchestrator is sleeping on a route's `wait_seconds` delay. */
  waiting_transition?: {
    source: string;
    target: string;
    wait_seconds: number;
    started_at: string;
  } | null;
  error?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /**
   * True for a row the list endpoint built from a projected document: status
   * and per-step status are real, the per-step inputs, outputs and state are
   * empty because the backend never read them. Rendering one run in full
   * means re-reading it by id.
   */
  partial?: boolean;
  /** "job" for a dynamic-workflow job attempt (a child of parent_run_id). */
  kind?: "workflow" | "job";
  parent_run_id?: string | null;
  /** Dynamic steps' agent DAGs, keyed by step id. */
  dynamic?: Record<string, DynamicRunState>;
  /** Live view of each job attempt's child run, keyed by child run id. */
  dynamic_jobs?: Record<string, DynamicJobRunSummary>;
}

// ─── Dynamic workflows ───────────────────────────────────────────────────────

export type JobCategory = "planning" | "execution" | "validation" | "integration";
export const JOB_CATEGORIES: JobCategory[] = ["planning", "execution", "validation", "integration"];

/** Mirrors Claude Code's permission modes. */
export type AutomationMode = "ask" | "plan" | "auto" | "bypass";

export interface PoolAgent {
  agent_id: string;
  max_instances?: number;
  /** Empty = the agent may fill any category. */
  categories?: JobCategory[];
}

export interface JobSlot { min: number; max: number }

export interface DynamicStepConfig {
  agent_pool: PoolAgent[];
  jobs?: Partial<Record<JobCategory, JobSlot>>;
  automation?: AutomationMode;
  limits?: {
    max_total_jobs?: number;
    max_handbacks?: number;
    max_delegations?: number;
    max_replans?: number;
    max_parallel?: number;
  };
  dispatcher_provider?: string | null;
  dispatcher_model?: string | null;
  dispatcher_instructions?: string;
  shared_volume?: { mount_point: string; ttl?: string } | null;
  repo?: { url: string; base_branch?: string; verify?: string[] } | null;
  output_key?: string | null;
  request_template?: string;
}

export type DynamicJobStatus = "pending" | "running" | "finished" | "failed" | "waiting" | "skipped" | "cancelled";

export interface DynamicJobAttempt {
  n: number;
  child_run_id?: string | null;
  status: "running" | "finished" | "failed" | "cancelled" | "needs_input";
  started_at: string;
  finished_at?: string | null;
  reason: string;
  feedback?: string | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
}

export interface DynamicJob {
  id: string;
  category: JobCategory;
  agent_id: string;
  title: string;
  prompt: string;
  depends_on: string[];
  owns: string[];
  status: DynamicJobStatus;
  attempts: DynamicJobAttempt[];
  delegated_by?: string | null;
  awaiting: string[];
  created_by: "dispatcher" | "planner" | "delegation" | "human";
}

export type DynamicDecisionKind = "plan" | "handback" | "delegate" | "escalation" | "question";

export interface DynamicDecision {
  id: string;
  kind: DynamicDecisionKind;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
  resolved: boolean;
  approved?: boolean | null;
  reason?: string | null;
}

export interface DynamicRunState {
  step_id: string;
  status: "planning" | "running" | "waiting_approval" | "completed" | "failed";
  jobs: DynamicJob[];
  decisions: DynamicDecision[];
  events: Array<{ ts: string; kind: string; job_id?: string | null; detail: string }>;
  replans: number;
  delegations: number;
  expanded: boolean;
  summary?: string | null;
  error?: string | null;
  usage: Record<string, number>;
}

export interface DynamicJobRunSummary {
  status: WorkflowStatus;
  job_id: string;
  pending_question?: { question: string; options?: string[] | null } | null;
  progress: string[];
  error?: string | null;
  updated_at?: string | null;
}

export interface PaginatedRunsResponse {
  runs: WorkflowRun[];
  total: number;
}

/**
 * Returns the effective UI status for a run. The backend reports
 * `waiting_approval` for both human_approval and ask_context interrupts;
 * we differentiate them here using `interrupt_payload.type`.
 */
export function effectiveStatus(run: Pick<WorkflowRun, "status" | "interrupt_payload">): WorkflowStatus {
  if (run.status === "waiting_approval" && run.interrupt_payload?.type === "ask_context") {
    return "asking_context";
  }
  return run.status;
}

// ─── API Request/Response ────────────────────────────────────────────────────

export interface WorkflowRequest {
  workflow_id: string;
  user_request: string;
  session_id?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ApproveRequest {
  // Usually field → replacement text; a dynamic-workflow decision also takes
  // structured values (an edited job list, answers to an agent's questions).
  corrections?: Record<string, unknown>;
}

export interface RejectRequest {
  reason?: string;
}

// ─── Workflow Definitions (static, from backend /workflows/*.json) ────────────

// ─── Ownership & visibility ──────────────────────────────────────────────────

export type Visibility = "public" | "private";

/**
 * Who a user-created resource belongs to and who else may see it.
 *
 * All optional: a backend without per-user visibility sends none of these, and
 * the UI then behaves as it always did — everything shared, everything editable.
 * `can_edit` is the backend's verdict for the caller (owner or admin), so the UI
 * never compares subjects itself.
 */
export interface Ownership {
  visibility?: Visibility;
  owner_id?: string | null;
  owner_name?: string | null;
  can_edit?: boolean;
}

export interface WorkflowDefinition extends Ownership {
  id: string;
  name: string;
  description: string;
  readonly?: boolean;
  /** False means the backend refuses every trigger and every manual start.
   *  Absent (older backends) reads as enabled. */
  enabled?: boolean;
  steps: WorkflowStepDefinition[];
}

export type StepStatus = "pending" | "running" | "finished" | "failed" | "skipped" | "waiting_clarification" | "waiting_approval";

export interface WorkflowStepDefinition {
  id: string;
  type: "fetch" | "llm" | "plan" | "approval" | "http" | "action" | "execute" | "result" | "workflow" | "agent";
  name?: string;
  description?: string;
  status?: StepStatus;
  output?: Record<string, unknown>;
  error?: string | null;
}

// ─── Editable workflow types (editor ↔ backend API) ──────────────────────────

export type WorkflowStepType = WorkflowStepDefinition["type"];

/** Real backend step types (used for create/update API calls). */
export type ApiStepType =
  | "llm"
  | "llm_structured"
  | "mcp"
  | "human_approval"
  | "ask_context"
  | "execute"
  | "workflow"
  | "cron"
  | "http"
  | "pubsub"
  | "http_call"
  | "python"
  | "parallel"
  | "join"
  | "proceed_or"
  | "storage"
  | "slack"
  | "switch"
  | "langgraph-agent"
  | "data_source"
  | "data"
  | "dynamic"
  | "dynamic_gate";

export type DataSelectionFormat = "jsonl" | "json" | "csv";

/**
 * One file a `data` step makes downloadable.
 *
 * `name` becomes the filename, which is why it has to be unique within the step
 * and non-empty. Nothing here transforms anything: `from` is read out of state
 * and written to a file, and the state the next step sees is untouched.
 */
export interface DataSelection {
  name: string;
  from: string;
  format: DataSelectionFormat;
}

export interface StructuredOutputField {
  name: string;
  type: "bool" | "str" | "int" | "float";
  description?: string;
}

/** Notification fired when a human_approval step enters waiting_approval. */
export interface NotifyConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  auth?: {
    type?: "bearer" | "basic";
    token?: string;     // bearer
    username?: string;  // basic
    password?: string;  // basic
  };
  payload?: Record<string, unknown>;
}

export interface EditableNodeConfig {
  id: string;
  type: ApiStepType;
  name: string;
  description?: string;
  // ── dynamic: the step's whole config, passed through as-is ─────────────────
  dynamic?: DynamicStepConfig;
  success_criteria?: string;
  fail_criteria?: string;
  // ── llm + llm_structured ──────────────────────────────────────────────────
  llm_provider?: string;
  model?: string;
  system_prompt?: string;
  user_template?: string;
  output_key?: string;
  output_mapping?: Record<string, string>;
  // ── llm_structured only ──────────────────────────────────────────────────
  output_fields?: StructuredOutputField[];
  fail_if_false?: string[];
  bind_mcp_tools?: boolean;
  max_iterations?: number;
  /** Maximum times this node may execute before the run fails (loop guard). */
  max_loops?: number;
  // ── mcp ──────────────────────────────────────────────────────────────────
  tool?: string;
  tool_input?: Record<string, string>;
  // ── ask_context ──────────────────────────────────────────────────────────
  questions_key?: string;   // state key holding the list of questions (from a previous step)
  // ── human_approval ───────────────────────────────────────────────────────
  interrupt_payload?: Record<string, string>;
  notify?: NotifyConfig;
  // ── execute ──────────────────────────────────────────────────────────────
  repo_template?: string;
  instructions_template?: string;
  conversation_id?: string;
  /** When true, an exception inside the node fails the run immediately.
   *  When false/unset, the error is captured under output_key so the next node
   *  can decide whether to retry or proceed. */
  stop_on_failure?: boolean;
  // ── workflow (sub-workflow spawn) ─────────────────────────────────────────
  workflow_id?: string;
  input_template?: string;
  // ── cron trigger ─────────────────────────────────────────────────────────
  schedule?: string;
  timezone?: string;
  request_template?: string;
  // ── pubsub trigger (Google Cloud Pub/Sub) ────────────────────────────────
  topic?: string;
  /** Existing subscription to pull from; blank = created on first use. */
  subscription?: string;
  /** Id of the event supplying topic / schema / subscription. */
  event?: string;
  /** Pre-events spelling of `event`; still read from stored definitions. */
  datasource?: string;
  project_id?: string;
  /** Event schema as typed — kept as text so a half-written JSON object edits. */
  event_schema_text?: string;
  // ── http trigger (inbound webhook) ───────────────────────────────────────
  auth_mode?: "hmac" | "bearer";
  webhook_secret?: string;
  bearer_token?: string;
  // ── http_call (outbound HTTP request) ────────────────────────────────────
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: Record<string, string>;
  // ── python ────────────────────────────────────────────────────────────────
  code?: string;
  /** Library script to run instead of the inline `code` above. */
  script_id?: string;
  /** Run isolated from the backend's env vars, tools, bash and libraries. */
  sandbox?: boolean;
  sandbox_runtime?: "local" | "docker" | "k8s";
  /** Image used by the docker / k8s sandbox runtimes. */
  sandbox_image?: string;
  /** Sandbox wall-clock limit, in seconds. */
  timeout_seconds?: number;
  // ── data_source ──────────────────────────────────────────────────────────
  source?: string;
  operation?: string;
  /**
   * Datasource operation inputs. `unknown` because an operation may declare
   * `object` / `array` / `number` / `boolean` params, and typing this as
   * strings is what put `[object Object]` in the editor and made those params
   * unauthorable.
   *
   * Pagination is NOT in here. The operation declares how it pages and the
   * executor drives it; a step says how much it wants via `limit`.
   */
  params?: Record<string, unknown>;

  // ── data ─────────────────────────────────────────────────────────────────
  /** What this step makes downloadable. It reads state and changes nothing. */
  selections?: DataSelection[];
  // ── parallel ─────────────────────────────────────────────────────────────
  max_parallel?: number;
  // ── join ─────────────────────────────────────────────────────────────────
  max_timeout?: number;
  failure_policy?: 'and' | 'or';
  // ── storage ──────────────────────────────────────────────────────────────
  // Scoped to the owning workflow by the backend; there is deliberately no
  // field here to name another workflow's storage.
  // `action` is shared with the slack step below — 'delete' means "delete an
  // entry" for storage and "delete a message" for slack, and the step type
  // decides which set of values the panel offers.
  action?: 'get' | 'set' | 'delete' | 'keys'
         | 'post' | 'reply' | 'history' | 'thread' | 'dm';
  key?: string;
  value?: unknown;
  // ── slack (messaging) ────────────────────────────────────────────────────
  // Deliberately no token field: the provider reads SLACK_BOT_TOKEN from the
  // deployment's settings, so a credential can never be saved into a workflow
  // definition. `provider` is what makes a second provider (WhatsApp, Teams) a
  // registry entry rather than a new step type.
  provider?: string;
  channel?: string;
  text?: string;
  thread_id?: string;
  user_id?: string;
  message_id?: string;
  oldest?: string;
  /**
   * Max records to fetch. Shared, like the rest of this bag: for `slack` it
   * caps a channel read, for `data_source` it caps how many records the
   * operation collects. Unset on a `data_source` step means every page — the
   * executor walks a paginated operation until the API says it is done.
   */
  limit?: number;
  /** State path to a list of {thread_id, text} to reply to in one step. */
  items?: string;
  /** Do not post a reply whose exact text is already in the thread. */
  skip_if_replied?: boolean;
  /** Capture provider errors under output_key instead of failing the run. */
  ignore_errors?: boolean;
  // ── proceed_or ───────────────────────────────────────────────────────────
  // Intentionally configuration-free: first branch in wins, later ones are cut
  // off by the backend router. There is nothing to tune.
  // ── langgraph-agent ──────────────────────────────────────────────────────
  agent_id?: string;
  runtime_override?: "local" | "docker" | "k8s";
  image?: string;
  helm_chart?: string;
  health_timeout?: number;
  compression_level?: "none" | "lite" | "full" | "ultra";
  env_vars?: { name: string; from_config?: string; value?: string }[];
  slack_notifications?: boolean;
  // ── slack addon ───────────────────────────────────────────────────────────
  slack_token?: string;
  slack_channel?: string;
  slack_topic?: string;    // injected as {slack_topic} in payload template
  slack_payload?: string;  // JSON string template
  slack_input_key?: string; // which output key's value is posted as Slack message content
  input_mapping?: Record<string, string>; // {state_key: agent_key} — omit to send full state
  // ── pvc addon ─────────────────────────────────────────────────────────────
  pvc_name?: string;
  pvc_mount_point?: string;
  pvc_ttl?: string;
  // ── mcp addon ─────────────────────────────────────────────────────────────
  servers?: Record<string, boolean>;
  // ── tools addon ───────────────────────────────────────────────────────────
  tools?: Record<string, boolean>;
  // ── s3 addon ──────────────────────────────────────────────────────────────
  s3_bucket?: string;
  s3_path?: string;
  // ── datasource addon ──────────────────────────────────────────────────────
  // Deliberately not `source` / `operation`: those belong to the data_source
  // *step* above, and an addon node and a step node share this config type.
  datasource_id?: string;
  allowed_operations?: string[];
}

export interface EditableWorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  readonly?: boolean;
  use_meta_llm?: boolean;
  use_storage?: boolean;
  nodes: EditableNodeConfig[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    data?: {
      condition?: string;
      /** Optional delay (seconds) inserted before transitioning to the target node. */
      wait_seconds?: number;
      waypoints?: Array<{ x: number; y: number }>;
    };
  }>;
  /** True when this workflow hasn't been POSTed to the API yet. */
  isNew?: boolean;
  layout?: Record<string, { x: number; y: number }>;
  addons?: Array<{ id: string; type: "slack" | "pvc" | "mcp" | "tools" | "s3" | "datasource"; attachedTo?: string; position?: { x: number; y: number }; servers?: Record<string, boolean>; tools?: Record<string, boolean>; s3_bucket?: string; s3_path?: string; datasource_id?: string; allowed_operations?: string[] }>;
}

/** Full workflow definition as returned by GET /workflows/{id}. */
export interface ApiWorkflowDefinition extends Ownership {
  id: string;
  name: string;
  description: string;
  readonly?: boolean;
  enabled?: boolean;
  steps: Array<Record<string, unknown>>;
  ui?: Record<string, unknown>;
  use_meta_llm?: boolean;
  use_storage?: boolean;
  created_at?: string;
  updated_at?: string;
}

// ─── LangGraph Node pipeline ─────────────────────────────────────────────────

export const LANGGRAPH_NODES = [
  "request",
  "fetch_context",
  "llm_agent",
  "plan",
  "approval",
  "run_actions",
  "execute",
  "result",
] as const;

export type LangGraphNode = (typeof LANGGRAPH_NODES)[number];

// Known workflows (loaded from backend workflows/ directory)
export const KNOWN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "feature_flow",
    name: "Feature Delivery Flow",
    description: "Single-repo feature delivery: plan → approve → execute via OpenHands.",
    steps: [
      { id: "plan", type: "plan" },
      { id: "approve", type: "approval" },
      { id: "execute", type: "execute" },
      { id: "result", type: "result" },
    ],
  },
  {
    id: "multi_repo_delivery",
    name: "Multi Repository Delivery",
    description: "Coordinated delivery across two repositories sequentially.",
    steps: [
      { id: "plan", type: "plan" },
      { id: "execute_backend", type: "execute" },
      { id: "execute_frontend", type: "execute" },
      { id: "result", type: "result" },
    ],
  },
  {
    id: "design_first_flow",
    name: "Design-First Delivery",
    description: "Fetch Figma + Jira context, then plan and execute.",
    steps: [
      { id: "fetch_figma", type: "fetch" },
      { id: "fetch_jira", type: "fetch" },
      { id: "plan", type: "plan" },
      { id: "execute", type: "execute" },
      { id: "result", type: "result" },
    ],
  },
  {
    id: "mcp_llm_http_flow",
    name: "MCP + LLM + HTTP Flow",
    description: "Fetch MCP data → plan → send HTTP notification.",
    steps: [
      { id: "fetch_data", type: "fetch" },
      { id: "plan", type: "plan" },
      { id: "notify", type: "http" },
      { id: "result", type: "result" },
    ],
  },
  {
    id: "llm_tool_call_flow",
    name: "LLM Tool-Call Flow",
    description: "Pure LLM agent with tool-calling loop — no code execution.",
    steps: [
      { id: "ask_llm", type: "llm" },
      { id: "result", type: "result" },
    ],
  },
  {
    id: "parallel_flow",
    name: "Parallel Fetch + Dual LLM + Dual Approval",
    description: "Parallel fetches, dual LLM processing, two independent approval gates.",
    steps: [
      { id: "fetch_figma", type: "fetch" },
      { id: "fetch_jira", type: "fetch" },
      { id: "llm_design", type: "llm" },
      { id: "llm_tasks", type: "llm" },
      { id: "approve_design", type: "approval" },
      { id: "approve_plan", type: "approval" },
      { id: "result", type: "result" },
    ],
  },
  {
    id: "python_action_flow",
    name: "Python Action Flow",
    description: "Runs a custom Python action handler from the registry.",
    steps: [
      { id: "run_action", type: "action" },
      { id: "result", type: "result" },
    ],
  },
];
