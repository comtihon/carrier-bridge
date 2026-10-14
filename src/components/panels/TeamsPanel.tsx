"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Pencil, Plus, Shield, ShieldOff, Trash2, UserCog, UserMinus, Users, X } from "lucide-react";
import { clsx } from "clsx";
import {
  createTeam, deleteTeam, isSuperAdmin, listTeams, listUsers, removeTeamMember, renameTeam, setTeamMember,
  type CurrentUser, type Team, type TeamMember, type UserInfo,
} from "@/lib/api";
import { PanelShell } from "./dock";
import type { AdminTab } from "../admin/AdminView";

/**
 * Teams and who is in them.
 *
 * Two audiences, and the backend decides what each may do — the panel only
 * offers what it would accept:
 *  - super admins manage every team: create, rename, delete, and move anyone
 *    in or out (adding someone moves them from their previous team);
 *  - a team admin manages their own team's roster: add people who are in no
 *    team yet, remove members, promote or demote. `/teams` and `/users` already
 *    come back scoped to that.
 * Plain members never see this panel; the dock shows their team instead.
 *
 * Super admins also get links to the Users and Login script administration,
 * which open in the centre pane (`onOpenAdmin`).
 */
export function TeamsPanel({ me, onClose, onOpenAdmin }: {
  me: CurrentUser | null;
  onClose: () => void;
  onOpenAdmin?: (tab: AdminTab) => void;
}) {
  const superAdmin = isSuperAdmin(me);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, u] = await Promise.all([listTeams(), listUsers()]);
      setTeams(t);
      setUsers(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Run a change, then reload; the backend's refusal is shown as is. */
  const act = useCallback(async (change: () => Promise<unknown>) => {
    setError(null);
    try {
      await change();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }, [load]);

  return (
    <PanelShell
      id="teams"
      onClose={onClose}
      actions={superAdmin ? (
        <button onClick={() => setCreating("")}
          title="New team"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors">
          <Plus className="w-3 h-3" />New
        </button>
      ) : undefined}
    >
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {superAdmin && onOpenAdmin && (
          <div className="flex gap-1">
            <button onClick={() => onOpenAdmin("users")}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-[11px] font-semibold">
              <UserCog className="w-3 h-3" />Users
            </button>
            <button onClick={() => onOpenAdmin("login-script")}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-[11px] font-semibold">
              <KeyRound className="w-3 h-3" />Login script
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</p>
        )}
        {creating !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!creating.trim()) return;
              act(() => createTeam(creating.trim())).then(() => setCreating(null));
            }}
            className="flex items-center gap-1">
            <input autoFocus aria-label="New team name" placeholder="Team name"
              value={creating} onChange={(e) => setCreating(e.target.value)}
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500" />
            <button type="submit" title="Create team" className="p-1 rounded hover:bg-slate-700 text-emerald-400"><Check className="w-3.5 h-3.5" /></button>
            <button type="button" title="Cancel" onClick={() => setCreating(null)} className="p-1 rounded hover:bg-slate-700 text-slate-500"><X className="w-3.5 h-3.5" /></button>
          </form>
        )}
        {loading && teams.length === 0 && (
          <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>
        )}
        {!loading && !error && teams.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-6">No teams yet.</p>
        )}
        {teams.map((team) => (
          <TeamCard key={team.id} team={team} users={users} superAdmin={superAdmin} me={me} act={act} />
        ))}
        {loading && teams.length > 0 && <Loader2 className="w-3 h-3 mx-auto text-slate-600 animate-spin" />}
      </div>
    </PanelShell>
  );
}

function TeamCard({ team, users, superAdmin, me, act }: {
  team: Team;
  users: UserInfo[];
  superAdmin: boolean;
  me: CurrentUser | null;
  act: (change: () => Promise<unknown>) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState("");
  const memberIds = new Set(team.members.map((m) => m.sub));
  const candidates = users.filter((u) => !memberIds.has(u.sub));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 space-y-2" data-testid={`team-${team.id}`}>
      <div className="flex items-center gap-1.5">
        <Users className="w-4 h-4 shrink-0 text-emerald-400" />
        {renaming !== null ? (
          <form className="flex-1 flex items-center gap-1 min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              if (!renaming.trim()) return;
              act(() => renameTeam(team.id, renaming.trim())).then(() => setRenaming(null));
            }}>
            <input autoFocus aria-label="Team name" value={renaming} onChange={(e) => setRenaming(e.target.value)}
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500" />
            <button type="submit" title="Save name" className="p-0.5 rounded hover:bg-slate-700 text-emerald-400"><Check className="w-3 h-3" /></button>
            <button type="button" title="Cancel" onClick={() => setRenaming(null)} className="p-0.5 rounded hover:bg-slate-700 text-slate-500"><X className="w-3 h-3" /></button>
          </form>
        ) : (
          <p className="flex-1 text-xs font-semibold text-slate-200 truncate">{team.name}</p>
        )}
        {superAdmin && renaming === null && (
          <>
            <button onClick={() => setRenaming(team.name)} title="Rename team"
              className="p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-200"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => setConfirmDelete(true)} title="Delete team"
              className="p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </>
        )}
      </div>

      {confirmDelete && (
        <div className="text-[10px] text-slate-400 bg-red-950/20 border border-red-900/60 rounded px-2 py-1.5 space-y-1.5">
          <p>Delete <span className="text-slate-200">{team.name}</span>? Its members end up in no team. A team that still owns team resources can&apos;t be deleted.</p>
          <div className="flex gap-1.5 justify-end">
            <button onClick={() => setConfirmDelete(false)} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
            <button onClick={() => { setConfirmDelete(false); act(() => deleteTeam(team.id)); }}
              className="px-2 py-0.5 rounded bg-red-700 text-white hover:bg-red-600">Delete</button>
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {team.members.length === 0 && <li className="text-[10px] text-slate-600 italic">No members</li>}
        {team.members.map((m) => (
          <MemberRow key={m.sub} member={m} isMe={m.sub === me?.sub}
            onToggleRole={() => act(() => setTeamMember(team.id, m.sub, m.role === "admin" ? "member" : "admin"))}
            onRemove={() => act(() => removeTeamMember(team.id, m.sub))} />
        ))}
      </ul>

      <div className="flex items-center gap-1">
        <select aria-label={`Add member to ${team.name}`} value={adding} onChange={(e) => setAdding(e.target.value)}
          className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500">
          <option value="">Add member…</option>
          {candidates.map((u) => {
            // Moving someone out of another team is a super-admin call; a team
            // admin only recruits people who are in no team.
            const elsewhere = u.team_id && u.team_id !== team.id ? (u.team_name || u.team_id) : null;
            return (
              <option key={u.sub} value={u.sub} disabled={!!elsewhere && !superAdmin}>
                {u.name || u.email || u.sub}{elsewhere ? ` (in ${elsewhere})` : ""}
              </option>
            );
          })}
        </select>
        <button disabled={!adding} title="Add member"
          onClick={() => { const sub = adding; setAdding(""); act(() => setTeamMember(team.id, sub)); }}
          className="p-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed">
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function MemberRow({ member, isMe, onToggleRole, onRemove }: {
  member: TeamMember;
  isMe: boolean;
  onToggleRole: () => void;
  onRemove: () => void;
}) {
  const admin = member.role === "admin";
  const label = member.name || member.email || member.sub;
  return (
    <li className="group flex items-center gap-1.5 text-[11px] text-slate-300 min-w-0">
      <span className="truncate flex-1" title={member.email ?? member.sub}>
        {label}{isMe && <span className="text-slate-500"> (you)</span>}
      </span>
      {admin && (
        <span className="shrink-0 px-1 rounded border border-emerald-700/70 text-emerald-300 text-[9px] uppercase tracking-wide">admin</span>
      )}
      <button onClick={onToggleRole}
        title={admin ? `Make ${label} a member` : `Make ${label} a team admin`}
        aria-label={admin ? `Demote ${label}` : `Promote ${label}`}
        className={clsx("p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100 focus:opacity-100")}>
        {admin ? <ShieldOff className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
      </button>
      <button onClick={onRemove} title={`Remove ${label}`} aria-label={`Remove ${label}`}
        className="p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus:opacity-100">
        <UserMinus className="w-3 h-3" />
      </button>
    </li>
  );
}
