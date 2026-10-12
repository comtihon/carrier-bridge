"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  Download,
  FileWarning,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import {
  downloadRunDataArtifact,
  downloadRunDataZip,
  getRunData,
  RunDataExpiredError,
  RunDataZipUnavailableError,
  type RunDataArtifact,
} from "@/lib/api";

/**
 * What a run's `data` steps captured, and how to download it.
 *
 * Two properties are load-bearing and everything else here is chrome:
 *
 *   1. A **truncated** artifact is a prefix of the data, not the whole of it,
 *      and the row says so in words on the surface — not in a tooltip, not in a
 *      colour a reader has to interpret. Someone downloading a partial export
 *      believing it complete is the one failure in this feature that does real
 *      damage, and it is silent, so the UI has to be loud.
 *
 *   2. An **expired** artifact is rendered as expired rather than offered as a
 *      download that will 410. When a download 410s anyway — the manifest was
 *      read a while ago, or the purge ran early — the row explains the
 *      retention window instead of reporting a failure, because that is what
 *      happened.
 *
 * `artifacts: []` is a normal outcome, not an error: plenty of runs have no
 * `data` step, and plenty more never reach the one they have.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatItems(items: number): string {
  return `${items.toLocaleString()} ${items === 1 ? "item" : "items"}`;
}

/** An unparseable timestamp is not treated as expired — that would hide a file. */
export function isExpired(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return false;
  return at <= now;
}

/** "in 6 days" / "3 hours ago", with the absolute date alongside it in the row. */
export function relativeExpiry(expiresAt: string, now: number = Date.now()): string {
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return expiresAt;
  const seconds = Math.round((at - now) / 1000);
  const ahead = seconds >= 0;
  const abs = Math.abs(seconds);
  const [value, unit] =
    abs < 3600 ? [Math.round(abs / 60), "minute"] :
    abs < 86400 ? [Math.round(abs / 3600), "hour"] :
    [Math.round(abs / 86400), "day"];
  const plural = value === 1 ? unit : `${unit}s`;
  return ahead ? `in ${value} ${plural}` : `${value} ${plural} ago`;
}

/** Per-row state that outlives the manifest: a 410 we learned about by trying. */
type RowState = { busy?: boolean; expiredMessage?: string; error?: string };

function TruncatedWarning({ artifact }: { artifact: RunDataArtifact }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-700/70 bg-amber-950/40 px-2 py-1.5">
      <FileWarning className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" />
      <p className="text-[11px] text-amber-200 leading-relaxed">
        <strong>This file is incomplete.</strong> It holds the first{" "}
        {artifact.items.toLocaleString()} {artifact.items === 1 ? "item" : "items"} and
        stops there — a prefix of the data, not all of it. Do not read it as the whole
        answer; narrow what the step selects, or export it in parts.
      </p>
    </div>
  );
}

function ArtifactRow({
  artifact,
  state,
  onDownload,
}: {
  artifact: RunDataArtifact;
  state: RowState;
  onDownload: () => void;
}) {
  const expired = state.expiredMessage !== undefined || isExpired(artifact.expires_at);

  return (
    <div className="py-2.5">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm text-slate-200 font-mono truncate">{artifact.filename}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[9px] font-medium uppercase tracking-wide text-slate-400">
              {artifact.format}
            </span>
            {artifact.truncated && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-900/70 border border-amber-600 text-[9px] font-bold uppercase tracking-wide text-amber-100">
                <AlertTriangle className="w-2.5 h-2.5" />
                Truncated — partial export
              </span>
            )}
            {expired && (
              <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                Expired
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            from step <span className="font-mono text-slate-400">{artifact.step_id}</span>
            {" · "}
            <span className="font-mono text-slate-400">{artifact.name}</span>
            {artifact.source_id && (
              <>
                {" · "}
                <span className="font-mono text-slate-500">
                  {artifact.source_id}
                  {artifact.operation ? `/${artifact.operation}` : ""}
                </span>
              </>
            )}
          </p>
          <p className="text-[11px] text-slate-500 flex items-center gap-1 flex-wrap">
            <span className="tabular-nums">{formatItems(artifact.items)}</span>
            <span className="text-slate-700">|</span>
            <span className="tabular-nums">{formatBytes(artifact.bytes)}</span>
            <span className="text-slate-700">|</span>
            <CalendarClock className="w-3 h-3" />
            <span className={clsx(expired ? "text-slate-500" : "text-slate-400")}>
              {expired ? "expired" : "expires"} {relativeExpiry(artifact.expires_at)}
              {" ("}
              {new Date(artifact.expires_at).toLocaleString()}
              {")"}
            </span>
          </p>
        </div>

        {expired ? (
          <span className="shrink-0 px-2.5 py-1 rounded-lg border border-slate-700 text-slate-500 text-xs">
            Not available
          </span>
        ) : (
          <button
            onClick={onDownload}
            disabled={state.busy}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-900/40 hover:bg-sky-900/70 border border-sky-700/50 text-sky-300 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.busy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            Download
          </button>
        )}
      </div>

      {artifact.truncated && <TruncatedWarning artifact={artifact} />}

      {state.expiredMessage && (
        <div className="mt-1.5 rounded-md border border-slate-700 bg-slate-800/40 px-2 py-1.5 space-y-0.5">
          <p className="text-[11px] text-slate-300">{state.expiredMessage}</p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Exports are kept only for the retention window; after it the file is
            purged and the bytes are gone. Re-run the workflow to export it again.
          </p>
        </div>
      )}

      {state.error && (
        <p className="mt-1.5 text-[11px] text-red-400">{state.error}</p>
      )}
    </div>
  );
}

export function RunDataPanel({ runId, onClose }: { runId: string; onClose?: () => void }) {
  const [artifacts, setArtifacts] = useState<RunDataArtifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  // The combined download is optional on the backend. Rather than probing for
  // it on open, the button is offered and retires itself on a 404 — one fewer
  // request, and the failure mode is a sentence instead of an error.
  const [zip, setZip] = useState<"idle" | "busy" | "unavailable">("idle");
  const [zipError, setZipError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArtifacts(null);
    setError(null);
    getRunData(runId)
      .then((manifest) => { if (!cancelled) setArtifacts(manifest.artifacts ?? []); })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [runId]);

  const setRow = useCallback((id: string, patch: RowState) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const handleDownload = useCallback(async (artifact: RunDataArtifact) => {
    setRow(artifact.id, { busy: true, error: undefined, expiredMessage: undefined });
    try {
      await downloadRunDataArtifact(artifact);
      setRow(artifact.id, { busy: false });
    } catch (err) {
      if (err instanceof RunDataExpiredError) {
        // Expected after the retention window, so it is explained rather than
        // reported: the row becomes an expired row, which is what it now is.
        setRow(artifact.id, { busy: false, expiredMessage: err.message });
        return;
      }
      setRow(artifact.id, {
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [setRow]);

  const handleZip = useCallback(async () => {
    setZip("busy");
    setZipError(null);
    try {
      await downloadRunDataZip(runId);
      setZip("idle");
    } catch (err) {
      if (err instanceof RunDataZipUnavailableError) {
        setZip("unavailable");
        return;
      }
      setZip("idle");
      setZipError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  const truncatedCount = useMemo(
    () => (artifacts ?? []).filter((a) => a.truncated).length,
    [artifacts],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Run data</h2>
          <p className="text-xs text-slate-400 font-mono mt-0.5">{runId}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <p className="mb-3 flex items-start gap-1.5 text-[11px] text-slate-500 leading-relaxed">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px text-emerald-500/70" />
        <span>
          Files the run&apos;s data steps captured. Capturing changed nothing about the
          run — these are copies of state, kept until they expire.
        </span>
      </p>

      {artifacts === null && !error && (
        <div className="flex items-center justify-center py-10">
          <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {artifacts !== null && artifacts.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-6 text-center space-y-1">
          <p className="text-sm text-slate-400">No data was captured on this run.</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Either the workflow has no data step, or the run did not reach one. That
            is normal — nothing failed.
          </p>
        </div>
      )}

      {artifacts !== null && artifacts.length > 0 && (
        <>
          {truncatedCount > 0 && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-600 bg-amber-950/40 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200 leading-relaxed">
                {truncatedCount === 1
                  ? "One of these files is truncated: it holds only the first part of its data."
                  : `${truncatedCount} of these files are truncated: they hold only the first part of their data.`}{" "}
                Each is marked below — do not treat one as a complete export.
              </p>
            </div>
          )}

          {artifacts.length > 1 && zip !== "unavailable" && (
            <div className="mb-2">
              <button
                onClick={handleZip}
                disabled={zip === "busy"}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {zip === "busy" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Archive className="w-3 h-3" />
                )}
                Download all
              </button>
              {zipError && <p className="mt-1 text-[11px] text-red-400">{zipError}</p>}
            </div>
          )}

          <div className="divide-y divide-slate-800">
            {artifacts.map((artifact) => (
              <ArtifactRow
                key={artifact.id}
                artifact={artifact}
                state={rows[artifact.id] ?? {}}
                onDownload={() => handleDownload(artifact)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
