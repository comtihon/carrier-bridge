"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  listAgentTools, listDatasources, listMcpIntegrations,
  type AgentAddonEntry, type AgentToolInfo, type DataSourceDefinition, type McpIntegration,
} from "@/lib/api";

type AddonType = AgentAddonEntry["type"];

const ADDON_LABELS: Record<AddonType, string> = {
  mcp: "MCP servers",
  tools: "Tools",
  s3: "Workspace storage (S3/GCS)",
  datasource: "Data source",
};

function blank(type: AddonType): AgentAddonEntry {
  switch (type) {
    case "mcp": return { type: "mcp", servers: {} };
    case "tools": return { type: "tools", tools: {} };
    case "s3": return { type: "s3", bucket: "", path: "" };
    case "datasource": return { type: "datasource", source_id: "", allowed_operations: [] };
  }
}

/**
 * Edits a list of agent addons: MCP servers, tools, workspace storage and data
 * sources (with the operations granted — a ticked write IS a granted write).
 *
 * Used for an agent's own addons, and for one workflow's use of an agent
 * (`overrides`): there an addon replaces the agent's own of the same type, and
 * a data source addon replaces the agent's grant for that source only.
 */
export function AddonsEditor({ value, onChange, disabled, overrides, workflowId }: {
  value: AgentAddonEntry[];
  onChange: (next: AgentAddonEntry[]) => void;
  disabled?: boolean;
  /** Editing per-use overrides rather than the agent's own addons. */
  overrides?: boolean;
  /** Offer the data sources granted to this workflow too. */
  workflowId?: string | null;
}) {
  const [mcp, setMcp] = useState<McpIntegration[] | null>(null);
  const [tools, setTools] = useState<AgentToolInfo[] | null>(null);
  const [sources, setSources] = useState<DataSourceDefinition[] | null>(null);
  const [adding, setAdding] = useState<AddonType | "">("");

  useEffect(() => {
    let live = true;
    listMcpIntegrations().then((x) => { if (live) setMcp(x); }).catch(() => { if (live) setMcp([]); });
    listAgentTools().then((x) => { if (live) setTools(x); }).catch(() => { if (live) setTools([]); });
    listDatasources(workflowId).then((x) => { if (live) setSources(x); }).catch(() => { if (live) setSources([]); });
    return () => { live = false; };
  }, [workflowId]);

  const update = (i: number, next: AgentAddonEntry) => onChange(value.map((a, j) => (j === i ? next : a)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  // One of each kind, except data sources (one per source).
  const addable = (Object.keys(ADDON_LABELS) as AddonType[]).filter(
    (t) => t === "datasource" || !value.some((a) => a.type === t),
  );
  const field = "w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-500";

  return (
    <div className="space-y-2" data-testid="addons-editor">
      {value.length === 0 && (
        <p className="text-[11px] text-slate-500">
          {overrides ? "No overrides: the agent's own addons apply." : "No addons."}
        </p>
      )}
      {value.map((addon, i) => (
        <div key={`${addon.type}-${i}`} className="rounded-lg border border-slate-700 bg-slate-900/60 p-2 space-y-1.5"
          data-testid={`addon-${addon.type}`}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-300 flex-1">{ADDON_LABELS[addon.type]}</span>
            {!disabled && (
              <button type="button" aria-label={`Remove ${ADDON_LABELS[addon.type]} addon`} onClick={() => remove(i)}
                className="p-0.5 rounded text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
            )}
          </div>
          {addon.type === "s3" && (
            <div className="grid grid-cols-2 gap-1.5">
              <input aria-label="Bucket" placeholder="bucket" value={addon.bucket} disabled={disabled}
                onChange={(e) => update(i, { ...addon, bucket: e.target.value })} className={field} />
              <input aria-label="Path" placeholder="path, e.g. workspaces/{workflow_id}" value={addon.path} disabled={disabled}
                onChange={(e) => update(i, { ...addon, path: e.target.value })} className={field} />
            </div>
          )}
          {addon.type === "mcp" && (
            <Checks
              names={(mcp ?? []).map((m) => m.name)}
              loading={mcp === null}
              checked={addon.servers}
              disabled={disabled}
              onChange={(servers) => update(i, { ...addon, servers })}
            />
          )}
          {addon.type === "tools" && (
            <Checks
              names={(tools ?? []).map((t) => t.name)}
              labels={Object.fromEntries((tools ?? []).map((t) => [t.name, t.label || t.name]))}
              loading={tools === null}
              checked={addon.tools}
              disabled={disabled}
              onChange={(t) => update(i, { ...addon, tools: t })}
            />
          )}
          {addon.type === "datasource" && (
            <DatasourceAddonFields
              addon={addon}
              sources={sources}
              disabled={disabled}
              taken={value.flatMap((a, j) => (a.type === "datasource" && j !== i ? [a.source_id] : []))}
              onChange={(next) => update(i, next)}
              field={field}
            />
          )}
        </div>
      ))}
      {!disabled && addable.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select aria-label="Addon type" value={adding} onChange={(e) => setAdding(e.target.value as AddonType | "")}
            className={`${field} w-auto`}>
            <option value="">Add addon…</option>
            {addable.map((t) => <option key={t} value={t}>{ADDON_LABELS[t]}</option>)}
          </select>
          <button type="button" disabled={!adding}
            onClick={() => { if (adding) { onChange([...value, blank(adding)]); setAdding(""); } }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-sky-800 text-[11px] text-white hover:bg-sky-700 disabled:opacity-40">
            <Plus className="w-3 h-3" />Add
          </button>
        </div>
      )}
    </div>
  );
}

function Checks({ names, labels, checked, onChange, disabled, loading }: {
  names: string[];
  labels?: Record<string, string>;
  checked: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  // Names stored on the addon but no longer offered stay visible so they can be unticked.
  const all = [...names, ...Object.keys(checked).filter((n) => !names.includes(n))];
  if (loading) return <p className="text-[10px] text-slate-500">loading…</p>;
  if (!all.length) return <p className="text-[10px] text-slate-500">None available.</p>;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {all.map((n) => (
        <label key={n} className="flex items-center gap-1 text-[11px] text-slate-300">
          <input type="checkbox" checked={!!checked[n]} disabled={disabled}
            onChange={(e) => onChange({ ...checked, [n]: e.target.checked })} />
          {labels?.[n] ?? n}
        </label>
      ))}
    </div>
  );
}

function DatasourceAddonFields({ addon, sources, taken, disabled, onChange, field }: {
  addon: Extract<AgentAddonEntry, { type: "datasource" }>;
  sources: DataSourceDefinition[] | null;
  taken: string[];
  disabled?: boolean;
  onChange: (next: Extract<AgentAddonEntry, { type: "datasource" }>) => void;
  field: string;
}) {
  const source = sources?.find((s) => s.id === addon.source_id) ?? null;
  const ops = source?.operations ?? [];
  const opNames = [...ops.map((o) => o.name), ...addon.allowed_operations.filter((n) => !ops.some((o) => o.name === n))];
  return (
    <div className="space-y-1.5">
      <select aria-label="Data source" value={addon.source_id} disabled={disabled}
        onChange={(e) => onChange({ ...addon, source_id: e.target.value, allowed_operations: [] })} className={field}>
        <option value="">{sources ? "— select a data source —" : "loading…"}</option>
        {(sources ?? []).filter((s) => s.id === addon.source_id || !taken.includes(s.id)).map((s) => (
          <option key={s.id} value={s.id}>{s.name || s.id}</option>
        ))}
        {addon.source_id && sources && !source && <option value={addon.source_id}>{addon.source_id} (unknown)</option>}
      </select>
      {addon.source_id && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {opNames.length === 0 && <span className="text-[10px] text-slate-500">No operations.</span>}
          {opNames.map((n) => {
            const method = ops.find((o) => o.name === n)?.method;
            const on = addon.allowed_operations.includes(n);
            return (
              <label key={n} className="flex items-center gap-1 text-[11px] text-slate-300" title={method ? `${method} — ticking a write grants it` : undefined}>
                <input type="checkbox" checked={on} disabled={disabled}
                  onChange={() => onChange({
                    ...addon,
                    allowed_operations: on ? addon.allowed_operations.filter((x) => x !== n) : [...addon.allowed_operations, n],
                  })} />
                <span className="font-mono">{n}</span>
                {method && method.toUpperCase() !== "GET" && <span className="text-[9px] text-amber-400">{method}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
