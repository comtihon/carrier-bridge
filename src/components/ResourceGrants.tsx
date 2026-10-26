"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, KeyRound, Loader2, Trash2, User } from "lucide-react";
import { clsx } from "clsx";
import {
  grantAccess, listGrantCandidates, listGrants, revokeGrant,
  type GrantAccess, type GrantableKind, type GrantCandidates, type GranteeType,
  type Ownership, type ResourceGrant, type Sharing,
} from "@/lib/api";

/**
 * Who a datasource, agent or workflow has been opened to beyond its visibility.
 *
 * A grant goes to a user — who can then see it and use it in their own
 * private workflows — or to one workflow, which alone may use it (team A's
 * workflow calling team B's agent or workflow). What the access level adds
 * depends on the kind: on a datasource it is which operations may be called,
 * on an agent or a workflow whether the user may also edit it. A workflow
 * grantee of an agent or a workflow only ever uses it.
 *
 * The backend decides who may share (`can_share`: owner, the team's admins,
 * super admins) and enforces every grant; this panel lists, adds and revokes.
 * A grantee sees only their own access, never the list.
 */

type Shareable = Ownership & Sharing & { id: string };

const ACCESS: Record<GrantableKind, Record<GrantAccess, { label: string; note: string }>> = {
  datasource: {
    read: { label: "Read only", note: "can call its read operations only" },
    read_write: { label: "Read & write", note: "can call all of its operations" },
  },
  agent: {
    read: { label: "Use", note: "can use it in workflows, not change it" },
    read_write: { label: "Use & edit", note: "can use it and change it" },
  },
  workflow: {
    read: { label: "Run & call", note: "can run it and call it from workflows, not change it" },
    read_write: { label: "Run & edit", note: "can run, call and change it" },
  },
};

const NOUN: Record<GrantableKind, string> = {
  datasource: "datasource",
  agent: "agent",
  workflow: "workflow",
};

/** Datasource labels, for callers that only show datasources. */
export const ACCESS_LABEL: Record<GrantAccess, string> = {
  read: ACCESS.datasource.read.label,
  read_write: ACCESS.datasource.read_write.label,
};

export function accessLabel(kind: GrantableKind, access: GrantAccess): string {
  return ACCESS[kind][access].label;
}

const fieldCls =
  "rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50";

/** What a grantee is told about their own access. */
export function GrantedAccessNote({ kind, resource }: { kind: GrantableKind; resource: Shareable }) {
  const access = resource.granted_access ?? resource.granted_to_workflow;
  if (!access || resource.can_share) return null;
  const who = resource.granted_access ? "you" : "this workflow";
  const { label, note } = ACCESS[kind][access];
  return (
    <p className="text-[11px] text-sky-300/90 bg-sky-950/30 border border-sky-800/60 rounded-lg px-3 py-2">
      Shared with {who}: <span className="font-semibold">{label}</span> — {who} {note}.
    </p>
  );
}

function granteeLabel(grant: ResourceGrant): string {
  return grant.grantee_name || grant.grantee_id;
}

export function ResourceGrants({ kind, resource }: { kind: GrantableKind; resource: Shareable }) {
  const resourceId = resource.id;
  const [grants, setGrants] = useState<ResourceGrant[] | null>(resource.grants ?? null);
  const [candidates, setCandidates] = useState<GrantCandidates | null>(null);
  const [type, setType] = useState<GranteeType>("user");
  const [grantee, setGrantee] = useState("");
  const [access, setAccess] = useState<GrantAccess>("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = NOUN[kind];
  const levels = ACCESS[kind];
  // On an agent or a workflow a workflow grantee only ever uses it.
  const workflowUseOnly = kind !== "datasource";
  const showAccess = (t: GranteeType) => !(workflowUseOnly && t === "workflow");

  const reload = useCallback(async () => {
    try {
      setGrants(await listGrants(kind, resourceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load grants");
    }
  }, [kind, resourceId]);

  useEffect(() => {
    if (!resource.can_share) return;
    let live = true;
    reload();
    listGrantCandidates(kind, resourceId)
      .then((c) => { if (live) setCandidates(c); })
      .catch(() => { if (live) setCandidates({ users: [], workflows: [] }); });
    return () => { live = false; };
  }, [resource.can_share, kind, resourceId, reload]);

  if (!resource.can_share) return <GrantedAccessNote kind={kind} resource={resource} />;

  const isPublic = resource.visibility === "public";

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const id = grantee.trim();
    if (!id) return;
    return run(async () => {
      await grantAccess(kind, resourceId, {
        grantee_type: type, grantee_id: id, access: showAccess(type) ? access : "read",
      });
      setGrantee("");
    }, "Failed to grant access");
  }

  const revoke = (grant: ResourceGrant) =>
    run(() => revokeGrant(kind, resourceId, grant.id), "Failed to revoke access");

  const changeAccess = (grant: ResourceGrant, next: GrantAccess) =>
    run(
      () => grantAccess(kind, resourceId, { grantee_type: grant.grantee_type, grantee_id: grant.grantee_id, access: next }),
      "Failed to change access",
    );

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
        Let a user outside its team — or one specific workflow — use this {noun}.
        A user can use it in their private workflows; a workflow grant works in that
        workflow only. Revoke at any time.
      </p>

      {isPublic ? (
        <p className="text-[11px] text-slate-500">Public {noun}s are open to everyone; there is nothing to grant.</p>
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
                  {showAccess(g.grantee_type) ? (
                    <select
                      aria-label={`Access for ${granteeLabel(g)}`}
                      value={g.access}
                      disabled={busy}
                      onChange={(e) => changeAccess(g, e.target.value as GrantAccess)}
                      className={fieldCls}
                    >
                      <option value="read">{levels.read.label}</option>
                      <option value="read_write">{levels.read_write.label}</option>
                    </select>
                  ) : (
                    <span className="text-[10px] text-slate-400">{levels.read.label}</span>
                  )}
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
              list={`grant-candidates-${kind}-${type}`}
              value={grantee}
              onChange={(e) => setGrantee(e.target.value)}
              // Inside the editor's form: Enter grants rather than saving the form.
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              placeholder={type === "user" ? "user id or pick…" : "workflow id or pick…"}
              className={clsx(fieldCls, "flex-1 min-w-[10rem]")}
            />
            <datalist id={`grant-candidates-${kind}-${type}`}>
              {options.filter((o) => !granted.has(o.id)).map((o) => (
                <option key={o.id} value={o.id}>{o.hint ? `${o.label} — ${o.hint}` : o.label}</option>
              ))}
            </datalist>
            {showAccess(type) && (
              <select
                aria-label="Access"
                value={access}
                onChange={(e) => setAccess(e.target.value as GrantAccess)}
                className={fieldCls}
              >
                <option value="read">{levels.read.label}</option>
                <option value="read_write">{levels.read_write.label}</option>
              </select>
            )}
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
              {workflowUseOnly ? `That workflow may use this ${noun}; nobody gets to edit it this way. ` : ""}
              A workflow you cannot see can be granted by its id — ask its owner for it.
            </p>
          )}
        </>
      )}
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </section>
  );
}
