"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import {
  FILTER_OPERATORS,
  createSheetBinding,
  deleteSheetBinding,
  isStatePath,
  listSheetBindings,
  previewSheetBinding,
  probeSheet,
  updateSheetBinding,
  type FilterClause,
  type FilterOperator,
  type PreviewBindingResult,
  type ProbeSheetResult,
  type SheetBinding,
  type TaggedValue,
} from "@/lib/api";
import { SHEETS_COMPUTE_WRITES_ENABLED } from "@/lib/config";
import { dsFieldCls, dsFieldMonoCls } from "./fieldStyles";
import { BindingTierBadge, SheetComputePanel } from "./SheetComputePanel";

/**
 * Authoring declarative bindings over an attached spreadsheet.
 *
 * A binding says what to read or write and where. It carries no code and no
 * prose, and every column it names is picked from a dropdown filled by
 * `probe-sheet` — which is the whole design: with no free-text column field
 * anywhere, a binding cannot name a column the sheet does not have, so the
 * form is correct by construction rather than by validation.
 *
 * The flow is four steps, all driven by that one probe:
 *
 *   1. the document is already attached (GoogleSheetsPanel does that);
 *   2. pick the tab, from the probe's `tabs`;
 *   3. read the detected schema — the headers as a table with real sample rows
 *      under them. This screen is the UX. Somebody looking at their own column
 *      names and their own data needs nothing explained;
 *   4. fill in the mode-specific form, then Preview.
 *
 * Bindings live on a *stored* datasource (they compile into its operations), so
 * this panel only appears once the source has been saved.
 *
 * A stored binding also carries a Computation panel (`SheetComputePanel`) for
 * the case this form cannot express — grouping, aggregation, arithmetic across
 * rows. That panel is where tier 2 lives, and the important thing about it is
 * what it does NOT offer: there is no way to ask for generated code. The user
 * describes what they want, the form is tried first, and escalation is an
 * explicit button pressed after being shown why the form is not enough.
 *
 * `resolution.tier` is displayed, never chosen: the backend fills it in, and
 * `BindingTierBadge` renders whichever tier came back.
 */

const BLANK_POLICY_HELP: Record<string, string> = {
  skip: "A blank value leaves the cell exactly as it was.",
  clear: "A blank value writes an empty cell, erasing what was there.",
};

/** A value editor's three states, as the write map presents them. */
type ValueKind = "unchanged" | "literal" | "state";

function valueKind(value: TaggedValue | undefined): ValueKind {
  if (!value) return "unchanged";
  return isStatePath(value) ? "state" : "literal";
}

function emptyRead(): NonNullable<SheetBinding["read"]> {
  return {
    mode: "rows",
    // Starts empty and must be filled: forty columns by five hundred rows is
    // not a sensible default for anything downstream, least of all a prompt.
    columns: [],
    filter: null,
    limit: 200,
    value_render: "UNFORMATTED_VALUE",
    date_render: "FORMATTED_STRING",
  };
}

function emptyWrite(): NonNullable<SheetBinding["write"]> {
  return {
    mode: "update_by_key",
    key_column: null,
    key_value: { literal: "" },
    on_missing: "error",
    value_input_option: "RAW",
    allow_formulas: false,
    blank_policy: "skip",
    columns: {},
  };
}

function describe(binding: SheetBinding): string {
  if (binding.operation === "read" && binding.read) {
    const read = binding.read;
    if (read.mode === "cells") return `cells ${read.range?.a1 || read.range?.named_range || ""}`;
    return `${read.mode} · ${read.columns.join(", ") || "no columns"}`;
  }
  const write = binding.write;
  if (!write) return "";
  if (write.mode === "set_cells") return `set_cells · ${write.cells?.length ?? 0} range(s)`;
  return `${write.mode} · ${Object.keys(write.columns).join(", ") || "no columns"}`;
}

// ─── Value editor ─────────────────────────────────────────────────────────────

/**
 * Literal / state-path toggle for one tagged value.
 *
 * `allowUnchanged` adds the third option the write map needs: leaving a column
 * out of the map altogether, which is what "never touch this cell" means.
 */
function ValueEditor({
  value,
  onChange,
  allowUnchanged = false,
  label,
}: {
  value: TaggedValue | undefined;
  onChange: (next: TaggedValue | undefined) => void;
  allowUnchanged?: boolean;
  label?: string;
}) {
  const kind = valueKind(value);
  return (
    <div className="flex gap-1.5 items-center">
      <select
        aria-label={label ? `${label} value kind` : "value kind"}
        value={kind}
        onChange={(e) => {
          const next = e.target.value as ValueKind;
          if (next === "unchanged") onChange(undefined);
          else if (next === "state") onChange({ from: "state." });
          else onChange({ literal: "" });
        }}
        className={clsx(dsFieldCls, "text-xs w-[9.5rem] shrink-0 py-1.5")}
      >
        {allowUnchanged && <option value="unchanged">leave unchanged</option>}
        <option value="literal">literal</option>
        <option value="state">from state</option>
      </select>
      {kind === "literal" && (
        <input
          aria-label={label ? `${label} literal` : "literal value"}
          value={String((value as { literal: unknown }).literal ?? "")}
          onChange={(e) => onChange({ literal: e.target.value })}
          placeholder="value written as typed"
          className={clsx(dsFieldCls, "text-xs flex-1 py-1.5")}
        />
      )}
      {kind === "state" && (
        <input
          aria-label={label ? `${label} state path` : "state path"}
          value={(value as { from: string }).from}
          onChange={(e) => onChange({ from: e.target.value })}
          placeholder="state.project.id"
          className={clsx(dsFieldMonoCls, "flex-1 py-1.5")}
        />
      )}
      {kind === "unchanged" && (
        <span className="flex-1 text-[10px] text-slate-500 italic">
          not written — the cell keeps whatever is in it
        </span>
      )}
    </div>
  );
}

// ─── The editor ───────────────────────────────────────────────────────────────

function BindingEditor({
  sourceId,
  fileId,
  fileName,
  initial,
  onSaved,
  onCancel,
  computeWritesEnabled,
}: {
  sourceId: string;
  fileId: string;
  fileName: string;
  initial: SheetBinding | null;
  onSaved: () => void;
  onCancel: () => void;
  /** Tier-2 writes are hidden while the backend flag is off. */
  computeWritesEnabled?: boolean;
}) {
  const isEdit = initial !== null;

  const [name, setName] = useState(initial?.name ?? "");
  const [operation, setOperation] = useState<"read" | "write">(initial?.operation ?? "read");
  const [outputKey, setOutputKey] = useState(initial?.output?.key ?? "");
  const [read, setRead] = useState(initial?.read ?? emptyRead());
  const [write, setWrite] = useState(initial?.write ?? emptyWrite());

  const [sheet, setSheet] = useState(initial?.document.sheet ?? "");
  const [headerRow, setHeaderRow] = useState(initial?.schema.header_row ?? 1);
  const [probe, setProbe] = useState<ProbeSheetResult | null>(null);
  const [probing, setProbing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [previewState, setPreviewState] = useState("{}");
  const [preview, setPreview] = useState<PreviewBindingResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const runProbe = useCallback(async (tab: string | null, row: number) => {
    setProbing(true);
    setError(null);
    try {
      const result = await probeSheet({
        file_id: fileId,
        sheet: tab,
        header_row: row,
        source_id: sourceId,
      });
      setProbe(result);
      if (result.status === "ok" && result.sheet) setSheet(result.sheet);
    } catch (err) {
      setProbe({
        status: "error",
        error: err instanceof Error ? err.message : "Backend unavailable",
      });
    } finally {
      setProbing(false);
    }
  }, [fileId, sourceId]);

  // Probe on open — for a new binding to fill the tab dropdown, and for an
  // existing one so its columns are checked against the sheet as it is *now*
  // rather than as it was when the binding was saved.
  useEffect(() => {
    runProbe(initial?.document.sheet ?? null, initial?.schema.header_row ?? 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headers = probe?.status === "ok" ? probe.headers ?? [] : [];
  const tabs = probe?.status === "ok" ? probe.tabs ?? [] : [];
  const namedRanges = probe?.status === "ok" ? probe.named_ranges ?? [] : [];
  const sampleRows = probe?.status === "ok" ? probe.sample_rows ?? [] : [];

  /** Columns the stored binding names that the sheet no longer has. */
  const strandedColumns = useMemo(() => {
    if (headers.length === 0) return [];
    const named = operation === "read"
      ? [...read.columns, read.key_column ?? ""]
      : [...Object.keys(write.columns), write.key_column ?? ""];
    return named.filter((c) => c && !headers.includes(c));
  }, [headers, operation, read, write]);

  const buildBinding = useCallback((): SheetBinding => {
    const tab = tabs.find((t) => t.title === sheet);
    return {
      version: 1,
      name: name.trim(),
      document: {
        provider: "google_sheets",
        file_id: fileId,
        name: fileName,
        sheet,
        // The numeric id is authoritative — it survives a tab rename.
        sheet_id: tab?.sheet_id ?? initial?.document.sheet_id ?? null,
      },
      schema: {
        header_row: headerRow,
        headers,
        // Captured from this probe, and re-checked before every run.
        fingerprint: probe?.fingerprint ?? "",
        probed_at: new Date().toISOString(),
      },
      operation,
      read: operation === "read" ? read : null,
      write: operation === "write" ? write : null,
      output: { key: outputKey.trim() },
    };
  }, [
    fileId, fileName, headerRow, headers, initial, name, operation, outputKey,
    probe, read, sheet, tabs, write,
  ]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const binding = buildBinding();
      if (isEdit) await updateSheetBinding(sourceId, initial.name, binding);
      else await createSheetBinding(sourceId, binding);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the binding");
    } finally {
      setSaving(false);
    }
  }, [buildBinding, initial, isEdit, onSaved, sourceId]);

  const runPreview = useCallback(async () => {
    if (!isEdit) {
      setError("Save the binding first — preview runs the stored one.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(previewState || "{}");
    } catch {
      setError("Sample state is not valid JSON");
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await previewSheetBinding(sourceId, initial.name, { state: parsed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview the binding");
    } finally {
      setPreviewing(false);
    }
  }, [initial, isEdit, previewState, sourceId]);

  // ── filter builder ──────────────────────────────────────────────────────
  const clauses = (read.filter?.clauses ?? []) as FilterClause[];

  const setClauses = (next: FilterClause[]) =>
    setRead({
      ...read,
      filter: next.length === 0 ? null : { op: read.filter?.op ?? "and", clauses: next },
    });

  return (
    <div className="space-y-3 rounded-lg border border-sky-800 bg-slate-900/60 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-sky-300">
          {isEdit ? `Binding · ${initial.name}` : "New binding"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          title="Discard and close"
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Step 2 — the tab, from the probe */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500">Tab</label>
          <select
            aria-label="Tab"
            value={sheet}
            onChange={(e) => { setSheet(e.target.value); runProbe(e.target.value, headerRow); }}
            className={clsx(dsFieldCls, "text-xs")}
          >
            <option value="">{probing ? "probing…" : "choose a tab"}</option>
            {tabs.map((t) => (
              <option key={`${t.sheet_id}-${t.title}`} value={t.title}>{t.title}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500">Header row</label>
          <input
            aria-label="Header row"
            type="number"
            min={1}
            value={headerRow}
            onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
            onBlur={() => runProbe(sheet || null, headerRow)}
            className={clsx(dsFieldCls, "text-xs w-20")}
          />
        </div>
        <button
          type="button"
          onClick={() => runProbe(sheet || null, headerRow)}
          disabled={probing}
          title="Read the tabs, headers and a few rows again"
          className="flex items-center gap-1 px-2.5 py-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-sky-400 disabled:opacity-50"
        >
          {probing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Probe
        </button>
      </div>

      {probe?.status === "error" && (
        <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-900 rounded-md px-2 py-1">
          {probe.error}
        </p>
      )}

      {/* Step 3 — the detected schema. Own headers, own data: nothing to explain. */}
      {headers.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-slate-500">
            Detected schema — {headers.length} column{headers.length === 1 ? "" : "s"} on row {headerRow}
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-slate-800/70">
                  {headers.map((h) => (
                    <th key={h} className="px-2 py-1 text-left font-mono font-semibold text-slate-300 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((row, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    {headers.map((h, j) => (
                      <td key={h} className="px-2 py-0.5 text-slate-400 whitespace-nowrap max-w-[12rem] truncate">
                        {String((row as unknown[])[j] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {strandedColumns.length > 0 && (
        <p className="text-[11px] text-amber-400 bg-amber-950/30 border border-amber-900 rounded-md px-2 py-1">
          This binding names {strandedColumns.map((c) => `"${c}"`).join(", ")}, which the sheet no
          longer has. Fix the mapping before saving — nothing will write by position.
        </p>
      )}

      {/* Step 4 — name, direction, and the mode-specific form */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500">Name (becomes the operation name)</label>
          <input
            aria-label="Binding name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="read_open_projects"
            className={clsx(dsFieldMonoCls)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500">Direction</label>
          <select
            aria-label="Direction"
            value={operation}
            onChange={(e) => setOperation(e.target.value as "read" | "write")}
            className={clsx(dsFieldCls, "text-xs")}
          >
            <option value="read">read</option>
            <option value="write">write (needs approval)</option>
          </select>
        </div>
      </div>

      {/* ── READ ─────────────────────────────────────────────────────────── */}
      {operation === "read" && (
        <div className="space-y-2 rounded-md border border-slate-700 bg-slate-800/30 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">Mode</label>
              <select
                aria-label="Read mode"
                value={read.mode}
                onChange={(e) => setRead({ ...read, mode: e.target.value as typeof read.mode })}
                className={clsx(dsFieldCls, "text-xs")}
              >
                <option value="rows">rows — every matching row</option>
                <option value="row_by_key">row_by_key — one row by key</option>
                <option value="cells">cells — one explicit range</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">Output key in state</label>
              <input
                aria-label="Output key"
                value={outputKey}
                onChange={(e) => setOutputKey(e.target.value)}
                placeholder="projects"
                className={clsx(dsFieldMonoCls)}
              />
            </div>
          </div>

          {read.mode !== "cells" && (
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">
                Columns to return — required, and start empty on purpose
              </label>
              <div className="flex flex-wrap gap-1.5">
                {headers.map((h) => {
                  const on = read.columns.includes(h);
                  return (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRead({
                        ...read,
                        columns: on
                          ? read.columns.filter((c) => c !== h)
                          : [...read.columns, h],
                      })}
                      className={clsx(
                        "px-2 py-0.5 rounded font-mono text-[10px] border transition-colors",
                        on
                          ? "bg-sky-900/50 border-sky-700 text-sky-200"
                          : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200",
                      )}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
              {read.columns.length === 0 && (
                <p className="text-[10px] text-amber-400">
                  Pick at least one. Reading every column of every row is how a whole
                  spreadsheet ends up somewhere it does not belong.
                </p>
              )}
            </div>
          )}

          {read.mode === "row_by_key" && (
            <div className="grid grid-cols-[10rem_1fr] gap-2 items-end">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500">Key column</label>
                <select
                  aria-label="Key column"
                  value={read.key_column ?? ""}
                  onChange={(e) => setRead({ ...read, key_column: e.target.value || null })}
                  className={clsx(dsFieldCls, "text-xs")}
                >
                  <option value="">choose</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500">Key value</label>
                <ValueEditor
                  label="Key"
                  value={read.key_value ?? undefined}
                  onChange={(v) => setRead({ ...read, key_value: v ?? null })}
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-[10px] text-slate-500">When no row matches</label>
                <select
                  aria-label="On missing"
                  value={read.on_missing ?? "null"}
                  onChange={(e) => setRead({ ...read, on_missing: e.target.value as "null" | "error" })}
                  className={clsx(dsFieldCls, "text-xs")}
                >
                  <option value="null">null — return nothing</option>
                  <option value="error">error — fail the run</option>
                </select>
              </div>
            </div>
          )}

          {read.mode === "cells" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500">Named range</label>
                <select
                  aria-label="Named range"
                  value={read.range?.named_range ?? ""}
                  onChange={(e) => setRead({
                    ...read,
                    range: e.target.value ? { named_range: e.target.value } : null,
                  })}
                  className={clsx(dsFieldCls, "text-xs")}
                >
                  <option value="">use A1 notation instead</option>
                  {namedRanges.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500">A1 range</label>
                <input
                  aria-label="A1 range"
                  value={read.range?.a1 ?? ""}
                  onChange={(e) => setRead({
                    ...read,
                    range: e.target.value ? { a1: e.target.value } : null,
                  })}
                  placeholder={`${sheet || "Sheet1"}!D7`}
                  className={clsx(dsFieldMonoCls)}
                  disabled={!!read.range?.named_range}
                />
              </div>
            </div>
          )}

          {read.mode === "rows" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-500">Filter</label>
                <select
                  aria-label="Filter combiner"
                  value={read.filter?.op ?? "and"}
                  onChange={(e) => setRead({
                    ...read,
                    filter: { op: e.target.value as "and" | "or", clauses },
                  })}
                  disabled={clauses.length < 2}
                  className={clsx(dsFieldCls, "text-[10px] w-20 py-1")}
                >
                  <option value="and">all of</option>
                  <option value="or">any of</option>
                </select>
                <button
                  type="button"
                  onClick={() => setClauses([
                    ...clauses,
                    { column: headers[0] ?? "", op: "eq", value: { literal: "" } },
                  ])}
                  disabled={headers.length === 0}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-sky-400 disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" /> clause
                </button>
              </div>
              {clauses.map((clause, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <select
                    aria-label={`Clause ${i + 1} column`}
                    value={clause.column}
                    onChange={(e) => setClauses(clauses.map((c, j) =>
                      j === i ? { ...c, column: e.target.value } : c))}
                    className={clsx(dsFieldCls, "text-xs w-36 shrink-0 py-1.5")}
                  >
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <select
                    aria-label={`Clause ${i + 1} operator`}
                    value={clause.op}
                    onChange={(e) => setClauses(clauses.map((c, j) =>
                      j === i ? { ...c, op: e.target.value as FilterOperator } : c))}
                    className={clsx(dsFieldCls, "text-xs w-24 shrink-0 py-1.5")}
                  >
                    {FILTER_OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                  <div className="flex-1">
                    <ValueEditor
                      label={`Clause ${i + 1}`}
                      value={clause.value}
                      onChange={(v) => setClauses(clauses.map((c, j) =>
                        j === i ? { ...c, value: v ?? { literal: "" } } : c))}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove clause ${i + 1}`}
                    onClick={() => setClauses(clauses.filter((_, j) => j !== i))}
                    className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {read.mode !== "cells" && (
            <div className="space-y-1 w-32">
              <label className="text-[10px] text-slate-500">Limit</label>
              <input
                aria-label="Limit"
                type="number"
                min={1}
                value={read.limit ?? ""}
                onChange={(e) => setRead({
                  ...read,
                  limit: e.target.value ? Number(e.target.value) : null,
                })}
                placeholder="no limit"
                className={clsx(dsFieldCls, "text-xs")}
              />
            </div>
          )}
        </div>
      )}

      {/* ── WRITE ────────────────────────────────────────────────────────── */}
      {operation === "write" && (
        <div className="space-y-2 rounded-md border border-slate-700 bg-slate-800/30 p-2.5">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500">Mode</label>
            <select
              aria-label="Write mode"
              value={write.mode}
              onChange={(e) => setWrite({ ...write, mode: e.target.value as typeof write.mode })}
              className={clsx(dsFieldCls, "text-xs")}
            >
              <option value="update_by_key">update_by_key — find a row and set columns</option>
              <option value="append_row">append_row — always add a row</option>
              <option value="set_cells">set_cells — write explicit ranges</option>
            </select>
          </div>

          {write.mode === "update_by_key" && (
            <div className="grid grid-cols-[10rem_1fr] gap-2 items-end">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500">Key column</label>
                <select
                  aria-label="Write key column"
                  value={write.key_column ?? ""}
                  onChange={(e) => setWrite({ ...write, key_column: e.target.value || null })}
                  className={clsx(dsFieldCls, "text-xs")}
                >
                  <option value="">choose</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500">Key value</label>
                <ValueEditor
                  label="Write key"
                  value={write.key_value ?? undefined}
                  onChange={(v) => setWrite({ ...write, key_value: v ?? null })}
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-[10px] text-slate-500">When no row matches</label>
                <select
                  aria-label="Write on missing"
                  value={write.on_missing ?? "error"}
                  onChange={(e) => setWrite({
                    ...write,
                    on_missing: e.target.value as "error" | "append" | "skip",
                  })}
                  className={clsx(dsFieldCls, "text-xs")}
                >
                  <option value="error">error — fail the run</option>
                  <option value="append">append — add it as a new row</option>
                  <option value="skip">skip — write nothing</option>
                </select>
              </div>
            </div>
          )}

          {/* The core widget: detected headers down the left, a value editor on
              the right, and "leave unchanged" as a first-class choice. */}
          {write.mode !== "set_cells" && (
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">
                Columns to write — a column left unchanged is never touched
              </label>
              <div className="space-y-1">
                {headers.map((h) => (
                  <div key={h} className="grid grid-cols-[10rem_1fr] gap-2 items-center">
                    <code className="text-[10px] text-slate-300 truncate" title={h}>{h}</code>
                    <ValueEditor
                      label={h}
                      allowUnchanged
                      value={write.columns[h]}
                      onChange={(v) => {
                        const next = { ...write.columns };
                        if (v === undefined) delete next[h];
                        else next[h] = v;
                        setWrite({ ...write, columns: next });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">Blank values</label>
              <select
                aria-label="Blank policy"
                value={write.blank_policy ?? "skip"}
                onChange={(e) => setWrite({
                  ...write, blank_policy: e.target.value as "skip" | "clear",
                })}
                className={clsx(dsFieldCls, "text-xs")}
              >
                <option value="skip">skip — leave the cell alone</option>
                <option value="clear">clear — write an empty cell</option>
              </select>
              <p className="text-[10px] text-slate-500">
                {BLANK_POLICY_HELP[write.blank_policy ?? "skip"]}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">How Sheets stores the value</label>
              <label className="flex items-start gap-1.5 text-[10px] text-slate-400">
                <input
                  type="checkbox"
                  aria-label="Let Sheets parse values (USER_ENTERED)"
                  checked={write.value_input_option === "USER_ENTERED"}
                  onChange={(e) => setWrite({
                    ...write,
                    value_input_option: e.target.checked ? "USER_ENTERED" : "RAW",
                    // allow_formulas is only meaningful with USER_ENTERED, and
                    // the backend refuses the combination the other way round.
                    allow_formulas: e.target.checked ? write.allow_formulas : false,
                  })}
                  className="mt-0.5"
                />
                <span>
                  Let Sheets parse values (<span className="font-mono">USER_ENTERED</span>)
                </span>
              </label>
              {write.value_input_option === "USER_ENTERED" ? (
                <>
                  <p className="text-[10px] text-amber-400">
                    A value starting with <span className="font-mono">=</span> becomes a live
                    formula. Values from state are not trusted text, so a leading
                    {" "}<span className="font-mono">= + - @</span> is prefixed with an apostrophe.
                  </p>
                  <label className="flex items-start gap-1.5 text-[10px] text-slate-400">
                    <input
                      type="checkbox"
                      aria-label="Allow formulas"
                      checked={!!write.allow_formulas}
                      onChange={(e) => setWrite({ ...write, allow_formulas: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>Allow formulas — drop that guard (only for values you compose)</span>
                  </label>
                </>
              ) : (
                <p className="text-[10px] text-slate-500">
                  <span className="font-mono">RAW</span> — every value is stored as inert text.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-900 rounded-md px-2 py-1 whitespace-pre-wrap">
          {error}
        </p>
      )}

      {/* Step 5 — preview */}
      <div className="space-y-1.5 rounded-md border border-slate-700 bg-slate-800/30 p-2.5">
        <label className="text-[10px] text-slate-500">
          Sample state — what the {"{ from: … }"} values resolve against
        </label>
        <textarea
          aria-label="Sample state"
          value={previewState}
          onChange={(e) => setPreviewState(e.target.value)}
          rows={3}
          spellCheck={false}
          className={clsx(dsFieldMonoCls, "resize-y")}
        />
        <button
          type="button"
          onClick={runPreview}
          disabled={previewing || !isEdit}
          title={isEdit ? "Resolve the binding without writing" : "Save the binding first"}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-sky-400 disabled:opacity-50"
        >
          {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
          Preview
        </button>

        {preview?.status === "error" && (
          <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-900 rounded-md px-2 py-1">
            {preview.error}
          </p>
        )}
        {preview?.status === "skipped" && (
          <p className="text-[11px] text-slate-400">Nothing would be written: {preview.reason}</p>
        )}
        {preview?.status === "ok" && (
          <div className="space-y-1">
            <p className="text-[11px] text-emerald-300">{preview.rows} row(s) would be returned</p>
            <pre className="max-h-40 overflow-auto rounded bg-slate-900/70 px-2 py-1 text-[10px] text-slate-300">
              {JSON.stringify(preview.output, null, 2)}
            </pre>
          </div>
        )}
        {preview?.status === "ready" && (
          <div className="space-y-1">
            <p className="text-[11px] text-slate-300">
              {preview.range
                ? <>Target <span className="font-mono text-sky-300">{preview.range}</span></>
                : <>Would append a new row</>}
              {preview.row_number ? ` (row ${preview.row_number})` : ""}
            </p>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left px-1 py-0.5">cell</th>
                  <th className="text-left px-1 py-0.5">column</th>
                  <th className="text-left px-1 py-0.5">before</th>
                  <th className="px-1 py-0.5" />
                  <th className="text-left px-1 py-0.5">after</th>
                </tr>
              </thead>
              <tbody>
                {preview.cells.map((cell) => (
                  <tr
                    key={cell.a1}
                    className={clsx("border-t border-slate-800", cell.action === "skip" && "opacity-60")}
                  >
                    <td className="px-1 py-0.5 font-mono text-sky-300">{cell.a1}</td>
                    <td className="px-1 py-0.5 text-slate-400">{cell.column}</td>
                    <td className="px-1 py-0.5 text-slate-400 max-w-[10rem] truncate">
                      {String(cell.before ?? "")}
                    </td>
                    <td className="px-1 py-0.5 text-slate-600">
                      <ArrowRight className="w-3 h-3" />
                    </td>
                    <td className="px-1 py-0.5 text-emerald-300 max-w-[10rem] truncate">
                      {cell.action === "skip" ? "(unchanged)" : String(cell.after ?? "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-500">
              Columns not listed are not touched.
            </p>
          </div>
        )}
      </div>

      {/* Tier 2. Only for a stored binding: the compile endpoints address one
          by name, and the column whitelist a generated write is held to is
          whatever the saved binding declares. */}
      {isEdit && initial && (
        <SheetComputePanel
          sourceId={sourceId}
          binding={initial}
          writesEnabled={computeWritesEnabled}
          onChanged={onSaved}
        />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !name.trim() || !sheet || headers.length === 0}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-sky-700 hover:bg-sky-600 text-xs text-white disabled:opacity-50"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isEdit ? "Save binding" : "Create binding"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── The panel ────────────────────────────────────────────────────────────────

export function SheetBindingsPanel({
  sourceId,
  fileId,
  fileName,
}: {
  /** Stored source id — bindings compile into its operations, so it must exist. */
  sourceId: string | null;
  /** The attached spreadsheet, from GoogleSheetsPanel. */
  fileId: string;
  fileName?: string;
}) {
  const [bindings, setBindings] = useState<SheetBinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SheetBinding | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!sourceId) return;
    try {
      setBindings(await listSheetBindings(sourceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bindings");
    }
  }, [sourceId]);

  useEffect(() => { load(); }, [load]);

  const remove = useCallback(async (name: string) => {
    if (!sourceId) return;
    try {
      await deleteSheetBinding(sourceId, name);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the binding");
    }
  }, [load, sourceId]);

  // Bindings are stored on the datasource and compile into its operations, so
  // there is nothing to attach them to until it has been saved once.
  if (!sourceId) {
    return (
      <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-800/30 p-3">
        <label className="text-xs font-medium text-slate-400">Bindings</label>
        <p className="text-[10px] text-slate-500">
          Save the data source first. A binding compiles into an operation of it, so it needs
          somewhere to live.
        </p>
      </div>
    );
  }

  if (!fileId) {
    return (
      <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-800/30 p-3">
        <label className="text-xs font-medium text-slate-400">Bindings</label>
        <p className="text-[10px] text-slate-500">
          Attach and verify a spreadsheet above, then author bindings against it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/30 p-3">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-400">Bindings</label>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => { setCreating(true); setEditing(null); }}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-sky-400"
        >
          <Plus className="w-3 h-3" /> New binding
        </button>
      </div>
      <p className="text-[10px] text-slate-500">
        A binding describes what to read or write, and where. Each one becomes an operation of
        this source that a workflow step can call by name.
      </p>

      {error && (
        <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-900 rounded-md px-2 py-1">
          {error}
        </p>
      )}

      {bindings !== null && bindings.length === 0 && !creating && (
        <p className="text-[10px] text-slate-500 italic">No bindings yet.</p>
      )}

      <ul className="space-y-1">
        {(bindings ?? []).map((binding) => (
          <li
            key={binding.name}
            className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/50 px-2 py-1.5"
          >
            <span
              className={clsx(
                "px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase shrink-0",
                binding.operation === "write"
                  ? "bg-amber-900/50 text-amber-300"
                  : "bg-sky-900/50 text-sky-300",
              )}
            >
              {binding.operation}
            </span>
            <code className="text-[11px] text-slate-200">{binding.name}</code>
            {/* The tier, at a glance: a user scanning this list should be able
                to see which bindings are plain mappings without opening them. */}
            <BindingTierBadge status={binding.compute_status} />
            <span className="text-[10px] text-slate-500 truncate flex-1">
              {binding.document.sheet} · {describe(binding)}
            </span>
            <button
              type="button"
              onClick={() => { setEditing(binding); setCreating(false); }}
              className="px-2 py-0.5 rounded text-[10px] text-sky-400 hover:bg-slate-800"
            >
              Edit
            </button>
            <button
              type="button"
              aria-label={`Delete ${binding.name}`}
              onClick={() => remove(binding.name)}
              className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>

      {(creating || editing) && (
        <BindingEditor
          key={editing?.name ?? "__new__"}
          sourceId={sourceId}
          fileId={fileId}
          fileName={fileName ?? ""}
          initial={editing}
          computeWritesEnabled={SHEETS_COMPUTE_WRITES_ENABLED}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
