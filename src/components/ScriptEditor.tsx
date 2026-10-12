"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCode2, Loader2, Save, X } from "lucide-react";
import {
  createScript,
  updateScript,
  ScriptNameConflictError,
  type Ownership,
  type ScriptDefinition,
} from "@/lib/api";
import { CodeEditor } from "./CodeEditor";
import { AccessSection, canEdit, useVisibilityDraft } from "./Visibility";

export interface ScriptDraft extends Ownership {
  /** null for a script that has never been saved. */
  id: string | null;
  name: string;
  description: string;
  code: string;
}

const inputCls =
  "w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 " +
  "placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors";

/**
 * Centre-pane editor for one library script.
 *
 * A new script is POSTed; a name that is already taken comes back as a 409 and
 * turns into an overwrite confirmation. An existing script is PUT in place, so
 * its id (and therefore every `script_id` reference) survives a rename.
 */
export function ScriptEditor({
  draft, onSaved, onClose,
}: {
  draft: ScriptDraft;
  onSaved: (script: ScriptDefinition) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [code, setCode] = useState(draft.code);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const access = useVisibilityDraft(draft, !draft.id);
  const readOnly = !!draft.id && !canEdit(draft);

  // Switching to another script in the library replaces the form contents.
  useEffect(() => {
    setName(draft.name);
    setDescription(draft.description);
    setCode(draft.code);
    setError(null);
    setConflict(false);
    setSavedAt(null);
  }, [draft]);

  const save = useCallback(async (overwrite: boolean) => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = draft.id
        ? await updateScript(draft.id, { name: name.trim(), description, code, ...access.payload })
        : await createScript({ name: name.trim(), description, code, overwrite, ...access.payload });
      setConflict(false);
      setSavedAt(new Date().toLocaleTimeString());
      onSaved(saved);
    } catch (err) {
      if (err instanceof ScriptNameConflictError) setConflict(true);
      else setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [draft.id, name, description, code, onSaved, access.payload]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 shrink-0">
        <FileCode2 className="w-5 h-5 text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">
            {draft.id ? name || draft.id : "New script"}
          </p>
          {draft.id && <p className="text-[10px] text-slate-500 font-mono truncate">{draft.id}</p>}
        </div>
        {savedAt && <span className="text-[10px] text-emerald-400">Saved {savedAt}</span>}
        {!readOnly && (
          <button onClick={() => save(false)} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        )}
        <button onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors"
          title="Close editor">
          <X className="w-4 h-4" />
        </button>
      </div>

      {conflict && (
        <div className="mx-6 mt-4 rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-3 flex items-center gap-3">
          <p className="text-xs text-amber-200 flex-1">
            A script named <span className="font-mono">{name}</span> already exists. Overwrite it?
          </p>
          <button onClick={() => save(true)} disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors disabled:opacity-50">
            Overwrite
          </button>
          <button onClick={() => setConflict(false)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs transition-colors hover:bg-slate-700">
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="mx-6 mt-4 text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <AccessSection resource={draft} isNew={!draft.id} draft={access} kind="script" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Name</label>
            <input type="text" value={name} onChange={(e) => { setName(e.target.value); setConflict(false); }}
              disabled={readOnly} placeholder="e.g. Normalize Jira payload" className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly} placeholder="What does this script do?" className={inputCls} />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Code</label>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Runs with a <span className="font-mono text-slate-400">state</span> dict in scope; assign{" "}
            <span className="font-mono text-slate-400">output</span> to store a result.
          </p>
          <CodeEditor value={code} onChange={setCode} minHeight={360} readOnly={readOnly}
            placeholder={'# state dict is available\noutput = state["plan"].upper()'} />
        </div>
      </div>
    </div>
  );
}
