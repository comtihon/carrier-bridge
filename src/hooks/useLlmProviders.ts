"use client";

import useSWR from "swr";
import { fetchLlmProviders, type LlmProviderInfo } from "@/lib/api";

export function useLlmProviders() {
  const { data, error, isLoading } = useSWR(
    "/llm/providers",
    fetchLlmProviders,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const providers: LlmProviderInfo[] = data?.providers ?? [];
  const defaultProvider = data?.default_provider ?? null;

  function getDefaultModel(name: string | undefined | null): string | undefined {
    if (!name) return undefined;
    return providers.find((p) => p.name === name)?.default_model;
  }

  return { providers, defaultProvider, getDefaultModel, error, isLoading };
}
