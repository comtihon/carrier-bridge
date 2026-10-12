"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, FileSpreadsheet, FolderOpen } from "lucide-react";
import { clsx } from "clsx";
import {
  resolveGoogleFile,
  tryDatasourceOperation,
  type DataSourceOperation,
  type GoogleFileResolution,
} from "@/lib/api";
import { GOOGLE_PICKER_API_KEY, GOOGLE_PICKER_CLIENT_ID } from "@/lib/config";
import { dsFieldCls, dsFieldMonoCls } from "./fieldStyles";

/**
 * Attaching a spreadsheet to a Google Sheets datasource.
 *
 * Access to a Google document is granted per document, by sharing it with the
 * service account the backend impersonates — so the one question this panel
 * answers is "can carrier actually read (and write) this one?", and only the
 * backend can answer it. Hence Verify: it calls `/datasources/google/resolve`,
 * which asks Drive as that account.
 *
 * "Not shared yet" is the *expected* first answer, not an error, so it gets the
 * share instruction and the address to copy rather than a red failure.
 *
 * The picker is a convenience on top. It signs the viewer into their own Google
 * account in this browser and needs an OAuth client id of its own, which is a
 * separate thing from the backend's service account and may simply not be
 * configured — so the button hides itself when `GOOGLE_PICKER_CLIENT_ID` is
 * empty and pasting the URL does the whole job on its own.
 */

const PICKER_SCRIPT_SRC = "https://apis.google.com/js/api.js";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

/** Minimal shape of the bits of `gapi` / the Picker this file touches. */
interface GapiWindow extends Window {
  gapi?: {
    load: (name: string, cb: () => void) => void;
    auth?: {
      authorize: (
        args: { client_id: string; scope: string[]; immediate: boolean },
        cb: (result: { access_token?: string; error?: string }) => void,
      ) => void;
    };
  };
  google?: {
    picker?: {
      // The Picker API is untyped here on purpose: pulling in @types/gapi for
      // one optional button is not worth the dependency.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
  };
}

/** One tab of the resolved spreadsheet, as `get_metadata` reports it. */
export interface SheetTab {
  sheetId: number;
  title: string;
  rowCount?: number;
  columnCount?: number;
}

interface SheetsMetadata {
  sheets?: { properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
  namedRanges?: { name?: string; namedRangeId?: string }[];
}

function parseTabs(payload: unknown): SheetTab[] {
  const meta = (payload ?? {}) as SheetsMetadata;
  return (meta.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((props): props is NonNullable<typeof props> => !!props?.title)
    .map((props) => ({
      sheetId: props.sheetId ?? 0,
      title: props.title as string,
      rowCount: props.gridProperties?.rowCount,
      columnCount: props.gridProperties?.columnCount,
    }));
}

/** Load the Picker's loader script once per page. */
function loadPickerScript(): Promise<GapiWindow["gapi"]> {
  const w = window as GapiWindow;
  if (w.gapi) return Promise.resolve(w.gapi);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PICKER_SCRIPT_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve((window as GapiWindow).gapi));
    script.addEventListener("error", () => reject(new Error("Could not load the Google Picker")));
    if (!existing) {
      script.src = PICKER_SCRIPT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

export function GoogleSheetsPanel({
  /** Operations of the draft source — `get_metadata` is run through try-operation. */
  operations,
  baseUrl,
  /** Stored source id in edit mode, so try-operation can use its stored auth. */
  sourceId,
  /** Address documents must be shared with, from the backend's template. */
  serviceAccount,
  spreadsheetId,
  onSpreadsheetIdChange,
  tab,
  onTabChange,
}: {
  operations: DataSourceOperation[];
  baseUrl: string;
  sourceId: string | null;
  serviceAccount: string;
  spreadsheetId: string;
  onSpreadsheetIdChange: (id: string) => void;
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const [ref, setRef] = useState(spreadsheetId);
  const [verifying, setVerifying] = useState(false);
  const [resolution, setResolution] = useState<GoogleFileResolution | null>(null);
  const [copied, setCopied] = useState(false);

  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState<string | null>(null);

  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const pickerAvailable = !!GOOGLE_PICKER_CLIENT_ID;

  /** Whether the draft can answer a metadata call at all. */
  const hasMetadataOp = useMemo(
    () => operations.some((op) => op.name === "get_metadata"),
    [operations],
  );

  // ── tab dropdown ─────────────────────────────────────────────────────────
  // Fed by the datasource's own `get_metadata` operation through try-operation,
  // rather than a second bespoke endpoint: the tab list is exactly what that
  // operation returns, and running it here also proves the source works.
  const loadSeq = useRef(0);

  const loadTabs = useCallback(async (fileId: string) => {
    if (!fileId || !hasMetadataOp) return;
    const seq = ++loadSeq.current;
    setTabsLoading(true);
    setTabsError(null);
    try {
      const result = await tryDatasourceOperation({
        base_url: baseUrl,
        kind: "http",
        source_id: sourceId,
        operations,
        operation: "get_metadata",
        params: { spreadsheet_id: fileId },
      });
      if (loadSeq.current !== seq) return;
      if (result.status !== "ok") {
        setTabs([]);
        setTabsError(result.error || "Could not read the spreadsheet's tabs");
        return;
      }
      const found = parseTabs(result.api_output);
      setTabs(found);
      setTabsError(found.length === 0 ? "The spreadsheet reports no tabs" : null);
    } catch (err) {
      if (loadSeq.current !== seq) return;
      setTabs([]);
      setTabsError(err instanceof Error ? err.message : "Backend unavailable");
    } finally {
      if (loadSeq.current === seq) setTabsLoading(false);
    }
  }, [baseUrl, hasMetadataOp, operations, sourceId]);

  /** Resolve a URL or file id through the backend, then fill the tab list. */
  const verify = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return;
    setVerifying(true);
    setResolution(null);
    setTabs([]);
    setTabsError(null);
    try {
      const result = await resolveGoogleFile(trimmed);
      setResolution(result);
      if (result.status === "ok" && result.file_id) {
        onSpreadsheetIdChange(result.file_id);
        await loadTabs(result.file_id);
      }
    } catch (err) {
      setResolution({
        status: "error",
        error: err instanceof Error ? err.message : "Backend unavailable",
        service_account: serviceAccount,
      });
    } finally {
      setVerifying(false);
    }
  }, [loadTabs, onSpreadsheetIdChange, serviceAccount]);

  // An already-attached spreadsheet (edit mode) is verified once on open, so
  // the panel opens showing whether access still works rather than nothing.
  const verifiedOnce = useRef(false);
  useEffect(() => {
    if (verifiedOnce.current || !spreadsheetId) return;
    verifiedOnce.current = true;
    verify(spreadsheetId);
  }, [spreadsheetId, verify]);

  const shareAddress = resolution?.service_account || serviceAccount;

  const copyAddress = useCallback(async () => {
    if (!shareAddress) return;
    try {
      await navigator.clipboard.writeText(shareAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the address is on screen either way.
      setCopied(false);
    }
  }, [shareAddress]);

  // ── Google Picker ────────────────────────────────────────────────────────
  const openPicker = useCallback(async () => {
    if (!pickerAvailable) return;
    setPickerError(null);
    setPickerBusy(true);
    try {
      const gapi = await loadPickerScript();
      if (!gapi) throw new Error("Could not load the Google Picker");

      const token = await new Promise<string>((resolve, reject) => {
        gapi.load("auth", () => {
          gapi.auth?.authorize(
            {
              client_id: GOOGLE_PICKER_CLIENT_ID,
              // drive.file is all the Picker needs: it grants access only to
              // what the user picks, not to their whole Drive.
              scope: ["https://www.googleapis.com/auth/drive.file"],
              immediate: false,
            },
            (result) => {
              if (result.access_token) resolve(result.access_token);
              else reject(new Error(result.error || "Google sign-in was cancelled"));
            },
          );
        });
      });

      await new Promise<void>((resolve, reject) => {
        gapi.load("picker", () => {
          const picker = (window as GapiWindow).google?.picker;
          if (!picker) {
            reject(new Error("Could not load the Google Picker"));
            return;
          }
          let builder = new picker.PickerBuilder()
            .addView(new picker.DocsView(picker.ViewId.SPREADSHEETS).setMimeTypes(SPREADSHEET_MIME_TYPE))
            .setOAuthToken(token)
            .setCallback((data: { action: string; docs?: { id: string; name?: string }[] }) => {
              if (data.action !== picker.Action.PICKED) return;
              const picked = data.docs?.[0];
              if (!picked) return;
              setRef(picked.id);
              // The Picker hands back an id, not a URL — the resolve endpoint
              // takes either, so the same Verify path runs.
              verify(picked.id);
            });
          // Optional: only needed for some Picker views, and it is a public
          // browser key rather than a secret.
          if (GOOGLE_PICKER_API_KEY) builder = builder.setDeveloperKey(GOOGLE_PICKER_API_KEY);
          builder.build().setVisible(true);
          resolve();
        });
      });
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : "The Picker could not be opened");
    } finally {
      setPickerBusy(false);
    }
  }, [pickerAvailable, verify]);

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/30 p-3">
      <label className="text-xs font-medium text-slate-400">Spreadsheet</label>
      <p className="text-[10px] text-slate-500">
        Paste the spreadsheet&apos;s URL, then verify. Carrier reads it as{" "}
        <span className="font-mono text-slate-400">{shareAddress || "(not configured)"}</span>, so the
        document has to be shared with that address.
      </p>

      <div className="flex gap-2">
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); verify(ref); }
          }}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className={clsx(dsFieldMonoCls, "flex-1")}
        />
        <button
          type="button"
          onClick={() => verify(ref)}
          disabled={!ref.trim() || verifying}
          title="Check, through the backend, whether carrier can read this spreadsheet"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-50 transition-colors shrink-0"
        >
          {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
          Verify
        </button>
        {/* Hidden entirely when no OAuth client is configured — a button that
            cannot work is worse than no button, and pasting the URL is the
            supported path regardless. */}
        {pickerAvailable && (
          <button
            type="button"
            onClick={openPicker}
            disabled={pickerBusy}
            title="Browse your Google Drive and pick a spreadsheet"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-50 transition-colors shrink-0"
          >
            {pickerBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
            Pick from Drive
          </button>
        )}
      </div>

      {pickerError && (
        <p className="text-[11px] text-amber-400 bg-amber-950/30 border border-amber-900 rounded-md px-2 py-1">
          {pickerError}
        </p>
      )}

      {/* Resolved */}
      {resolution?.status === "ok" && (
        <div className="space-y-1 rounded-md border border-emerald-800 bg-emerald-950/30 px-2 py-1.5 text-[11px]">
          <p className="text-emerald-300">
            <span className="font-semibold">{resolution.name || "(untitled)"}</span> — carrier can{" "}
            {resolution.can_edit ? "read and write it" : "read it (shared read-only)"}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500">
            <dt>file id</dt><dd className="text-slate-400 break-all">{resolution.file_id}</dd>
            <dt>type</dt><dd className="text-slate-400 break-all">{resolution.mime_type}</dd>
            <dt>writable</dt><dd className="text-slate-400">{resolution.can_edit ? "yes" : "no"}</dd>
          </dl>
          {!resolution.can_edit && (
            <p className="text-amber-400">
              Writes will be refused. Re-share it as <span className="font-mono">Editor</span> to allow them.
            </p>
          )}
        </div>
      )}

      {/* Not shared with us yet — the expected first outcome, so instructions
          rather than a failure. */}
      {resolution && (resolution.status === "no_access" || resolution.status === "not_configured") && (
        <div className="space-y-1.5 rounded-md border border-amber-900 bg-amber-950/30 px-2 py-1.5 text-[11px]">
          <p className="text-amber-300">{resolution.error}</p>
          {resolution.status === "no_access" && (
            <>
              <ol className="list-decimal list-inside space-y-0.5 text-slate-400 text-[10px]">
                <li>Open the spreadsheet and click <span className="text-slate-300">Share</span>.</li>
                <li>Paste the address below and give it <span className="text-slate-300">Editor</span> (Viewer is enough for read-only use).</li>
                <li>Come back and click <span className="text-slate-300">Verify</span> again.</li>
              </ol>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 rounded bg-slate-900/70 px-2 py-1 text-[10px] text-slate-300 break-all">
                  {shareAddress}
                </code>
                <button
                  type="button"
                  onClick={copyAddress}
                  title="Copy the address to share with"
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-300 transition-colors shrink-0"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {resolution && !["ok", "no_access", "not_configured"].includes(resolution.status) && (
        <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-900 rounded-md px-2 py-1">
          {resolution.error}
        </p>
      )}

      {/* Tab dropdown, filled from get_metadata once the document resolves. */}
      {resolution?.status === "ok" && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-[10px] text-slate-500">
            Default tab
            {tabsLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          </label>
          <select
            value={tab}
            onChange={(e) => onTabChange(e.target.value)}
            disabled={tabs.length === 0}
            className={clsx(dsFieldCls, "text-xs", !tab && "text-slate-500")}
          >
            <option value="">
              {tabsLoading ? "loading tabs…" : tabs.length ? "no default (state the range per call)" : "no tabs read"}
            </option>
            {tabs.map((t) => (
              <option key={t.sheetId} value={t.title}>
                {t.title}
                {t.rowCount && t.columnCount ? ` (${t.rowCount}×${t.columnCount})` : ""}
              </option>
            ))}
          </select>
          {tabsError && <p className="text-[10px] text-amber-400">{tabsError}</p>}
          {!tabsError && tab && (
            <p className="text-[10px] text-slate-500">
              Operations take a full A1 range, so a call on this tab looks like{" "}
              <span className="font-mono text-slate-400">{tab}!A1:D20</span>.
            </p>
          )}
          {!hasMetadataOp && (
            <p className="text-[10px] text-amber-400">
              This source has no <span className="font-mono">get_metadata</span> operation, so the tabs
              cannot be listed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
