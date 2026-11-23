"use client";

/**
 * Shared company memory (gbrain): the status icon beside the backend status,
 * and the access picker used by the agent and workflow editors.
 *
 * Access is set twice — on the agent and on the workflow — and an agent step
 * gets the lower of the two, so the hints say which side caps which.
 */

import React, { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { clsx } from "clsx";
import { checkBrainHealth, type BrainAccess, type BrainHealth } from "@/lib/api";

export const BRAIN_ACCESS_OPTIONS: Array<{ value: BrainAccess; label: string }> = [
  { value: "none",  label: "None" },
  { value: "read",  label: "Read only" },
  { value: "write", label: "Read & write" },
];

/** Normalise whatever the backend stored (or left out) to a valid level. */
export function brainAccessOf(v: unknown): BrainAccess {
  return v === "read" || v === "write" ? v : "none";
}

export const BRAIN_REFRESH_MS = 60_000;

/**
 * The brain status, fetched on mount and — with `refreshMs` — re-checked on an
 * interval. `null` until the first answer arrives.
 */
export function useBrainHealth(refreshMs?: number): BrainHealth | null {
  const [health, setHealth] = useState<BrainHealth | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => {
      checkBrainHealth().then((h) => { if (live) setHealth(h); });
    };
    check();
    const timer = refreshMs ? setInterval(check, refreshMs) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [refreshMs]);
  return health;
}

function present(health: BrainHealth): { label: string; title: string; color: string } {
  switch (health.status) {
    case "ok":
      return { label: "Brain connected", title: "Brain: connected", color: "text-emerald-400" };
    case "unavailable":
      return {
        label: "Brain unavailable",
        title: health.detail ? `Brain: unavailable — ${health.detail}` : "Brain: unavailable",
        color: "text-red-400",
      };
    case "not_configured":
      return { label: "Brain not configured", title: "Brain: not configured", color: "text-slate-500" };
    default:
      return { label: "Brain unknown", title: "Brain: status unknown", color: "text-slate-500" };
  }
}

export function BrainHealthIndicator({ compact = false }: { compact?: boolean }) {
  const health = useBrainHealth(BRAIN_REFRESH_MS);
  if (health === null) return null;
  const { label, title, color } = present(health);
  if (compact) {
    return (
      <span title={title} data-testid="brain-health" data-status={health.status}
        className="flex items-center justify-center w-9 h-9">
        <Brain className={clsx("w-3.5 h-3.5", color)} />
      </span>
    );
  }
  return (
    <div title={title} data-testid="brain-health" data-status={health.status} className="flex items-center gap-1.5">
      <Brain className={clsx("w-3.5 h-3.5", color)} />
      <span className={clsx("text-[10px]", color)}>{label}</span>
    </div>
  );
}

/**
 * None / Read only / Read & write, with a one-line hint. Stays editable when
 * gbrain is not configured — the setting is stored for when it is.
 */
export function BrainAccessSelect({
  value, onChange, hint, disabled, className, hintClassName,
}: {
  value: BrainAccess;
  onChange: (v: BrainAccess) => void;
  hint: string;
  disabled?: boolean;
  className?: string;
  hintClassName?: string;
}) {
  const health = useBrainHealth();
  const notConfigured = health?.status === "not_configured";
  return (
    <>
      <select
        aria-label="Brain access"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(brainAccessOf(e.target.value))}
        className={clsx(className, notConfigured && "opacity-60")}
      >
        {BRAIN_ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <p className={clsx("text-[10px] text-slate-500", hintClassName)}>
        {hint}
        {notConfigured && <span className="block text-slate-600">gbrain not configured on this backend</span>}
      </p>
    </>
  );
}
