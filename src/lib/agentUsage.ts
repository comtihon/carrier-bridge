/**
 * Agents vs runtimes, and how a workflow uses an agent.
 *
 * An agent is a role: prompt, tools, addons, and a default runtime. A runtime
 * is where an agent runs: local / docker / k8s, one connected machine (and the
 * ACP agent on it), or a runtime pool. A workflow may run an agent elsewhere
 * and give it other addons for one use (`runtime` / `addons` on a static agent
 * step or on a dynamic step's `agent_pool` entry) — carrier's
 * app.domain.models.agent_usage.
 */

import type { AgentAddonEntry, AgentDefinition, AgentSummary } from "./api";

export type RuntimeKind = "default" | "local" | "docker" | "k8s" | "runner" | "pool";

export interface RuntimeSelection {
  kind: RuntimeKind;
  runner_id?: string | null;
  acp_agent?: string | null;
  pool_id?: string | null;
}

/**
 * Whether an agent is a role (listed among agents) or a machine's own agent
 * (listed among runtimes). The rule: an agent that runs on a connected
 * machine and has no prompt of its own is that machine's agent, as the
 * Runners panel creates them; everything else is a role.
 */
export function isRoleAgent(agent: Pick<AgentDefinition, "default_runtime"> & {
  has_prompt?: boolean;
  agent_input?: Record<string, unknown>;
}): boolean {
  if (agent.default_runtime !== "runner") return true;
  const prompt = agent.has_prompt ?? !!(agent.agent_input && agent.agent_input.system_prompt);
  return !!prompt;
}

export function roleAgents<T extends AgentDefinition | AgentSummary>(agents: T[]): T[] {
  return agents.filter((a) => isRoleAgent(a as Parameters<typeof isRoleAgent>[0]));
}

/** A selection as one `<select>` value: "default" | "local" | "runner:<id>:<agent>" | "pool:<id>". */
export function runtimeKey(sel: RuntimeSelection | null | undefined): string {
  if (!sel || sel.kind === "default") return "default";
  if (sel.kind === "runner") return `runner:${sel.runner_id ?? ""}:${sel.acp_agent ?? ""}`;
  if (sel.kind === "pool") return `pool:${sel.pool_id ?? ""}`;
  return sel.kind;
}

export function runtimeFromKey(key: string): RuntimeSelection | undefined {
  if (!key || key === "default") return undefined;
  if (key.startsWith("runner:")) {
    const [, runnerId, acpAgent] = key.split(":");
    return { kind: "runner", runner_id: runnerId, acp_agent: acpAgent || null };
  }
  if (key.startsWith("pool:")) return { kind: "pool", pool_id: key.slice("pool:".length) };
  return { kind: key as RuntimeKind };
}

/** "Linux", "Windows", "macOS" for a runner's OS (Node's `process.platform`). */
export function platformLabel(os: string | null | undefined): string {
  switch ((os ?? "").toLowerCase()) {
    case "linux": return "Linux";
    case "win32": case "windows": return "Windows";
    case "darwin": case "macos": return "macOS";
    case "": case "unknown": return "unknown";
    default: return os as string;
  }
}

/** "3 claude, 1 codex" from `{claude: 3, codex: 1}`, largest first. */
export function countsText(counts: Record<string, number> | null | undefined, label: (k: string) => string = (k) => k): string {
  return Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${n} ${label(k)}`)
    .join(", ");
}

/** The agent's own addons with this use's overrides applied (mirrors carrier's merge). */
export function mergeAddons(base: AgentAddonEntry[], overrides: AgentAddonEntry[]): AgentAddonEntry[] {
  if (!overrides.length) return base;
  const types = new Set<string>(overrides.filter((a) => a.type !== "datasource").map((a) => a.type));
  const sources = new Set(overrides.flatMap((a) => (a.type === "datasource" ? [a.source_id] : [])));
  return [
    ...base.filter((a) => !(types.has(a.type) || (a.type === "datasource" && sources.has(a.source_id)))),
    ...overrides,
  ];
}
