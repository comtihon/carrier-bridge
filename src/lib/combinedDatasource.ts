/**
 * Pure helpers for `combined_datasource` steps: what a part is, what it says
 * about itself, which part is the step output, and how a run's per-part
 * summary maps onto the parts the workflow defines.
 *
 * Kept free of React so the canvas node, the run view, the properties panel
 * and the tests all read the same rules.
 */
import type { CombinedPart, RunPartStatus } from "./types";

export type PartKind = "datasource" | "python" | "combined" | "unknown";

/** Which icon / colour family a part gets. */
export function partKind(part: Pick<CombinedPart, "type">): PartKind {
  switch (part.type) {
    case "data_source":
    case "datasource":
      return "datasource";
    case "python":
      return "python";
    case "combined_datasource":
    case "combined":
      return "combined";
    default:
      return "unknown";
  }
}

/** The one-line description under a part's id. */
export function partSubtitle(part: CombinedPart): string {
  switch (partKind(part)) {
    case "datasource": {
      const src = part.source ?? "?";
      return part.operation ? `${src}.${part.operation}` : src;
    }
    case "python":
      return part.script_id ? part.script_id : "inline code";
    case "combined": {
      const n = Array.isArray(part.parts) ? part.parts.length : 0;
      return `${n} part${n === 1 ? "" : "s"}`;
    }
    default:
      return String(part.type ?? "unknown");
  }
}

/**
 * The id of the part whose output becomes the step (or nested part) output:
 * the explicit `output` when it names an existing part, otherwise the last.
 */
export function outputPartId(
  parts: CombinedPart[] | undefined | null,
  output?: string | null,
): string | undefined {
  const list = parts ?? [];
  if (output && list.some((p) => p.id === output)) return output;
  return list.length ? list[list.length - 1].id : undefined;
}

export type PartRunState = "completed" | "failed" | "skipped" | "active" | "pending";

/** Backend part status → the canvas's run-state vocabulary. */
export function partRunState(status: string | null | undefined): PartRunState | undefined {
  switch (status) {
    case "finished": return "completed";
    case "failed":   return "failed";
    case "skipped":  return "skipped";
    case "running":  return "active";
    case "pending":  return "pending";
    default:         return undefined;
  }
}

/** Run summaries indexed by part id, one level deep. */
export function runPartsById(
  runParts: RunPartStatus[] | null | undefined,
): Map<string, RunPartStatus> {
  const map = new Map<string, RunPartStatus>();
  for (const p of runParts ?? []) {
    if (p && typeof p.id === "string") map.set(p.id, p);
  }
  return map;
}

/** "1.2s" / "340ms" — compact enough for a node row. */
export function formatDurationMs(ms: number | null | undefined): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s ? `${s}s` : ""}`;
}

/** Compact run stats for a part row, e.g. ["1.2s", "50 rec", "2 err"]. */
export function partRunStats(run: RunPartStatus | undefined): string[] {
  if (!run) return [];
  const out: string[] = [];
  const d = formatDurationMs(run.duration_ms);
  if (d) out.push(d);
  if (typeof run.records === "number") out.push(`${run.records} rec`);
  if (typeof run.calls === "number" && run.calls > 1) out.push(`${run.calls} calls`);
  if (typeof run.error_count === "number" && run.error_count > 0) out.push(`${run.error_count} err`);
  return out;
}

/**
 * Why the parts list cannot be saved, or null. An empty list is fine (a node
 * just dropped on the canvas has none); blank or duplicate ids are not,
 * because later parts address earlier ones by id.
 */
export function combinedPartsProblem(
  parts: CombinedPart[] | undefined,
  output?: string,
  path = "",
): string | null {
  const list = parts ?? [];
  const seen = new Set<string>();
  for (const [i, part] of list.entries()) {
    const where = `${path}part ${i + 1}`;
    if (!part || typeof part !== "object") return `${where} is not an object`;
    const id = typeof part.id === "string" ? part.id.trim() : "";
    if (!id) return `${where} needs an id`;
    if (seen.has(id)) return `${where}: duplicate part id "${id}"`;
    seen.add(id);
    if (!part.type) return `${where} ("${id}") needs a type`;
    if (partKind(part) === "combined") {
      const nested = combinedPartsProblem(part.parts, part.output, `${where} ("${id}") → `);
      if (nested) return nested;
    }
  }
  if (output && !seen.has(output)) return `${path}output "${output}" is not a part id`;
  return null;
}
