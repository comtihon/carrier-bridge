"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Library, Loader2, Save, ShieldCheck, ShieldOff } from "lucide-react";
import { clsx } from "clsx";
import {
  createScript,
  getScript,
  listScriptSummaries,
  ScriptNameConflictError,
  type ScriptSummary,
} from "@/lib/api";
import type { EditableNodeConfig } from "@/lib/types";
import { CodeEditor } from "./CodeEditor";
import { scopeConflict, useUsageScope, visibilitySuffix } from "./Visibility";

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

/**
 * Property-panel fields for a `python` step.
 *
 * The code either lives on the node (inline) or comes from the script library
 * (`script_id`). Inline code can be pushed into the library by name; a name
 * clash comes back as a 409 and turns into an overwrite confirmation.
 */
export function PythonStepFields({
  config,
  onChange,
  readonly = false,
}: {
  config: EditableNodeConfig;
  onChange: (patch: Partial<EditableNodeConfig>) => void;
  readonly?: boolean;
}) {
  // The picker stays in library mode even before a script is chosen, so the
  // toggle still works when the library is empty.
  const [mode, setMode] = useState<"inline" | "library">(config.script_id ? "library" : "inline");
  const fromLibrary = mode === "library";
  const sandbox = config.sandbox !== false;
  const runtime = config.sandbox_runtime ?? "local";

  const scope = useUsageScope();
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictName, setConflictName] = useState<string | null>(null);

  // Turning the sandbox off is a privileged, easy-to-underestimate action: the
  // script gains the backend's credentials. The checkbox therefore does not apply
  // the change directly — it opens a confirmation the user has to read. Turning it
  // back ON is always safe and applies immediately.
  const [confirmUnsandbox, setConfirmUnsandbox] = useState(false);

  const onSandboxToggle = (checked: boolean) => {
    if (checked) {
      onChange({ sandbox: true });
      return;
    }
    setConfirmUnsandbox(true);
  };

  const loadScripts = useCallback(async () => {
    setLoading(true);
    setScriptsError(null);
    try {
      // Summaries only: the dropdown shows id + name, and `selectScript` below
      // fetches the body of whichever script is chosen. Listing full scripts here
      // pulled every Python source in the library into every python node panel.
      setScripts(await listScriptSummaries());
    } catch (err) {
      setScriptsError(err instanceof Error ? err.message : "Failed to load scripts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadScripts(); }, [loadScripts]);

  // A step that gains a script_id elsewhere (e.g. saved from this panel) shows
  // as library-backed.
  useEffect(() => { if (config.script_id) setMode("library"); }, [config.script_id]);

  // Pull the body of the selected library script in so the node shows what it
  // will run; the backend still resolves `script_id` at run time.
  const selectScript = useCallback(async (id: string) => {
    if (!id) {
      onChange({ script_id: undefined });
      return;
    }
    onChange({ script_id: id });
    try {
      const script = await getScript(id);
      onChange({ script_id: id, code: script.code });
    } catch {
      // The picker keeps working even if the body can't be previewed.
    }
  }, [onChange]);

  const doSave = useCallback(async (overwrite: boolean) => {
    const name = saveName.trim() || config.name || config.id;
    setSaving(true);
    setSaveError(null);
    setSaveMsg(null);
    try {
      const saved = await createScript({
        name,
        description: config.description ?? null,
        code: config.code ?? "",
        overwrite,
      });
      setConflictName(null);
      setSaveMsg(`Saved as "${saved.name}"`);
      setSaveName("");
      // Point the node at the library copy so both stay in step.
      onChange({ script_id: saved.id });
      await loadScripts();
    } catch (err) {
      if (err instanceof ScriptNameConflictError) {
        setConflictName(name);
      } else {
        setSaveError(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }, [saveName, config.name, config.id, config.description, config.code, onChange, loadScripts]);

  return (
    <>
      <div className="rounded-md bg-yellow-950/40 border border-yellow-900/40 px-3 py-2 text-[11px] text-yellow-300/80 leading-relaxed">
        Code runs with <span className="font-mono">state</span> dict in scope.
        Assign <span className="font-mono">output</span> to store a result.
      </div>

      {/* ── Source: inline vs library ─────────────────────────────────────── */}
      <Field label="Source">
        <div className="flex gap-1 p-0.5 rounded-lg bg-slate-800 border border-slate-700">
          <button type="button" disabled={readonly}
            onClick={() => { setMode("inline"); onChange({ script_id: undefined }); }}
            className={clsx(
              "flex-1 py-1 rounded-md text-[11px] font-semibold transition-colors",
              !fromLibrary ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200",
            )}>
            Inline code
          </button>
          <button type="button" disabled={readonly}
            onClick={() => setMode("library")}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[11px] font-semibold transition-colors",
              fromLibrary ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200",
            )}>
            <Library className="w-3 h-3" />Library
          </button>
        </div>
      </Field>

      {fromLibrary && (
        <Field label="Script" hint="Edit the body in the Library panel — the node runs whatever the library holds at run time.">
          <div className="flex items-center gap-1.5">
            <select value={config.script_id ?? ""} disabled={readonly}
              onChange={(e) => selectScript(e.target.value)}
              className={inputCls}>
              <option value="">— select a script —</option>
              {scripts.map((s) => {
                const conflict = scopeConflict(scope, s);
                return (
                  <option key={s.id} value={s.id} disabled={!!conflict && s.id !== config.script_id} title={conflict ?? undefined}>
                    {s.name || s.id}{visibilitySuffix(s)}{conflict ? " (not usable here)" : ""}
                  </option>
                );
              })}
            </select>
            {loading && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin shrink-0" />}
          </div>
          {scriptsError && (
            <p className="text-[10px] text-red-400 mt-1">{scriptsError}</p>
          )}
        </Field>
      )}

      <Field label="Code">
        <CodeEditor
          value={config.code ?? ""}
          onChange={(code) => onChange({ code })}
          readOnly={readonly || fromLibrary}
          minHeight={180}
          placeholder={'# state dict is available\noutput = state["plan"].upper()'}
        />
      </Field>

      {/* ── Save to library ───────────────────────────────────────────────── */}
      {!fromLibrary && !readonly && (
        <Field label="Save to library">
          <div className="flex items-center gap-1.5">
            <input type="text" value={saveName}
              onChange={(e) => { setSaveName(e.target.value); setConflictName(null); }}
              placeholder={config.name || config.id}
              className={inputCls} />
            <button type="button" disabled={saving}
              onClick={() => doSave(false)}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
          {conflictName && (
            <div className="mt-1.5 rounded-lg border border-amber-700/60 bg-amber-950/30 px-2.5 py-2 space-y-2">
              <p className="text-[11px] text-amber-200 leading-relaxed">
                A script named <span className="font-mono">{conflictName}</span> already
                exists. Overwrite it?
              </p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => doSave(true)} disabled={saving}
                  className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold transition-colors disabled:opacity-50">
                  Overwrite
                </button>
                <button type="button" onClick={() => setConflictName(null)}
                  className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 text-[11px] transition-colors hover:bg-slate-700">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {saveMsg && <p className="text-[10px] text-emerald-400 mt-1">{saveMsg}</p>}
          {saveError && <p className="text-[10px] text-red-400 mt-1">{saveError}</p>}
        </Field>
      )}

      {/* ── Sandbox ───────────────────────────────────────────────────────── */}
      <Field label="Execution">
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={sandbox} disabled={readonly}
            onChange={(e) => onSandboxToggle(e.target.checked)}
            className="mt-0.5 accent-sky-500" />
          <span className="text-xs text-slate-200 flex items-center gap-1.5">
            {sandbox
              ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              : <ShieldOff className="w-3.5 h-3.5 text-amber-400" />}
            Sandbox
          </span>
        </label>
        <p className="text-[10px] text-slate-500 leading-relaxed mt-1">
          {sandbox
            ? "The script runs isolated: no backend env vars, tools, bash, libraries or system deps."
            : "The script runs inside the backend process with full access to its env vars, libraries and tools."}
        </p>
        {!sandbox && (
          <p className="text-[10px] text-amber-400/90 leading-relaxed mt-1 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
            <span>Requires admin permission to save. Saving without it is rejected by the backend.</span>
          </p>
        )}
      </Field>

      {confirmUnsandbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsandbox-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-amber-500/40 bg-slate-900 p-4 shadow-xl">
            <h3 id="unsandbox-title" className="flex items-center gap-2 text-sm font-semibold text-amber-300">
              <ShieldOff className="w-4 h-4" />
              Run this script without a sandbox?
            </h3>
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-slate-300">
              <p>
                The script will be executed <strong>inside the backend process</strong>, not in an
                isolated one. It can read every environment variable that process holds — database
                credentials, LLM API keys, the service-auth private key — and act with the
                backend&apos;s own cloud identity.
              </p>
              <p>
                Only turn this off for a script you have read and trust. Anyone who can edit this
                workflow afterwards inherits the same access.
              </p>
              <p className="text-amber-400/90">
                Saving requires admin permission. Without it the backend rejects the workflow.
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmUnsandbox(false)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Keep sandbox
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange({ sandbox: false });
                  setConfirmUnsandbox(false);
                }}
                className="rounded-lg bg-amber-500/90 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
              >
                Turn off sandbox
              </button>
            </div>
          </div>
        </div>
      )}

      {sandbox && (
        <>
          <Field label="Sandbox runtime">
            <select value={runtime} disabled={readonly}
              onChange={(e) => onChange({ sandbox_runtime: e.target.value as "local" | "docker" | "k8s" })}
              className={inputCls}>
              <option value="local">local — child process</option>
              <option value="docker">docker — throw-away container</option>
              <option value="k8s">k8s — one-shot pod</option>
            </select>
          </Field>
          {runtime !== "local" && (
            <Field label="Sandbox image" hint="Defaults to the backend's SCRIPT_SANDBOX_IMAGE.">
              <input type="text" value={config.sandbox_image ?? ""} disabled={readonly}
                onChange={(e) => onChange({ sandbox_image: e.target.value || undefined })}
                placeholder="python:3.12-slim"
                className={`${inputCls} font-mono`} />
            </Field>
          )}
          <Field label="Timeout (seconds)" hint="Defaults to the backend's SCRIPT_SANDBOX_TIMEOUT.">
            <input type="number" min={1} value={config.timeout_seconds ?? ""} disabled={readonly}
              onChange={(e) => onChange({ timeout_seconds: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="60"
              className={`${inputCls} font-mono`} />
          </Field>
        </>
      )}

      <Field label="Output Key">
        <input type="text" value={config.output_key ?? ""} disabled={readonly}
          onChange={(e) => onChange({ output_key: e.target.value })}
          placeholder="e.g. result"
          className={`${inputCls} font-mono`} />
      </Field>
    </>
  );
}
