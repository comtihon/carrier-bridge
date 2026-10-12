"use client";

import { useEffect, useState } from "react";
import { Globe, LockKeyhole } from "lucide-react";
import { clsx } from "clsx";
import { getCurrentUser, type CurrentUser, type Ownership, type Visibility } from "@/lib/api";

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
 * The visibility an editor is working on, and whether to offer it at all.
 *
 * A new resource defaults to private, and the control appears once `/me` says
 * the backend authenticates — with auth off there is nobody to hide things
 * from. An existing resource shows it when the backend sent one.
 */
export function useVisibilityDraft(resource: Ownership | null | undefined, isNew: boolean) {
  const me = useCurrentUser();
  const [visibility, setVisibility] = useState<Visibility>(
    isNew ? "private" : (resource?.visibility ?? "public"),
  );
  // Follow the editor to another resource — or to a new one, which starts
  // private again.
  useEffect(() => {
    setVisibility(isNew ? "private" : (resource?.visibility ?? "public"));
  }, [resource, isNew]);
  const supported = isNew ? !!me?.auth_enabled : resource?.visibility !== undefined;
  return {
    me,
    supported,
    visibility,
    setVisibility,
    /** Spread into a create/update body: empty unless the control is shown. */
    payload: (supported ? { visibility } : {}) as { visibility?: Visibility },
  };
}

/** Private/Public switch. */
export function VisibilityControl({
  value, onChange, disabled,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
}) {
  const options: Array<{ v: Visibility; label: string; Icon: typeof Globe }> = [
    { v: "private", label: "Private", Icon: LockKeyhole },
    { v: "public", label: "Public", Icon: Globe },
  ];
  return (
    <div role="radiogroup" aria-label="Visibility"
      className="inline-flex items-center rounded-lg overflow-hidden border border-slate-700 text-[11px] font-medium">
      {options.map(({ v, label, Icon }) => (
        <button key={v} type="button" role="radio" aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={clsx(
            "flex items-center gap-1 px-2.5 py-1.5 transition-colors disabled:cursor-not-allowed",
            value === v ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200",
            disabled && value !== v && "opacity-50",
          )}>
          <Icon className="w-3 h-3" />{label}
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
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs font-medium text-slate-400">Visibility</label>
        <VisibilityControl value={draft.visibility} onChange={draft.setVisibility} disabled={!editable} />
        {owner && <span className="text-[11px] text-slate-500">Owned by <span className="text-slate-300">{owner}</span></span>}
      </div>
      <p className="text-[10px] text-slate-500">
        {draft.visibility === "private"
          ? "Only you (and admins) can see and use it."
          : "Every user can see and use it; only the owner and admins can change it."}
      </p>
      {!editable && (
        <p className="text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-800/60 rounded-lg px-3 py-2">
          Read-only: this {kind} belongs to {owner ?? "someone else"}. You can use it, but only its owner or an admin can change it.
        </p>
      )}
    </div>
  );
}

/** Lock shown next to a private resource in a list or picker. */
export function PrivateBadge({ resource }: { resource: Ownership }) {
  if (resource.visibility !== "private") return null;
  return (
    <span title="Private — only you (and admins) can see it" aria-label="Private" className="shrink-0">
      <LockKeyhole className="w-3 h-3 text-slate-500" />
    </span>
  );
}
