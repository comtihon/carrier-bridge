import type { DynamicJob, DynamicRunState } from "@/lib/types";

export const COL_WIDTH = 290;
export const ROW_HEIGHT = 128;

export type DagEdgeKind = "depends" | "delegate" | "handback";

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  kind: DagEdgeKind;
  /** Times this loop was taken (handbacks only). */
  count?: number;
}

export interface DagLayout {
  positions: Record<string, { x: number; y: number }>;
  edges: DagEdge[];
  depth: Record<string, number>;
}

/**
 * Column = longest dependency chain to the job; a delegated helper sits one
 * column after the job that asked for it. Rows are filled in plan order so a
 * re-render with one more job does not reshuffle the rest.
 */
export function layoutDag(state: Pick<DynamicRunState, "jobs" | "decisions">): DagLayout {
  const byId = new Map<string, DynamicJob>(state.jobs.map((j) => [j.id, j]));
  const depth: Record<string, number> = {};
  const visiting = new Set<string>();

  function depthOf(id: string): number {
    if (depth[id] !== undefined) return depth[id];
    const job = byId.get(id);
    if (!job || visiting.has(id)) return 0;
    visiting.add(id);
    let d = 0;
    for (const dep of job.depends_on) if (byId.has(dep)) d = Math.max(d, depthOf(dep) + 1);
    if (job.delegated_by && byId.has(job.delegated_by)) d = Math.max(d, depthOf(job.delegated_by) + 1);
    visiting.delete(id);
    depth[id] = d;
    return d;
  }
  state.jobs.forEach((j) => depthOf(j.id));

  const rows: Record<number, number> = {};
  const positions: DagLayout["positions"] = {};
  for (const job of state.jobs) {
    const col = depth[job.id];
    const row = rows[col] ?? 0;
    rows[col] = row + 1;
    positions[job.id] = { x: col * COL_WIDTH, y: row * ROW_HEIGHT };
  }

  const edges: DagEdge[] = [];
  for (const job of state.jobs) {
    for (const dep of job.depends_on) {
      if (byId.has(dep)) edges.push({ id: `dep:${dep}->${job.id}`, source: dep, target: job.id, kind: "depends" });
    }
    if (job.delegated_by && byId.has(job.delegated_by)) {
      edges.push({ id: `del:${job.delegated_by}->${job.id}`, source: job.delegated_by, target: job.id, kind: "delegate" });
    }
  }
  // Handbacks: validator → each job it sent back, counted over approved decisions.
  const handbacks = new Map<string, DagEdge>();
  for (const d of state.decisions) {
    if (d.kind !== "handback" || !d.approved) continue;
    const by = String(d.payload.by ?? "");
    const targets = (d.payload.targets as string[] | undefined) ?? [];
    for (const t of targets) {
      if (!byId.has(by) || !byId.has(t)) continue;
      const key = `hb:${by}->${t}`;
      const e = handbacks.get(key) ?? { id: key, source: by, target: t, kind: "handback" as const, count: 0 };
      e.count = (e.count ?? 0) + 1;
      handbacks.set(key, e);
    }
  }
  edges.push(...handbacks.values());
  return { positions, edges, depth };
}

/** The child run id of a job's latest attempt, if it has one. */
export function latestChildRunId(job: DynamicJob): string | undefined {
  for (let i = job.attempts.length - 1; i >= 0; i--) {
    const id = job.attempts[i].child_run_id;
    if (id) return id;
  }
  return undefined;
}
