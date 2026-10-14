"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { downloadRunDataArtifact } from "@/lib/api";
import { formatBytes, outputRefFilename, type OutputRef } from "@/lib/outputRef";

/**
 * A step output that the backend stored out of band: shows size, kind and the
 * preview instead of the reference object's raw JSON, plus a download when the
 * run response gave one (same bearer-authenticated fetch as run data files).
 */
export function StoredOutputRef({ value }: { value: OutputRef }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (!value.download_url) return;
    setBusy(true);
    setError(null);
    try {
      await downloadRunDataArtifact({ filename: outputRefFilename(value), download_url: value.download_url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 space-y-1" data-testid="stored-output-ref">
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span className="font-medium text-slate-300">stored output</span>
        <span className="tabular-nums">({formatBytes(value.bytes)}{value.kind ? `, ${value.kind}` : ""})</span>
        {value.download_url && (
          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded bg-sky-900/40 hover:bg-sky-900/70 border border-sky-700/50 text-sky-300 text-[11px] disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            Download
          </button>
        )}
      </div>
      {value.preview && (
        <p className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap break-words">
          {value.preview}…
        </p>
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
