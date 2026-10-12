"use client";

/**
 * Designer for a dynamic workflow: no canvas, only the orchestration config.
 *
 * The agent DAG does not exist until a run starts — the dispatcher (meta-LLM)
 * reads the request and the pool below and fills job slots with agents. What
 * the author decides here is *which* agents may take part (each with its own
 * addons: tools, datasources, MCP servers), how many jobs of each category the
 * run may hold, and how much of it a human signs off.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Save, Loader2, AlertTriangle, Bot, Lock, Workflow } from "lucide-react";
import { clsx } from "clsx";
import { listAgents, type AgentDefinition, type AgentAddonEntry } from "@/lib/api";
import type {
  DynamicStepConfig,
  EditableWorkflowDefinition,
  JobCategory,
  PoolAgent,
} from "@/lib/types";
import { JOB_CATEGORIES } from "@/lib/types";
import { dsFieldCls, dsFieldMonoCls } from "../fieldStyles";
import {
  AUTOMATION_MODES,
  CATEGORY_LABELS,
  DEFAULT_LIMITS,
  DEFAULT_SLOTS,
  DYNAMIC_STEP_ID,
  defaultDynamicConfig,
  dynamicConfigProblems,
  dynamicNode,
} from "./dynamicWorkflow";

export interface DynamicWorkflowEditorProps {
  workflow: EditableWorkflowDefinition;
  onSave?: (updated: EditableWorkflowDefinition) => void;
  onCancel?: () => void;
  saving?: boolean;
  saveError?: string | null;
  readonly?: boolean;
  hideHeader?: boolean;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1">{children}</label>;
}

/** Short badges for what an agent can reach — what the dispatcher sees too. */
export function addonBadges(addons: AgentAddonEntry[] | undefined): string[] {
  const out: string[] = [];
  for (const a of addons ?? []) {
    if (a.type === "mcp") {
      const on = Object.entries(a.servers).filter(([, v]) => v).map(([k]) => k);
      if (on.length) out.push(`MCP: ${on.join(", ")}`);
    } else if (a.type === "tools") {
      const on = Object.entries(a.tools).filter(([, v]) => v).map(([k]) => k);
      if (on.length) out.push(`Tools: ${on.join(", ")}`);
    } else if (a.type === "datasource") {
      out.push(`Datasource: ${a.source_id}${a.allowed_operations.length ? ` (${a.allowed_operations.length} ops)` : " (no ops)"}`);
    } else if (a.type === "s3") {
      out.push("S3 workspace");
    }
  }
  return out;
}

function NumberField({ value, onChange, min = 0, max, disabled, className }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; disabled?: boolean; className?: string;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(Math.max(min, parseInt(e.target.value || "0", 10)))}
      className={clsx(dsFieldCls, "w-20 py-1", className)}
    />
  );
}

function PoolAgentCard({ agent, entry, readonly, onToggle, onChange }: {
  agent: AgentDefinition;
  entry: PoolAgent | undefined;
  readonly?: boolean;
  onToggle: () => void;
  onChange: (next: PoolAgent) => void;
}) {
  const selected = !!entry;
  const badges = addonBadges(agent.addons);
  const cats = entry?.categories ?? [];
  return (
    <div
      className={clsx(
        "rounded-lg border p-3 transition-colors",
        selected ? "border-violet-600/70 bg-violet-950/30" : "border-slate-800 bg-slate-900 hover:border-slate-700",
      )}
      data-testid={`pool-agent-${agent.id}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Use ${agent.name || agent.id}`}
          checked={selected}
          disabled={readonly}
          onChange={onToggle}
          className="mt-1 accent-violet-500"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Bot className="w-3.5 h-3.5 text-violet-400 self-center" />
            <span className="text-sm font-medium text-slate-200">{agent.name || agent.id}</span>
            <span className="text-[10px] font-mono text-slate-500">{agent.id}</span>
          </div>
          {agent.description ? (
            <p className="text-xs text-slate-400 mt-1">{agent.description}</p>
          ) : (
            <p className="text-xs text-amber-400/90 mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              No description — the dispatcher picks agents by their description.
            </p>
          )}
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {badges.map((b) => (
                <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">{b}</span>
              ))}
            </div>
          )}
          {selected && entry && (
            <div className="flex flex-wrap items-center gap-4 mt-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">Max parallel</span>
                <NumberField
                  value={entry.max_instances ?? 1}
                  min={1}
                  max={32}
                  disabled={readonly}
                  onChange={(v) => onChange({ ...entry, max_instances: Math.max(1, v) })}
                />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-400 mr-1">May fill</span>
                {JOB_CATEGORIES.map((c) => {
                  const on = cats.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={readonly}
                      onClick={() => {
                        const next = on ? cats.filter((x) => x !== c) : [...cats, c];
                        onChange({ ...entry, categories: next });
                      }}
                      className={clsx(
                        "text-[11px] px-2 py-0.5 rounded-full border",
                        on ? "border-violet-500 bg-violet-800/50 text-violet-100" : "border-slate-700 text-slate-400 hover:text-slate-200",
                      )}
                    >
                      {CATEGORY_LABELS[c]}
                    </button>
                  );
                })}
                {cats.length === 0 && <span className="text-[10px] text-slate-500 ml-1">(any)</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function DynamicWorkflowEditor({ workflow, onSave, onCancel, saving, saveError, readonly, hideHeader }: DynamicWorkflowEditorProps) {
  const node = dynamicNode(workflow);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? "");
  const [useMetaLlm, setUseMetaLlm] = useState<boolean>(workflow.use_meta_llm ?? true);
  const [cfg, setCfg] = useState<DynamicStepConfig>(() => ({ ...defaultDynamicConfig(), ...(node?.dynamic ?? {}) }));
  const [agents, setAgents] = useState<AgentDefinition[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAgents()
      .then((a) => { if (!cancelled) setAgents(a); })
      .catch((e) => { if (!cancelled) setAgentsError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  const slots = { ...DEFAULT_SLOTS, ...(cfg.jobs ?? {}) };
  const limits = { ...DEFAULT_LIMITS, ...(cfg.limits ?? {}) };
  const problems = useMemo(() => dynamicConfigProblems(cfg), [cfg]);
  const poolById = useMemo(() => new Map(cfg.agent_pool.map((p) => [p.agent_id, p])), [cfg.agent_pool]);
  // Agents in the pool that no longer exist (deleted since) stay visible so they can be removed.
  const missing = useMemo(
    () => (agents ? cfg.agent_pool.filter((p) => !agents.some((a) => a.id === p.agent_id)) : []),
    [agents, cfg.agent_pool],
  );

  const patch = (p: Partial<DynamicStepConfig>) => setCfg((c) => ({ ...c, ...p }));
  const setPool = (pool: PoolAgent[]) => patch({ agent_pool: pool });
  const togglePool = (agentId: string) =>
    setPool(poolById.has(agentId) ? cfg.agent_pool.filter((p) => p.agent_id !== agentId) : [...cfg.agent_pool, { agent_id: agentId, max_instances: 1, categories: [] }]);
  const updatePool = (next: PoolAgent) => setPool(cfg.agent_pool.map((p) => (p.agent_id === next.agent_id ? next : p)));
  const setSlot = (cat: JobCategory, key: "min" | "max", v: number) =>
    patch({ jobs: { ...slots, [cat]: { ...slots[cat], [key]: v } } });

  function handleSave() {
    if (!onSave) return;
    const others = workflow.nodes.filter((n) => n.type !== "dynamic");
    const dyn = node ?? { id: DYNAMIC_STEP_ID, type: "dynamic" as const, name: "Orchestrator" };
    onSave({
      ...workflow,
      name,
      description,
      use_meta_llm: useMetaLlm,
      nodes: [...others, { ...dyn, dynamic: cfg }],
    });
  }

  const automation = AUTOMATION_MODES.find((m) => m.value === (cfg.automation ?? "plan"))!;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!hideHeader && (
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-slate-950">
          {onCancel && (
            <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400" title="Close">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <Workflow className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-slate-200 truncate">{name || workflow.id}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-900/50 border border-violet-700/60 text-violet-200">dynamic</span>
          {readonly && <Lock className="w-3.5 h-3.5 text-slate-500" />}
          <div className="flex-1" />
          {saveError && <span className="text-xs text-red-400 truncate max-w-md" title={saveError}>{saveError}</span>}
          {!readonly && onSave && (
            <button
              onClick={handleSave}
              disabled={saving || problems.length > 0}
              title={problems.join("\n") || "Save"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-4xl mx-auto space-y-4">
          {problems.length > 0 && !readonly && (
            <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 space-y-0.5" role="alert">
              {problems.map((p) => <div key={p}>• {p}</div>)}
            </div>
          )}

          <Section title="Workflow">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <input className={dsFieldCls} value={name} disabled={readonly} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>ID</Label>
                <input className={dsFieldMonoCls} value={workflow.id} disabled />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <textarea className={clsx(dsFieldCls, "min-h-[60px]")} value={description} disabled={readonly} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" className="accent-violet-500" checked={useMetaLlm} disabled={readonly} onChange={(e) => setUseMetaLlm(e.target.checked)} />
              Quality-gate every job's output with the meta-LLM (a rejected output is retried like a failure)
            </label>
          </Section>

          <Section title="Automation" hint="How much of the run a human signs off. Decisions that need sign-off pause the run until approved or rejected.">
            <select
              aria-label="Automation mode"
              className={clsx(dsFieldCls, "w-60")}
              value={cfg.automation ?? "plan"}
              disabled={readonly}
              onChange={(e) => patch({ automation: e.target.value as DynamicStepConfig["automation"] })}
            >
              {AUTOMATION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <p className="text-xs text-slate-400">{automation.description}</p>
          </Section>

          <Section
            title="Agent pool"
            hint="The agents the dispatcher may put into jobs. Configure each agent's tools, datasources and MCP servers on the agent itself; they appear here as badges and are what the dispatcher matches jobs against."
          >
            {agentsError && <p className="text-xs text-red-400">Could not load agents: {agentsError}</p>}
            {!agents && !agentsError && (
              <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading agents…</p>
            )}
            {agents && agents.length === 0 && <p className="text-xs text-slate-500">No agents defined yet. Create agents first.</p>}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {(agents ?? []).map((a) => (
                <PoolAgentCard
                  key={a.id}
                  agent={a}
                  entry={poolById.get(a.id)}
                  readonly={readonly}
                  onToggle={() => togglePool(a.id)}
                  onChange={updatePool}
                />
              ))}
            </div>
            {missing.map((m) => (
              <div key={m.agent_id} className="flex items-center gap-2 text-xs text-red-300">
                <AlertTriangle className="w-3 h-3" /> Agent <span className="font-mono">{m.agent_id}</span> is in the pool but no longer exists.
                {!readonly && <button className="underline" onClick={() => togglePool(m.agent_id)}>Remove</button>}
              </div>
            ))}
          </Section>

          <Section title="Jobs" hint="How many jobs of each category one run may hold. The dispatcher fills them; planning output is turned into execution and validation jobs.">
            <table className="text-xs text-slate-300">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left font-medium pr-6 pb-1">Category</th>
                  <th className="text-left font-medium pr-3 pb-1">Min</th>
                  <th className="text-left font-medium pb-1">Max</th>
                </tr>
              </thead>
              <tbody>
                {JOB_CATEGORIES.map((c) => (
                  <tr key={c}>
                    <td className="pr-6 py-1">{CATEGORY_LABELS[c]}</td>
                    <td className="pr-3 py-1">
                      <NumberField value={slots[c].min} min={c === "execution" ? 1 : 0} disabled={readonly} onChange={(v) => setSlot(c, "min", v)} />
                    </td>
                    <td className="py-1">
                      <NumberField value={slots[c].max} disabled={readonly} onChange={(v) => setSlot(c, "max", v)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-1">
              {([
                ["max_parallel", "Parallel jobs"],
                ["max_total_jobs", "Total jobs"],
                ["max_handbacks", "Handbacks / job"],
                ["max_delegations", "Delegations"],
                ["max_replans", "Re-plans"],
              ] as const).map(([k, label]) => (
                <div key={k}>
                  <Label>{label}</Label>
                  <NumberField
                    value={limits[k]}
                    min={k === "max_parallel" || k === "max_total_jobs" ? 1 : 0}
                    disabled={readonly}
                    onChange={(v) => patch({ limits: { ...limits, [k]: v } })}
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Workspace" hint="How parallel jobs share and hand over their work.">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="accent-violet-500"
                checked={!!cfg.repo}
                disabled={readonly}
                onChange={(e) => patch({ repo: e.target.checked ? { url: "", base_branch: "main", verify: [] } : null })}
              />
              Git repository — each execution job works on its own branch; the integration job merges them
            </label>
            {cfg.repo && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pl-6">
                <div className="md:col-span-2">
                  <Label>Repository URL</Label>
                  <input className={dsFieldMonoCls} value={cfg.repo.url} disabled={readonly} placeholder="https://github.com/org/repo.git"
                    onChange={(e) => patch({ repo: { ...cfg.repo!, url: e.target.value } })} />
                </div>
                <div>
                  <Label>Base branch</Label>
                  <input className={dsFieldMonoCls} value={cfg.repo.base_branch ?? "main"} disabled={readonly}
                    onChange={(e) => patch({ repo: { ...cfg.repo!, base_branch: e.target.value } })} />
                </div>
                <div className="md:col-span-3">
                  <Label>Verify commands (one per line)</Label>
                  <textarea className={clsx(dsFieldMonoCls, "min-h-[50px]")} disabled={readonly}
                    value={(cfg.repo.verify ?? []).join("\n")}
                    onChange={(e) => patch({ repo: { ...cfg.repo!, verify: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) } })} />
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="accent-violet-500"
                checked={!!cfg.shared_volume}
                disabled={readonly}
                onChange={(e) => patch({ shared_volume: e.target.checked ? { mount_point: "/shared", ttl: "6h" } : null })}
              />
              Shared volume (k8s) — every job mounts it; each job writes only under its own <code className="text-slate-400">jobs/&lt;id&gt;/</code>
            </label>
            {cfg.shared_volume && (
              <div className="grid grid-cols-2 gap-3 pl-6 max-w-md">
                <div>
                  <Label>Mount point</Label>
                  <input className={dsFieldMonoCls} value={cfg.shared_volume.mount_point} disabled={readonly}
                    onChange={(e) => patch({ shared_volume: { ...cfg.shared_volume!, mount_point: e.target.value } })} />
                </div>
                <div>
                  <Label>Keep for</Label>
                  <input className={dsFieldMonoCls} value={cfg.shared_volume.ttl ?? "6h"} disabled={readonly}
                    onChange={(e) => patch({ shared_volume: { ...cfg.shared_volume!, ttl: e.target.value } })} />
                </div>
              </div>
            )}
          </Section>

          <Section title="Dispatcher" hint="The meta-LLM that reads the request and assigns agents to jobs. Leave model empty to use META_LLM_MODEL.">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Provider</Label>
                <input className={dsFieldMonoCls} value={cfg.dispatcher_provider ?? ""} disabled={readonly} placeholder="default"
                  onChange={(e) => patch({ dispatcher_provider: e.target.value || null })} />
              </div>
              <div>
                <Label>Model</Label>
                <input className={dsFieldMonoCls} value={cfg.dispatcher_model ?? ""} disabled={readonly} placeholder="default"
                  onChange={(e) => patch({ dispatcher_model: e.target.value || null })} />
              </div>
              <div>
                <Label>Output key</Label>
                <input className={dsFieldMonoCls} value={cfg.output_key ?? ""} disabled={readonly} placeholder={DYNAMIC_STEP_ID}
                  onChange={(e) => patch({ output_key: e.target.value || null })} />
              </div>
            </div>
            <div>
              <Label>Instructions</Label>
              <textarea
                className={clsx(dsFieldCls, "min-h-[80px]")}
                disabled={readonly}
                placeholder="e.g. Always start with the researcher. Never run more than two coders on the same service."
                value={cfg.dispatcher_instructions ?? ""}
                onChange={(e) => patch({ dispatcher_instructions: e.target.value })}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
