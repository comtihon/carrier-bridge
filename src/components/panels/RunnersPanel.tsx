"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Gauge, Laptop, Loader2, Pencil, Plus, Unplug } from "lucide-react";
import { clsx } from "clsx";
import {
  addRunnerAgent, deleteRunner, isSuperAdmin, listRunners, updateRunner,
  type CurrentUser, type Runner, type Visibility,
} from "@/lib/api";
import { agentDisplayName, formatAgo, formatClock } from "@/lib/runners";
import { PanelShell } from "./dock";
import { VisibilityBadge, VisibilityControl, canEdit, useCurrentUser, useTeams } from "../Visibility";

/**
 * Runners: the caller's machines (and ones shared with them) connected through
 * acp-web-proxy, each offering its local ACP agents to workflows.
 *
 * A row shows whether the machine is online, what it runs, and which of its
 * agents are already carrier agents — the rest get an "Add as agent" button.
 * An agent that hit its usage limit says until when; steps using it wait.
 *
 * Connecting a new machine happens in a dialog the caller owns (`onConnect`),
 * so `#approve-runner` can open it without this panel. Online state changes
 * on its own, so the list reloads on a slow interval.
 */

const RELOAD_MS = 15_000;

export function RunnersPanel({ onClose, onConnect, onOpenAgent, onAgentAdded, reloadToken }: {
  onClose: () => void;
  onConnect: () => void;
  /** Open a carrier agent definition in the centre editor. */
  onOpenAgent?: (id: string) => void;
  /** After "Add as agent", so the Agents panel can reload. */
  onAgentAdded?: () => void;
  /** Bumped after an approval so the new machine shows up. */
  reloadToken?: number;
}) {
  const me = useCurrentUser();
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      setRunners(await listRunners());
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runners");
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

  return (
    <PanelShell
      id="runners"
      onClose={onClose}
      actions={
        <button onClick={onConnect}
          title="Connect a machine"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-[11px] font-semibold transition-colors">
          <Plus className="w-3 h-3" />Connect
        </button>
      }
    >
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {error && (
          <p role="alert" className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</p>
        )}
        {loading && runners.length === 0 && (
          <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>
        )}
        {!loading && !error && runners.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 text-center py-6">
            <Laptop className="w-6 h-6 text-slate-600" />
            <p className="text-xs text-slate-500">No machines connected.</p>
            <button onClick={onConnect} className="text-[11px] text-teal-400 hover:underline">Connect a machine</button>
          </div>
        )}
        {runners.map((r) => (
          <RunnerCard key={r.id} runner={r} me={me} now={now} act={act} onOpenAgent={onOpenAgent} onAgentAdded={onAgentAdded} />
        ))}
        {loading && runners.length > 0 && <Loader2 className="w-3 h-3 mx-auto text-slate-600 animate-spin" />}
      </div>
    </PanelShell>
  );
}

function RunnerCard({ runner, me, now, act, onOpenAgent, onAgentAdded }: {
  runner: Runner;
  me: CurrentUser | null;
  now: number;
  act: (change: () => Promise<unknown>) => Promise<void>;
  onOpenAgent?: (id: string) => void;
  onAgentAdded?: () => void;
}) {
  const editable = canEdit(runner);
  const [editing, setEditing] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const owner = runner.owner_id && me?.sub === runner.owner_id ? "You" : (runner.owner_name || runner.owner_id);
  // A definition without an agent name runs the machine's default agent.
  const definitionFor = (agent: string) =>
    runner.agent_definitions.find((d) => (d.acp_agent ?? runner.default_agent) === agent);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 space-y-2" data-testid={`runner-${runner.id}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          data-testid="runner-status"
          title={runner.online ? "Online" : "Offline"}
          aria-label={runner.online ? "Online" : "Offline"}
          className={clsx("w-2 h-2 rounded-full shrink-0", runner.online ? "bg-emerald-400" : "bg-slate-600")}
        />
        <p className="flex-1 text-xs font-semibold text-slate-200 truncate" title={runner.hostname}>{runner.name}</p>
        <VisibilityBadge resource={runner} />
        {editable && (
          <>
            <button onClick={() => setEditing((v) => !v)} title="Rename / visibility"
              className="p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-200"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => setConfirmRevoke(true)} title="Disconnect / revoke"
              className="p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400"><Unplug className="w-3 h-3" /></button>
          </>
        )}
      </div>

      <p className="text-[10px] text-slate-500">
        {runner.online ? <span className="text-emerald-400">online</span> : <>last seen {formatAgo(runner.last_seen, now)}</>}
        {" · "}{runner.os}/{runner.arch}
        {runner.version && <> · v{runner.version}</>}
      </p>
      {owner && <p className="text-[10px] text-slate-500">Owned by <span className="text-slate-300">{owner}</span></p>}

      {confirmRevoke && (
        <div className="text-[10px] text-slate-400 bg-red-950/20 border border-red-900/60 rounded px-2 py-1.5 space-y-1.5">
          <p>
            Disconnect <span className="text-slate-200">{runner.name}</span>? The machine&apos;s credential is revoked and it
            stops reconnecting; steps using its agents fail until it is connected again.
          </p>
          <div className="flex gap-1.5 justify-end">
            <button onClick={() => setConfirmRevoke(false)} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
            <button onClick={() => { setConfirmRevoke(false); act(() => deleteRunner(runner.id)); }}
              className="px-2 py-0.5 rounded bg-red-700 text-white hover:bg-red-600">Disconnect</button>
          </div>
        </div>
      )}

      {editing && (
        <RunnerSettings runner={runner} me={me}
          onCancel={() => setEditing(false)}
          onSave={(payload) => act(() => updateRunner(runner.id, payload)).then(() => setEditing(false))} />
      )}

      <ul className="space-y-1">
        {runner.agents.length === 0 && <li className="text-[10px] text-slate-600 italic">No agents found on this machine</li>}
        {runner.agents.map((agent) => {
          const def = definitionFor(agent);
          const limit = runner.limits?.[agent];
          return (
            <li key={agent} className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-300 min-w-0">
                <Bot className="w-3 h-3 shrink-0 text-fuchsia-400" />
                <span className="truncate flex-1">{agentDisplayName(agent)}</span>
                {def ? (
                  <button onClick={() => onOpenAgent?.(def.id)} title={`Open agent ${def.id}`}
                    className="truncate max-w-[7rem] text-[10px] text-fuchsia-300 hover:underline">
                    {def.name || def.id}
                  </button>
                ) : editable ? (
                  <button onClick={() => act(async () => { await addRunnerAgent(runner.id, { acp_agent: agent }); onAgentAdded?.(); })}
                    className="shrink-0 px-1.5 py-0.5 rounded border border-slate-700 hover:bg-slate-800 text-[10px] text-slate-300">
                    Add as agent
                  </button>
                ) : null}
              </div>
              {limit && (
                <p className="flex items-center gap-1 pl-4 text-[10px] text-amber-300" title={limit.message}>
                  <Gauge className="w-3 h-3 shrink-0" />
                  {agentDisplayName(agent)} limited{limit.until ? ` until ${formatClock(limit.until, now)}` : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Name and visibility of a machine. */
function RunnerSettings({ runner, me, onCancel, onSave }: {
  runner: Runner;
  me: CurrentUser | null;
  onCancel: () => void;
  onSave: (payload: { name?: string; visibility?: Visibility; team_id?: string }) => void;
}) {
  const superAdmin = isSuperAdmin(me);
  const [name, setName] = useState(runner.name);
  const [visibility, setVisibility] = useState<Visibility>(runner.visibility ?? "private");
  const [teamId, setTeamId] = useState(runner.team_id ?? "");
  const teams = useTeams(superAdmin && visibility === "team");
  const noTeam = !superAdmin && !me?.team && runner.visibility !== "team";

  return (
    <form className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({
          name: name.trim(),
          visibility,
          ...(visibility === "team" && superAdmin && teamId ? { team_id: teamId } : {}),
        });
      }}>
      <input aria-label="Runner name" value={name} onChange={(e) => setName(e.target.value)}
        className="w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-teal-500" />
      <VisibilityControl
        value={visibility}
        onChange={setVisibility}
        withTeam={(!!me && "team" in me) || runner.visibility === "team"}
        teamLabel={!superAdmin && me?.team?.name ? me.team.name : "Team"}
        teamUnavailable={noTeam ? "You're not in a team" : undefined}
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
        <button type="submit" disabled={!name.trim() || (visibility === "team" && superAdmin && !teamId)}
          className="px-2 py-0.5 rounded bg-teal-700 text-[11px] text-white hover:bg-teal-600 disabled:opacity-40">Save</button>
      </div>
    </form>
  );
}
