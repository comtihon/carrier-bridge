"use client";

import { clsx } from "clsx";
import { useDatasources } from "@/hooks/useDatasources";
import {
  RISK_BADGE_BASE_CLS,
  RISK_LEVEL_CLS,
  RISK_LEVEL_GLYPH,
  operationsRiskLevel,
  operationsRiskTitle,
  type RiskOperation,
} from "@/lib/datasourceRisk";

/**
 * Aggregate risk of a set of datasource operations, as one small badge.
 *
 * Pass whatever set is relevant to the surface: every operation for a
 * datasource shown as an entity, or the single selected one for a node bound
 * to an operation. `kind` matters — a GraphQL operation's verb is always POST,
 * so its level comes from the query document instead.
 */
export function DatasourceRiskBadge({
  operations,
  kind,
  className,
}: {
  operations: readonly RiskOperation[];
  kind?: string | null;
  className?: string;
}) {
  const level = operationsRiskLevel(operations, kind);
  return (
    <span
      title={operationsRiskTitle(operations, kind)}
      className={clsx(RISK_BADGE_BASE_CLS, RISK_LEVEL_CLS[level], className)}
    >
      {RISK_LEVEL_GLYPH[level]}
    </span>
  );
}

/**
 * The same badge for a canvas node, which knows a datasource id and (usually)
 * one selected operation but not the methods behind them.
 *
 * A node runs exactly one operation, so that operation's verb is the honest
 * answer. Before one is picked the node could still end up running any of them,
 * so it falls back to the whole datasource — which can only over-state the
 * risk, never under-state it.
 *
 * The list comes from a shared SWR key, so a graph of twenty datasource nodes
 * still costs one request.
 */
export function NodeDatasourceRiskBadge({
  sourceId,
  operation,
  className,
}: {
  sourceId?: string | null;
  operation?: string | null;
  className?: string;
}) {
  const { byId, isLoading } = useDatasources();
  const ds = sourceId ? byId.get(sourceId) : undefined;

  // Nothing to say yet — a slate "?" while the list loads would read as a real
  // verdict, so render nothing at all.
  if (!ds && (isLoading || !sourceId)) return null;

  const ops = ds?.operations ?? [];
  const selected = operation ? ops.find((o) => o.name === operation) : undefined;

  return (
    <DatasourceRiskBadge
      operations={selected ? [selected] : ops}
      kind={ds?.kind}
      className={className}
    />
  );
}
