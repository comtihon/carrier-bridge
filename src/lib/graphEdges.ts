/**
 * The one place the canvas decides what edges a step list has.
 *
 * This rule used to be written out three times — here in the dashboard's load
 * path, again in the editor's YAML parser, and a third time in the backend's
 * graph builder. Three copies of a rule is three chances to disagree, and they
 * did: the backend gave a step with no declared destination a fall-through edge
 * to its neighbour in the array, while both front-end copies suppressed that
 * edge whenever the neighbour was already some other step's target. So the
 * canvas drew one graph and the engine ran another, with nothing on screen to
 * show for it. A workflow wired its own tail back into a branch that way and
 * posted the same Slack digest eleven times on a single cron tick.
 *
 * The backend now resolves fall-through into an explicit `next` when a
 * definition is saved, so a stored step list says outright where every step
 * goes and the last branch below rarely fires. It still has to be right, for
 * definitions written before that and for YAML pasted into the editor, and it
 * mirrors the engine: fall through to the next step, no exceptions carved out.
 * Deciding an edge "looks wrong" and dropping it is what broke `code-review-loop`,
 * whose revision loop is a fall-through into a step its router also targets.
 */

export type DerivedEdge = {
  id: string;
  source: string;
  target: string;
  data?: {
    condition?: string;
    wait_seconds?: number;
    waypoints?: Array<{ x: number; y: number }>;
  };
};

export type UiEdgeLayout = Record<string, { waypoints: Array<{ x: number; y: number }> }>;

/** Marker a step uses to say it terminates; never a step id. */
export const END_MARKER = "END";

/**
 * Derive the canvas edges for `rawSteps`, in the order `nodeIds` gives them.
 *
 * `nodeIds` is passed separately because the caller has already mapped raw
 * steps to nodes and may have dropped malformed entries.
 */
export function deriveEdges(
  rawSteps: Array<Record<string, unknown>>,
  nodeIds: string[],
  uiEdgeLayout?: UiEdgeLayout,
): DerivedEdge[] {
  const known = new Set(nodeIds);
  const edges: DerivedEdge[] = [];

  const layoutFor = (source: string, target: string) => {
    const waypoints = uiEdgeLayout?.[`${source}:${target}`]?.waypoints;
    return waypoints?.length ? { waypoints } : undefined;
  };

  for (let i = 0; i < nodeIds.length; i++) {
    const source = nodeIds[i];
    const raw = rawSteps[i] ?? {};

    if (raw.type === "parallel" && Array.isArray(raw.targets)) {
      for (const target of raw.targets as string[]) {
        if (!known.has(target)) continue;
        edges.push({
          id: `e_${source}_${target}_${edges.length}`,
          source,
          target,
          data: layoutFor(source, target),
        });
      }
      continue;
    }

    if (Array.isArray(raw.routes)) {
      for (const route of raw.routes as Array<Record<string, unknown>>) {
        const target = typeof route.next === "string" ? route.next : null;
        if (!target || !known.has(target)) continue;
        const condition = typeof route.when === "string" && route.when ? route.when : undefined;
        const wait =
          typeof route.wait_seconds === "number" && route.wait_seconds > 0
            ? route.wait_seconds
            : undefined;
        const layout = layoutFor(source, target);
        const data = {
          ...(condition ? { condition } : {}),
          ...(wait !== undefined ? { wait_seconds: wait } : {}),
          ...(layout ?? {}),
        };
        edges.push({
          id: `e_${source}_${target}_${edges.length}`,
          source,
          target,
          ...(Object.keys(data).length > 0 ? { data } : {}),
        });
      }
      continue;
    }

    if (typeof raw.next === "string") {
      // A `next` that names no step — `END` above all — is a termination, not
      // an edge. Returning here is what makes it stick: the step has spoken, so
      // it must not also collect the fall-through below.
      if (known.has(raw.next)) {
        edges.push({
          id: `e_${source}_${raw.next}`,
          source,
          target: raw.next,
          data: layoutFor(source, raw.next),
        });
      }
      continue;
    }

    // Nothing declared: fall through to the next step, exactly as the engine does.
    if (i < nodeIds.length - 1) {
      const target = nodeIds[i + 1];
      edges.push({
        id: `e_${source}_${target}`,
        source,
        target,
        data: layoutFor(source, target),
      });
    }
  }

  return edges;
}
