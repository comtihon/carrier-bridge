"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCode2, Loader2, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { deleteScript, listScriptSummaries, type ScriptSummary } from "@/lib/api";
import { PanelShell } from "./dock";
import { PrivateBadge, canEdit } from "../Visibility";

/**
 * The script library. Clicking a script opens it in the centre editor; the
 * "New" button opens an unsaved draft there.
 *
 * The list is a summary — a row shows a name and a description, and shipping
 * every Python body to draw it was the heaviest response this UI asked for.
 * `onOpen` hands out an id, and the caller fetches the script's code.
 */
export function LibraryPanel({
  onClose, onOpen, onNew, selectedId, reloadToken,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  selectedId?: string | null;
  /** Bumped by the centre editor after a save so the list refreshes. */
  reloadToken?: number;
}) {
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ScriptSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setScripts(await listScriptSummaries());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scripts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadToken]);

  const handleDelete = useCallback(async (script: ScriptSummary) => {
    setConfirming(null);
    try {
      await deleteScript(script.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }, [load]);

  return (
    <>
      <PanelShell
        id="library"
        onClose={onClose}
        actions={
          <button onClick={onNew}
            title="New script"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold transition-colors">
            <Plus className="w-3 h-3" />New
          </button>
        }
      >
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && scripts.length === 0 && (
            <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>
          )}
          {error && (
            <p className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</p>
          )}
          {!loading && !error && scripts.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
              <p className="text-2xl">🐍</p>
              <p className="text-xs text-slate-500">No scripts yet.</p>
              <p className="text-[10px] text-slate-600">Save one from a Python node, or create one here.</p>
            </div>
          )}
          {scripts.map((s) => (
            <div key={s.id}
              onClick={() => onOpen(s.id)}
              className={clsx(
                "group rounded-xl border px-3 py-2.5 cursor-pointer transition-all",
                selectedId === s.id
                  ? "border-amber-600 bg-amber-950/30"
                  : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/40",
              )}>
              <div className="flex items-start gap-2">
                <FileCode2 className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-xs font-semibold text-slate-200 truncate">{s.name || s.id}</p>
                    <PrivateBadge resource={s} />
                  </div>
                  {s.description && (
                    <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5 leading-relaxed">{s.description}</p>
                  )}
                  <p className="text-[10px] text-slate-600 mt-1 font-mono truncate">{s.id}</p>
                </div>
                {canEdit(s) && (
                  <button onClick={(e) => { e.stopPropagation(); setConfirming(s); }}
                    className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {loading && scripts.length > 0 && (
            <Loader2 className="w-3 h-3 mx-auto text-slate-600 animate-spin" />
          )}
        </div>
      </PanelShell>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirming(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-xs w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-100 mb-1">Delete script?</p>
            <p className="text-xs text-slate-400 mb-4">
              <span className="font-mono text-slate-300">{confirming.name || confirming.id}</span> will be
              permanently removed. Workflow steps that reference it will fail at run time.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirming(null)}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDelete(confirming)}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-700 text-white hover:bg-red-600 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
