"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, Laptop, Loader2, X } from "lucide-react";
import {
  approveRunnerEnrollment, denyRunnerEnrollment, isSuperAdmin, lookupRunnerEnrollment,
  type RunnerApproveResult, type RunnerEnrollment, type Visibility,
} from "@/lib/api";
import { BACKEND_URL } from "@/lib/config";
import { agentDisplayName, formatClock, formatSpan, normalizeApprovalCode } from "@/lib/runners";
import { VisibilityControl, useCurrentUser, useTeams } from "./Visibility";

/**
 * Connecting a machine (a runner) to carrier.
 *
 * The machine runs `acp-web-proxy install <carrier>`, which asks carrier for
 * an enrollment and prints a six-digit number. Whoever is sitting at that
 * machine types the number here, checks that the details are the machine in
 * front of them, and approves. The number only picks which pending request is
 * approved — the credential goes to the machine over its own poll channel and
 * never passes through this page.
 */

/** Where carrier sends people to approve a machine: `<UI>/#approve-runner`. */
export const APPROVE_RUNNER_HASH = "#approve-runner";

/**
 * Call `onOpen` when the page is (or becomes) `#approve-runner`, and drop the
 * hash so a reload does not reopen the dialog.
 */
export function useApproveRunnerDeepLink(onOpen: () => void) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== APPROVE_RUNNER_HASH) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      onOpenRef.current();
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
}

/** What to paste into Claude Code (or a terminal) on the machine. */
export function installPrompt(backendUrl: string = BACKEND_URL): string {
  return `Install acp-web-proxy and connect it to ${backendUrl}: npx -y github:comtihon/acp-web-proxy install ${backendUrl}`;
}

function DialogShell({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div role="dialog" aria-label={title}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-y-auto max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-slate-800">
          <Laptop className="w-4 h-4 text-teal-400" />
          <p className="flex-1 text-sm font-semibold text-slate-100">{title}</p>
          <button onClick={onClose} title="Close"
            className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

const primaryBtn =
  "flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const secondaryBtn =
  "px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50";
const fieldCls =
  "w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500";

// ─── Connect a machine ────────────────────────────────────────────────────────

/** How to connect a machine: the install line to paste, then the number. */
export function ConnectRunnerDialog({ onClose, onHaveNumber }: {
  onClose: () => void;
  onHaveNumber: () => void;
}) {
  const text = installPrompt();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the text is on screen either way.
    }
  }

  return (
    <DialogShell title="Connect a machine" onClose={onClose}>
      <p className="text-xs text-slate-400 leading-relaxed">
        Run your own Claude Code or Codex from workflows. On the machine, paste this into Claude Code
        (or run the command in a terminal). It installs <span className="font-mono text-slate-300">acp-web-proxy</span> as
        a background service and prints a six-digit number.
      </p>
      <div className="relative">
        <pre data-testid="install-prompt"
          className="text-[11px] text-slate-200 font-mono whitespace-pre-wrap break-all bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 pr-9">
          {text}
        </pre>
        <button onClick={copy} title={copied ? "Copied" : "Copy"}
          className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-xs text-slate-400">Then enter that number here to approve the machine.</p>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className={secondaryBtn}>Close</button>
        <button onClick={onHaveNumber} className={primaryBtn}>
          <KeyRound className="w-3 h-3" />I have a number
        </button>
      </div>
    </DialogShell>
  );
}

// ─── Approve a machine ────────────────────────────────────────────────────────

type Step =
  | { at: "enter" }
  | { at: "confirm"; enrollment: RunnerEnrollment; code: string }
  | { at: "approved"; result: RunnerApproveResult }
  | { at: "denied" };

/**
 * Number matching: type the number the machine shows, check the machine's
 * details, then approve (choosing its name, visibility and which of its
 * agents to add) or deny.
 */
export function ApproveRunnerDialog({ onClose, onApproved }: {
  onClose: () => void;
  /** After an approval, so a runner list can reload. */
  onApproved?: (result: RunnerApproveResult) => void;
}) {
  const [step, setStep] = useState<Step>({ at: "enter" });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = normalizeApprovalCode(input);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      setStep({ at: "confirm", enrollment: await lookupRunnerEnrollment(code), code });
    } catch (err) {
      // No such number (404) or too many wrong ones (429): the backend says which.
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Approve a machine" onClose={onClose}>
      {step.at === "enter" && (
        <form onSubmit={lookup} className="space-y-3">
          <label htmlFor="runner-code" className="block text-xs text-slate-400">
            Enter the number shown on the machine you are connecting.
          </label>
          <input id="runner-code" aria-label="Approval number" autoFocus
            inputMode="numeric" autoComplete="one-time-code" placeholder="482 913"
            value={input} onChange={(e) => { setInput(e.target.value); setError(null); }}
            className={`${fieldCls} font-mono text-lg tracking-[0.3em] text-center`} />
          {error && (
            <p role="alert" className="text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={!code || busy} className={primaryBtn}>
              {busy && <Loader2 className="w-3 h-3 animate-spin" />}Next
            </button>
          </div>
        </form>
      )}
      {step.at === "confirm" && (
        <ConfirmEnrollment
          enrollment={step.enrollment}
          code={step.code}
          onBack={() => setStep({ at: "enter" })}
          onApproved={(result) => { setStep({ at: "approved", result }); onApproved?.(result); }}
          onDenied={() => setStep({ at: "denied" })}
        />
      )}
      {step.at === "approved" && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-emerald-300">
            <Check className="w-4 h-4" />Connected <span className="font-semibold">{step.result.runner.name}</span>
          </p>
          <p className="text-xs text-slate-400">The machine picks this up within a few seconds and comes online.</p>
          {step.result.agents.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[11px] text-slate-500">Agents added:</p>
              <ul className="space-y-0.5">
                {step.result.agents.map((a) => (
                  <li key={a.id} className="text-xs text-slate-200">
                    {a.name || a.id} <span className="font-mono text-[10px] text-slate-500">{a.id}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No agents added — add them from the Runners panel.</p>
          )}
          <div className="flex justify-end">
            <button onClick={onClose} className={primaryBtn}>Done</button>
          </div>
        </div>
      )}
      {step.at === "denied" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">Denied. The machine will not be connected.</p>
          <div className="flex justify-end">
            <button onClick={onClose} className={secondaryBtn}>Close</button>
          </div>
        </div>
      )}
    </DialogShell>
  );
}

function ConfirmEnrollment({ enrollment, code, onBack, onApproved, onDenied }: {
  enrollment: RunnerEnrollment;
  code: string;
  onBack: () => void;
  onApproved: (result: RunnerApproveResult) => void;
  onDenied: () => void;
}) {
  const me = useCurrentUser();
  const superAdmin = isSuperAdmin(me);
  const [name, setName] = useState(enrollment.hostname);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [teamId, setTeamId] = useState("");
  const teams = useTeams(superAdmin && visibility === "team");
  const [agents, setAgents] = useState<Set<string>>(() => new Set(enrollment.agents));
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  const expires = enrollment.expires_at ? Date.parse(enrollment.expires_at) : NaN;

  async function act(kind: "approve" | "deny") {
    if (kind === "approve" && visibility === "team" && superAdmin && !teamId) {
      setError("Choose the team this machine belongs to.");
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      if (kind === "deny") {
        await denyRunnerEnrollment(enrollment.id, code);
        onDenied();
      } else {
        onApproved(await approveRunnerEnrollment(enrollment.id, {
          code,
          name: name.trim() || enrollment.hostname,
          visibility,
          ...(visibility === "team" && superAdmin && teamId ? { team_id: teamId } : {}),
          agents: enrollment.agents.filter((a) => agents.has(a)),
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const rows: Array<[string, React.ReactNode]> = [
    ["Machine", <span key="h" className="font-semibold text-slate-100">{enrollment.hostname}</span>],
    ["System", `${enrollment.os} / ${enrollment.arch}`],
    ["Timezone", enrollment.tz || "—"],
    ["Agents", enrollment.agents.length ? enrollment.agents.map(agentDisplayName).join(", ") : "none found"],
    ["Request from", <span key="ip" className="font-mono">{enrollment.request_ip || "—"}</span>],
    ["Requested", enrollment.created_at ? formatClock(enrollment.created_at, now) : "—"],
    ["Expires", Number.isNaN(expires) ? "—"
      : expires <= now ? "expired" : `${formatClock(enrollment.expires_at!, now)} (in ${formatSpan(expires - now)})`],
  ];
  const noTeam = !superAdmin && !me?.team;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="enrollment-details">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-slate-300 min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex items-start gap-2 text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-800/60 rounded-lg px-3 py-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Only approve a number shown on a machine you are using right now. Never enter a number someone sent you.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="runner-name" className="text-xs font-medium text-slate-400">Name</label>
        <input id="runner-name" value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-slate-400">Visibility</p>
        <VisibilityControl
          value={visibility}
          onChange={setVisibility}
          withPublic={false}
          withTeam={!!me && "team" in me}
          teamLabel={!superAdmin && me?.team?.name ? me.team.name : "Team"}
          teamUnavailable={noTeam ? "You're not in a team" : undefined}
        />
        {superAdmin && visibility === "team" && (
          <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}
            className="block rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none">
            <option value="">{teams ? "— select a team —" : "loading…"}</option>
            {(teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <p className="text-[10px] text-slate-500">
          {visibility === "private"
            ? "Only you can run agents on this machine."
            : "Your team can run agents on this machine — on your subscription."}
        </p>
      </div>
      {enrollment.agents.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-slate-400 mb-1">Add as carrier agents</legend>
          {enrollment.agents.map((a) => (
            <label key={a} className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={agents.has(a)}
                onChange={(e) => setAgents((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(a); else next.delete(a);
                  return next;
                })} />
              {agentDisplayName(a)}
              {a === enrollment.default_agent && <span className="text-[10px] text-slate-500">default</span>}
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onBack} disabled={!!busy} className={`${secondaryBtn} mr-auto`}>Back</button>
        <button onClick={() => act("deny")} disabled={!!busy}
          className="px-3 py-1.5 text-xs rounded-lg bg-red-900/60 text-red-200 hover:bg-red-800 transition-colors disabled:opacity-50">
          {busy === "deny" ? "Denying…" : "Deny"}
        </button>
        <button onClick={() => act("approve")} disabled={!!busy} className={primaryBtn}>
          {busy === "approve" && <Loader2 className="w-3 h-3 animate-spin" />}Approve
        </button>
      </div>
    </div>
  );
}
