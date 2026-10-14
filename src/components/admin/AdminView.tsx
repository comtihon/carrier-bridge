"use client";

import { clsx } from "clsx";
import { KeyRound, ShieldCheck, UserCog, X } from "lucide-react";
import { isSuperAdmin, type CurrentUser } from "@/lib/api";
import { UsersAdmin } from "./UsersAdmin";
import { LoginScriptAdmin } from "./LoginScriptAdmin";

export type AdminTab = "users" | "login-script";

const TABS: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "users", label: "Users", icon: UserCog },
  { id: "login-script", label: "Login script", icon: KeyRound },
];

/**
 * Centre-pane administration for super admins: every user, and the login
 * script. Teams themselves stay in the dock's Teams panel. Anyone else gets
 * nothing — the backend refuses these routes for them anyway.
 */
export function AdminView({ me, tab, onTabChange, onClose }: {
  me: CurrentUser | null;
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onClose: () => void;
}) {
  if (!isSuperAdmin(me)) return null;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-slate-900/40 shrink-0">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-bold text-white">Administration</span>
        <div role="tablist" aria-label="Administration" className="flex items-center gap-1 ml-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTabChange(id)}
              className={clsx(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors",
                tab === id ? "bg-slate-800 text-emerald-300" : "text-slate-500 hover:text-slate-200 hover:bg-slate-800/60",
              )}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button onClick={onClose} title="Close administration"
          className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-200">
          <X className="w-4 h-4" />
        </button>
      </div>
      {tab === "users" ? <UsersAdmin me={me} /> : <LoginScriptAdmin />}
    </div>
  );
}
