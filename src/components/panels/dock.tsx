"use client";

import { clsx } from "clsx";
import {
  BotMessageSquare, Database, Bot, Laptop, Library, ListOrdered, Radio, ShieldAlert, Users, Workflow, X,
} from "lucide-react";

/** Every panel the left dock can show. Multiple can be open at once. */
export type PanelId =
  | "copilot" | "runs" | "approvals" | "workflows"
  | "agents" | "runners" | "datasources" | "events" | "library" | "teams";

export const PANEL_META: Record<PanelId, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}> = {
  copilot:     { label: "Copilot",     icon: BotMessageSquare, accent: "text-sky-400" },
  runs:        { label: "Runs",        icon: ListOrdered,      accent: "text-sky-400" },
  approvals:   { label: "Approvals",   icon: ShieldAlert,      accent: "text-amber-400" },
  workflows:   { label: "Workflows",   icon: Workflow,         accent: "text-violet-400" },
  agents:      { label: "Agents",      icon: Bot,              accent: "text-fuchsia-400" },
  runners:     { label: "Runners",     icon: Laptop,           accent: "text-teal-400" },
  datasources: { label: "Datasources", icon: Database,         accent: "text-cyan-400" },
  events:      { label: "Events",      icon: Radio,            accent: "text-indigo-400" },
  library:     { label: "Library",     icon: Library,          accent: "text-amber-400" },
  teams:       { label: "Teams",       icon: Users,            accent: "text-emerald-400" },
};

export const PANEL_ORDER: PanelId[] = [
  // Approvals sits next to Runs: a held deletion is a run that stopped, and
  // the badge on it is the one number somebody needs to see without looking.
  // Runners sits next to Agents: a machine is where some agents run.
  "copilot", "runs", "approvals", "workflows", "agents", "runners", "datasources", "events", "library", "teams",
];

/** The always-visible icon rail. Clicking an icon opens or closes its panel. */
export function DockRail({ open, onToggle, badges, footer, hidden }: {
  open: Set<PanelId>;
  onToggle: (id: PanelId) => void;
  badges?: Partial<Record<PanelId, number>>;
  /** Pinned to the bottom of the rail — used for the backend health dot. */
  footer?: React.ReactNode;
  /** Panels the caller has no use for (Teams, for anyone but admins). */
  hidden?: Set<PanelId>;
}) {
  return (
    <div className="w-11 shrink-0 flex flex-col items-center gap-1 py-2 border-r border-slate-800 bg-slate-900/70">
      {PANEL_ORDER.filter((id) => !hidden?.has(id)).map((id) => {
        const { label, icon: Icon, accent } = PANEL_META[id];
        const isOpen = open.has(id);
        const badge = badges?.[id];
        return (
          <button
            key={id}
            onClick={() => onToggle(id)}
            title={isOpen ? `Close ${label}` : `Open ${label}`}
            className={clsx(
              "relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
              isOpen
                ? `bg-slate-800 ${accent}`
                : "text-slate-500 hover:text-slate-200 hover:bg-slate-800/60",
            )}
          >
            <Icon className="w-4 h-4" />
            {isOpen && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-current" />
            )}
            {badge ? (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-black text-[9px] font-bold flex items-center justify-center">
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
      {footer && <div className="mt-auto pb-1">{footer}</div>}
    </div>
  );
}

/** Chrome shared by every dock panel: header, close button, scrollable body. */
export function PanelShell({ id, onClose, actions, children, bare = false }: {
  id: PanelId;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Panels that draw their own header (Copilot) opt out of this one. */
  bare?: boolean;
}) {
  const { label, icon: Icon, accent } = PANEL_META[id];
  return (
    <aside className="w-64 shrink-0 h-full flex flex-col border-r border-slate-800 bg-slate-900/50 overflow-hidden">
      {!bare && (
        <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-800 shrink-0">
          <Icon className={clsx("w-4 h-4", accent)} />
          <span className="text-xs font-bold text-white flex-1 truncate">{label}</span>
          {actions}
          <button
            onClick={onClose}
            title={`Close ${label}`}
            className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </aside>
  );
}
