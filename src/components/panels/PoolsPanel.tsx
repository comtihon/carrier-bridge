"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Gauge, Laptop, Loader2, LogOut, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import {
  createRuntimePool, deleteRuntimePool, isSuperAdmin, joinRuntimePool, leaveRuntimePool, listAgents,
  listRuntimePools,
  type AgentDefinition, type CurrentUser, type RuntimePool, type Visibility,
} from "@/lib/api";
import { agentDisplayName, formatClock } from "@/lib/runners";
import { PanelShell } from "./dock";
import { VisibilityBadge, VisibilityControl, canEdit, useCurrentUser, useTeams } from "../Visibility";

/**
 * Runtime pools: sets of runner agents that pool agents (`default_runtime:
 * "pool"`) run on — typically a team's pool of its members' machines.
 *
 * A card shows how many members are online now, each member's machine, owner
 * and quota, and the unfinished runs holding it (a run keeps its member for
 * all its steps). Only an agent's owner can add it ("Add my agent": their
 * runner agents not in the pool yet), private agents included; the owner, the
 * pool's editors and its team's admins can remove one. Online state changes on
 * its own, so the list reloads on a slow interval.
 */

const RELOAD_MS = 15_000;

export function PoolsPanel({ onClose, reloadToken }: {
  onClose: () => void;
  reloadToken?: number;
}) {
  const me = useCurrentUser();
  const [pools, setPools] = useState<RuntimePool[]>([]);
  const [mine, setMine] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [p, agents] = await Promise.all([listRuntimePools(), listAgents().catch(() => [])]);
      setPools(p);
      setMine(agents.filter((a) => a.default_runtime === "runner"));
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runtime pools");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadToken]);
  useEffect(() => {
    const id = setInterval(() => load(true), RELOAD_MS);
    return () => clearInterval(id);
  }, [load]);

  /** Run a change, then reload; the backend's refusal is shown as is. */
  const act = useCallback(async (change: () => Promise<unknown>) => {
    setError(null);
    try {
      await change();
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }, [load]);

  // Only the caller's own runner agents may join a pool.
  const ownAgents = mine.filter((a) => !me?.sub || !a.owner_id || a.owner_id === me.sub);

  return (
    <PanelShell
      id="pools"
      onClose={onClose}
      actions={
        <button onClick={() => setCreating((v) => !v)}
          title="New runtime pool"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-[11px] font-semibold transition-colors">
          <Plus className="w-3 h-3" />New
        </button>
      }
    >
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {error && (
          <p role="alert" className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</p>
        )}
        {creating && (
          <NewPoolForm me={me} onCancel={() => setCreating(false)}
            onSave={(payload) => act(() => createRuntimePool(payload)).then(() => setCreating(false))} />
        )}
        {loading && pools.length === 0 && (
          <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>
        )}
        {!loading && !error && pools.length === 0 && !creating && (
          <div className="flex flex-col items-center justify-center gap-2 text-center py-6">
            <Boxes className="w-6 h-6 text-slate-600" />
            <p className="text-xs text-slate-500">No runtime pools.</p>
            <p className="text-[10px] text-slate-600 px-2">
              A pool lets team workflows run on members&apos; machines, one machine per run.
            </p>
            <button onClick={() => setCreating(true)} className="text-[11px] text-teal-400 hover:underline">Create a pool</button>
          </div>
        )}
        {pools.map((p) => (
          <PoolCard key={p.id} pool={p} me={me} now={now} ownAgents={ownAgents} act={act} />
        ))}
        {loading && pools.length > 0 && <Loader2 className="w-3 h-3 mx-auto text-slate-600 animate-spin" />}
      </div>
    </PanelShell>
  );
}

function PoolCard({ pool, me, now, ownAgents, act }: {
  pool: RuntimePool;
  me: CurrentUser | null;
  now: number;
  ownAgents: AgentDefinition[];
  act: (change: () => Promise<unknown>) => Promise<void>;
}) {
  const editable = canEdit(pool);
  const [joinId, setJoinId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const memberIds = new Set(pool.members.map((m) => m.agent_id));
  const joinable = ownAgents.filter((a) => !memberIds.has(a.id));
  const ownIds = new Set(ownAgents.map((a) => a.id));
  const teamAdmin = me?.team?.role === "admin" && pool.visibility === "team" && pool.team_id === me.team.id;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 space-y-2" data-testid={`pool-${pool.id}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Boxes className="w-3.5 h-3.5 shrink-0 text-teal-400" />
        <p className="flex-1 text-xs font-semibold text-slate-200 truncate" title={pool.description ?? pool.id}>{pool.name || pool.id}</p>
        <span data-testid="pool-online"
          title={`${pool.online_count} of ${pool.member_count} member(s) online, ${pool.available_count} in quota`}
          className={clsx("shrink-0 px-1 rounded border text-[10px]",
            pool.available_count > 0 ? "border-emerald-800 text-emerald-300" : "border-slate-700 text-slate-500")}>
          {pool.online_count}/{pool.member_count} online
        </span>
        <VisibilityBadge resource={pool} />
        {editable && (
          <button onClick={() => setConfirmDelete(true)} title="Delete pool"
            className="p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
        )}
      </div>
      {pool.description && <p className="text-[10px] text-slate-500">{pool.description}</p>}

      {confirmDelete && (
        <div className="text-[10px] text-slate-400 bg-red-950/20 border border-red-900/60 rounded px-2 py-1.5 space-y-1.5">
          <p>Delete <span className="text-slate-200">{pool.name || pool.id}</span>? Refused while an agent runs on it.</p>
          <div className="flex gap-1.5 justify-end">
            <button onClick={() => setConfirmDelete(false)} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
            <button onClick={() => { setConfirmDelete(false); act(() => deleteRuntimePool(pool.id)); }}
              className="px-2 py-0.5 rounded bg-red-700 text-white hover:bg-red-600">Delete</button>
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {pool.members.length === 0 && <li className="text-[10px] text-slate-600 italic">No members yet</li>}
        {pool.members.map((m) => {
          const removable = ownIds.has(m.agent_id) || editable || teamAdmin;
          return (
            <li key={m.agent_id} className="space-y-0.5" data-testid={`member-${m.agent_id}`}>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-300 min-w-0">
                <span
                  title={!m.usable ? "Agent or machine is gone" : m.online ? "Online" : "Offline"}
                  aria-label={!m.usable ? "Gone" : m.online ? "Online" : "Offline"}
                  className={clsx("w-2 h-2 rounded-full shrink-0",
                    !m.usable ? "bg-red-500" : m.online ? "bg-emerald-400" : "bg-slate-600")}
                />
                <Laptop className="w-3 h-3 shrink-0 text-slate-500" />
                <span className="truncate flex-1" title={m.name ?? m.agent_id}>
                  {m.acp_agent ? agentDisplayName(m.acp_agent) : (m.name ?? m.agent_id)}
                  {m.runner_name && <span className="text-slate-500"> on {m.runner_name}</span>}
                </span>
                {m.runs.length > 0 && (
                  <span title={m.runs.map((r) => r.run_id).join("\n")}
                    className="shrink-0 px-1 rounded border border-violet-800 text-[10px] text-violet-300">
                    {m.runs.length} run{m.runs.length === 1 ? "" : "s"}
                  </span>
                )}
                {removable && (
                  <button onClick={() => act(() => leaveRuntimePool(pool.id, m.agent_id))}
                    aria-label={`Remove ${m.agent_id} from ${pool.id}`}
                    title={ownIds.has(m.agent_id) ? "Take my agent out of this pool" : "Remove from pool"}
                    className="p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400"><LogOut className="w-3 h-3" /></button>
                )}
              </div>
              <p className="pl-4 text-[10px] text-slate-500">
                {m.owner_name ? <>owner <span className="text-slate-400">{m.owner_name}</span></> : null}
                {m.visibility === "private" && <span className="text-slate-600"> · private</span>}
              </p>
              {m.limited_until && (
                <p className="flex items-center gap-1 pl-4 text-[10px] text-amber-300">
                  <Gauge className="w-3 h-3 shrink-0" />
                  out of quota{m.limited_until !== "unknown" ? ` until ${formatClock(m.limited_until, now)}` : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {joinable.length > 0 && (
        <form className="flex items-center gap-1" onSubmit={(e) => {
          e.preventDefault();
          if (joinId) act(() => joinRuntimePool(pool.id, joinId)).then(() => setJoinId(""));
        }}>
          <select aria-label={`Add my agent to ${pool.id}`} value={joinId} onChange={(e) => setJoinId(e.target.value)}
            className="flex-1 min-w-0 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 focus:outline-none">
            <option value="">Add my agent…</option>
            {joinable.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
          <button type="submit" disabled={!joinId}
            title="Workflows using this pool may then run on that machine"
            className="px-1.5 py-0.5 rounded bg-teal-700 text-[10px] text-white hover:bg-teal-600 disabled:opacity-40">Add</button>
        </form>
      )}
    </div>
  );
}

/** Id, name and visibility of a new pool; teams are the usual scope. */
function NewPoolForm({ me, onCancel, onSave }: {
  me: CurrentUser | null;
  onCancel: () => void;
  onSave: (payload: { id: string; name: string; visibility: Visibility; team_id?: string }) => void;
}) {
  const superAdmin = isSuperAdmin(me);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<Visibility>(me?.team ? "team" : "private");
  const [teamId, setTeamId] = useState("");
  const teams = useTeams(superAdmin && visibility === "team");
  const validId = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);

  return (
    <form className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!validId) return;
        onSave({
          id, name: name.trim() || id, visibility,
          ...(visibility === "team" && superAdmin && teamId ? { team_id: teamId } : {}),
        });
      }}>
      <input aria-label="Pool id" value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="id, e.g. engineering"
        className="w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-teal-500" />
      <input aria-label="Pool name" value={name} onChange={(e) => setName(e.target.value)} placeholder="name"
        className="w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-teal-500" />
      <VisibilityControl
        value={visibility}
        onChange={setVisibility}
        withTeam={!!me && "team" in me}
        teamLabel={!superAdmin && me?.team?.name ? me.team.name : "Team"}
        teamUnavailable={!superAdmin && !me?.team ? "You're not in a team" : undefined}
      />
      {superAdmin && visibility === "team" && (
        <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}
          className="w-full rounded bg-slate-800 border border-slate-600 px-1.5 py-1 text-[11px] text-slate-100 focus:outline-none">
          <option value="">{teams ? "— select a team —" : "loading…"}</option>
          {(teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <div className="flex gap-1.5 justify-end">
        <button type="button" onClick={onCancel} className="px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300 hover:bg-slate-700">Cancel</button>
        <button type="submit" disabled={!validId || (visibility === "team" && superAdmin && !teamId)}
          className="px-2 py-0.5 rounded bg-teal-700 text-[11px] text-white hover:bg-teal-600 disabled:opacity-40">Create</button>
      </div>
    </form>
  );
}
