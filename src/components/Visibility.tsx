"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Globe, LockKeyhole, Users } from "lucide-react";
import { clsx } from "clsx";
import {
  getCurrentUser, isSuperAdmin, listTeams,
  type CurrentUser, type DataSourceSharing, type GrantAccess, type Ownership, type Team, type Visibility,
} from "@/lib/api";

/**
 * Per-user visibility of agents, datasources, library scripts and workflows.
 *
 * The backend decides everything — what a list contains, who may edit — and
 * reports it on each resource (`visibility`, `owner_*`, `can_edit`). The UI
 * only has to offer the choice when creating, show whose a thing is, and not
 * invite edits the backend would refuse.
 *
 * Against a backend without the feature (no `/me`, no fields) none of this
 * renders and no `visibility` is sent: the app behaves exactly as before.
 */

// One `/me` per page load: it does not change while the app is open.
let currentUser: Promise<CurrentUser | null> | null = null;

/** Forget the cached `/me` — for tests, which stub a different backend each. */
export function resetCurrentUserCache() {
  currentUser = null;
}

/** The caller as the backend sees it; null while loading or when unsupported. */
export function useCurrentUser(): CurrentUser | null {
  const [me, setMe] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let live = true;
    currentUser ??= getCurrentUser();
    currentUser.then((u) => { if (live) setMe(u); });
    return () => { live = false; };
  }, []);
  return me;
}

/** Whether the caller may change a resource. Missing verdict = legacy = yes. */
export function canEdit(resource: Ownership | null | undefined): boolean {
  return resource?.can_edit !== false;
}

/**
 * Teams the caller may put a resource into — loaded only for super admins,
 * who pick one; everyone else's team resources go to their own team.
 */
export function useTeams(enabled: boolean): Team[] | null {
  const [teams, setTeams] = useState<Team[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    listTeams().then((t) => { if (live) setTeams(t); }).catch(() => { if (live) setTeams([]); });
    return () => { live = false; };
  }, [enabled]);
  return teams;
}

/**
 * The visibility an editor is working on, and whether to offer it at all.
 *
 * A new resource defaults to private, and the control appears once `/me` says
 * the backend authenticates — with auth off there is nobody to hide things
 * from. An existing resource shows it when the backend sent one.
 *
 * Super admins are not bound to a team, so choosing Team asks them which one
 * (`team_id` goes into the body); for everyone else Team means their own team
 * and the backend fills it in.
 */
export function useVisibilityDraft(resource: Ownership | null | undefined, isNew: boolean) {
  const me = useCurrentUser();
  const superAdmin = isSuperAdmin(me);
  const initial = () => (isNew ? "private" : (resource?.visibility ?? "public")) as Visibility;
  const [visibility, setVisibility] = useState<Visibility>(initial);
  const [teamId, setTeamId] = useState<string>(isNew ? "" : (resource?.team_id ?? ""));
  // Follow the editor to another resource — or to a new one, which starts
  // private again.
  useEffect(() => {
    setVisibility(initial());
    setTeamId(isNew ? "" : (resource?.team_id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, isNew]);
  const supported = isNew ? !!me?.auth_enabled : resource?.visibility !== undefined;
  // A backend with teams always reports the caller's (`team: null` for none);
  // one without them leaves the key out, and Team is not offered at all.
  const teamsSupported = (!!me && "team" in me) || resource?.visibility === "team";
  const teams = useTeams(supported && superAdmin && teamsSupported);

  // The team this resource is (or will be) in — what its references are
  // checked against. Unknown is fine: the backend has the last word.
  const scopeTeamId =
    visibility === "team"
      ? (superAdmin ? teamId : (resource?.team_id ?? me?.team?.id)) || null
      : (me?.team?.id ?? null);
  const payload: { visibility?: Visibility; team_id?: string } = !supported
    ? {}
    : visibility === "team" && superAdmin && teamId
      ? { visibility, team_id: teamId }
      : { visibility };
  return {
    me,
    supported,
    superAdmin,
    teamsSupported,
    teams,
    visibility,
    setVisibility,
    teamId,
    setTeamId,
    /** Team chosen but none picked — only a super admin can get here. */
    missingTeam: supported && visibility === "team" && superAdmin && !teamId,
    /** What the resource being edited may use; see `scopeConflict`. */
    scope: (supported ? { visibility, teamId: scopeTeamId } : null) as UsageScope | null,
    /** Spread into a create/update body: empty unless the control is shown. */
    payload,
  };
}

/** Private / Team / Public switch. */
export function VisibilityControl({
  value, onChange, disabled, teamLabel = "Team", teamUnavailable, withTeam = true,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
  /** False against a backend without teams: just Private/Public. */
  withTeam?: boolean;
  /** "Team", or the team's name when there is only one it can be. */
  teamLabel?: string;
  /** Why Team cannot be chosen (no team); enabled when absent. */
  teamUnavailable?: string;
}) {
  const options: Array<{ v: Visibility; label: string; Icon: typeof Globe; off?: string }> = [
    { v: "private", label: "Private", Icon: LockKeyhole },
    { v: "team", label: teamLabel, Icon: Users, off: teamUnavailable },
    { v: "public", label: "Public", Icon: Globe },
  ].filter((o) => withTeam || o.v !== "team") as typeof options;
  return (
    <div role="radiogroup" aria-label="Visibility"
      className="inline-flex items-center rounded-lg overflow-hidden border border-slate-700 text-[11px] font-medium">
      {options.map(({ v, label, Icon, off }) => (
        <button key={v} type="button" role="radio" aria-checked={value === v}
          aria-label={v === "team" ? "Team" : label}
          disabled={disabled || (!!off && value !== v)}
          title={off}
          onClick={() => onChange(v)}
          className={clsx(
            "flex items-center gap-1 px-2.5 py-1.5 transition-colors disabled:cursor-not-allowed max-w-[10rem]",
            value === v ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200",
            (disabled || off) && value !== v && "opacity-50",
          )}>
          <Icon className="w-3 h-3 shrink-0" /><span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** "You", the owner's name, or their id — whichever the backend gave. */
function ownerLabel(resource: Ownership, me: CurrentUser | null): string | null {
  if (!resource.owner_id) return null;
  if (me?.sub && resource.owner_id === me.sub) return "You";
  return resource.owner_name || resource.owner_id;
}

/** What the chosen visibility means, in one line. */
function visibilityNote(visibility: Visibility, kind: string, team: string | null): string {
  if (visibility === "private") return "Only you (and admins) can see and use it.";
  if (visibility === "public") return "Every user can see and use it; only the owner and admins can change it.";
  const who = team ? `Members of ${team}` : "Your team";
  return kind === "workflow"
    ? `${who} can see, run and edit it, and see its runs.`
    : `${who} can see it and use it in their team and private workflows; only the owner and admins can change it.`;
}

/**
 * The access block at the top of a resource editor: owner, visibility, and —
 * when the caller cannot edit — why the form is read-only.
 */
export function AccessSection({
  resource, isNew, draft, kind,
}: {
  resource: Ownership | null | undefined;
  isNew: boolean;
  draft: ReturnType<typeof useVisibilityDraft>;
  /** "agent", "datasource"… — for the read-only note. */
  kind: string;
}) {
  if (!draft.supported) return null;
  const editable = isNew || canEdit(resource);
  const owner = !isNew && resource ? ownerLabel(resource, draft.me) : null;
  const ownTeam = draft.me?.team ?? null;
  // A super admin picks the team; anyone else's Team is their own team (or,
  // on an existing resource, the one it is already in).
  const teamName = draft.superAdmin
    ? (draft.teams?.find((t) => t.id === draft.teamId)?.name ?? resource?.team_name ?? null)
    : (resource?.visibility === "team" ? (resource.team_name ?? ownTeam?.name ?? null) : (ownTeam?.name ?? null));
  const teamUnavailable =
    draft.superAdmin || ownTeam || resource?.visibility === "team" ? undefined : "You're not in a team";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs font-medium text-slate-400">Visibility</label>
        <VisibilityControl
          value={draft.visibility}
          onChange={draft.setVisibility}
          disabled={!editable}
          teamLabel={!draft.superAdmin && teamName ? teamName : "Team"}
          teamUnavailable={teamUnavailable}
          withTeam={draft.teamsSupported}
        />
        {owner && <span className="text-[11px] text-slate-500">Owned by <span className="text-slate-300">{owner}</span></span>}
      </div>
      {draft.superAdmin && draft.visibility === "team" && (
        <div className="flex items-center gap-2">
          <label htmlFor="visibility-team" className="text-[11px] text-slate-400">Team</label>
          <select
            id="visibility-team"
            aria-label="Team"
            disabled={!editable}
            value={draft.teamId}
            onChange={(e) => draft.setTeamId(e.target.value)}
            className="rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="">{draft.teams ? "— select a team —" : "loading…"}</option>
            {(draft.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <p className="text-[10px] text-slate-500">{visibilityNote(draft.visibility, kind, teamName)}</p>
      {!editable && (
        <p className="text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-800/60 rounded-lg px-3 py-2">
          Read-only: this {kind} belongs to {owner ?? "someone else"}. You can use it, but only its owner or an admin can change it.
        </p>
      )}
    </div>
  );
}

/** Lock (private) or people (team) next to a resource in a list or picker. */
export function VisibilityBadge({ resource }: { resource: Ownership }) {
  if (resource.visibility === "private") {
    return (
      <span title="Private — only you (and admins) can see it" aria-label="Private" className="shrink-0">
        <LockKeyhole className="w-3 h-3 text-slate-500" />
      </span>
    );
  }
  if (resource.visibility === "team") {
    const team = resource.team_name || "the team";
    return (
      <span title={`Team — shared with ${team}`} aria-label={`Team: ${team}`} className="shrink-0">
        <Users className="w-3 h-3 text-emerald-500/80" />
      </span>
    );
  }
  return null;
}

/** Kept for callers from before teams; same as `VisibilityBadge`. */
export const PrivateBadge = VisibilityBadge;

/** " · private" / " · team" for a `<option>`, which cannot hold an icon. */
export function visibilitySuffix(resource: Ownership): string {
  if (resource.visibility === "private") return " · private";
  if (resource.visibility === "team") return " · team";
  return "";
}

// ─── What a resource may use ──────────────────────────────────────────────────

/** Visibility of the resource being edited, and its team, if known. */
export interface UsageScope {
  visibility: Visibility;
  teamId: string | null;
  /**
   * The workflow being edited, once it is saved: datasources granted to it
   * are offered in its pickers (and nowhere else).
   */
  workflowId?: string | null;
}

const RANK: Record<Visibility, number> = { private: 0, team: 1, public: 2 };

/**
 * Why a resource with `scope` may not use `used`, or null when it may.
 *
 * Mirrors the backend rule — a resource only uses resources of the same or
 * broader scope, and a team resource only its own team's — so pickers can
 * say so up front. The backend still decides; an unknown side never blocks.
 */
export function scopeConflict(scope: UsageScope | null | undefined, used: Ownership & DataSourceSharing): string | null {
  if (!scope || !used.visibility) return null;
  if (grantedAccess(scope, used)) return null;
  if (RANK[used.visibility] < RANK[scope.visibility]) {
    return scope.visibility === "public"
      ? `A public resource can only use public ones; this one is ${used.visibility}.`
      : "A team resource can't use private ones.";
  }
  if (used.visibility === "team" && scope.teamId && used.team_id && used.team_id !== scope.teamId) {
    return `Belongs to another team (${used.team_name || used.team_id}); only the same team's resources can be used.`;
  }
  return null;
}

/**
 * The grant the resource being edited would use `used` through, or null when
 * it needs none (or has none). A workflow grant covers that workflow; a user
 * grant covers the grantee's private resources.
 */
export function grantedAccess(
  scope: UsageScope | null | undefined, used: DataSourceSharing,
): GrantAccess | null {
  if (!scope) return null;
  if (used.granted_to_workflow && scope.workflowId) return used.granted_to_workflow;
  if (used.granted_access && scope.visibility === "private") return used.granted_access;
  return null;
}

const UsageScopeContext = createContext<UsageScope | null>(null);

/** Tell the pickers below what the resource being edited may use. */
export function UsageScopeProvider({ scope, children }: { scope: UsageScope | null; children: React.ReactNode }) {
  return <UsageScopeContext.Provider value={scope}>{children}</UsageScopeContext.Provider>;
}

/** The scope of the resource being edited, or null outside of one. */
export function useUsageScope(): UsageScope | null {
  return useContext(UsageScopeContext);
}

/** Small line naming the caller's team and role, for the dock. */
export function TeamTag({ me }: { me: CurrentUser | null }) {
  if (!me?.team) return null;
  const role = me.team.role === "admin" ? "admin" : "member";
  return (
    <span title={`Team ${me.team.name} — ${role}`} className="flex flex-col items-center gap-0.5 text-[9px] text-slate-500 max-w-[2.5rem]">
      <Users className="w-3.5 h-3.5 text-emerald-500/80" />
      <span className="truncate w-full text-center">{me.team.name}</span>
    </span>
  );
}
