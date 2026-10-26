"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { deleteDatasource, listDatasourceSummaries, type DataSourceSummary } from "@/lib/api";
import { ACCESS_LABEL } from "../ResourceGrants";
import { PanelShell } from "./dock";
import { PrivateBadge, canEdit } from "../Visibility";
import { DatasourceRiskBadge } from "../DatasourceRiskBadge";

/**
 * Datasources: view, edit, add.
 *
 * Clicking a source opens it in the centre editor rather than over the app — its
 * operations carry queries and response schemas that need the room.
 *
 * Those same schemas are why the list is a summary: it keeps each operation's
 * name and method (the risk badge aggregates the methods) and drops the bodies.
 * `onOpen` hands out an id, and the caller fetches the full source.
 */
export function DatasourcesPanel({
  onClose, onOpen, onNew, selectedId, reloadToken,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  selectedId?: string | null;
  /** Bumped by the centre editor after a save so the list refreshes. */
  reloadToken?: number;
}) {
  const [items, setItems] = useState<DataSourceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DataSourceSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listDatasourceSummaries());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load datasources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadToken]);

  const handleDelete = useCallback(async (ds: DataSourceSummary) => {
    setConfirming(null);
    try {
      await deleteDatasource(ds.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }, [load]);

  return (
    <>
      <PanelShell
        id="datasources"
        onClose={onClose}
        actions={
          <button onClick={onNew}
            title="New datasource"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-[11px] font-semibold transition-colors">
            <Plus className="w-3 h-3" />New
          </button>
        }
      >
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>}
          {error && (
            <p className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</p>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
              <p className="text-2xl">🗄️</p>
              <p className="text-xs text-slate-500">No datasources yet.</p>
            </div>
          )}
          {items.map((ds) => (
            <div key={ds.id}
              onClick={() => onOpen(ds.id)}
              className={clsx(
                "group rounded-xl border px-3 py-2.5 cursor-pointer transition-all",
                selectedId === ds.id
                  ? "border-cyan-600 bg-cyan-950/30"
                  : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/40",
              )}>
              <div className="flex items-start gap-2">
                <Database className="w-4 h-4 mt-0.5 shrink-0 text-cyan-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-xs font-semibold text-slate-200 truncate">{ds.name || ds.id}</p>
                    <PrivateBadge resource={ds} />
                    {ds.granted_access && (
                      <span
                        title={`Shared with you — ${ACCESS_LABEL[ds.granted_access].toLowerCase()}`}
                        className="shrink-0 rounded border border-sky-800 bg-sky-950/40 px-1 text-[9px] text-sky-300"
                      >
                        shared · {ds.granted_access === "read" ? "read" : "read/write"}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{ds.base_url || ds.kind}</p>
                  <p className="text-[10px] text-slate-600 mt-1 font-mono">{ds.id}</p>
                </div>
                {/* A source in the list is not bound to one operation, so the
                    badge aggregates every operation it exposes. */}
                <DatasourceRiskBadge
                  operations={ds.operations ?? []}
                  kind={ds.kind}
                  className="mt-0.5"
                />
                {canEdit(ds) && (
                  <button onClick={(e) => { e.stopPropagation(); setConfirming(ds); }}
                    className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {loading && items.length > 0 && (
            <Loader2 className="w-3 h-3 mx-auto text-slate-600 animate-spin" />
          )}
        </div>
      </PanelShell>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirming(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-xs w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-100 mb-1">Delete datasource?</p>
            <p className="text-xs text-slate-400 mb-4">
              <span className="font-mono text-slate-300">{confirming.name || confirming.id}</span> will be permanently removed.
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
