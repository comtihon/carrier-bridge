import type {
  WorkflowRun,
  WorkflowRequest,
  ApproveRequest,
  RejectRequest,
  WorkflowDefinition,
  ApiWorkflowDefinition,
  GrantAccess,
  GranteeType,
  ResourceGrant,
  Sharing,
  RunTraceResponse,
  PaginatedRunsResponse,
  ApprovalCase,
  ApprovalCaseStatus,
  ApprovalListResponse,
  ApprovalHistoryResponse,
  Ownership,
  Visibility,
} from "./types";

export type { GrantAccess, GranteeType, Ownership, ResourceGrant, Sharing, Visibility } from "./types";

import { BACKEND_URL } from "./config";
import { getAccessToken } from "./oidc";

const BASE = `${BACKEND_URL}/api/v1`;

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // A backend `detail` is written for people (who owns this, what still
    // references it) — show it as is; anything else keeps the status prefix.
    const detail = detailText(body);
    throw new Error(detail ?? `API ${res.status}: ${body || res.statusText}`);
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** The backend's `detail` when the body is `{"detail": "..."}`, else null. */
function detailText(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.detail === "string" && parsed.detail ? parsed.detail : null;
  } catch {
    return null;
  }
}

/**
 * Error carrying the backend's `detail` rather than the raw JSON envelope —
 * used where the message is shown to the user verbatim (schema import).
 */
function apiError(status: number, text: string, statusText: string): Error {
  let detail = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.detail === "string") {
      detail = parsed.detail;
    } else if (Array.isArray(parsed?.detail)) {
      detail = parsed.detail
        .map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d))
        .join("; ");
    }
  } catch {
    // not JSON — keep the raw body
  }
  return new Error(detail || statusText || `HTTP ${status}`);
}

/** POST JSON, surfacing the backend's `detail` on failure. */
async function postWithDetail<T>(path: string, payload: unknown): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw apiError(res.status, await res.text().catch(() => ""), res.statusText);
  }
  return res.json() as Promise<T>;
}

/**
 * Multipart POST: the browser must set `Content-Type` itself so the multipart
 * boundary matches the body.
 */
async function postFormWithDetail<T>(path: string, body: FormData): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body });
  if (!res.ok) {
    throw apiError(res.status, await res.text().catch(() => ""), res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Workflows ────────────────────────────────────────────────────────────────

/**
 * Workflows the caller can see. With `workflowId` — the workflow being edited
 * — also the ones granted to it (that it may call), marked `granted_to_workflow`.
 */
export async function fetchWorkflows(workflowId?: string | null): Promise<WorkflowDefinition[]> {
  return request<WorkflowDefinition[]>(`/workflows${workflowQuery(workflowId)}`);
}

function workflowQuery(workflowId?: string | null, sep: "?" | "&" = "?"): string {
  return workflowId ? `${sep}workflow_id=${encodeURIComponent(workflowId)}` : "";
}

export async function submitWorkflow(
  payload: WorkflowRequest
): Promise<WorkflowRun> {
  return request<WorkflowRun>("/workflows/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun> {
  return request<WorkflowRun>(`/workflows/runs/${runId}`);
}

export async function listWorkflowRuns(
  limit = 20,
  offset = 0,
  workflowId?: string,
  excludeWorkflowIds?: string[],
): Promise<PaginatedRunsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (workflowId) params.set("workflow_id", workflowId);
  if (excludeWorkflowIds?.length) {
    for (const id of excludeWorkflowIds) params.append("exclude_workflow_ids", id);
  }
  return request<PaginatedRunsResponse>(`/workflows/runs?${params}`);
}

export async function approveWorkflowRun(
  runId: string,
  payload: ApproveRequest = {}
): Promise<WorkflowRun> {
  return request<WorkflowRun>(`/workflows/runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function rejectWorkflowRun(
  runId: string,
  payload: RejectRequest = {}
): Promise<WorkflowRun> {
  return request<WorkflowRun>(`/workflows/runs/${runId}/reject`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function approveGate(
  runId: string,
  gateId: string,
  payload: ApproveRequest = {}
): Promise<WorkflowRun> {
  return request<WorkflowRun>(
    `/workflows/runs/${runId}/gates/${gateId}/approve`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function rejectGate(
  runId: string,
  gateId: string,
  payload: RejectRequest = {}
): Promise<WorkflowRun> {
  return request<WorkflowRun>(
    `/workflows/runs/${runId}/gates/${gateId}/reject`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function resumeWorkflowRun(runId: string): Promise<WorkflowRun> {
  return request<WorkflowRun>(`/workflows/runs/${runId}/resume`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function retryWorkflowRun(runId: string): Promise<WorkflowRun> {
  return request<WorkflowRun>(`/workflows/runs/${runId}/retry`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function restartFromStep(runId: string, stepId: string): Promise<WorkflowRun> {
  return request<WorkflowRun>(`/workflows/runs/${runId}/restart-from-step`, {
    method: "POST",
    body: JSON.stringify({ step_id: stepId }),
  });
}

export async function terminateWorkflowRun(runId: string): Promise<WorkflowRun> {
  return request<WorkflowRun>(`/workflows/runs/${runId}/terminate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getRunTrace(runId: string): Promise<RunTraceResponse> {
  return request<RunTraceResponse>(`/workflows/runs/${runId}/trace`);
}

// ─── Workflow definition CRUD ─────────────────────────────────────────────────

export async function getWorkflowDefinition(id: string): Promise<ApiWorkflowDefinition> {
  return request<ApiWorkflowDefinition>(`/workflows/${id}`);
}

export async function createWorkflowDefinition(payload: {
  id: string;
  name: string;
  description: string;
  steps: Array<Record<string, unknown>>;
  ui?: Record<string, unknown>;
  use_meta_llm?: boolean;
  use_storage?: boolean;
  visibility?: Visibility;
}): Promise<ApiWorkflowDefinition> {
  return request<ApiWorkflowDefinition>("/workflows", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateWorkflowDefinition(
  id: string,
  payload: {
    name: string;
    description: string;
    steps: Array<Record<string, unknown>>;
    ui?: Record<string, unknown>;
    use_meta_llm?: boolean;
    use_storage?: boolean;
    /** Omit to keep the stored value; the backend only changes it when sent. */
    enabled?: boolean;
    /** Same: omitted keeps who can see it. */
    visibility?: Visibility;
  },
): Promise<ApiWorkflowDefinition> {
  return request<ApiWorkflowDefinition>(`/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** Enable or disable a workflow.
 *
 * There is no partial-update route — PUT /workflows/{id} replaces the whole
 * definition — so the current one is read back and re-sent with only the flag
 * changed. Sending the flag alone would blank out the steps.
 */
export async function setWorkflowEnabled(
  id: string,
  enabled: boolean,
): Promise<ApiWorkflowDefinition> {
  const current = await getWorkflowDefinition(id);
  return updateWorkflowDefinition(id, {
    name: current.name,
    description: current.description,
    steps: current.steps,
    ui: current.ui,
    use_meta_llm: current.use_meta_llm,
    use_storage: current.use_storage,
    enabled,
  });
}

export async function deleteWorkflowDefinition(id: string): Promise<void> {
  return request<void>(`/workflows/${id}`, { method: "DELETE" });
}

// ─── Current user ─────────────────────────────────────────────────────────────

/** Who the backend thinks is calling, and whether it authenticates at all. */
export type TeamRole = "member" | "admin";

export interface CurrentUser {
  sub: string | null;
  name: string | null;
  is_admin: boolean;
  /** System-wide admin; older backends only send `is_admin`, which means the same. */
  is_super_admin?: boolean;
  auth_enabled: boolean;
  /** The caller's team, if any; older backends omit it. */
  team?: { id: string; name: string; role?: TeamRole } | null;
}

/** Super admin, whichever field the backend spells it with. */
export function isSuperAdmin(me: CurrentUser | null | undefined): boolean {
  return !!(me?.is_super_admin ?? me?.is_admin);
}

/** Admin of their own team (not a super admin). */
export function isTeamAdmin(me: CurrentUser | null | undefined): boolean {
  return !isSuperAdmin(me) && me?.team?.role === "admin";
}

/**
 * `GET /me`, or null when the backend has no such route (older backends) or
 * the call fails — both mean "no per-user visibility here", never an error.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await request<CurrentUser>("/me");
  } catch {
    return null;
  }
}

// ─── Teams ────────────────────────────────────────────────────────────────────

export interface TeamMember {
  sub: string;
  name: string | null;
  email: string | null;
  role?: TeamRole;
}

export interface Team {
  id: string;
  name: string;
  members: TeamMember[];
  created_at?: string;
}

export interface UserInfo {
  sub: string;
  name: string | null;
  email: string | null;
  team_id: string | null;
  team_name: string | null;
  last_seen?: string | null;
  /** The user's team and role in it; newer backends send this instead of team_id/team_name. */
  team?: { id: string; name: string; role?: TeamRole } | null;
  /** System-wide admin, granted by the identity provider's roles — not editable here. */
  is_super_admin?: boolean;
  /** Roles from the identity provider (and the login script, if one is set). */
  roles?: string[];
}

/** One user row whichever shape the backend sends: `team` object or flat `team_id`/`team_name`. */
function normalizeUser(raw: Partial<UserInfo> & { sub: string }): UserInfo {
  const team = raw.team !== undefined
    ? raw.team
    : raw.team_id ? { id: raw.team_id, name: raw.team_name ?? raw.team_id } : null;
  return {
    ...raw,
    name: raw.name ?? null,
    email: raw.email ?? null,
    team: team ?? null,
    team_id: team?.id ?? null,
    team_name: team?.name ?? null,
  };
}

/** Super admins get every team; everyone else their own. */
export async function listTeams(): Promise<Team[]> {
  return request<Team[]>("/teams");
}

export async function createTeam(name: string): Promise<Team> {
  return request<Team>("/teams", { method: "POST", body: JSON.stringify({ name }) });
}

export async function renameTeam(id: string, name: string): Promise<Team> {
  return request<Team>(`/teams/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ name }) });
}

/** Refused (409) while the team still owns team resources. */
export async function deleteTeam(id: string): Promise<void> {
  await request<void>(`/teams/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Add a user to a team — moving them out of any previous one — or change
 * their role in it.
 */
export async function setTeamMember(teamId: string, sub: string, role?: TeamRole): Promise<Team> {
  return request<Team>(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(sub)}`, {
    method: "PUT",
    body: JSON.stringify(role ? { role } : {}),
  });
}

export async function removeTeamMember(teamId: string, sub: string): Promise<void> {
  await request<void>(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(sub)}`, { method: "DELETE" });
}

/** Super admins: everyone. Team admins: users with no team plus their members. */
export async function listUsers(): Promise<UserInfo[]> {
  const rows = await request<Array<Partial<UserInfo> & { sub: string }>>("/users");
  return rows.map(normalizeUser);
}

/** Super admins: put a user in a team (moving them out of any other) or, with `null`, in none. */
export async function setUserTeam(sub: string, teamId: string | null, role: TeamRole = "member"): Promise<void> {
  await request<unknown>(`/users/${encodeURIComponent(sub)}/team`, {
    method: "PUT",
    body: JSON.stringify({ team_id: teamId, role }),
  });
}

/** Super admins: forget a stored user. They come back on their next login. */
export async function deleteUser(sub: string): Promise<void> {
  await request<void>(`/users/${encodeURIComponent(sub)}`, { method: "DELETE" });
}

// ─── Login script ─────────────────────────────────────────────────────────────

/**
 * Where the login script comes from: the deployment's config (read-only
 * here), the database (edited here), or nowhere (disabled).
 */
export type LoginScriptSource = "config" | "db" | "none";

export interface LoginScript {
  source: LoginScriptSource;
  editable: boolean;
  script: string | null;
  timeout_ms: number;
  updated_at: string | null;
  updated_by: string | null;
}

export interface LoginScriptTestResult {
  ok: boolean;
  result: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number;
}

export async function getLoginScript(): Promise<LoginScript> {
  return request<LoginScript>("/auth/login-script");
}

/**
 * Store the login script; `null` (or an empty one) disables it. A script that
 * does not compile comes back as 400 with the reason, a config-managed one as 409.
 */
export async function saveLoginScript(script: string | null): Promise<LoginScript> {
  return request<LoginScript>("/auth/login-script", {
    method: "PUT",
    body: JSON.stringify({ script: script && script.trim() ? script : null }),
  });
}

/** Run a script (the given one, else the stored one) against sample claims without saving. */
export async function testLoginScript(payload: {
  script?: string;
  claims: Record<string, unknown>;
  sub?: string;
}): Promise<LoginScriptTestResult> {
  return request<LoginScriptTestResult>("/auth/login-script/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── LLM providers ────────────────────────────────────────────────────────────

export interface LlmProviderInfo {
  name: string;
  default_model: string;
}

export interface LlmProvidersResponse {
  providers: LlmProviderInfo[];
  default_provider: string | null;
}

export async function fetchLlmProviders(): Promise<LlmProvidersResponse> {
  return request<LlmProvidersResponse>("/llm/providers");
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export interface McpIntegration {
  name: string;
  enabled: boolean;
  transport: "streamable_http" | "sse" | "stdio";
  /** False when the server is declared but cannot be dialled — no endpoint or
   * command, or a bearer token env var with nothing behind it. */
  configured: boolean;
}

export type AgentAddonEntry =
  | { type: "mcp"; servers: Record<string, boolean> }
  | { type: "s3"; bucket: string; path: string }
  | { type: "tools"; tools: Record<string, boolean> }
  /**
   * One datasource an agent may call, and which of its operations.
   *
   * `allowed_operations` IS the authorization — a ticked write is a granted
   * write, with no separate flag and no approval step. An empty list grants
   * nothing rather than everything, and the backend enforces the list on both
   * the tool listing and the call, so nothing here is advisory.
   *
   * Several entries are allowed, one per datasource; the grant is their union.
   * Merging them therefore has to key on `(type, source_id)`, not on `type`
   * alone the way the single-instance addons do.
   */
  | { type: "datasource"; source_id: string; allowed_operations: string[] };

export interface AgentDefinition extends Ownership, Sharing {
  id: string;
  name: string;
  description: string | null;
  /** "runner": the agent runs on a user's machine connected through acp-web-proxy. */
  default_runtime: AgentRuntime;
  agent_input: Record<string, unknown>;
  image: string | null;
  helm_chart: string | null;
  helm_values: Record<string, unknown>;
  health_timeout?: number | null;
  created_at?: string;
  updated_at?: string;
  addons?: AgentAddonEntry[];
  /** "http-poll": pi-cloud-agent /start + /poll; "acp": ACP over WebSocket via acp-web-proxy. */
  protocol?: "http-poll" | "acp";
  /** ACP only: agent name in the proxy config (pi, claude, codex…); null = proxy default. */
  acp_agent?: string | null;
  /** Runner agents only: the machine it runs on; `acp_agent` names the agent there. */
  runner_id?: string | null;
}

export type AgentRuntime = "local" | "docker" | "k8s" | "runner";

export interface AgentCreateRequest {
  id: string;
  name?: string;
  description?: string | null;
  default_runtime?: string;
  agent_input?: Record<string, unknown>;
  image?: string | null;
  helm_chart?: string | null;
  helm_values?: Record<string, unknown>;
  addons?: AgentAddonEntry[];
  protocol?: "http-poll" | "acp";
  acp_agent?: string | null;
  runner_id?: string | null;
  visibility?: Visibility;
}

export interface AgentUpdateRequest {
  name?: string;
  description?: string | null;
  default_runtime?: string;
  agent_input?: Record<string, unknown>;
  image?: string | null;
  helm_chart?: string | null;
  helm_values?: Record<string, unknown>;
  addons?: AgentAddonEntry[];
  protocol?: "http-poll" | "acp";
  acp_agent?: string | null;
  runner_id?: string | null;
  visibility?: Visibility;
}

/** Every agent the caller can see; with `workflowId`, also those granted to it. */
export async function listAgents(workflowId?: string | null): Promise<AgentDefinition[]> {
  return request<AgentDefinition[]>(`/agents${workflowQuery(workflowId)}`);
}

/** What a list of agents draws: no `agent_input` (the system prompt), no addons. */
export type AgentSummary =
  Pick<AgentDefinition, "id" | "name" | "description" | "default_runtime"> & Ownership & Sharing;

/**
 * Agents without the parts only the editor reads.
 *
 * Pair every use of this with `getAgent` before editing — a summary is missing
 * fields that a `PUT` would otherwise reset.
 */
export async function listAgentSummaries(): Promise<AgentSummary[]> {
  return request<AgentSummary[]>("/agents?view=summary");
}

/** One agent; `workflowId` also finds one granted to that workflow. */
export async function getAgent(id: string, workflowId?: string | null): Promise<AgentDefinition> {
  return request<AgentDefinition>(`/agents/${id}${workflowQuery(workflowId)}`);
}

export async function updateAgentAddons(id: string, addons: AgentAddonEntry[]): Promise<AgentDefinition> {
  return request<AgentDefinition>(`/agents/${id}/addons`, {
    method: "PUT",
    body: JSON.stringify({ addons }),
  });
}

/** One bash-level tool an agent can be granted, from the backend registry. */
export interface AgentToolInfo {
  name: string;
  label: string;
  description: string;
  command: string | null;
  /** Env var names the tool fills on the agent — never their values. */
  env_keys: string[];
  /** False when a declared env var has no value behind it on the backend. */
  configured: boolean;
  cli_tools: string[];
}

export async function listAgentTools(): Promise<AgentToolInfo[]> {
  return request<AgentToolInfo[]>("/agents/tools");
}

export async function listMcpIntegrations(): Promise<McpIntegration[]> {
  return request<McpIntegration[]>("/agents/mcp-integrations");
}

export async function createAgent(payload: AgentCreateRequest): Promise<AgentDefinition> {
  return request<AgentDefinition>("/agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAgent(id: string, payload: AgentUpdateRequest): Promise<AgentDefinition> {
  return request<AgentDefinition>(`/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteAgent(id: string): Promise<void> {
  return request<void>(`/agents/${id}`, { method: "DELETE" });
}

export interface S3FileEntry {
  name: string;
  path: string;
  size: number;
  updated: string | null;
}

export interface S3FilesResponse {
  bucket: string;
  path: string;
  files: S3FileEntry[];
}

export async function listS3AddonFiles(agentId: string, runId: string): Promise<S3FilesResponse> {
  return request<S3FilesResponse>(`/agents/${agentId}/s3/files?run_id=${encodeURIComponent(runId)}`);
}

export async function getS3SignedUrl(agentId: string, runId: string, filePath: string): Promise<{ url: string; expires_in: number }> {
  return request<{ url: string; expires_in: number }>(
    `/agents/${agentId}/s3/download?run_id=${encodeURIComponent(runId)}&file_path=${encodeURIComponent(filePath)}`
  );
}

export async function agentReply(runId: string, answer: string): Promise<void> {
  await request<void>(`/runs/${runId}/agent/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
}

// ─── Runners ──────────────────────────────────────────────────────────────────

/**
 * A machine connected through acp-web-proxy in dial mode: it dials carrier
 * and offers its local ACP agents (Claude Code, Codex…). Owned like any other
 * resource; private to whoever approved it unless shared.
 */
export interface Runner extends Ownership {
  id: string;
  name: string;
  hostname: string;
  os: string;
  arch: string;
  tz: string;
  version: string;
  /** ACP agents on the machine, by the name the proxy knows them. */
  agents: string[];
  default_agent: string | null;
  labels: Record<string, string>;
  online: boolean;
  last_seen: string | null;
  connected_at: string | null;
  created_at: string | null;
  approved_by_name: string | null;
  /** Agents (by machine agent name) that hit their usage limit, and until when. */
  limits: Record<string, RunnerLimit>;
  /** Carrier agents that run on this machine. */
  agent_definitions: Array<{ id: string; name: string; acp_agent: string | null }>;
}

export interface RunnerLimit {
  /** When the limit resets; null when the agent did not say. */
  until: string | null;
  kind: string;
  message: string;
}

/** A machine asking to be connected, as the approver sees it after typing its number. */
export interface RunnerEnrollment {
  id: string;
  hostname: string;
  os: string;
  arch: string;
  tz: string;
  version: string;
  agents: string[];
  default_agent: string | null;
  request_ip: string | null;
  created_at: string | null;
  expires_at: string | null;
}

export interface RunnerApproveRequest {
  /** The number again: the enrollment id alone does not approve anything. */
  code: string;
  name?: string;
  visibility?: Visibility;
  team_id?: string;
  /** Machine agents to add as carrier agents; omitted = backend default. */
  agents?: string[];
}

export interface RunnerApproveResult {
  runner: Runner;
  agents: AgentDefinition[];
}

const RUNNERS = "/acp/runners";

export async function listRunners(): Promise<Runner[]> {
  return request<Runner[]>(RUNNERS);
}

export async function updateRunner(
  id: string, payload: { name?: string; visibility?: Visibility; team_id?: string },
): Promise<Runner> {
  return request<Runner>(`${RUNNERS}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** Revokes the machine: its sockets are refused and it stops reconnecting. */
export async function deleteRunner(id: string): Promise<void> {
  await request<void>(`${RUNNERS}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Add one of the machine's agents as a carrier agent. */
export async function addRunnerAgent(
  runnerId: string, payload: { acp_agent: string; id?: string; name?: string },
): Promise<AgentDefinition> {
  return request<AgentDefinition>(`${RUNNERS}/${encodeURIComponent(runnerId)}/agents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * The pending enrollment a number belongs to. Fails with the backend's
 * `detail` — no such number (404), too many wrong ones (429).
 */
export async function lookupRunnerEnrollment(code: string): Promise<RunnerEnrollment> {
  return request<RunnerEnrollment>(`${RUNNERS}/enrollments/lookup`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function approveRunnerEnrollment(
  id: string, payload: RunnerApproveRequest,
): Promise<RunnerApproveResult> {
  return request<RunnerApproveResult>(`${RUNNERS}/enrollments/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function denyRunnerEnrollment(id: string, code: string): Promise<void> {
  await request<unknown>(`${RUNNERS}/enrollments/${encodeURIComponent(id)}/deny`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

// ─── Datasources ──────────────────────────────────────────────────────────────

export type DataSourceAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "header"; header_name: string; value: string }
  /**
   * Bearer token minted by one of the backend's own OAuth2 identities at
   * request time. Carries no secret: the signing key stays in the backend's
   * config, so there is nothing to store, redact, or rotate here. `identity`
   * names which configured identity to use; omitted means the default one.
   */
  | { type: "service_identity"; identity?: string | null }
  /**
   * Bearer token for a Google Workspace API, minted by impersonating the
   * backend's configured service account. Carries no secret either, and
   * `impersonate_subject` is not caller-controlled: the backend resolves it
   * from `GOOGLE_IMPERSONATE_SA` and refuses a block naming anything else, so
   * send it omitted (null) unless echoing back what was read.
   */
  | { type: "google"; impersonate_subject?: string | null; scopes: string[] };

/**
 * Auth block as sent to the backend. Alongside the literal secret, the secret
 * field may be replaced by `from_config` naming one of the backend's config
 * keys (see {@link listConfigKeys}); the backend resolves it to the value and
 * stores that, so the browser never handles the secret.
 */
export type DataSourceAuthWrite =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "bearer"; from_config: string }
  | { type: "basic"; username: string; password: string }
  | { type: "basic"; username: string; from_config: string }
  | { type: "header"; header_name: string; value: string }
  | { type: "header"; header_name: string; from_config: string }
  | { type: "service_identity"; identity?: string | null }
  | { type: "google"; impersonate_subject?: string | null; scopes?: string[] };

/**
 * Placeholder the backend returns instead of secret values. Sending it back
 * in an update preserves the stored secret (same auth type only).
 */
export const DATASOURCE_SECRET_REDACTED = "********";

/**
 * Names (never values) of the credential-like config keys currently set on the
 * backend — the set that `from_config` auth references can point at.
 */
export async function listConfigKeys(): Promise<string[]> {
  const data = await request<{ keys?: string[] }>("/llm/config/keys");
  return data.keys ?? [];
}

/**
 * One outbound service identity the backend can mint tokens for. The signing
 * key behind it never leaves the backend, so only non-secret descriptors are
 * reported.
 */
export interface ServiceIdentityInfo {
  name: string;
  /** Usable right now: every field needed to mint a token is present. */
  configured: boolean;
  /** Subject the backend authenticates as (a machine-user id, for Zitadel). */
  client_id: string | null;
  token_url: string | null;
  audience: string | null;
  scopes: string | null;
  /** Why it is unusable, when it is not. */
  error: string | null;
}

export interface ServiceIdentitiesResponse {
  enabled: boolean;
  identities: ServiceIdentityInfo[];
  /** Used when an auth block names none; null when the backend has several and designates no default. */
  default_identity: string | null;
  /** Set when the identities cannot be read at all. */
  error: string | null;
}

export async function listServiceIdentities(): Promise<ServiceIdentitiesResponse> {
  return request<ServiceIdentitiesResponse>("/llm/service-identities");
}

export interface DataSourceParamSpec {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  description: string;
  /**
   * Value used when the caller supplies none. Needed where the target API
   * demands an argument with no safe implicit value — Sheets rejects a write
   * with no `valueInputOption` and its own preference (`USER_ENTERED`) turns a
   * value starting with `=` into a live formula.
   */
  default?: unknown;
}

export interface DataSourceOperation {
  name: string;
  method: string;
  /** HTTP sources: path appended to base_url; supports {params.x} / {op.field}. */
  path?: string | null;
  /** GraphQL sources: query document. */
  query?: string | null;
  variables?: Record<string, unknown> | null;
  params: DataSourceParamSpec[];
  /**
   * Tri-state override of the "does this call need approval?" verdict that
   * `method` otherwise decides. `true` puts a POST /purge behind the gate,
   * `false` lets a DELETE that only clears a cache run unstopped, and
   * `null`/absent means "not stated" — the verb decides.
   */
  destructive?: boolean | null;
  response_schema?: Record<string, unknown> | null;
  /** JMESPath expression applied to the response payload. */
  mapping?: string | null;
  paginate?: Record<string, unknown> | null;
  /**
   * Query-string arguments, rendered for every method — including POST/PUT,
   * where a plain declared param would go into the JSON body instead. Values
   * are templates like a path's. Sheets' `valueInputOption` lives here.
   */
  query_params?: Record<string, string> | null;
  /** Per-operation retry override; `{attempts: 1}` for a non-idempotent write. */
  retries?: Record<string, unknown> | null;
  /** One line on what the operation does — this is what an agent reads. */
  description?: string;
}

export type DataSourceKind = "http" | "graphql";

export type DataSourceGrant = ResourceGrant;

/** Who the caller could grant a resource to. */
export interface GrantCandidates {
  users: { id: string; name: string | null; email: string | null }[];
  workflows: { id: string; name: string; owner_name: string | null; visibility: Visibility }[];
}

/** Kept for callers from before agents and workflows had grants. */
export type DataSourceSharing = Sharing;

export interface DataSourceDefinition extends Ownership, Sharing {
  id: string;
  name: string;
  description: string | null;
  kind: DataSourceKind;
  base_url: string;
  auth: DataSourceAuth;
  default_headers: Record<string, string>;
  operations: DataSourceOperation[];
  cache?: Record<string, unknown>;
  timeout_seconds?: number;
  retries?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DataSourceCreateRequest {
  id: string;
  name?: string;
  description?: string | null;
  kind?: DataSourceKind;
  base_url?: string;
  auth?: DataSourceAuthWrite;
  default_headers?: Record<string, string>;
  operations?: DataSourceOperation[];
  timeout_seconds?: number;
  visibility?: Visibility;
}

export interface DataSourceUpdateRequest {
  name?: string;
  description?: string | null;
  kind?: DataSourceKind;
  base_url?: string;
  auth?: DataSourceAuthWrite;
  default_headers?: Record<string, string>;
  operations?: DataSourceOperation[];
  timeout_seconds?: number;
  visibility?: Visibility;
}

/**
 * Every datasource the caller can see. With `workflowId` — the workflow being
 * edited — also the ones granted to that workflow, which it alone may use.
 */
export async function listDatasources(workflowId?: string | null): Promise<DataSourceDefinition[]> {
  const query = workflowId ? `?workflow_id=${encodeURIComponent(workflowId)}` : "";
  return request<DataSourceDefinition[]>(`/datasources${query}`);
}

/**
 * What a list of datasources draws. Operations keep name+method only — the risk
 * badge aggregates the methods — and the paths, params and response schemas
 * that make an imported OpenAPI source big are left behind.
 */
export type DataSourceSummary =
  Pick<DataSourceDefinition, "id" | "name" | "description" | "kind" | "base_url"> & Ownership & Sharing & {
    operations: Pick<DataSourceOperation, "name" | "method">[];
  };

/**
 * Datasources without the parts only the editor reads.
 *
 * Pair every use of this with `getDatasource` before editing — a summary has no
 * `auth` and no operation bodies, and a `PUT` built from one would drop them.
 */
export async function listDatasourceSummaries(): Promise<DataSourceSummary[]> {
  return request<DataSourceSummary[]>("/datasources?view=summary");
}

export async function getDatasource(id: string): Promise<DataSourceDefinition> {
  return request<DataSourceDefinition>(`/datasources/${id}`);
}

export async function createDatasource(payload: DataSourceCreateRequest): Promise<DataSourceDefinition> {
  return request<DataSourceDefinition>("/datasources", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateDatasource(id: string, payload: DataSourceUpdateRequest): Promise<DataSourceDefinition> {
  return request<DataSourceDefinition>(`/datasources/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteDatasource(id: string): Promise<void> {
  return request<void>(`/datasources/${id}`, { method: "DELETE" });
}

/** What can be granted beyond its visibility. */
export type GrantableKind = "datasource" | "agent" | "workflow";

const GRANT_COLLECTION: Record<GrantableKind, string> = {
  datasource: "datasources",
  agent: "agents",
  workflow: "workflows",
};

function grantsPath(kind: GrantableKind, id: string): string {
  return `/${GRANT_COLLECTION[kind]}/${encodeURIComponent(id)}/grants`;
}

export async function listGrants(kind: GrantableKind, id: string): Promise<ResourceGrant[]> {
  return request<ResourceGrant[]>(grantsPath(kind, id));
}

export async function listGrantCandidates(kind: GrantableKind, id: string): Promise<GrantCandidates> {
  return request<GrantCandidates>(`${grantsPath(kind, id)}/candidates`);
}

/** Grant (or change the access of) a user or a workflow. */
export async function grantAccess(
  kind: GrantableKind,
  id: string,
  grant: { grantee_type: GranteeType; grantee_id: string; access: GrantAccess },
): Promise<ResourceGrant> {
  return request<ResourceGrant>(grantsPath(kind, id), {
    method: "POST",
    body: JSON.stringify(grant),
  });
}

export async function revokeGrant(kind: GrantableKind, id: string, grantId: string): Promise<void> {
  return request<void>(`${grantsPath(kind, id)}/${encodeURIComponent(grantId)}`, { method: "DELETE" });
}

// ─── Events (Pub/Sub topics workflows are triggered by) ───────────────────────

/** A Pub/Sub topic a `pubsub` trigger step can subscribe to. */
export interface EventDefinition {
  id: string;
  name: string;
  description: string | null;
  topic: string;
  /** Empty until the backend creates one on a trigger's first use. */
  subscription: string;
  project_id: string;
  event_schema: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface EventCreateRequest {
  id: string;
  name?: string;
  description?: string | null;
  topic: string;
  subscription?: string;
  project_id?: string;
  event_schema?: Record<string, unknown> | null;
}

export interface EventUpdateRequest {
  name?: string;
  description?: string | null;
  topic?: string;
  subscription?: string;
  project_id?: string;
  event_schema?: Record<string, unknown> | null;
}

/** Thrown by createEvent when the name is taken — the overwrite prompt. */
export class EventNameConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventNameConflictError";
  }
}

export async function listEvents(): Promise<EventDefinition[]> {
  return request<EventDefinition[]>("/events");
}

/** What a list of events draws: no `event_schema`, which is most of an event. */
export type EventSummary = Pick<EventDefinition, "id" | "name" | "description" | "topic">;

/**
 * Events without their schemas.
 *
 * Pair every use of this with `getEvent` before editing.
 */
export async function listEventSummaries(): Promise<EventSummary[]> {
  return request<EventSummary[]>("/events?view=summary");
}

export async function getEvent(id: string): Promise<EventDefinition> {
  return request<EventDefinition>(`/events/${encodeURIComponent(id)}`);
}

/**
 * Create an event.  A name (or id) already in use comes back as a 409, which
 * the caller turns into an overwrite prompt and then retries as `updateEvent`.
 */
export async function createEvent(payload: EventCreateRequest): Promise<EventDefinition> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (res.status === 409) {
    throw new EventNameConflictError(
      apiError(409, await res.text().catch(() => ""), res.statusText).message,
    );
  }
  if (!res.ok) {
    throw apiError(res.status, await res.text().catch(() => ""), res.statusText);
  }
  return res.json() as Promise<EventDefinition>;
}

export async function updateEvent(id: string, payload: EventUpdateRequest): Promise<EventDefinition> {
  return request<EventDefinition>(`/events/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteEvent(id: string): Promise<void> {
  return request<void>(`/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Datasource probing / schema discovery (server-side) ─────────────────────

export interface DiscoveredSchema {
  kind: "openapi" | "graphql";
  /** Where the schema was found (URL or "graphql introspection @ <url>"). */
  source: string;
  /** Base URL the schema itself declares, when it declares one. */
  base_url?: string | null;
  operations: ImportedOperation[];
}

/** A specification's operation, carrying its human summary for the pick-list. */
export interface ImportedOperation extends DataSourceOperation {
  summary?: string | null;
}

/**
 * Result of importing a specification the user pointed at (URL) or uploaded.
 * Nothing is stored server-side: the operations are a pick-list, and only the
 * selected ones end up in the saved data source.
 */
export interface SchemaImportResult {
  kind: "openapi" | "graphql";
  /** The URL or file name the specification came from. */
  source: string;
  base_url: string | null;
  operations: ImportedOperation[];
}

export interface FetchSchemaRequest {
  /**
   * URL of an OpenAPI/Swagger document (JSON or YAML), a GraphQL introspection
   * result, GraphQL SDL — or, with `kind: "graphql"`, the GraphQL endpoint
   * itself, which the backend introspects.
   */
  schema_url: string;
  kind?: "http" | "graphql";
  /** Auth block if the schema URL itself needs credentials. */
  auth?: DataSourceAuthWrite | null;
}

/** Read a specification from a URL, server-side (no CORS, stored secrets usable). */
export async function fetchDatasourceSchema(payload: FetchSchemaRequest): Promise<SchemaImportResult> {
  return postWithDetail<SchemaImportResult>("/datasources/schema/fetch", payload);
}

/** Read a specification from an uploaded file. */
export async function uploadDatasourceSchema(
  file: File,
  kind: "http" | "graphql" = "http",
): Promise<SchemaImportResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("kind", kind);
  return postFormWithDetail<SchemaImportResult>("/datasources/schema/upload", body);
}

export interface DataSourceProbeRequest {
  base_url: string;
  kind?: "http" | "graphql";
  /** Auth block with real secrets or a `from_config` reference; null/omitted probes unauthenticated. */
  auth?: DataSourceAuthWrite | null;
}

export interface DataSourceProbeResult {
  url_status: "ok" | "unauthorized" | "unreachable";
  auth_status: "ok" | "failed" | "skipped";
  error: string | null;
  /**
   * Only ever set for `kind: "graphql"`, where the endpoint URL is itself the
   * way to fetch the schema. HTTP sources are never guessed at — import their
   * specification with {@link fetchDatasourceSchema} or
   * {@link uploadDatasourceSchema}.
   */
  discovered: DiscoveredSchema | null;
}

export async function probeDatasource(payload: DataSourceProbeRequest): Promise<DataSourceProbeResult> {
  return request<DataSourceProbeResult>("/datasources/probe", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Google Sheets ────────────────────────────────────────────────────────────

/**
 * What `/datasources/google/resolve` answers.
 *
 * A target-server failure is never an exception here: "the service account
 * cannot see that document" is the *expected* first outcome, because access is
 * granted per document by sharing it with the backend's address. `status` says
 * which case it is and `service_account` is the address to tell the user to
 * share with.
 */
export interface GoogleFileResolution {
  status: "ok" | "invalid" | "wrong_type" | "no_access" | "not_configured" | "error";
  error: string | null;
  file_id?: string;
  name?: string;
  mime_type?: string;
  /** Whether the backend can write, not just read. Only set on `ok`. */
  can_edit?: boolean;
  /** The address a document has to be shared with; "" when unconfigured. */
  service_account: string;
}

/** Resolve a pasted Drive URL — or a file id, which is what the Picker returns. */
export async function resolveGoogleFile(ref: string): Promise<GoogleFileResolution> {
  return request<GoogleFileResolution>("/datasources/google/resolve", {
    method: "POST",
    body: JSON.stringify({ ref }),
  });
}

/**
 * The Google Sheets datasource, ready to be created.
 *
 * The operation templates are code on the backend rather than something typed
 * into this editor, so the "Google Sheets" preset and the agent-facing
 * `create_google_sheets_datasource` tool produce the same source.
 */
export interface GoogleSheetsTemplate {
  id: string;
  name: string;
  description: string;
  kind: DataSourceKind;
  base_url: string;
  auth: DataSourceAuthWrite;
  operations: DataSourceOperation[];
  service_account: string;
  default_value_input_option: string;
}

export async function getGoogleSheetsTemplate(): Promise<GoogleSheetsTemplate> {
  return request<GoogleSheetsTemplate>("/datasources/google/sheets-template");
}

// ─── Sheet bindings ───────────────────────────────────────────────────────────

/**
 * A declarative read/write over one tab of one spreadsheet.
 *
 * Authored entirely in a form: no code and no prose. Saving one compiles it
 * into an `OperationDefinition` of the same name on the same datasource, which
 * is what makes it callable from a workflow step, /try-operation and the
 * datasources MCP tools — nothing downstream learns a new concept.
 */

/**
 * Either a literal or a path into workflow state — never both.
 *
 * The tag is what makes the form correct: without it `"state.project.id"` is
 * indistinguishable from the string a user actually wants in the cell, and the
 * usual fix (templating) makes every literal containing a brace a hazard. A
 * literal is copied through untouched.
 */
export type TaggedValue = { literal: unknown } | { from: string };

export function isStatePath(value: TaggedValue): value is { from: string } {
  return typeof (value as { from?: unknown }).from === "string";
}

export type FilterOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "contains";

export const FILTER_OPERATORS: FilterOperator[] = [
  "eq", "ne", "lt", "lte", "gt", "gte", "in", "contains",
];

export interface FilterClause {
  column: string;
  op: FilterOperator;
  value: TaggedValue;
}

export interface FilterGroup {
  op: "and" | "or";
  clauses: (FilterClause | FilterGroup)[];
}

export interface CellRange {
  named_range?: string | null;
  a1?: string | null;
}

export interface SheetBindingDocument {
  provider: "google_sheets";
  file_id: string;
  /** Display only — the file may be renamed at any time. */
  name?: string;
  /** Tab title. Used to build A1 ranges; never to identify the tab. */
  sheet: string;
  /** Authoritative tab identity: survives a rename, unlike the title. */
  sheet_id?: number | null;
}

export interface SheetBindingSchema {
  header_row: number;
  headers: string[];
  /** `sha256:…` over the ordered headers, re-checked before every run. */
  fingerprint: string;
  probed_at?: string | null;
}

export interface SheetBindingRead {
  mode: "rows" | "row_by_key" | "cells";
  /** Required for rows / row_by_key: starts empty and must be filled. */
  columns: string[];
  filter?: FilterGroup | null;
  limit?: number | null;
  key_column?: string | null;
  key_value?: TaggedValue | null;
  on_missing?: "null" | "error";
  range?: CellRange | null;
  value_render?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
  date_render?: "SERIAL_NUMBER" | "FORMATTED_STRING";
}

export interface SheetBindingWrite {
  mode: "update_by_key" | "append_row" | "set_cells";
  key_column?: string | null;
  key_value?: TaggedValue | null;
  on_missing?: "error" | "append" | "skip";
  /**
   * RAW by default, and that matters: USER_ENTERED makes a value beginning
   * with `=` a live formula, and values here come from workflow state.
   */
  value_input_option?: "RAW" | "USER_ENTERED";
  /** Opt out of the leading-`=` prefix guard. Only with USER_ENTERED. */
  allow_formulas?: boolean;
  /** `skip` leaves a blank value's cell alone; `clear` writes an empty cell. */
  blank_policy?: "skip" | "clear";
  /** column -> value. A column absent from this map is NEVER touched. */
  columns: Record<string, TaggedValue>;
  cells?: { range: CellRange; value: TaggedValue }[];
}

export interface SheetBindingResolution {
  /**
   * How the binding came to exist. `binding` is a form; `script` carries a
   * generated transform. An OUTCOME, never a setting: the backend decides, and
   * the UI only ever displays it.
   */
  tier: "binding" | "script";
  /** The natural-language request a tier-2 binding was generated from. */
  instruction: string | null;
  answers?: Record<string, string>;
  authored_by: "human" | "llm";
  model_id: string | null;
  compiled_at: string | null;
  script_id: string | null;
  /**
   * Set once a person has edited the generated code. One-way: from then on the
   * backend refuses to regenerate, so their fix is never overwritten.
   */
  edited_by_human: boolean;
  golden?: SheetBindingGolden | null;
}

/** The frozen `sample_rows -> output` pair a tier-2 binding is re-tested against. */
export interface SheetBindingGolden {
  input_rows: unknown[][];
  output: unknown;
  input_hash: string;
  output_hash: string;
  verified_at: string | null;
}

/** The generated transform of a tier-2 binding. */
export interface SheetBindingCompute {
  script_id: string;
  content_hash: string;
  signature_version: number;
  code: string;
  output_shape: "records" | "record" | "value";
  /** The model's one-line explanation, shown next to the code in review. */
  rationale: string;
  /** Compiled code is inert until somebody reviews it and confirms. */
  activated: boolean;
  /** The schema, instruction or answers moved on; it will not run. */
  stale: boolean;
  stale_reason: string;
  cache_key: string;
}

/**
 * What every surface reports about a binding's tier — the badge's whole input.
 *
 * `tier` here is derived by the backend from whether the binding carries code,
 * so it cannot disagree with reality the way a stored flag could.
 */
export interface ComputeStatus {
  name: string;
  operation: "read" | "write";
  tier: "binding" | "script";
  generated: boolean;
  instruction: string | null;
  answers: Record<string, string>;
  authored_by: "human" | "llm";
  model_id: string | null;
  edited_by_human: boolean;
  compiled_at: string | null;
  schema_fingerprint: string;
  script_id?: string;
  content_hash?: string;
  signature_version?: number;
  output_shape?: "records" | "record" | "value";
  rationale?: string;
  activated?: boolean;
  stale?: boolean;
  stale_reason?: string;
  golden?: {
    rows: number;
    input_hash: string;
    output_hash: string;
    verified_at: string | null;
    verified_days_ago: number | null;
  } | null;
}

/** One ambiguity question a compile asked instead of guessing. */
export interface ComputeNeed {
  question: string;
  options: string[];
}

/** The three shapes a compile can return; `status` discriminates them. */
export interface CompileComputeResult {
  status: "ok" | "cached" | "needs" | "error";
  binding: string;
  /** status "needs": the questions to render as a small form. */
  needs?: ComputeNeed[];
  instruction?: string;
  answers?: Record<string, string>;
  /** status "ok"/"cached": the generated source, for review. */
  code?: string;
  rationale?: string;
  /** The transform's result on the author's own sample rows. */
  output?: unknown;
  compute?: ComputeStatus;
  attempts?: number;
  error?: string;
}

export interface BindingCodeResult {
  binding: string;
  code: string;
  /** The fixed entry point a hand edit must keep. */
  signature: string;
  compute: ComputeStatus;
  golden: SheetBindingGolden | null;
}

export interface ComputeActionResult {
  status: "ok" | "stale";
  binding: string;
  compute: ComputeStatus;
  output?: unknown;
  error?: string;
}

export interface SheetBinding {
  version: number;
  /** Becomes the compiled operation's name, so lower snake case. */
  name: string;
  document: SheetBindingDocument;
  schema: SheetBindingSchema;
  operation: "read" | "write";
  read?: SheetBindingRead | null;
  write?: SheetBindingWrite | null;
  output?: { key: string };
  /** Tier 2 only. Absent on a form-authored binding — which is what makes
   *  that binding demonstrably code-free. */
  compute?: SheetBindingCompute | null;
  resolution?: SheetBindingResolution;
  /** Added by the list endpoint: the operation this binding compiled to. */
  compiled_operation?: string;
  /** Added by the list endpoint: the tier badge's input. */
  compute_status?: ComputeStatus;
}

/** One tab, as `probe-sheet` reports it. */
export interface ProbedTab {
  sheet_id: number | null;
  title: string;
}

/**
 * Everything the binding editor is built from, in one call.
 *
 * Every dropdown in the form is filled from this — which is what makes the
 * form correct by construction: there is no free-text column name anywhere, so
 * a binding cannot name a column the sheet does not have.
 */
export interface ProbeSheetResult {
  status: "ok" | "error";
  error: string | null;
  file_id?: string;
  tabs?: ProbedTab[];
  named_ranges?: { name: string; range: Record<string, unknown> }[];
  sheet?: string;
  sheet_id?: number | null;
  header_row?: number;
  headers?: string[];
  /** A few real rows, padded to the header width. This screen is the UX. */
  sample_rows?: unknown[][];
  fingerprint?: string;
  range?: string;
}

export async function probeSheet(payload: {
  file_id: string;
  sheet?: string | null;
  header_row?: number;
  source_id?: string;
}): Promise<ProbeSheetResult> {
  return request<ProbeSheetResult>("/datasources/google/probe-sheet", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listSheetBindings(sourceId: string): Promise<SheetBinding[]> {
  return request<SheetBinding[]>(`/datasources/${encodeURIComponent(sourceId)}/bindings`);
}

export async function createSheetBinding(
  sourceId: string, binding: SheetBinding,
): Promise<SheetBinding> {
  return request<SheetBinding>(`/datasources/${encodeURIComponent(sourceId)}/bindings`, {
    method: "POST",
    body: JSON.stringify({ binding }),
  });
}

export async function updateSheetBinding(
  sourceId: string, name: string, binding: SheetBinding,
): Promise<SheetBinding> {
  return request<SheetBinding>(
    `/datasources/${encodeURIComponent(sourceId)}/bindings/${encodeURIComponent(name)}`,
    { method: "PUT", body: JSON.stringify({ binding }) },
  );
}

export async function deleteSheetBinding(sourceId: string, name: string): Promise<void> {
  await request<void>(
    `/datasources/${encodeURIComponent(sourceId)}/bindings/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

/** One cell a write would touch, with what is there now and what would replace it. */
export interface PreviewCell {
  a1: string;
  column: string | null;
  value: unknown;
  /** `skip` means blank_policy left it alone — before and after are equal. */
  action: "write" | "skip";
  before?: unknown;
  after?: unknown;
}

export interface PreviewBindingResult {
  /** `ready` for a planned write, `ok` for an executed read, else skipped/error. */
  status: "ready" | "ok" | "skipped" | "error";
  error: string | null;
  binding: string;
  operation?: "read" | "write";
  params?: Record<string, unknown>;
  reason?: string | null;
  mode?: string;
  row_number?: number | null;
  /** The A1 range(s) a write would target. */
  range?: string | null;
  value_input_option?: string;
  blank_policy?: string;
  cells: PreviewCell[];
  /** The same changes as lines a person can read — what an approver sees. */
  changes: string[];
  cells_total?: number;
  /** Read previews only: the size-capped result. */
  output?: unknown;
  rows?: number;
}

/**
 * Dry-run a binding against sample state.
 *
 * A write is planned and never sent: the reads happen (the row number and the
 * "before" values come from the live sheet), the header fingerprint is
 * checked, and the response carries the target range plus every cell's
 * before/after. A read is executed, since that is all there is to preview.
 */
export async function previewSheetBinding(
  sourceId: string,
  name: string,
  payload: { state?: Record<string, unknown>; params?: Record<string, unknown> },
): Promise<PreviewBindingResult> {
  return request<PreviewBindingResult>(
    `/datasources/${encodeURIComponent(sourceId)}/bindings/${encodeURIComponent(name)}/preview`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export interface TryOperationRequest {
  base_url: string;
  kind?: "http" | "graphql";
  /** Auth with real secrets or a `from_config` reference, or null with source_id set to use stored secrets. */
  auth?: DataSourceAuthWrite | null;
  /** Stored definition whose secrets back redacted/omitted auth (edit mode). */
  source_id?: string | null;
  /** Every operation of the draft (templates may reference siblings). */
  operations: DataSourceOperation[];
  /** Name of the operation to execute. */
  operation: string;
  params?: Record<string, unknown>;
  timeout_seconds?: number;
  /**
   * Set on the retry, after the user has read the row count and clicked
   * through. Without it a destructive operation is previewed and refused.
   */
  confirm_destructive?: boolean;
}

/** What a refused try run reports instead of running. */
export interface TryOperationDestructivePlan {
  operation: string;
  method: string;
  affected_rows: number;
  targets: string[];
  affected_sample: string[];
}

export interface TryOperationResult {
  status: "ok" | "error" | "confirmation_required";
  error: string | null;
  /** Size-capped sample of the raw response (lists/strings truncated). */
  api_output: unknown;
  /** Meta-LLM-suggested JMESPath mapping, when one validated. */
  suggested_mapping: string | null;
  /** Present only on `confirmation_required`. */
  destructive?: TryOperationDestructivePlan;
}

export async function tryDatasourceOperation(payload: TryOperationRequest): Promise<TryOperationResult> {
  return request<TryOperationResult>("/datasources/try-operation", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Script library ───────────────────────────────────────────────────────────

export interface ScriptDefinition extends Ownership {
  id: string;
  name: string;
  description?: string | null;
  code: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ScriptCreateRequest {
  /** Omit to let the backend slugify the name — that makes save-by-name idempotent. */
  id?: string;
  name: string;
  description?: string | null;
  code: string;
  /** Set after the user confirmed the overwrite warning raised by a 409. */
  overwrite?: boolean;
  visibility?: Visibility;
}

/** Thrown by `createScript` when the name is taken and `overwrite` was not set. */
export class ScriptNameConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptNameConflictError";
  }
}

export async function listScripts(): Promise<ScriptDefinition[]> {
  return request<ScriptDefinition[]>("/scripts");
}

/** What a list of scripts draws: no `code`, which is all of a script's weight. */
export type ScriptSummary = Pick<ScriptDefinition, "id" | "name" | "description"> & Ownership;

/**
 * Scripts without their bodies.
 *
 * Pair every use of this with `getScript` before showing or saving code.
 */
export async function listScriptSummaries(): Promise<ScriptSummary[]> {
  return request<ScriptSummary[]>("/scripts?view=summary");
}

export async function getScript(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/scripts/${encodeURIComponent(id)}`);
}

/**
 * Create or overwrite a script.  A name clash comes back as a 409, which the
 * caller turns into an overwrite prompt and then retries with `overwrite: true`.
 */
export async function createScript(payload: ScriptCreateRequest): Promise<ScriptDefinition> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/scripts`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (res.status === 409) {
    throw new ScriptNameConflictError(
      apiError(409, await res.text().catch(() => ""), res.statusText).message,
    );
  }
  if (!res.ok) {
    throw apiError(res.status, await res.text().catch(() => ""), res.statusText);
  }
  return res.json() as Promise<ScriptDefinition>;
}

export async function updateScript(
  id: string,
  payload: { name: string; description?: string | null; code: string; visibility?: Visibility },
): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/scripts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteScript(id: string): Promise<void> {
  await request<void>(`/scripts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Data-source deletion approvals ──────────────────────────────────────────

/**
 * The approval queue and its history.
 *
 * Every destructive data-source call a run makes leaves a row here, decided or
 * not, so the same endpoint serves the pending queue and the audit trail —
 * `status` is what separates them.
 */
export async function listApprovals(params: {
  status?: ApprovalCaseStatus;
  workflowId?: string;
  datasourceId?: string;
  runId?: string;
  limit?: number;
  offset?: number;
  /**
   * "summary" leaves the unbounded fields on the server — the inputs, the
   * targets, the affected sample, the details map. A queue row renders none of
   * them, and a write case's sample is a before/after for every cell, so a
   * full read of fifty rows moved megabytes to draw fifty lines. Read the case
   * by id for those.
   */
  view?: "full" | "summary";
} = {}): Promise<ApprovalListResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.view) query.set("view", params.view);
  if (params.workflowId) query.set("workflow_id", params.workflowId);
  if (params.datasourceId) query.set("datasource_id", params.datasourceId);
  if (params.runId) query.set("run_id", params.runId);
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<ApprovalListResponse>(`/approvals${qs ? `?${qs}` : ""}`);
}

/** Badge count for the dock rail. Deliberately its own cheap endpoint. */
export async function countPendingApprovals(): Promise<number> {
  const body = await request<{ count: number }>("/approvals/pending/count");
  return body.count ?? 0;
}

export async function getApproval(caseId: string): Promise<ApprovalCase> {
  return request<ApprovalCase>(`/approvals/${encodeURIComponent(caseId)}`);
}

/**
 * Past decisions on one workflow + data source + operation, with the streak
 * the backend counted. The streak is read from the server, never recomputed
 * here: the panel and the gate must not disagree about whether the next case
 * gets decided without a human.
 */
export async function getApprovalHistory(params: {
  workflowId: string;
  datasourceId: string;
  operation: string;
  limit?: number;
  /** As in `listApprovals` — a history row shows who, why and how many. */
  view?: "full" | "summary";
}): Promise<ApprovalHistoryResponse> {
  const query = new URLSearchParams({
    workflow_id: params.workflowId,
    datasource_id: params.datasourceId,
    operation: params.operation,
  });
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.view) query.set("view", params.view);
  return request<ApprovalHistoryResponse>(`/approvals/history?${query.toString()}`);
}

/** Approve or reject one case; a workflow case's run resumes with it. */
export async function decideApproval(
  caseId: string,
  payload: { approved: boolean; reason?: string },
): Promise<ApprovalCase> {
  return postWithDetail<ApprovalCase>(
    `/approvals/${encodeURIComponent(caseId)}/decide`,
    payload,
  );
}

/** Cancel an autonomous decision before its veto window closes. */
export async function vetoApproval(
  caseId: string,
  by?: string,
): Promise<ApprovalCase> {
  return postWithDetail<ApprovalCase>(
    `/approvals/${encodeURIComponent(caseId)}/veto`,
    { by: by ?? null },
  );
}

// ─── Backend health ───────────────────────────────────────────────────────────

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Sheet bindings, tier 2 (generated transforms) ───────────────────────────
//
// The lifecycle of a binding whose computation a model wrote. Note what is NOT
// here: no way to ask for tier 2. Escalation is a decision the backend makes
// and the user authorises; there is no "use generated code" switch to send.

const bindingPath = (sourceId: string, name: string) =>
  `/datasources/${encodeURIComponent(sourceId)}/bindings/${encodeURIComponent(name)}`;

/**
 * Generate (or regenerate) the computation of a binding.
 *
 * Returns one of three things and the caller must branch on `status`:
 * `needs` (clarifying questions — nothing was stored), `ok`/`cached` (code
 * stored switched OFF, awaiting review), or a thrown error carrying the
 * checker's own rejection.
 *
 * Requires admin permission on the backend: it stores code that is later
 * executed. A 403 here is that, not a bug.
 */
export async function compileSheetBindingCode(
  sourceId: string,
  name: string,
  payload: {
    /** Omit to re-use the instruction already stored — i.e. a plain recompile. */
    instruction?: string;
    /** Answers to a previous call's questions, folded in so recompiles repeat. */
    answers?: Record<string, string>;
    /** Re-run the model even when nothing about the request changed. */
    force?: boolean;
    params?: Record<string, unknown>;
  },
): Promise<CompileComputeResult> {
  return request<CompileComputeResult>(`${bindingPath(sourceId, name)}/compile`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** The generated code of a binding, with its verification state. */
export async function getSheetBindingCode(
  sourceId: string,
  name: string,
): Promise<BindingCodeResult> {
  return request<BindingCodeResult>(`${bindingPath(sourceId, name)}/code`);
}

/**
 * Replace generated code with a hand-written version.
 *
 * Held to exactly the same checks the generated version was. Sets
 * `edited_by_human`, which permanently stops regeneration.
 */
export async function editSheetBindingCode(
  sourceId: string,
  name: string,
  code: string,
): Promise<ComputeActionResult> {
  return request<ComputeActionResult>(`${bindingPath(sourceId, name)}/code`, {
    method: "PUT",
    body: JSON.stringify({ code }),
  });
}

/** Switch a compiled transform on, after re-proving it against its fixture. */
export async function activateSheetBindingCode(
  sourceId: string,
  name: string,
): Promise<ComputeActionResult> {
  return request<ComputeActionResult>(`${bindingPath(sourceId, name)}/activate`, {
    method: "POST",
  });
}

/**
 * Re-run the frozen test and re-check the sheet's header row.
 *
 * Resolves with `status: "stale"` rather than throwing when either check
 * fails: the state it leaves behind is the answer, and the panel renders it.
 */
export async function retestSheetBindingCode(
  sourceId: string,
  name: string,
): Promise<ComputeActionResult> {
  return request<ComputeActionResult>(`${bindingPath(sourceId, name)}/retest`, {
    method: "POST",
  });
}

/** Switch generated code off until somebody re-confirms it. Needs no admin. */
export async function markSheetBindingStale(
  sourceId: string,
  name: string,
  reason: string,
): Promise<ComputeActionResult> {
  return request<ComputeActionResult>(`${bindingPath(sourceId, name)}/stale`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// ─── Run data (`data` steps) ─────────────────────────────────────────────────
//
// A `data` step names slices of a run's state and captures them as files. It is
// read-only by construction: the manifest below is a list of things to
// download, never a record of anything the step did to the data.
//
// Two outcomes are typed rather than folded into the generic "API 4xx" error,
// because both are expected and each needs its own sentence in the UI:
//
//   410 on an artifact — the retention window closed and the bytes are gone.
//                        Not a fault; the panel explains it instead of showing
//                        a failure.
//   404 on data.zip    — this backend does not implement the optional combined
//                        download. The "download all" button simply retires.

export type RunDataFormat = "jsonl" | "json" | "csv";

/** One downloadable file a `data` step produced. */
export interface RunDataArtifact {
  id: string;
  /** The `data` step that captured it — one step can capture several files. */
  step_id: string;
  /** The selection's name, as the workflow author typed it. */
  name: string;
  format: RunDataFormat;
  /** `name` plus the format's extension; what the saved file is called. */
  filename: string;
  shape: string;
  items: number;
  bytes: number;
  /**
   * True when the file holds a *prefix* of the data rather than all of it.
   * Never render this quietly — a partial export mistaken for a complete one
   * is the failure that does real damage.
   */
  truncated: boolean;
  source_id?: string | null;
  operation?: string | null;
  created_at: string;
  /** When the bytes are purged; a download after this 410s. */
  expires_at: string;
  /** Either a backend-relative path or an absolute signed URL — both occur. */
  download_url: string;
}

export interface RunDataManifest {
  run_id: string;
  /** Empty is normal: a run with no `data` step, or one that never reached it. */
  artifacts: RunDataArtifact[];
}

/** Thrown on a 410: the retention window closed and the stream is gone. */
export class RunDataExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunDataExpiredError";
  }
}

/** Thrown on a 404 from `data.zip`, which is an optional endpoint. */
export class RunDataZipUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunDataZipUnavailableError";
  }
}

export async function getRunData(runId: string): Promise<RunDataManifest> {
  return request<RunDataManifest>(`/runs/${encodeURIComponent(runId)}/data`);
}

/**
 * Resolve a manifest `download_url` into something the browser can fetch.
 *
 * The contract permits two shapes and this has to accept both: an absolute
 * signed URL (self-authenticating, usually on another origin) or a
 * backend-relative path. A relative path is joined to the versioned API base
 * unless it already carries the `/api/` prefix, so `"/runs/x/data/y"` and
 * `"/api/v1/runs/x/data/y"` both land on the same endpoint.
 */
export function resolveRunDataUrl(downloadUrl: string): { url: string; signed: boolean } {
  if (/^https?:\/\//i.test(downloadUrl)) return { url: downloadUrl, signed: true };
  if (downloadUrl.startsWith("/api/")) return { url: `${BACKEND_URL}${downloadUrl}`, signed: false };
  const path = downloadUrl.startsWith("/") ? downloadUrl : `/${downloadUrl}`;
  return { url: `${BASE}${path}`, signed: false };
}

/** The backend's `detail`, or `fallback` when the body is not the JSON envelope. */
async function detailOf(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.detail === "string" && parsed.detail) return parsed.detail;
  } catch {
    // not JSON — the fallback is a better sentence than a raw body
  }
  return fallback;
}

/**
 * Hand a streamed response to the browser as a saved file.
 *
 * `Content-Disposition: attachment` only takes effect for a navigation, and
 * this request carried an Authorization header, so the bytes arrive as a blob
 * and the anchor has to supply the name.
 */
async function saveResponseAsFile(res: Response, filename: string): Promise<void> {
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: revoking in the same one cancels the download
  // that was just started.
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

/**
 * Download one artifact.
 *
 * A signed URL is opened rather than fetched: it authenticates itself and lives
 * on another origin, so fetching it would only put a CORS failure between the
 * user and their file. A relative path is fetched with the bearer token and
 * saved from the blob.
 */
export async function downloadRunDataArtifact(
  artifact: Pick<RunDataArtifact, "filename" | "download_url">,
): Promise<void> {
  const { url, signed } = resolveRunDataUrl(artifact.download_url);
  if (signed) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 410) {
    throw new RunDataExpiredError(
      await detailOf(res, "This export has expired and its file has been purged."),
    );
  }
  if (!res.ok) {
    throw apiError(res.status, await res.text().catch(() => ""), res.statusText);
  }
  await saveResponseAsFile(res, artifact.filename);
}

/**
 * Download every artifact of a run as one archive.
 *
 * Optional on the backend. A 404 means "not implemented here", which is not an
 * error the user needs to see as one — the caller retires the button instead.
 */
export async function downloadRunDataZip(runId: string): Promise<void> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/data.zip`, { headers });
  if (res.status === 404) {
    throw new RunDataZipUnavailableError(
      "This backend does not offer a combined download.",
    );
  }
  if (res.status === 410) {
    throw new RunDataExpiredError(
      await detailOf(res, "These exports have expired and their files have been purged."),
    );
  }
  if (!res.ok) {
    throw apiError(res.status, await res.text().catch(() => ""), res.statusText);
  }
  await saveResponseAsFile(res, `${runId}-data.zip`);
}
