"use client";

import { useEffect, useState } from "react";
import { listRunners, listRuntimePools, type Runner, type RuntimePool } from "@/lib/api";
import { agentDisplayName } from "@/lib/runners";
import { runtimeFromKey, runtimeKey, type RuntimeSelection } from "@/lib/agentUsage";

/**
 * Where one use of an agent runs: the agent's own default runtime, a plain
 * runtime, one connected machine's ACP agent, or a runtime pool. Machines and
 * pools the caller cannot see are not offered (carrier's visibility rules);
 * a stored selection that is not in the lists stays shown as "(unknown)".
 */
export function RuntimeSelect({ value, onChange, disabled, className, label = "Runtime" }: {
  value: RuntimeSelection | null | undefined;
  onChange: (next: RuntimeSelection | undefined) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  const [runners, setRunners] = useState<Runner[] | null>(null);
  const [pools, setPools] = useState<RuntimePool[] | null>(null);

  useEffect(() => {
    let live = true;
    listRunners().then((r) => { if (live) setRunners(r); }).catch(() => { if (live) setRunners([]); });
    listRuntimePools().then((p) => { if (live) setPools(p); }).catch(() => { if (live) setPools([]); });
    return () => { live = false; };
  }, []);

  const key = runtimeKey(value);
  const options: Array<{ key: string; label: string; group: string }> = [
    { key: "default", label: "Agent default", group: "" },
    { key: "local", label: "local", group: "Runtime" },
    { key: "docker", label: "docker", group: "Runtime" },
    { key: "k8s", label: "k8s", group: "Runtime" },
  ];
  for (const r of runners ?? []) {
    for (const a of r.agents) {
      options.push({
        key: `runner:${r.id}:${a}`,
        label: `${r.name} · ${agentDisplayName(a)}${r.online ? "" : " (offline)"}`,
        group: "Machine",
      });
    }
  }
  for (const p of pools ?? []) {
    options.push({
      key: `pool:${p.id}`,
      label: `${p.name || p.id} (${p.online_count}/${p.member_count} online)`,
      group: "Runtime pool",
    });
  }
  const known = options.some((o) => o.key === key);
  const groups = ["Runtime", "Machine", "Runtime pool"];

  return (
    <select
      aria-label={label}
      value={key}
      disabled={disabled}
      onChange={(e) => onChange(runtimeFromKey(e.target.value))}
      className={className}
    >
      <option value="default">Agent default</option>
      {groups.map((g) => {
        const opts = options.filter((o) => o.group === g);
        if (!opts.length) return null;
        return (
          <optgroup key={g} label={g}>
            {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </optgroup>
        );
      })}
      {!known && key !== "default" && (
        <option value={key}>
          {value?.kind === "runner" && !value.acp_agent ? `${value.runner_id} · machine default` : `${key} (unknown)`}
        </option>
      )}
      {(runners === null || pools === null) && <option disabled value="__loading">loading…</option>}
    </select>
  );
}
