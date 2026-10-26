/**
 * Small pure helpers for runners (machines connected through acp-web-proxy)
 * and the waits they put on a run: approval numbers, reset times, and the
 * `_quota_wait_<step>` / `_runner_wait_<step>` keys in a run's state.
 */

/** Digits in an approval number — the machine prints "482 913". */
export const APPROVAL_CODE_LENGTH = 6;

/**
 * The approval number as the backend wants it: "482 913", "482-913" and
 * "482913" are the same number. Null until it is exactly six digits.
 */
export function normalizeApprovalCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${APPROVAL_CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** "15:42" for a time today, "Oct 27, 15:42" for any other day. */
export function formatClock(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (at.toDateString() === new Date(now).toDateString()) return time;
  return `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** "1h 12m", "45m", "2d 3h", "under a minute" — for a duration in ms. */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** "5m ago", "just now", or "never". */
export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const ms = now - at;
  return ms < 60_000 ? "just now" : `${formatSpan(ms)} ago`;
}

/** "claude" → "Claude": a machine's agent names are lowercase config keys. */
export function agentDisplayName(name: string): string {
  return name ? name[0].toUpperCase() + name.slice(1) : name;
}

// ─── Waits in a run's state ───────────────────────────────────────────────────

/** A step parked because its agent ran out of quota. */
export interface QuotaWait {
  /** When it resumes; null when the limit gave no reset time. */
  resume_at: string | null;
  kind: "usage_limit" | "rate_limited" | "overloaded" | string;
  message: string;
  agent_id: string;
  since: string;
}

/** A step waiting for the machine its agent runs on to come online. */
export interface RunnerWait {
  runner_id: string;
  runner_name: string | null;
  since: string;
}

function entry<T>(state: Record<string, unknown> | null | undefined, key: string): T | null {
  const value = state?.[key];
  return value && typeof value === "object" ? (value as T) : null;
}

export function quotaWaitOf(state: Record<string, unknown> | null | undefined, stepId: string): QuotaWait | null {
  return entry<QuotaWait>(state, `_quota_wait_${stepId}`);
}

export function runnerWaitOf(state: Record<string, unknown> | null | undefined, stepId: string): RunnerWait | null {
  return entry<RunnerWait>(state, `_runner_wait_${stepId}`);
}

const QUOTA_TITLES: Record<string, string> = {
  usage_limit: "Usage limit reached",
  rate_limited: "Rate limited",
  overloaded: "Agent overloaded",
};

/**
 * "Usage limit reached — resumes at 15:42 (in 1h 12m)", or "… — resumes when
 * the limit resets" when there is no reset time to count down to.
 */
export function quotaWaitText(wait: Pick<QuotaWait, "kind" | "resume_at">, now: number = Date.now()): string {
  const title = QUOTA_TITLES[wait.kind] ?? "Usage limit reached";
  if (!wait.resume_at) return `${title} — resumes when the limit resets`;
  const left = Date.parse(wait.resume_at) - now;
  if (Number.isNaN(left)) return `${title} — resumes when the limit resets`;
  if (left <= 0) return `${title} — resuming now`;
  return `${title} — resumes at ${formatClock(wait.resume_at, now)} (in ${formatSpan(left)})`;
}
