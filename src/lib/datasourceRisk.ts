/**
 * How dangerous a datasource is to run.
 *
 * For an HTTP source the verb answers it. For a GraphQL source it does not:
 * every call is a POST, so reading the verb painted every read-only query
 * amber with a `W`. There the query document decides — a mutation writes, a
 * query (including the shorthand `{ ... }` form) and a subscription read.
 *
 * One vocabulary for two things that must agree: the per-operation method
 * badge (one verb) and the aggregate risk badge (a set of verbs). Both read
 * from the maps below so a colour never means one thing in a list and another
 * on the canvas.
 *
 * Precedence is worst-wins — a single DELETE makes the whole set red, because
 * the badge answers "can running this destroy something?", not "what does it
 * mostly do?". An empty or unrecognised set is neutral, never red: not knowing
 * is not the same as knowing it deletes.
 */

export type RiskLevel = "read" | "write" | "delete" | "unknown";

/** HTTP verb → what it can do. Anything absent is `unknown`. */
const METHOD_LEVEL: Record<string, RiskLevel> = {
  GET: "read",
  HEAD: "read",
  OPTIONS: "read",
  POST: "write",
  PUT: "write",
  PATCH: "write",
  DELETE: "delete",
};

/** Worst-wins ordering; `unknown` sits below `read` so any known verb outranks it. */
const LEVEL_RANK: Record<RiskLevel, number> = {
  unknown: 0,
  read: 1,
  write: 2,
  delete: 3,
};

/** Read-only verbs are green, writes amber, deletes red, unknown slate. */
export const RISK_LEVEL_CLS: Record<RiskLevel, string> = {
  read: "text-emerald-300 bg-emerald-950/40 border-emerald-800",
  write: "text-amber-300 bg-amber-950/40 border-amber-800",
  delete: "text-red-300 bg-red-950/40 border-red-800",
  unknown: "text-slate-400 bg-slate-800/60 border-slate-700",
};

/** Shared badge geometry — small enough to sit inside a canvas node. */
export const RISK_BADGE_BASE_CLS =
  "shrink-0 px-1.5 py-0.5 rounded border font-mono text-[10px] leading-none tracking-wide";

/** Single-glyph label; the colour carries the meaning, the title spells it out. */
export const RISK_LEVEL_GLYPH: Record<RiskLevel, string> = {
  read: "R",
  write: "W",
  delete: "D",
  unknown: "?",
};

export function methodLevel(method?: string | null): RiskLevel {
  return METHOD_LEVEL[(method ?? "").trim().toUpperCase()] ?? "unknown";
}

/** Comments and string literals, stripped before looking for a keyword. */
const GQL_COMMENT = /#[^\n]*/g;
const GQL_STRING = /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"/g;
/** `mutation`, `mutation Name`, `mutation Name($x: Int)` — then the selection set. */
const GQL_MUTATION = /(?:^|[\s}])mutation\b\s*[A-Za-z_]\w*?\s*(?:\([^)]*\))?\s*\{/i;
const GQL_ANON_MUTATION = /(?:^|[\s}])mutation\s*\{/i;

/**
 * Whether a GraphQL document writes.
 *
 * A document with no operation keyword is the shorthand query form
 * (`{ projects { id } }`) and reads. `subscription` reads too — it streams,
 * it does not change anything. Comments and strings are stripped first so a
 * `# mutation` note or a `"mutation"` argument cannot make a query look like
 * a write.
 *
 * Mirrors `graphql_writes` in
 * `app/infrastructure/datasources/destructive.py` — the badge and the
 * approval gate have to give the same answer.
 */
export function graphqlWrites(query?: string | null): boolean {
  if (!query) return false;
  const stripped = query.replace(GQL_COMMENT, "").replace(GQL_STRING, '""');
  return GQL_MUTATION.test(stripped) || GQL_ANON_MUTATION.test(stripped);
}

/** The minimum an operation has to expose for its level to be decided. */
export type RiskOperation = {
  method?: string | null;
  /** GraphQL sources: the query document. */
  query?: string | null;
  /** Tri-state override; `true`/`false` beat everything below. */
  destructive?: boolean | null;
};

/**
 * What one operation can do, given the kind of source it belongs to.
 *
 * For GraphQL the verb says nothing — every call is a POST, so reading it
 * painted every read-only query amber with a `W`. The document is what
 * separates a query from a mutation, so that is what gets read.
 */
export function operationLevel(
  op: RiskOperation,
  kind?: string | null,
): RiskLevel {
  if (op.destructive === true) return "delete";
  if (op.destructive === false) return "read";
  if ((kind ?? "http") === "graphql") {
    return graphqlWrites(op.query) ? "write" : "read";
  }
  return methodLevel(op.method);
}

/** Worst level across a set of operations of one source. */
export function operationsRiskLevel(
  ops: readonly RiskOperation[],
  kind?: string | null,
): RiskLevel {
  let worst: RiskLevel = "unknown";
  for (const op of ops) {
    const level = operationLevel(op, kind);
    if (LEVEL_RANK[level] > LEVEL_RANK[worst]) worst = level;
  }
  return worst;
}

/** Why the badge is that colour, for the `title` tooltip. */
export function operationsRiskTitle(
  ops: readonly RiskOperation[],
  kind?: string | null,
): string {
  const level = operationsRiskLevel(ops, kind);
  const n = ops.length;
  if (level === "unknown") {
    return n === 0 ? "No operations — risk unknown" : "Unknown operations — risk unknown";
  }
  if (level === "read") {
    return n === 1 ? "Read-only" : `Read-only (${n} operations)`;
  }
  const count = ops.filter((o) => operationLevel(o, kind) === level).length;
  if (level === "delete") {
    return count === 1 ? "Contains a delete operation" : `Contains ${count} delete operations`;
  }
  return count === 1 ? "1 write operation" : `${count} write operations`;
}
