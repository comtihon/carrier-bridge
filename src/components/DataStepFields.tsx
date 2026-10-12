"use client";

import { useMemo } from "react";
import { Download, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import type {
  DataSelection,
  DataSelectionFormat,
  EditableNodeConfig,
  EditableWorkflowDefinition,
} from "@/lib/types";

const inputCls =
  "w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 " +
  "placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors";

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

export const DATA_FORMATS: Array<{ value: DataSelectionFormat; label: string }> = [
  { value: "jsonl", label: "jsonl — one JSON object per line" },
  { value: "json",  label: "json — one JSON document"         },
  { value: "csv",   label: "csv — a header row plus rows"     },
];

/**
 * A name that cannot be a filename is a name the export cannot use, so the
 * allowed set is the intersection of "obvious" and "safe on every filesystem".
 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Why selection `i` is not usable, or null when it is.
 *
 * Names are compared case-insensitively: `Rows` and `rows` are one file on a
 * mac or a Windows box, and silently overwriting one export with another is
 * exactly the class of failure this node must not have.
 */
export function selectionErrors(selections: DataSelection[]): Array<string | null> {
  const seen = new Map<string, number>();
  for (const [i, sel] of selections.entries()) {
    const key = sel.name.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, i);
  }
  return selections.map((sel, i) => {
    const name = sel.name.trim();
    if (!name) return "A name is required — it becomes the filename.";
    if (!NAME_RE.test(name)) {
      return "Letters, digits, dot, dash and underscore only — this becomes a filename.";
    }
    if (seen.get(name.toLowerCase()) !== i) {
      return "Another selection already uses this name, and each one becomes its own file.";
    }
    if (!sel.from.trim()) return "Name the state path to read, e.g. state.projects.";
    return null;
  });
}

/**
 * The step-level complaint, for the serialiser and the save path.
 *
 * A `data` step with no selections at all is not an error — a node that has
 * just been dropped on the canvas has none — it simply exports nothing.
 */
export function dataStepProblem(config: EditableNodeConfig): string | null {
  const selections = config.selections ?? [];
  const errors = selectionErrors(selections);
  const idx = errors.findIndex((e) => e !== null);
  if (idx === -1) return null;
  return `selection ${idx + 1} (“${selections[idx].name || "unnamed"}”): ${errors[idx]}`;
}

/**
 * State keys reachable at `stepId`, as `state.<key>` paths.
 *
 * Walks the drawn edges backwards and collects what each ancestor stores:
 * `output_key`, plus the keys of an `output_mapping` where a step writes
 * several. This is a suggestion list, not a constraint — the backend resolves
 * the path at run time and a workflow can put things in state that no node
 * declares — so the field it feeds stays free text.
 */
export function upstreamStatePaths(
  nodes: EditableNodeConfig[],
  edges: EditableWorkflowDefinition["edges"],
  stepId: string,
): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }

  const ancestors = new Set<string>();
  const queue = [...(incoming.get(stepId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === stepId || ancestors.has(id)) continue;
    ancestors.add(id);
    for (const parent of incoming.get(id) ?? []) queue.push(parent);
  }

  const keys = new Set<string>();
  for (const node of nodes) {
    if (!ancestors.has(node.id)) continue;
    if (node.output_key?.trim()) keys.add(node.output_key.trim());
    for (const key of Object.keys(node.output_mapping ?? {})) {
      if (key.trim()) keys.add(key.trim());
    }
  }
  return [...keys].sort().map((k) => `state.${k}`);
}

/**
 * Property-panel fields for a `data` step.
 *
 * The one thing this panel exists to get across is what the node is *not*: it
 * does not filter, transform or reshape anything, and the step after it sees
 * exactly the state the step before it produced. Users read "data" as a verb
 * and assume otherwise, so the copy says it twice — once at the top as the
 * node's whole mental model, and once at the bottom next to the rows that make
 * it look like a transform.
 */
export function DataStepFields({
  config,
  nodes = [],
  edges = [],
  onChange,
  readonly = false,
}: {
  config: EditableNodeConfig;
  nodes?: EditableNodeConfig[];
  edges?: EditableWorkflowDefinition["edges"];
  onChange: (patch: Partial<EditableNodeConfig>) => void;
  readonly?: boolean;
}) {
  const selections = config.selections ?? [];
  const errors = selectionErrors(selections);
  const paths = useMemo(
    () => upstreamStatePaths(nodes, edges, config.id),
    [nodes, edges, config.id],
  );
  const listId = `data-paths-${config.id}`;

  const setSelection = (idx: number, patch: Partial<DataSelection>) =>
    onChange({
      selections: selections.map((sel, i) => (i === idx ? { ...sel, ...patch } : sel)),
    });

  const addSelection = () =>
    onChange({
      selections: [...selections, { name: "", from: paths[0] ?? "", format: "jsonl" }],
    });

  const removeSelection = (idx: number) =>
    onChange({ selections: selections.filter((_, i) => i !== idx) });

  return (
    <>
      <div className="rounded-md bg-sky-950/40 border border-sky-900/40 px-3 py-2 text-[11px] text-sky-200/90 leading-relaxed space-y-1">
        <p className="flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-400" />
          <span>
            <strong>This step changes nothing.</strong> It copies what you name below
            into downloadable files and passes the run&apos;s state through untouched —
            the next step sees exactly what this one received.
          </span>
        </p>
        <p className="text-sky-300/70">
          It does not filter, transform or reshape the data. Use a Python step for
          that, then point a selection at what it stored.
        </p>
      </div>

      <Field
        label="Selections"
        hint="One file each. The name becomes the filename, so it has to be unique within the step."
      >
        <div className="space-y-2">
          {selections.length === 0 && (
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Nothing selected yet, so this step exports nothing. Add a selection to
              name the data you want to download after a run.
            </p>
          )}

          {selections.map((sel, i) => (
            <div
              key={i}
              className={clsx(
                "space-y-1.5 rounded-lg border p-2",
                errors[i] ? "border-red-800/70 bg-red-950/20" : "border-slate-700 bg-slate-800/30",
              )}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  aria-label={`Selection ${i + 1} name`}
                  value={sel.name}
                  disabled={readonly}
                  onChange={(e) => setSelection(i, { name: e.target.value })}
                  placeholder="open_projects"
                  className={clsx(inputCls, "font-mono flex-1")}
                />
                <button
                  type="button"
                  aria-label={`Remove selection ${i + 1}`}
                  disabled={readonly}
                  onClick={() => removeSelection(i)}
                  className="shrink-0 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  aria-label={`Selection ${i + 1} state path`}
                  value={sel.from}
                  disabled={readonly}
                  list={paths.length > 0 ? listId : undefined}
                  onChange={(e) => setSelection(i, { from: e.target.value })}
                  placeholder="state.projects"
                  className={clsx(inputCls, "font-mono flex-1")}
                />
                <select
                  aria-label={`Selection ${i + 1} format`}
                  value={sel.format}
                  disabled={readonly}
                  onChange={(e) =>
                    setSelection(i, { format: e.target.value as DataSelectionFormat })
                  }
                  className={clsx(inputCls, "w-28 shrink-0")}
                >
                  {DATA_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>{f.value}</option>
                  ))}
                </select>
              </div>

              <p className="text-[10px] text-slate-600 font-mono">
                {sel.name.trim() ? `${sel.name.trim()}.${sel.format}` : `<name>.${sel.format}`}
              </p>

              {errors[i] && (
                <p className="text-[10px] text-red-400 leading-relaxed">{errors[i]}</p>
              )}
            </div>
          ))}

          {paths.length > 0 && (
            <datalist id={listId}>
              {paths.map((p) => <option key={p} value={p} />)}
            </datalist>
          )}

          {!readonly && (
            <button
              type="button"
              onClick={addSelection}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add selection
            </button>
          )}
        </div>
      </Field>

      {paths.length === 0 && selections.length > 0 && (
        <p className="text-[10px] text-slate-600 leading-relaxed">
          No upstream step declares an output key, so there is nothing to suggest —
          type the state path this should read.
        </p>
      )}

      <div className="rounded-md border border-slate-700/60 bg-slate-800/20 px-3 py-2 text-[10px] text-slate-500 leading-relaxed flex items-start gap-1.5">
        <Download className="w-3 h-3 mt-px shrink-0" />
        <span>
          After a run, these files appear under <strong>Data</strong> on the run and
          can be downloaded until the retention window closes. The run&apos;s state is
          unaffected either way.
        </span>
      </div>
    </>
  );
}
