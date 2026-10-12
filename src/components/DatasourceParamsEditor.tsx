"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import type { DataSourceParamSpec } from "@/lib/api";

/**
 * The inputs of one datasource operation, as a form the operation describes.
 *
 * The generic key/value editor this replaces was typed `Record<string,
 * string>`, which broke twice over for a datasource step. An `object` param
 * — a REST API's `pagination` param, which is `{limit, skip}` — arrived as an
 * object, went into a text input, and React printed `[object Object]`. And
 * there was no way to author one: whatever you typed stayed a string, so a
 * GraphQL variable declared `PaginationInput` got `"{\"limit\": 50}"` and the
 * server rejected it.
 *
 * The operation already declares its params — name, type, required,
 * description, default — so the form is generated from that instead of being
 * free-form. Which also fixes a quieter problem: the executor only ever sends
 * params the operation declares, so a name typed by hand was silently dropped.
 */

/**
 * Param names the operation's own pagination drives, which a step must not set.
 *
 * Paging is the data source's business: the operation declares where the
 * cursor/offset and the page size go, and the executor fills them in on every
 * page. A step that also set them would fight the paginator, and showing them
 * invites exactly that — a REST API's `pagination` param appeared in the editor
 * as `[object Object]` and looked like something a workflow was supposed to
 * fill in. A step says how MUCH it wants (the node's `limit`), never which
 * page.
 *
 * Both fields may be dotted paths into a nested input (`pagination.skip`), so
 * the first segment is what names the param to hide.
 */
export function paginationParamNames(
  paginate?: Record<string, unknown> | null,
): Set<string> {
  const names = new Set<string>();
  for (const key of ["param", "size_param"]) {
    const raw = paginate?.[key];
    if (typeof raw === "string" && raw.trim()) {
      names.add(raw.trim().split(".")[0]);
    }
  }
  return names;
}

/** A lone `{state_key}` reference, which the runtime substitutes whole. */
const TEMPLATE_RE = /^\{[A-Za-z_]\w*(?:\[[^\]]+\]|\.[A-Za-z_]\w*)*\}$/;

export function isStateTemplate(text: string): boolean {
  return TEMPLATE_RE.test(text.trim());
}

/** How a param's stored value is shown in a text box. */
export function valueToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

/**
 * Parse what was typed for a param of *type*.
 *
 * A lone `{state_key}` is always kept as a string: the runtime resolves it
 * against workflow state and substitutes the whole value, so a template for
 * an `object` param is correct and must not be JSON-parsed.
 */
export function textToValue(
  text: string,
  type: DataSourceParamSpec["type"],
): { value: unknown; error?: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: "" };
  if (isStateTemplate(trimmed)) return { value: trimmed };

  if (type === "object" || type === "array") {
    try {
      const parsed = JSON.parse(trimmed);
      const wanted = type === "array" ? Array.isArray(parsed) : isPlainObject(parsed);
      if (!wanted) {
        return {
          value: text,
          error: type === "array" ? "Expected a JSON array" : "Expected a JSON object",
        };
      }
      return { value: parsed };
    } catch {
      return { value: text, error: "Not valid JSON" };
    }
  }
  if (type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? { value: n } : { value: text, error: "Not a number" };
  }
  if (type === "boolean") {
    if (/^(true|false)$/i.test(trimmed)) return { value: /^true$/i.test(trimmed) };
    return { value: text, error: "Expected true or false" };
  }
  return { value: text };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const TYPE_CLS: Record<DataSourceParamSpec["type"], string> = {
  string: "text-slate-400 border-slate-700",
  number: "text-sky-300 border-sky-800",
  boolean: "text-violet-300 border-violet-800",
  array: "text-amber-300 border-amber-800",
  object: "text-amber-300 border-amber-800",
};

const inputCls =
  "w-full px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300 font-mono placeholder-slate-600 focus:outline-none focus:border-slate-500";

/** One param. Keeps its own text so half-typed JSON is not thrown away. */
function ParamRow({
  spec, value, onChange, readonly,
}: {
  spec: DataSourceParamSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  readonly?: boolean;
}) {
  const [text, setText] = useState(() => valueToText(value));
  const [error, setError] = useState<string | undefined>();

  // Re-sync when the value changes from outside (a different operation
  // selected, a definition reloaded) but not while this field is being typed
  // into — that would fight the user mid-keystroke.
  useEffect(() => {
    const incoming = valueToText(value);
    setText((current) => (current.trim() === "" || !error ? incoming : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.name, JSON.stringify(value)]);

  const structured = spec.type === "object" || spec.type === "array";

  function commit(next: string) {
    setText(next);
    const { value: parsed, error: err } = textToValue(next, spec.type);
    setError(err);
    // The raw text is still stored on a parse failure, so nothing typed is
    // lost — it just will not be a valid request until the error clears.
    onChange(parsed);
  }

  const placeholder = structured
    ? spec.type === "array"
      ? '["a", "b"]  or  {state_key}'
      : '{"limit": 50, "skip": 0}  or  {state_key}'
    : spec.type === "boolean"
      ? "true / false  or  {state_key}"
      : spec.type === "number"
        ? "0  or  {state_key}"
        : "value  or  {state_key}";

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono text-slate-300">{spec.name}</span>
        <span
          className={clsx(
            "px-1 rounded border text-[9px] font-mono leading-none py-0.5",
            TYPE_CLS[spec.type],
          )}
        >
          {spec.type}
        </span>
        {spec.required && (
          <span className="text-[9px] text-red-400/80 uppercase tracking-wide">required</span>
        )}
        {spec.default != null && (
          <span className="text-[9px] text-slate-600 font-mono">
            default {valueToText(spec.default)}
          </span>
        )}
      </div>
      {spec.description && (
        <p className="text-[9px] text-slate-500 leading-snug">{spec.description}</p>
      )}
      {structured ? (
        <textarea
          value={text}
          onChange={(e) => commit(e.target.value)}
          disabled={readonly}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          spellCheck={false}
          placeholder={placeholder}
          aria-label={spec.name}
          className={clsx(inputCls, "resize-y", error && "border-red-700")}
        />
      ) : (
        <input
          type="text"
          value={text}
          onChange={(e) => commit(e.target.value)}
          disabled={readonly}
          spellCheck={false}
          placeholder={placeholder}
          aria-label={spec.name}
          className={clsx(inputCls, error && "border-red-700")}
        />
      )}
      {error && <p className="text-[9px] text-red-400">{error}</p>}
    </div>
  );
}

export function DatasourceParamsEditor({
  specs, value, onChange, readonly, paginate,
}: {
  specs: readonly DataSourceParamSpec[];
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  readonly?: boolean;
  /** The operation's pagination block; its params are hidden. */
  paginate?: Record<string, unknown> | null;
}) {
  const paged = paginationParamNames(paginate);
  const shown = specs.filter((s) => !paged.has(s.name));
  const declared = new Set(specs.map((s) => s.name));
  const stray = Object.keys(value).filter(
    (k) => !declared.has(k) && !paged.has(k),
  );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-1.5">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Params
        </label>
        <span className="text-[9px] text-slate-600 normal-case">
          from the operation; values accept {"{state_key}"}
        </span>
      </div>

      {shown.length === 0 && (
        <p className="text-[10px] text-slate-500">
          {specs.length === 0
            ? "This operation declares no inputs."
            : "This operation's only inputs are its pagination, which it handles itself."}
        </p>
      )}

      {shown.map((spec) => (
        <ParamRow
          key={spec.name}
          spec={spec}
          value={value[spec.name]}
          onChange={(v) => onChange({ ...value, [spec.name]: v })}
          readonly={readonly}
        />
      ))}

      {paged.size > 0 && (
        <p className="text-[9px] text-slate-600">
          Paged automatically ({[...paged].join(", ")}) — set Limit below to cap
          how many records are fetched.
        </p>
      )}

      {stray.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-slate-800">
          <p className="text-[9px] text-amber-400/90">
            Not declared by this operation — the runtime drops these, so they
            have no effect.
          </p>
          {stray.map((k) => (
            <div key={k} className="flex items-center gap-1">
              <span className="flex-1 truncate text-[10px] font-mono text-slate-500">
                {k}={valueToText(value[k])}
              </span>
              <button
                onClick={() => {
                  const next = { ...value };
                  delete next[k];
                  onChange(next);
                }}
                disabled={readonly}
                aria-label={`Remove ${k}`}
                className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
