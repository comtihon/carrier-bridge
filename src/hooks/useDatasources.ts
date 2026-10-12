"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { listDatasources, type DataSourceDefinition } from "@/lib/api";

/** Stable identity so the derived map is not rebuilt while the list loads. */
const NO_DATASOURCES: DataSourceDefinition[] = [];

/**
 * The datasource list behind one shared SWR key.
 *
 * Canvas nodes need their datasource's operations to colour a risk badge, and
 * there can be many such nodes on one graph — one SWR key means one request no
 * matter how many of them mount, and the editor's own list stays in agreement
 * with what the nodes show.
 */
export function useDatasources() {
  const { data, error, isLoading, mutate } = useSWR<DataSourceDefinition[]>(
    "/datasources",
    listDatasources,
    { revalidateOnFocus: false },
  );

  const datasources = data ?? NO_DATASOURCES;

  /** id → definition, for resolving a node's `source` to its operations. */
  const byId = useMemo(
    () => new Map(datasources.map((d) => [d.id, d])),
    [datasources],
  );

  return { datasources, byId, error, isLoading, reload: mutate };
}
