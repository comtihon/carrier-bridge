"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import {
  deleteUser, getLoginScript, listTeams, listUsers, setUserTeam,
  type CurrentUser, type LoginScriptSource, type Team, type TeamRole, type UserInfo,
} from "@/lib/api";

const SUPER_ADMIN_HINT =
  "Super admin comes from the identity provider's roles. Change it there; it applies at the user's next login.";

/** "3 min ago", "2 days ago", or the date for anything older than a month. */
export function formatLastSeen(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString();
}

function matches(u: UserInfo, q: string): boolean {
  if (!q) return true;
  const hay = [u.name, u.email, u.sub, u.team?.name, ...(u.roles ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

/**
 * Every stored user, for super admins: which team they are in and with what
 * role, their identity-provider roles, and when they last signed in. Team and
 * role are changed in place; deleting a user only forgets the stored record —
 * they come back on their next login.
 */
export function UsersAdmin({ me }: { me: CurrentUser | null }) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scriptSource, setScriptSource] = useState<LoginScriptSource>("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, t] = await Promise.all([listUsers(), listTeams()]);
      setUsers(u);
      setTeams(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
    // Only for the notice; a backend without login scripts simply has none.
    getLoginScript().then((s) => setScriptSource(s.source), () => setScriptSource("none"));
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Run a change for one user, then reload; the backend's refusal is shown as is. */
  const act = useCallback(async (sub: string, change: () => Promise<unknown>) => {
    setError(null);
    setBusy(sub);
    try {
      await change();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }, [load]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => users.filter((u) => matches(u, q)), [users, q]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input aria-label="Search users" placeholder="Search name, email, sub, team or role"
            value={query} onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
        </div>
        <span className="text-[11px] text-slate-500">{shown.length} of {users.length}</span>
        <button onClick={load} title="Reload users" aria-label="Reload users"
          className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-200">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
        {scriptSource !== "none" && (
          <p role="note" className="flex items-start gap-1.5 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/60 rounded px-2 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>A login script is active. It may overwrite a user&apos;s team membership at their next login, so changes made here can be undone by it.</span>
          </p>
        )}
        {error && (
          <p role="alert" className="text-[11px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</p>
        )}
        {loading && users.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">Loading…</p>
        ) : shown.length === 0 && !error ? (
          <p className="text-xs text-slate-500 text-center py-6">{users.length ? "No users match." : "No users yet."}</p>
        ) : shown.length > 0 && (
          <table className="w-full text-xs text-slate-300 border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <th className="py-1.5 pr-3 font-semibold">User</th>
                <th className="py-1.5 pr-3 font-semibold">Team</th>
                <th className="py-1.5 pr-3 font-semibold">Roles</th>
                <th className="py-1.5 pr-3 font-semibold">Last seen</th>
                <th className="py-1.5 font-semibold sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <UserRow key={u.sub} user={u} teams={teams} isMe={u.sub === me?.sub}
                  busy={busy === u.sub}
                  onSetTeam={(teamId, role) => act(u.sub, () => setUserTeam(u.sub, teamId, role))}
                  onDelete={() => act(u.sub, () => deleteUser(u.sub))} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function UserRow({ user, teams, isMe, busy, onSetTeam, onDelete }: {
  user: UserInfo;
  teams: Team[];
  isMe: boolean;
  busy: boolean;
  onSetTeam: (teamId: string | null, role: TeamRole) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const label = user.name || user.email || user.sub;
  const teamId = user.team?.id ?? "";
  const role: TeamRole = user.team?.role === "admin" ? "admin" : "member";
  // A team the list doesn't carry (scoped or just deleted) still shows by name.
  const knownTeam = !teamId || teams.some((t) => t.id === teamId);

  return (
    <>
      <tr className="border-b border-slate-800/70 align-top" data-testid={`user-${user.sub}`}>
        <td className="py-2 pr-3 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-200 truncate">{label}</span>
            {isMe && <span className="text-slate-500">(you)</span>}
            {user.is_super_admin && (
              <span title={SUPER_ADMIN_HINT} aria-label="Super admin"
                className="shrink-0 inline-flex items-center gap-0.5 px-1 rounded border border-amber-700/70 text-amber-300 text-[9px] uppercase tracking-wide">
                <ShieldCheck className="w-2.5 h-2.5" />super admin
              </span>
            )}
          </div>
          {user.email && user.email !== label && <div className="text-[11px] text-slate-400 truncate">{user.email}</div>}
          <div className="text-[10px] text-slate-600 font-mono truncate" title={user.sub}>{user.sub}</div>
        </td>
        <td className="py-2 pr-3">
          <div className="flex items-center gap-1">
            <select aria-label={`Team of ${label}`} value={teamId} disabled={busy}
              onChange={(e) => onSetTeam(e.target.value || null, role)}
              className="bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50">
              <option value="">No team</option>
              {!knownTeam && <option value={teamId}>{user.team?.name ?? teamId}</option>}
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select aria-label={`Team role of ${label}`} value={role} disabled={busy || !teamId}
              onChange={(e) => onSetTeam(teamId, e.target.value as TeamRole)}
              className="bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50">
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            {busy && <Loader2 className="w-3 h-3 text-slate-500 animate-spin" />}
          </div>
        </td>
        <td className="py-2 pr-3">
          <div className="flex flex-wrap gap-1">
            {(user.roles ?? []).length === 0 && <span className="text-[10px] text-slate-600">—</span>}
            {(user.roles ?? []).map((r) => (
              <span key={r} className="px-1.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] text-slate-300">{r}</span>
            ))}
          </div>
        </td>
        <td className="py-2 pr-3 whitespace-nowrap text-[11px] text-slate-400" title={user.last_seen ?? undefined}>
          {formatLastSeen(user.last_seen)}
        </td>
        <td className="py-2 text-right">
          <button onClick={() => setConfirming(true)} disabled={busy}
            title={`Delete ${label}`} aria-label={`Delete ${label}`}
            className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400 disabled:opacity-40">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
      {confirming && (
        <tr>
          <td colSpan={5} className="pb-2">
            <div className="text-[11px] text-slate-400 bg-red-950/20 border border-red-900/60 rounded px-2 py-1.5 flex items-center gap-2">
              <p className="flex-1">
                Delete <span className="text-slate-200">{label}</span>? Their stored record and team membership are removed.
                If they can still sign in, they come back as a new user at their next login.
              </p>
              <button onClick={() => setConfirming(false)} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
              <button onClick={() => { setConfirming(false); onDelete(); }}
                className="px-2 py-0.5 rounded bg-red-700 text-white hover:bg-red-600">Delete</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
