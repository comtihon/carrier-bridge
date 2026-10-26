"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, KeyRound, Loader2, Trash2, User } from "lucide-react";
import { clsx } from "clsx";
import {
  grantDatasource, listDatasourceGrantCandidates, listDatasourceGrants, revokeDatasourceGrant,
  type DataSourceDefinition, type DataSourceGrant, type GrantAccess, type GrantCandidates, type GranteeType,
} from "@/lib/api";

/**
 * Who a datasource has been opened to beyond its visibility.
 *
 * A grant goes to a user — who can then see the datasource and use it in their
 * own private workflows — or to one workflow, which alone may use it. Read
 * covers operations that do not write; read & write covers all of them.
 * Neither lets the grantee change the datasource.
 *
 * The backend decides who may share (`can_share`: owner, the team's admins,
 * super admins) and enforces every grant; this panel lists, adds and revokes.
 * A grantee sees only their own access, never the list.
 */

export const ACCESS_LABEL: Record<GrantAccess, string> = {
  read: "Read only",
  read_write: "Read & write",
};

const ACCESS_NOTE: Record<GrantAccess, string> = {
  read: "can call its read operations only",
  read_write: "can call all of its operations",
};

const fieldCls =
  "rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50";

/** What a grantee is told about their own access. */
export function GrantedAccessNote({ datasource }: { datasource: DataSourceDefinition }) {
  const access = datasource.granted_access ?? datasource.granted_to_workflow;
  if (!access || datasource.can_share) return null;
  const who = datasource.granted_access ? "you" : "this workflow";
  return (
    <p className="text-[11px] text-sky-300/90 bg-sky-950/30 border border-sky-800/60 rounded-lg px-3 py-2">
      Shared with {who}: <span className="font-semibold">{ACCESS_LABEL[access]}</span> — {who}{" "}
      {ACCESS_NOTE[access]}.
    </p>
  );
}

function granteeLabel(grant: DataSourceGrant): string {
  return grant.grantee_name || grant.grantee_id;
}

export function DatasourceGrants({ datasource }: { datasource: DataSourceDefinition }) {
  const sourceId = datasource.id;
  const [grants, setGrants] = useState<DataSourceGrant[] | null>(datasource.grants ?? null);
  const [candidates, setCandidates] = useState<GrantCandidates | null>(null);
  const [type, setType] = useState<GranteeType>("user");
  const [grantee, setGrantee] = useState("");
  const [access, setAccess] = useState<GrantAccess>("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setGrants(await listDatasourceGrants(sourceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load grants");
    }
  }, [sourceId]);

  useEffect(() => {
    if (!datasource.can_share) return;
    let live = true;
    reload();
    listDatasourceGrantCandidates(sourceId)
      .then((c) => { if (live) setCandidates(c); })
      .catch(() => { if (live) setCandidates({ users: [], workflows: [] }); });
    return () => { live = false; };
  }, [datasource.can_share, sourceId, reload]);

  if (!datasource.can_share) return <GrantedAccessNote datasource={datasource} />;

  const isPublic = datasource.visibility === "public";

  async function add() {
    const id = grantee.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await grantDatasource(sourceId, { grantee_type: type, grantee_id: id, access });
      setGrantee("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant access");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(grant: DataSourceGrant) {
    setBusy(true);
    setError(null);
    try {
      await revokeDatasourceGrant(sourceId, grant.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke access");
    } finally {
      setBusy(false);
    }
  }

  async function changeAccess(grant: DataSourceGrant, next: GrantAccess) {
    setBusy(true);
    setError(null);
    try {
      await grantDatasource(sourceId, { grantee_type: grant.grantee_type, grantee_id: grant.grantee_id, access: next });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change access");
    } finally {
      setBusy(false);
    }
  }

  const granted = new Set((grants ?? []).filter((g) => g.grantee_type === type).map((g) => g.grantee_id));
  const options = type === "user"
    ? (candidates?.users ?? []).map((u) => ({ id: u.id, label: u.name || u.email || u.id, hint: u.email }))
    : (candidates?.workflows ?? []).map((w) => ({ id: w.id, label: w.name, hint: w.owner_name }));

  return (
    <section aria-label="Shared access" className="space-y-2 rounded-lg border border-slate-700/80 bg-slate-900/40 p-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-3.5 h-3.5 text-sky-400" />
        <h3 className="text-xs font-medium text-slate-300">Shared access</h3>
      </div>
      <p className="text-[10px] text-slate-500">
        Let a user outside its team — or one specific workflow — use this datasource.
        A user can use it in their private workflows; a workflow grant works in that
        workflow only. Revoke at any time.
      </p>

      {isPublic ? (
        <p className="text-[11px] text-slate-500">Public datasources are open to everyone; there is nothing to grant.</p>
      ) : (
        <>
          {grants === null ? (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> loading…</p>
          ) : grants.length === 0 ? (
            <p className="text-[11px] text-slate-500">Not shared beyond its visibility.</p>
          ) : (
            <ul className="divide-y divide-slate-800 rounded border border-slate-800">
              {grants.map((g) => (
                <li key={g.id} className="flex items-center gap-2 px-2 py-1.5" data-testid="grant-row">
                  {g.grantee_type === "user"
                    ? <User className="w-3 h-3 text-slate-400 shrink-0" aria-hidden />
                    : <GitBranch className="w-3 h-3 text-violet-400 shrink-0" aria-hidden />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200 truncate">
                      {granteeLabel(g)}
                      {g.grantee_name && g.grantee_name !== g.grantee_id && (
                        <span className="ml-1 font-mono text-[10px] text-slate-500">{g.grantee_id}</span>
                      )}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {g.grantee_type === "workflow" ? "Workflow" : "User"}
                      {g.granted_by_name ? ` · granted by ${g.granted_by_name}` : ""}
                      {g.granted_at ? ` · ${new Date(g.granted_at).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <select
                    aria-label={`Access for ${granteeLabel(g)}`}
                    value={g.access}
                    disabled={busy}
                    onChange={(e) => changeAccess(g, e.target.value as GrantAccess)}
                    className={fieldCls}
                  >
                    <option value="read">{ACCESS_LABEL.read}</option>
                    <option value="read_write">{ACCESS_LABEL.read_write}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => revoke(g)}
                    disabled={busy}
                    title="Revoke"
                    aria-label={`Revoke access for ${granteeLabel(g)}`}
                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded overflow-hidden border border-slate-600 text-[11px]" role="radiogroup" aria-label="Grant to">
              {(["user", "workflow"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  onClick={() => { setType(t); setGrantee(""); }}
                  className={clsx(
                    "px-2 py-1 transition-colors",
                    type === t ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200",
                  )}
                >
                  {t === "user" ? "User" : "Workflow"}
                </button>
              ))}
            </div>
            <input
              aria-label={type === "user" ? "User id" : "Workflow id"}
              list={`grant-candidates-${type}`}
              value={grantee}
              onChange={(e) => setGrantee(e.target.value)}
              // Inside the datasource form: Enter grants rather than saving the form.
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              placeholder={type === "user" ? "user id or pick…" : "workflow id or pick…"}
              className={clsx(fieldCls, "flex-1 min-w-[10rem]")}
            />
            <datalist id={`grant-candidates-${type}`}>
              {options.filter((o) => !granted.has(o.id)).map((o) => (
                <option key={o.id} value={o.id}>{o.hint ? `${o.label} — ${o.hint}` : o.label}</option>
              ))}
            </datalist>
            <select
              aria-label="Access"
              value={access}
              onChange={(e) => setAccess(e.target.value as GrantAccess)}
              className={fieldCls}
            >
              <option value="read">{ACCESS_LABEL.read}</option>
              <option value="read_write">{ACCESS_LABEL.read_write}</option>
            </select>
            <button
              type="button"
              onClick={add}
              disabled={busy || !grantee.trim()}
              className="px-2.5 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white text-xs disabled:opacity-50"
            >
              Grant
            </button>
          </div>
          {type === "workflow" && (
            <p className="text-[10px] text-slate-500">
              A workflow you cannot see can be granted by its id — ask its owner for it.
            </p>
          )}
        </>
      )}
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </section>
  );
}
