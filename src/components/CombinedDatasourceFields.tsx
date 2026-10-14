"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Code, Database, Layers, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import type { CombinedPart, EditableNodeConfig } from "@/lib/types";
import type { DataSourceDefinition } from "@/lib/api";
import { useDatasources } from "@/hooks/useDatasources";
import { combinedPartsProblem, outputPartId, partKind } from "@/lib/combinedDatasource";
import { CodeEditor } from "./CodeEditor";

const inputCls =
  "w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 " +
  "placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors disabled:opacity-60";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-600 leading-relaxed">{hint}</p>}
    </div>
  );
}

/** A part id not yet used in `parts`, e.g. `fetch_2`. */
export function nextPartId(parts: CombinedPart[], prefix: string): string {
  const used = new Set(parts.map((p) => p.id));
  let n = parts.length + 1;
  while (used.has(`${prefix}_${n}`)) n += 1;
  return `${prefix}_${n}`;
}

export function newPart(kind: "data_source" | "python" | "combined_datasource", parts: CombinedPart[]): CombinedPart {
  switch (kind) {
    case "data_source":
      return { id: nextPartId(parts, "fetch"), type: "data_source", source: "", operation: "", params: {} };
    case "python":
      return { id: nextPartId(parts, "py"), type: "python", code: "output = {}" };
    case "combined_datasource":
      return { id: nextPartId(parts, "combined"), type: "combined_datasource", parts: [] };
  }
}

/** Parse the JSON-mode text; returns parts or an error sentence. */
export function parsePartsJson(text: string): { parts?: CombinedPart[]; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!Array.isArray(parsed)) return { error: "Parts must be a JSON array" };
  const problem = combinedPartsProblem(parsed as CombinedPart[]);
  if (problem) return { error: problem };
  return { parts: parsed as CombinedPart[] };
}

/**
 * Properties-panel fields for a `combined_datasource` step: output key, which
 * part is the output, and the ordered parts — edited structurally (add,
 * reorder, delete, per-type fields, nested combined) or as raw JSON.
 */
export function CombinedDatasourceFields({
  config,
  onChange,
  readonly = false,
}: {
  config: EditableNodeConfig;
  onChange: (patch: Partial<EditableNodeConfig>) => void;
  readonly?: boolean;
}) {
  const { datasources } = useDatasources();
  const parts = config.parts ?? [];
  const [mode, setMode] = useState<"structured" | "json">("structured");
  const [jsonText, setJsonText] = useState(() => JSON.stringify(parts, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const problem = combinedPartsProblem(parts, config.output_part);

  const switchMode = (next: "structured" | "json") => {
    if (next === "json") {
      setJsonText(JSON.stringify(parts, null, 2));
      setJsonError(null);
    }
    setMode(next);
  };

  const onJson = (text: string) => {
    setJsonText(text);
    const res = parsePartsJson(text);
    if (res.error) {
      setJsonError(res.error);
      return;
    }
    setJsonError(null);
    const patch: Partial<EditableNodeConfig> = { parts: res.parts };
    // A JSON edit that removes the chosen output part must not leave a dangling id.
    if (config.output_part && !res.parts!.some((p) => p.id === config.output_part)) patch.output_part = undefined;
    onChange(patch);
  };

  return (
    <div className="space-y-3" data-testid="combined-fields">
      <Field label="Step ID">
        <input type="text" value={config.id} readOnly disabled className={`${inputCls} font-mono`} />
      </Field>
      <Field label="Output Key" hint="State key the step output is written to">
        <input
          type="text"
          value={config.output_key ?? ""}
          onChange={(e) => onChange({ output_key: e.target.value || undefined })}
          placeholder="e.g. invoice_candidates"
          disabled={readonly}
          className={`${inputCls} font-mono`}
          aria-label="Output key"
        />
      </Field>
      <OutputSelect
        parts={parts}
        value={config.output_part}
        onChange={(v) => onChange({ output_part: v })}
        readonly={readonly}
      />

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 flex-1">
            Parts ({parts.length}) — run in order
          </span>
          <div className="flex rounded-md border border-slate-700 overflow-hidden text-[10px]">
            {(["structured", "json"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={clsx("px-2 py-0.5", mode === m ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200")}
              >
                {m === "structured" ? "Form" : "JSON"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Later parts read earlier ones by id: params templates like{" "}
          <code className="text-slate-400">{"{cand[project_ids]}"}</code>, python{" "}
          <code className="text-slate-400">parts[&quot;id&quot;]</code> or{" "}
          <code className="text-slate-400">stream: id</code>. A list value for a
          non-array param calls the operation once per item.
        </p>

        {mode === "json" ? (
          <div className="space-y-1">
            <textarea
              value={jsonText}
              onChange={(e) => onJson(e.target.value)}
              rows={14}
              spellCheck={false}
              disabled={readonly}
              aria-label="Parts JSON"
              className={`${inputCls} resize-y font-mono text-[11px] leading-relaxed`}
            />
            {jsonError && <p className="text-[10px] text-red-400" data-testid="parts-json-error">{jsonError}</p>}
          </div>
        ) : (
          <PartsEditor
            parts={parts}
            onChange={(next) => onChange({ parts: next })}
            datasources={datasources}
            readonly={readonly}
            depth={0}
          />
        )}
        {problem && mode === "structured" && (
          <p className="text-[10px] text-red-400" data-testid="parts-problem">{problem}</p>
        )}
      </div>
    </div>
  );
}

function OutputSelect({
  parts,
  value,
  onChange,
  readonly,
}: {
  parts: CombinedPart[];
  value?: string;
  onChange: (v: string | undefined) => void;
  readonly: boolean;
}) {
  const last = parts.length ? parts[parts.length - 1].id : undefined;
  return (
    <Field label="Output part" hint="Whose output becomes the step output">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={readonly}
        className={`${inputCls} font-mono`}
        aria-label="Output part"
      >
        <option value="">{last ? `last part (${last})` : "last part"}</option>
        {parts.map((p, i) => (
          <option key={`${p.id}-${i}`} value={p.id}>{p.id}</option>
        ))}
        {value && !parts.some((p) => p.id === value) && <option value={value}>{value} (missing)</option>}
      </select>
    </Field>
  );
}

const KIND_ICON = { datasource: Database, python: Code, combined: Layers, unknown: Database } as const;

export function PartsEditor({
  parts,
  onChange,
  datasources,
  readonly,
  depth,
}: {
  parts: CombinedPart[];
  onChange: (parts: CombinedPart[]) => void;
  datasources: DataSourceDefinition[];
  readonly: boolean;
  depth: number;
}) {
  const update = (i: number, patch: Partial<CombinedPart>) => {
    const next = parts.slice();
    next[i] = { ...next[i], ...patch };
    // Drop keys explicitly cleared so the saved part stays minimal.
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[i][k];
    onChange(next);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= parts.length) return;
    const next = parts.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(parts.filter((_, k) => k !== i));
  const add = (kind: "data_source" | "python" | "combined_datasource") => onChange([...parts, newPart(kind, parts)]);

  return (
    <div className={clsx("space-y-1.5", depth > 0 && "pl-2 border-l border-slate-700")} data-testid={`parts-editor-${depth}`}>
      {parts.length === 0 && <p className="text-[10px] text-slate-500 italic">No parts yet.</p>}
      {parts.map((part, i) => (
        <PartCard
          key={i}
          part={part}
          index={i}
          earlier={parts.slice(0, i).map((p) => p.id)}
          count={parts.length}
          onPatch={(patch) => update(i, patch)}
          onMove={(d) => move(i, d)}
          onRemove={() => remove(i)}
          datasources={datasources}
          readonly={readonly}
          depth={depth}
        />
      ))}
      {!readonly && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <AddBtn onClick={() => add("data_source")} icon={<Database className="w-3 h-3" />} label="Datasource" />
          <AddBtn onClick={() => add("python")} icon={<Code className="w-3 h-3" />} label="Python" />
          <AddBtn onClick={() => add("combined_datasource")} icon={<Layers className="w-3 h-3" />} label="Combined" />
        </div>
      )}
    </div>
  );
}

function AddBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-[10px] text-sky-400 hover:text-sky-300 hover:border-slate-500"
    >
      + {icon} {label}
    </button>
  );
}

function PartCard({
  part,
  index,
  earlier,
  count,
  onPatch,
  onMove,
  onRemove,
  datasources,
  readonly,
  depth,
}: {
  part: CombinedPart;
  index: number;
  earlier: string[];
  count: number;
  onPatch: (patch: Partial<CombinedPart>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  datasources: DataSourceDefinition[];
  readonly: boolean;
  depth: number;
}) {
  const kind = partKind(part);
  const Icon = KIND_ICON[kind];
  const [nestedOpen, setNestedOpen] = useState(false);
  const ds = datasources.find((d) => d.id === part.source);
  const ops = ds?.operations ?? [];
  const nested = Array.isArray(part.parts) ? part.parts : [];

  return (
    <div className="rounded-md border border-slate-700 bg-slate-800/50 p-2 space-y-1.5" data-testid="part-card" data-part-id={part.id}>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-slate-600 w-3 text-right">{index + 1}.</span>
        <Icon className="w-3 h-3 text-slate-400 shrink-0" />
        <input
          type="text"
          value={part.id}
          onChange={(e) => onPatch({ id: e.target.value })}
          disabled={readonly}
          aria-label="Part id"
          className={`${inputCls} font-mono !py-0.5 flex-1`}
        />
        <button type="button" title="Move up" disabled={readonly || index === 0} onClick={() => onMove(-1)}
          className="p-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
        <button type="button" title="Move down" disabled={readonly || index === count - 1} onClick={() => onMove(1)}
          className="p-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
        <button type="button" title="Delete part" disabled={readonly} onClick={onRemove}
          className="p-0.5 text-slate-500 hover:text-red-400 disabled:opacity-30"><Trash2 className="w-3 h-3" /></button>
      </div>

      {kind === "datasource" && (
        <>
          <select
            value={part.source ?? ""}
            onChange={(e) => onPatch({ source: e.target.value, operation: "" })}
            disabled={readonly}
            aria-label="Source"
            className={`${inputCls} font-mono`}
          >
            <option value="">— datasource —</option>
            {datasources.map((d) => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}
            {part.source && !ds && <option value={part.source}>{part.source}</option>}
          </select>
          <select
            value={part.operation ?? ""}
            onChange={(e) => onPatch({ operation: e.target.value })}
            disabled={readonly}
            aria-label="Operation"
            className={`${inputCls} font-mono`}
          >
            <option value="">— operation —</option>
            {ops.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
            {part.operation && !ops.some((o) => o.name === part.operation) && (
              <option value={part.operation}>{part.operation}</option>
            )}
          </select>
          <JsonObjectInput
            label="Params (JSON)"
            value={part.params ?? {}}
            onChange={(v) => onPatch({ params: v })}
            readonly={readonly}
          />
        </>
      )}

      {kind === "python" && (
        <>
          <input
            type="text"
            value={part.script_id ?? ""}
            onChange={(e) => onPatch({ script_id: e.target.value || undefined })}
            placeholder="script_id (library) — blank = inline code"
            disabled={readonly}
            aria-label="Script id"
            className={`${inputCls} font-mono`}
          />
          {!part.script_id && (
            <CodeEditor
              value={part.code ?? ""}
              onChange={(code) => onPatch({ code })}
              language="python"
              readOnly={readonly}
              minHeight={80}
              placeholder={'output = {"ids": parts["prev"]}'}
            />
          )}
          <select
            value={part.stream ?? ""}
            onChange={(e) => onPatch({ stream: e.target.value || undefined })}
            disabled={readonly}
            aria-label="Stream"
            className={`${inputCls} font-mono`}
          >
            <option value="">no stream</option>
            {earlier.map((id) => <option key={id} value={id}>stream: {id}</option>)}
            {part.stream && !earlier.includes(part.stream) && <option value={part.stream}>stream: {part.stream}</option>}
          </select>
        </>
      )}

      {kind === "combined" && (
        <>
          <button
            type="button"
            onClick={() => setNestedOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
            aria-expanded={nestedOpen}
          >
            {nestedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {nested.length} part{nested.length === 1 ? "" : "s"}
            {" · output "}
            <span className="font-mono">{outputPartId(nested, part.output) ?? "—"}</span>
          </button>
          {nestedOpen && (
            <>
              <OutputSelect
                parts={nested}
                value={part.output}
                onChange={(v) => onPatch({ output: v })}
                readonly={readonly}
              />
              <PartsEditor
                parts={nested}
                onChange={(next) => onPatch({ parts: next })}
                datasources={datasources}
                readonly={readonly}
                depth={depth + 1}
              />
            </>
          )}
        </>
      )}

      {kind === "unknown" && (
        <p className="text-[10px] text-slate-500">
          Unknown part type <span className="font-mono">{String(part.type)}</span> — edit it in JSON mode.
        </p>
      )}
    </div>
  );
}

/** A JSON object textarea that only commits valid objects. */
function JsonObjectInput({
  label,
  value,
  onChange,
  readonly,
}: {
  label: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  readonly: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);

  // Reorder / external edits replace the value; resync unless the text already says the same.
  useEffect(() => {
    let same = false;
    try { same = JSON.stringify(JSON.parse(text)) === JSON.stringify(value); } catch { same = false; }
    if (!same && !err) setText(JSON.stringify(value, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (t: string) => {
    setText(t);
    try {
      const parsed = JSON.parse(t.trim() || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setErr("Must be a JSON object");
        return;
      }
      setErr(null);
      onChange(parsed as Record<string, unknown>);
    } catch {
      setErr("Invalid JSON");
    }
  };

  return (
    <div className="space-y-0.5">
      <span className="block text-[9px] text-slate-500 uppercase">{label}</span>
      <textarea
        value={text}
        onChange={(e) => handle(e.target.value)}
        rows={3}
        spellCheck={false}
        disabled={readonly}
        aria-label={label}
        className={`${inputCls} resize-y font-mono text-[11px]`}
      />
      {err && <p className="text-[10px] text-red-400">{err}</p>}
    </div>
  );
}
