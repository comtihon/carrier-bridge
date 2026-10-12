"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { listEvents, type EventDefinition } from "@/lib/api";

/** Stable identity so the derived map is not rebuilt while the list loads. */
const NO_EVENTS: EventDefinition[] = [];

/**
 * The events list behind one shared SWR key. The trigger's property fields and
 * the canvas labels have to agree about which events exist — including an event
 * created mid-session — and a per-caller fetch leaves them disagreeing until
 * the next mount.
 */
export function useEvents() {
  const { data, error, isLoading, mutate } = useSWR<EventDefinition[]>(
    "/events",
    listEvents,
    { revalidateOnFocus: false },
  );

  const events = data ?? NO_EVENTS;

  /** id → what to show for it; an unnamed event is shown by its id. */
  const eventNames = useMemo(
    () => new Map(events.map((e) => [e.id, (e.name ?? "").trim() || e.id])),
    [events],
  );

  return { events, eventNames, error, isLoading, reload: mutate };
}
