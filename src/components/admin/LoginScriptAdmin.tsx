"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Lock, Play, Power, Save, XCircle } from "lucide-react";
import {
  getLoginScript, listUsers, saveLoginScript, testLoginScript,
  type LoginScript, type LoginScriptTestResult, type UserInfo,
} from "@/lib/api";
import { CodeEditor } from "../CodeEditor";

export const SAMPLE_CLAIMS = JSON.stringify(
  { sub: "123", email: "user@example.com", groups: ["engineering"] },
  null,
  2,
);

export const SCRIPT_TEMPLATE = `function onLogin(ctx) {
  // ctx.claims: the identity provider's token claims
  // ctx.user:   the stored user, or null on first login
  // ctx.teams:  every team, [{ id, name }]
  const groups = ctx.claims.groups || [];
  if (groups.includes("engineering")) {
    return { team: { name: "Engineering", role: "member" } };
  }
  // Return nothing (or omit "team") to keep the membership set by hand.
}
`;

const SOURCE_LABEL: Record<LoginScript["source"], string> = {
  config: "deployment config",
  db: "stored here",
  none: "disabled",
};

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
}

/**
 * The script that runs at every login and may set a user's roles, name,
 * email and team from the identity provider's claims. Super admins edit it
 * here unless the deployment's config pins it, and can dry-run any draft
 * against sample claims before saving.
 */
export function LoginScriptAdmin() {
  const [script, setScript] = useState<LoginScript | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const adopt = useCallback((s: LoginScript) => {
    setScript(s);
    setDraft(s.script ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLoginScript()
      .then((s) => { if (!cancelled) adopt(s); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load the login script"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [adopt]);

  const readOnly = !script || !script.editable || script.source === "config";
  const dirty = !!script && draft !== (script.script ?? "");

  async function store(next: string | null, done: string) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      adopt(await saveLoginScript(next));
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading…</span>
      </div>
    );
  }
  if (loadError || !script) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-red-400">Could not load the login script</p>
        <p className="text-xs font-mono text-slate-500">{loadError}</p>
      </div>
    );
  }

  const updated = formatWhen(script.updated_at);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span>Source: <span className="text-slate-200" data-testid="login-script-source">{SOURCE_LABEL[script.source]}</span></span>
        <span>Timeout: <span className="text-slate-200">{script.timeout_ms} ms</span></span>
        {(updated || script.updated_by) && (
          <span>
            Last changed{updated ? ` ${updated}` : ""}{script.updated_by ? ` by ${script.updated_by}` : ""}
          </span>
        )}
      </div>

      {script.source === "config" && (
        <p role="note" className="flex items-start gap-1.5 text-[11px] text-slate-300 bg-slate-800/60 border border-slate-700 rounded px-2 py-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400" />
          <span>
            This script is set in the deployment&apos;s configuration, so it is read-only here. Change it in the
            config and redeploy; you can still test it below.
          </span>
        </p>
      )}
      {script.source !== "config" && !script.editable && (
        <p role="note" className="text-[11px] text-slate-400">The backend does not allow editing the login script.</p>
      )}

      <LoginScriptHelp />

      <section className="space-y-2">
        <CodeEditor value={draft} onChange={setDraft} language="javascript" readOnly={readOnly}
          placeholder={readOnly ? "No login script." : "function onLogin(ctx) { … }"} minHeight={240} />
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button onClick={() => store(draft, draft.trim() ? "Saved." : "Login script disabled.")} disabled={saving || !dirty}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save
            </button>
            {script.source === "db" && (
              <button onClick={() => setConfirmDisable(true)} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold disabled:opacity-40">
                <Power className="w-3.5 h-3.5" />Disable
              </button>
            )}
            {!draft.trim() && script.source === "none" && (
              <button onClick={() => setDraft(SCRIPT_TEMPLATE)}
                className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs">
                Start from example
              </button>
            )}
            {dirty && <span className="text-[11px] text-amber-400">Unsaved changes</span>}
            {notice && !dirty && <span className="text-[11px] text-emerald-400">{notice}</span>}
          </div>
        )}
        {confirmDisable && (
          <div className="text-[11px] text-slate-400 bg-red-950/20 border border-red-900/60 rounded px-2 py-1.5 flex items-center gap-2">
            <p className="flex-1">Disable the login script? It is removed and stops running at login; teams and roles already set stay as they are.</p>
            <button onClick={() => setConfirmDisable(false)} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
            <button onClick={() => { setConfirmDisable(false); store(null, "Login script disabled."); }}
              className="px-2 py-0.5 rounded bg-red-700 text-white hover:bg-red-600">Disable</button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[11px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1 whitespace-pre-wrap font-mono">{error}</p>
        )}
      </section>

      <LoginScriptTester draft={readOnly ? null : draft} />
    </div>
  );
}

function LoginScriptHelp() {
  return (
    <details className="text-[11px] text-slate-400 bg-slate-900/40 border border-slate-800 rounded px-3 py-2">
      <summary className="cursor-pointer text-slate-300">How the login script works</summary>
      <div className="mt-2 space-y-1.5">
        <p>
          Define <code className="text-slate-200">function onLogin(ctx)</code>. It runs at every login with
          {" "}<code className="text-slate-200">ctx = {"{ claims, user, teams }"}</code>: the identity provider&apos;s
          token claims, the stored user (or null on first login), and every team.
        </p>
        <p>
          Return nothing to change nothing, or an object with any of
          {" "}<code className="text-slate-200">roles</code>, <code className="text-slate-200">name</code>,
          {" "}<code className="text-slate-200">email</code> and <code className="text-slate-200">team</code>.
          {" "}<code className="text-slate-200">team</code> is <code className="text-slate-200">null</code> (no team) or
          {" "}<code className="text-slate-200">{"{ name | id, role }"}</code> with role <code className="text-slate-200">member</code> or
          {" "}<code className="text-slate-200">admin</code>.
        </p>
        <p>Leaving <code className="text-slate-200">team</code> out keeps the membership set by hand. Saving an empty script disables it.</p>
      </div>
    </details>
  );
}

/** Dry-run a script against sample claims (and optionally a stored user) without saving it. */
function LoginScriptTester({ draft }: { draft: string | null }) {
  const [claims, setClaims] = useState(SAMPLE_CLAIMS);
  const [sub, setSub] = useState("");
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LoginScriptTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listUsers().then(setUsers, () => setUsers([]));
  }, []);

  async function run() {
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(claims);
    } catch (err) {
      setError(`Claims are not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Claims must be a JSON object.");
      return;
    }
    setRunning(true);
    try {
      setResult(await testLoginScript({
        // An editable draft is tested as written; otherwise the stored script runs.
        ...(draft !== null && draft.trim() ? { script: draft } : {}),
        claims: parsed as Record<string, unknown>,
        ...(sub ? { sub } : {}),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-2 border-t border-slate-800 pt-3">
      <h3 className="text-xs font-semibold text-slate-200">Test</h3>
      <p className="text-[11px] text-slate-500">
        Runs the script above against these claims without saving anything. Pick a user to pass their stored record as
        {" "}<code>ctx.user</code>.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide text-slate-500" htmlFor="login-script-claims">Claims (JSON)</label>
          <textarea id="login-script-claims" value={claims} onChange={(e) => setClaims(e.target.value)} spellCheck={false}
            rows={8}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-[12px] text-slate-200 focus:outline-none focus:border-emerald-500" />
          <div className="flex items-center gap-2">
            <select aria-label="Test as user" value={sub} onChange={(e) => setSub(e.target.value)}
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500">
              <option value="">No stored user</option>
              {users.map((u) => <option key={u.sub} value={u.sub}>{u.name || u.email || u.sub}</option>)}
            </select>
            <button onClick={run} disabled={running}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold disabled:opacity-40">
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}Run test
            </button>
          </div>
        </div>
        <div className="space-y-1" data-testid="login-script-test-result">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Result</span>
          {error && <p role="alert" className="text-[11px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</p>}
          {!error && !result && <p className="text-[11px] text-slate-600">Not run yet.</p>}
          {result && (
            <div className="space-y-1">
              <p className={result.ok ? "flex items-center gap-1 text-[11px] text-emerald-400" : "flex items-center gap-1 text-[11px] text-red-400"}>
                {result.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {result.ok ? "OK" : "Failed"}
                <span className="text-slate-500">· {result.duration_ms} ms</span>
              </p>
              {result.error && <pre className="text-[11px] text-red-300 bg-red-950/20 border border-red-900/60 rounded px-2 py-1 whitespace-pre-wrap">{result.error}</pre>}
              {result.ok && (
                <pre className="text-[11px] text-slate-200 bg-slate-950 border border-slate-800 rounded px-2 py-1 overflow-auto max-h-64">
                  {result.result === null ? "null (no changes)" : JSON.stringify(result.result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
