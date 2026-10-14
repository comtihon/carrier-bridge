"use client";

import { useState, useCallback, useEffect, useRef, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

class WorkflowDetailErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, error: err?.message };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[WorkflowDetail] render error:", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <p className="text-red-400 text-sm font-medium">Failed to render step detail</p>
          <p className="text-slate-500 text-xs font-mono">{this.state.error}</p>
          <button onClick={() => this.setState({ hasError: false })}
            className="text-xs text-sky-400 hover:underline">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import {
  Plus, BotMessageSquare, Wifi, WifiOff, Pencil, Trash2,
  Workflow, ListOrdered, Loader2, Lock, ChevronLeft, ChevronRight,
  Eye, EyeOff, Power, PowerOff,
} from "lucide-react";
import { useWorkflowRuns, useRunList } from "@/hooks/useWorkflowRuns";
import { WorkflowList } from "./WorkflowList";
import { WorkflowDetail } from "./WorkflowDetail";
import { newDynamicWorkflow } from "./dynamic/dynamicWorkflow";
import { SubmitWorkflowModal } from "./SubmitWorkflowModal";
import { ChatPanel } from "./ChatPanel";
import { ScriptEditor, type ScriptDraft } from "./ScriptEditor";
import { AccessSection, TeamTag, UsageScopeProvider, VisibilityBadge, useCurrentUser, useVisibilityDraft } from "./Visibility";
import { TeamsPanel } from "./panels/TeamsPanel";
import { EventEditor, emptyEventDraft, eventToDraft, type EventDraft } from "./EventEditor";
import { DockRail, PanelShell, PANEL_ORDER, type PanelId } from "./panels/dock";
import { AgentsPanel } from "./panels/AgentsPanel";
import { ApprovalsPanel } from "./panels/ApprovalsPanel";
import { ApprovalDetail } from "./ApprovalDetail";
import { DatasourcesPanel } from "./panels/DatasourcesPanel";
import { EventsPanel } from "./panels/EventsPanel";
import { LibraryPanel } from "./panels/LibraryPanel";
import { WorkflowEditor, AgentEditor, DatasourceEditor, apiStepToConfig, editableToApiPayload } from "./WorkflowEditor";
import { deriveEdges } from "@/lib/graphEdges";
import { clsx } from "clsx";
import {
  countPendingApprovals,
  fetchWorkflows,
  getWorkflowDefinition,
  createWorkflowDefinition,
  updateWorkflowDefinition,
  deleteWorkflowDefinition,
  setWorkflowEnabled,
  getAgent,
  getDatasource,
  getEvent,
  getScript,
  isSuperAdmin,
  isTeamAdmin,
  type ScriptDefinition,
  type EventDefinition,
  type AgentDefinition,
  type DataSourceDefinition,
} from "@/lib/api";
import { effectiveStatus } from "@/lib/types";
import { BACKEND_URL } from "@/lib/config";
import type {
  ApprovalCaseSummary, WorkflowRun, EditableWorkflowDefinition, WorkflowDefinition,
  EditableNodeConfig, Ownership, Visibility,
} from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The ownership fields of a resource, and nothing else. */
/** Panels hidden from everyone who can't manage a team. */
const TEAMS_HIDDEN = new Set<PanelId>(["teams"]);

function ownershipOf(r: Ownership): Ownership {
  return {
    visibility: r.visibility, owner_id: r.owner_id, owner_name: r.owner_name,
    team_id: r.team_id, team_name: r.team_name, can_edit: r.can_edit,
  };
}

/** Convert a raw API workflow definition to the editable format. */
function toEditable(def: {
  id: string;
  name: string;
  description?: string;
  readonly?: boolean;
  steps: Array<Record<string, unknown>>;
  ui?: Record<string, unknown>;
  use_meta_llm?: boolean;
  use_storage?: boolean;
}): EditableWorkflowDefinition {
  const rawSteps = def.steps ?? [];
  const nodes = rawSteps.map(apiStepToConfig);

  type UiEdgesShape = Record<string, { waypoints: Array<{ x: number; y: number }> }>;
  const declaredEdgeLayout =
    def.ui && typeof def.ui.edges === "object" && def.ui.edges !== null
      ? (def.ui.edges as UiEdgesShape)
      : undefined;
  const edges: EditableWorkflowDefinition["edges"] = deriveEdges(
    rawSteps,
    nodes.map((n) => n.id),
    declaredEdgeLayout,
  );

  const layout = def.ui && typeof def.ui.nodes === "object" && def.ui.nodes !== null
    ? (def.ui.nodes as Record<string, { x: number; y: number }>)
    : undefined;

  type UiEdgeLayout = Record<string, { waypoints: Array<{ x: number; y: number }> }>;
  const uiEdgeLayout = def.ui && typeof def.ui.edges === "object" && def.ui.edges !== null
    ? (def.ui.edges as UiEdgeLayout)
    : undefined;

  // Attach waypoints to edges that have them in ui.edges
  for (const edge of edges) {
    const wp = uiEdgeLayout?.[`${edge.source}:${edge.target}`]?.waypoints;
    if (wp && wp.length > 0) {
      edge.data = { ...edge.data, waypoints: wp };
    }
  }

  // Restore addon nodes from ui.addons (e.g. Slack addon attached to agent steps)
  type UiAddon = { id: string; type: string; attachedTo?: string | null; position?: { x: number; y: number } | null; slack_token?: string; slack_topic?: string; slack_payload?: string; servers?: Record<string, boolean> };
  const uiAddons = def.ui && Array.isArray(def.ui.addons) ? (def.ui.addons as UiAddon[]) : [];
  for (const addon of uiAddons) {
    if (addon.type === "slack") {
      const entry: Record<string, unknown> = {
        id: addon.id,
        type: "slack-addon",
        name: "Slack",
        attachedTo: addon.attachedTo ?? null,
        slack_notifications: true,
      };
      if (addon.position) {
        if (!layout) (layout as unknown as Record<string, { x: number; y: number }>) = {};
        (layout as Record<string, { x: number; y: number }>)[addon.id] = addon.position;
      }
      if (addon.slack_token) entry.slack_token = addon.slack_token;
      if (addon.slack_topic) entry.slack_topic = addon.slack_topic;
      if (addon.slack_payload) entry.slack_payload = addon.slack_payload;
      nodes.push(entry as unknown as EditableNodeConfig);
    } else if (addon.type === "pvc") {
      const parentStep = rawSteps.find((s) => s.id === addon.attachedTo);
      const entry: Record<string, unknown> = {
        id: addon.id,
        type: "pvc-addon",
        name: "PVC",
        attachedTo: addon.attachedTo ?? null,
        pvc_name: (parentStep?.pvc_name as string) ?? "",
        pvc_mount_point: (parentStep?.pvc_mount_point as string) ?? "",
        pvc_ttl: (parentStep?.pvc_ttl as string) ?? "1h",
      };
      if (addon.position) {
        if (!layout) (layout as unknown as Record<string, { x: number; y: number }>) = {};
        (layout as Record<string, { x: number; y: number }>)[addon.id] = addon.position;
      }
      nodes.push(entry as unknown as EditableNodeConfig);
    } else if (addon.type === "mcp") {
      const parentStep = rawSteps.find((s) => s.id === addon.attachedTo);
      const entry: Record<string, unknown> = {
        id: addon.id,
        type: "mcp-addon",
        name: "MCP",
        attachedTo: addon.attachedTo ?? null,
        servers: addon.servers ?? {},
      };
      if (addon.position) {
        if (!layout) (layout as unknown as Record<string, { x: number; y: number }>) = {};
        (layout as Record<string, { x: number; y: number }>)[addon.id] = addon.position;
      }
      nodes.push(entry as unknown as EditableNodeConfig);
    } else if (addon.type === "tools") {
      const entry: Record<string, unknown> = {
        id: addon.id,
        type: "tools-addon",
        name: "Tools",
        attachedTo: addon.attachedTo ?? null,
        tools: (addon as unknown as Record<string, unknown>).tools ?? {},
      };
      if (addon.position) {
        if (!layout) (layout as unknown as Record<string, { x: number; y: number }>) = {};
        (layout as Record<string, { x: number; y: number }>)[addon.id] = addon.position;
      }
      nodes.push(entry as unknown as EditableNodeConfig);
    } else if (addon.type === "s3") {
      const entry: Record<string, unknown> = {
        id: addon.id,
        type: "s3-addon",
        name: "S3 Storage",
        attachedTo: addon.attachedTo ?? null,
        s3_bucket: (addon as unknown as Record<string, unknown>).s3_bucket ?? "",
        s3_path: (addon as unknown as Record<string, unknown>).s3_path ?? "",
      };
      if (addon.position) {
        if (!layout) (layout as unknown as Record<string, { x: number; y: number }>) = {};
        (layout as Record<string, { x: number; y: number }>)[addon.id] = addon.position;
      }
      nodes.push(entry as unknown as EditableNodeConfig);
    } else if (addon.type === "datasource") {
      const entry: Record<string, unknown> = {
        id: addon.id,
        type: "datasource-addon",
        name: "Datasource",
        attachedTo: addon.attachedTo ?? null,
        datasource_id: (addon as unknown as Record<string, unknown>).datasource_id ?? "",
        allowed_operations: (addon as unknown as Record<string, unknown>).allowed_operations ?? [],
      };
      if (addon.position) {
        if (!layout) (layout as unknown as Record<string, { x: number; y: number }>) = {};
        (layout as Record<string, { x: number; y: number }>)[addon.id] = addon.position;
      }
      nodes.push(entry as unknown as EditableNodeConfig);
    }
  }

  return { id: def.id, name: def.name, description: def.description, readonly: def.readonly, use_meta_llm: def.use_meta_llm, use_storage: def.use_storage, nodes, edges, layout };
}

// ─── Hidden-workflow filter (localStorage) ────────────────────────────────────

function useHiddenWorkflows() {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("copilot_hidden_workflows");
      return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("copilot_hidden_workflows", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  return { hidden, toggle };
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

/** Which editor the centre pane shows. */
type CenterView =
  | "run" | "workflow" | "script" | "event" | "agent" | "datasource" | "approval" | null;

export function Dashboard() {
  const { hidden: hiddenWorkflows, toggle: toggleHiddenWorkflow } = useHiddenWorkflows();

  const listContainerRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setPageSize(Math.max(5, Math.min(50, Math.floor(el.clientHeight / 72))));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const {
    runIds, listedRuns, addRunId, removeRunId,
    page, total, pageSize: ps, hasNext, hasPrev, nextPage, prevPage,
  } = useWorkflowRuns({ pageSize, excludeWorkflowIds: Array.from(hiddenWorkflows) });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // The list call already carries a row for every run on the page, so hand
  // those to the poller as its starting data rather than making it fetch each
  // row. Rows carry no per-step payloads, so the run in the centre pane is
  // read back in full by id.
  const { runs, refresh } = useRunList(runIds, listedRuns, selectedRunId);

  const [showModal, setShowModal] = useState(false);

  // ── Dock state ────────────────────────────────────────────────────────────
  // Any number of panels can be open at once; each closes on its own.
  const [openPanels, setOpenPanels] = useState<Set<PanelId>>(() => new Set<PanelId>(["runs"]));
  const [center, setCenter] = useState<CenterView>(null);

  const togglePanel = useCallback((id: PanelId) => {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const closePanel = useCallback((id: PanelId) => {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const openPanel = useCallback((id: PanelId) => {
    setOpenPanels((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // ── Workflow definitions state ────────────────────────────────────────────
  const [wfList, setWfList]           = useState<WorkflowDefinition[]>([]);
  const [wfListLoading, setWfListLoading] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<EditableWorkflowDefinition | null>(null);
  const [editorLoading, setEditorLoading]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);
  // Owner and visibility of the open workflow. Kept beside it rather than in
  // it: the editor owns the definition, and visibility is not part of the graph.
  const [wfOwnership, setWfOwnership] = useState<Ownership | null>(null);
  const wfAccess = useVisibilityDraft(wfOwnership, !!editingWorkflow?.isNew);
  // Teams are managed by super admins (all of them) and team admins (their own).
  const me = useCurrentUser();
  const canManageTeams = isSuperAdmin(me) || isTeamAdmin(me);

  // ── Script library state ──────────────────────────────────────────────────
  const [scriptDraft, setScriptDraft] = useState<ScriptDraft | null>(null);
  // Bumped after a save so the library panel refetches its list.
  const [libraryToken, setLibraryToken] = useState(0);

  // ── Events state ──────────────────────────────────────────────────────────
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  // Bumped after a save so the events panel refetches its list.
  const [eventsToken, setEventsToken] = useState(0);

  // ── Held-deletion state ───────────────────────────────────────────────────
  // The queue row itself is the starting point for the centre pane, which
  // re-reads the case: a row can be minutes stale, and a case decided from a
  // run or from Slack must not offer buttons that will fail.
  const [approvalCase, setApprovalCase] = useState<ApprovalCaseSummary | null>(null);
  // Bumped after a decision made in the centre pane so the queue refetches.
  const [approvalsToken, setApprovalsToken] = useState(0);

  // ── Agent / datasource state ──────────────────────────────────────────────
  // null inside the wrapper means "a new one"; the wrapper itself being null
  // means the centre pane is not editing that kind of resource at all.
  const [agentTarget, setAgentTarget] = useState<{ agent: AgentDefinition | null } | null>(null);
  const [agentsToken, setAgentsToken] = useState(0);
  const [dsTarget, setDsTarget] = useState<{ datasource: DataSourceDefinition | null } | null>(null);
  const [dsToken, setDsToken] = useState(0);

  // ── Opening a resource in the centre editor ───────────────────────────────
  // The dock panels list summaries, so the id a row hands over is all we have.
  // The full definition is fetched before the editor is rendered: every editor
  // saves with a whole-document PUT, and one mounted on a summary would write
  // back the fields the summary left out as empty.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  // The most recently requested row. Two quick clicks race, and the slower
  // fetch must not be the one that decides what the editor shows.
  const openRequestRef = useRef<string | null>(null);

  const openResource = useCallback(
    async <T,>(id: string, fetchOne: (id: string) => Promise<T>, apply: (item: T) => void) => {
      openRequestRef.current = id;
      setOpeningId(id);
      setOpenError(null);
      try {
        const item = await fetchOne(id);
        if (openRequestRef.current !== id) return;
        apply(item);
      } catch (err) {
        if (openRequestRef.current !== id) return;
        // Deliberately no fall back to the summary: editing partial data and
        // saving it would quietly erase whatever the summary omitted.
        setOpenError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (openRequestRef.current === id) setOpeningId(null);
      }
    },
    [],
  );

  // track which IDs haven't been POSTed yet (created in-session)
  const newIdsRef = useRef<Set<string>>(new Set());

  const selectedRun = selectedRunId ? runs[selectedRunId] : null;

  const handleRunUpdate = useCallback((run: WorkflowRun) => { refresh(run.id); }, [refresh]);
  const handleWorkflowStarted = useCallback(
    (runId: string) => {
      addRunId(runId);
      setSelectedRunId(runId);
      setCenter("run");
      openPanel("runs");
    },
    [addRunId, openPanel],
  );

  const handleSelectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setCenter("run");
  }, []);

  // ── Held deletions ────────────────────────────────────────────────────────

  const handleOpenApproval = useCallback((item: ApprovalCaseSummary) => {
    setApprovalCase(item);
    setCenter("approval");
  }, []);

  const handleApprovalDecided = useCallback((updated: ApprovalCaseSummary) => {
    setApprovalCase(updated);
    // The queue and the rail badge both counted this case as open a moment
    // ago; neither watches the centre pane, so tell them.
    setApprovalsToken((t) => t + 1);
  }, []);

  // A held deletion names its run, which this tab may never have listed — an
  // agent's tool call belongs to no run of ours, and another user's run to no
  // page of ours. Adding the id is what makes the poller fetch it.
  const handleOpenApprovalRun = useCallback((runId: string) => {
    addRunId(runId);
    setSelectedRunId(runId);
    setCenter("run");
    openPanel("runs");
  }, [addRunId, openPanel]);

  const pendingApprovals = runIds
    .map((id) => runs[id])
    .filter((r) => r && effectiveStatus(r) === "waiting_approval").length;

  // Held deletions are counted server-side, not derived from the runs this
  // tab happens to be watching: a case an agent's tool call opened belongs to
  // no run in the list, and one from another user's run belongs to no run this
  // tab has ever loaded. Both still need somebody to answer them.
  const [pendingDeletions, setPendingDeletions] = useState(0);
  const approvalsOpen = openPanels.has("approvals");
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const count = await countPendingApprovals();
        if (!cancelled) setPendingDeletions(count);
      } catch {
        // silent — the rail draws without a badge rather than not at all
      }
    };
    poll();
    // Faster while the panel is open, because the badge and the list are then
    // the same information and must not visibly disagree.
    const timer = setInterval(poll, approvalsOpen ? 15_000 : 60_000);
    return () => { cancelled = true; clearInterval(timer); };
    // pendingApprovals is a dependency, not a coincidence: a run leaving
    // waiting_approval is the moment a held deletion was just answered, so the
    // badge refreshes then instead of on the next tick of the timer.
    // approvalsToken is the same moment reached the other way — a case
    // answered in the centre pane, which no run in this list reports.
  }, [approvalsOpen, pendingApprovals, approvalsToken]);

  // ── Load workflow list ────────────────────────────────────────────────────
  const loadWorkflowList = useCallback(async () => {
    setWfListLoading(true);
    try {
      const list = await fetchWorkflows();
      setWfList(list);
    } catch {
      // silent — backend may not be running
    } finally {
      setWfListLoading(false);
    }
  }, []);

  const workflowsOpen = openPanels.has("workflows");
  useEffect(() => {
    if (workflowsOpen) loadWorkflowList();
  }, [workflowsOpen, loadWorkflowList]);

  // ── Open workflow in editor ───────────────────────────────────────────────
  const handleEditWorkflow = useCallback(async (id: string) => {
    setCenter("workflow");
    // Already loaded — just make sure it's visible, no re-fetch needed
    if (editingWorkflow?.id === id && !editingWorkflow?.isNew) return;

    setEditorLoading(true);
    setSaveError(null);

    // The list endpoint (registry) has the authoritative readonly flag.
    const listItem = wfList.find((w) => w.id === id);

    try {
      const full = await getWorkflowDefinition(id);
      setEditingWorkflow(toEditable({
        id: full.id,
        name: full.name,
        description: full.description,
        // Prefer the list's readonly over the GET response — the registry
        // is the source of truth, the file backend can stamp readonly=true
        // on everything in some configurations. Someone else's workflow is
        // read-only too: the backend would refuse the save.
        readonly: (listItem?.readonly ?? full.readonly) || full.can_edit === false,
        steps: full.steps as Array<Record<string, unknown>>,
        ui: full.ui,
        use_meta_llm: full.use_meta_llm,
        use_storage: full.use_storage,
      }));
      setWfOwnership(ownershipOf(full));
    } catch {
      if (listItem) {
        setEditingWorkflow(toEditable({
          id: listItem.id,
          name: listItem.name,
          description: listItem.description,
          readonly: listItem.readonly || listItem.can_edit === false,
          steps: listItem.steps as unknown as Array<Record<string, unknown>>,
        }));
        setWfOwnership(ownershipOf(listItem));
      }
    } finally {
      setEditorLoading(false);
    }
  }, [wfList, editingWorkflow]);

  // ── Create blank workflow ─────────────────────────────────────────────────
  const handleNewWorkflow = useCallback(() => {
    const id = `workflow-${Date.now()}`;
    newIdsRef.current.add(id);
    setEditingWorkflow({ id, name: "New Workflow", description: "", nodes: [], edges: [], isNew: true });
    setWfOwnership(null);
    setSaveError(null);
    setCenter("workflow");
    openPanel("workflows");
  }, [openPanel]);

  // A dynamic workflow: no drawn graph, the dispatcher builds the agent DAG per run.
  const handleNewDynamicWorkflow = useCallback(() => {
    const id = `workflow-${Date.now()}`;
    newIdsRef.current.add(id);
    setEditingWorkflow(newDynamicWorkflow(id));
    setWfOwnership(null);
    setSaveError(null);
    setCenter("workflow");
    openPanel("workflows");
  }, [openPanel]);

  // ── Save (create or update) ───────────────────────────────────────────────
  const handleSaveWorkflow = useCallback(async (updated: EditableWorkflowDefinition) => {
    if (wfAccess.missingTeam) {
      setSaveError("Choose the team this workflow belongs to.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = editableToApiPayload(updated);
      if (updated.isNew) {
        setWfOwnership(ownershipOf(await createWorkflowDefinition({ ...payload, ...wfAccess.payload })));
        newIdsRef.current.delete(updated.id);
        // Reload list — the new workflow should now appear
        await loadWorkflowList();
        setEditingWorkflow({ ...updated, isNew: false });
      } else {
        // Take every field from `payload` rather than hand-picking: PUT
        // replaces the whole definition, so a field left out here is a feature
        // silently switched off. `use_storage` was missing, which is why the
        // storage checkbox never appeared to stick.
        const saved = await updateWorkflowDefinition(updated.id, {
          name:         payload.name,
          description:  payload.description,
          steps:        payload.steps,
          ui:           payload.ui,
          use_meta_llm: payload.use_meta_llm,
          use_storage:  payload.use_storage,
          ...wfAccess.payload,
        });
        const stored = ownershipOf(saved);
        setWfOwnership(stored);
        // Refresh list name/description (and the private badge)
        setWfList((prev) =>
          prev.map((w) =>
            w.id === updated.id
              ? { ...w, name: updated.name, description: updated.description ?? "", ...stored }
              : w,
          ),
        );
        setEditingWorkflow({ ...updated, isNew: false });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [loadWorkflowList, wfAccess.payload, wfAccess.missingTeam]);

  // ── Enable / disable workflow ─────────────────────────────────────────────
  // The card flips immediately and rolls back if the PUT fails, matching how the
  // rest of this panel behaves. The server is the enforcer either way: a disabled
  // workflow refuses every trigger and every manual start with a 409.
  const handleToggleWorkflowEnabled = useCallback(async (id: string) => {
    const current = wfList.find((w) => w.id === id);
    if (!current) return;
    const next = current.enabled === false;
    setWfList((prev) => prev.map((w) => (w.id === id ? { ...w, enabled: next } : w)));
    try {
      await setWorkflowEnabled(id, next);
    } catch (err) {
      console.error("Enable/disable failed:", err);
      setWfList((prev) =>
        prev.map((w) => (w.id === id ? { ...w, enabled: !next } : w)),
      );
    }
  }, [wfList]);

  // ── Delete workflow ───────────────────────────────────────────────────────
  const handleDeleteWorkflow = useCallback(async (id: string) => {
    try {
      // Only call API if it was ever saved
      if (!newIdsRef.current.has(id)) {
        await deleteWorkflowDefinition(id);
      }
      setWfList((prev) => prev.filter((w) => w.id !== id));
      if (editingWorkflow?.id === id) {
        setEditingWorkflow(null);
        setCenter((c) => (c === "workflow" ? null : c));
      }
    } catch (err) {
      // Show inline error — don't crash
      console.error("Delete failed:", err);
    }
  }, [editingWorkflow]);

  // ── Script library ────────────────────────────────────────────────────────
  const handleOpenScript = useCallback(async (id: string) => {
    setCenter("script");
    await openResource(id, getScript, (script) =>
      setScriptDraft({
        id: script.id,
        name: script.name,
        description: script.description ?? "",
        code: script.code,
        ...ownershipOf(script),
      }),
    );
  }, [openResource]);

  const handleNewScript = useCallback(() => {
    openRequestRef.current = null;
    setOpenError(null);
    setScriptDraft({ id: null, name: "", description: "", code: "" });
    setCenter("script");
    openPanel("library");
  }, [openPanel]);

  const handleScriptSaved = useCallback((script: ScriptDefinition) => {
    // A brand-new script gains an id — keep editing the same document.
    // Ownership too: a new script comes back with its owner and visibility.
    setScriptDraft((prev) => (prev ? { ...prev, id: script.id, name: script.name, ...ownershipOf(script) } : prev));
    setLibraryToken((t) => t + 1);
  }, []);

  // ── Events ────────────────────────────────────────────────────────────────
  const handleOpenEvent = useCallback(async (id: string) => {
    setCenter("event");
    await openResource(id, getEvent, (event) => setEventDraft(eventToDraft(event)));
  }, [openResource]);

  const handleNewEvent = useCallback(() => {
    openRequestRef.current = null;
    setOpenError(null);
    setEventDraft(emptyEventDraft);
    setCenter("event");
    openPanel("events");
  }, [openPanel]);

  // ── Agents ────────────────────────────────────────────────────────────────
  const handleOpenAgent = useCallback(async (id: string) => {
    setCenter("agent");
    await openResource(id, getAgent, (agent) => setAgentTarget({ agent }));
  }, [openResource]);

  const handleNewAgent = useCallback(() => {
    openRequestRef.current = null;
    setOpenError(null);
    setAgentTarget({ agent: null });
    setCenter("agent");
    openPanel("agents");
  }, [openPanel]);

  const handleAgentSaved = useCallback((agent: AgentDefinition) => {
    // Adopt what came back so a second Save updates it instead of re-creating.
    setAgentTarget((prev) => (prev && prev.agent === null ? { agent } : prev));
    setAgentsToken((t) => t + 1);
  }, []);

  // ── Datasources ───────────────────────────────────────────────────────────
  const handleOpenDatasource = useCallback(async (id: string) => {
    setCenter("datasource");
    await openResource(id, getDatasource, (datasource) => setDsTarget({ datasource }));
  }, [openResource]);

  const handleNewDatasource = useCallback(() => {
    openRequestRef.current = null;
    setOpenError(null);
    setDsTarget({ datasource: null });
    setCenter("datasource");
    openPanel("datasources");
  }, [openPanel]);

  const handleDatasourceSaved = useCallback((datasource: DataSourceDefinition) => {
    setDsTarget((prev) => (prev && prev.datasource === null ? { datasource } : prev));
    setDsToken((t) => t + 1);
  }, []);

  const handleEventSaved = useCallback((event: EventDefinition) => {
    // A create hands back the stored event: adopt it so the next Save updates
    // that event instead of trying to create it a second time. One that already
    // had an id keeps its draft, so an edit in progress is not rewound.
    setEventDraft((prev) => (prev && prev.id === null ? eventToDraft(event) : prev));
    setEventsToken((t) => t + 1);
  }, []);

  // ── Panels ────────────────────────────────────────────────────────────────
  function renderPanel(id: PanelId) {
    switch (id) {
      case "copilot":
        return (
          <PanelShell key={id} id={id} bare onClose={() => closePanel(id)}>
            <ChatPanel onWorkflowStarted={handleWorkflowStarted} onClose={() => closePanel(id)} />
          </PanelShell>
        );
      case "runs":
        return (
          <PanelShell key={id} id={id} onClose={() => closePanel(id)}
            actions={
              <button onClick={() => setShowModal(true)}
                title="New run"
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition-colors">
                <Plus className="w-3 h-3" />New
              </button>
            }>
            <div ref={listContainerRef} className="flex-1 overflow-hidden p-2">
              <WorkflowList
                runIds={runIds}
                runs={runs} selectedRunId={selectedRunId}
                onSelect={handleSelectRun} onRemove={removeRunId}
                page={page} total={total} pageSize={ps}
                onPrev={hasPrev ? prevPage : undefined}
                onNext={hasNext ? nextPage : undefined}
              />
            </div>
          </PanelShell>
        );
      case "workflows":
        return (
          <PanelShell key={id} id={id} onClose={() => closePanel(id)}
            actions={
              <>
                {wfListLoading && <Loader2 className="w-3 h-3 text-slate-500 animate-spin" />}
                <button onClick={handleNewWorkflow}
                  title="New workflow"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-semibold transition-colors">
                  <Plus className="w-3 h-3" />New
                </button>
                <button onClick={handleNewDynamicWorkflow}
                  title="New dynamic workflow — agents are chosen per run by the dispatcher"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-violet-700 hover:bg-violet-900/50 text-violet-200 text-[11px] font-semibold transition-colors">
                  <Plus className="w-3 h-3" />Dynamic
                </button>
              </>
            }>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {wfList.map((wf) => (
                <WorkflowDefinitionCard
                  key={wf.id}
                  workflow={wf}
                  selected={editingWorkflow?.id === wf.id}
                  loading={editorLoading && editingWorkflow?.id === wf.id}
                  hidden={hiddenWorkflows.has(wf.id)}
                  disabled={wf.enabled === false}
                  onEdit={() => handleEditWorkflow(wf.id)}
                  onDelete={() => handleDeleteWorkflow(wf.id)}
                  onToggleHidden={() => toggleHiddenWorkflow(wf.id)}
                  onToggleEnabled={() => handleToggleWorkflowEnabled(wf.id)}
                />
              ))}
              {!wfListLoading && wfList.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
                  <p className="text-2xl">🔗</p>
                  <p className="text-xs text-slate-500">No workflows found.</p>
                  <p className="text-[10px] text-slate-600">Make sure the backend is running.</p>
                </div>
              )}
            </div>
          </PanelShell>
        );
      case "approvals":
        return (
          <ApprovalsPanel
            key={id}
            onClose={() => closePanel(id)}
            onOpen={handleOpenApproval}
            selectedId={center === "approval" ? approvalCase?.id ?? null : null}
            reloadToken={pendingApprovals + approvalsToken}
          />
        );
      case "agents":
        return (
          <AgentsPanel
            key={id}
            onClose={() => closePanel(id)}
            onOpen={handleOpenAgent}
            onNew={handleNewAgent}
            selectedId={openingId ?? agentTarget?.agent?.id ?? null}
            reloadToken={agentsToken}
          />
        );
      case "datasources":
        return (
          <DatasourcesPanel
            key={id}
            onClose={() => closePanel(id)}
            onOpen={handleOpenDatasource}
            onNew={handleNewDatasource}
            selectedId={openingId ?? dsTarget?.datasource?.id ?? null}
            reloadToken={dsToken}
          />
        );
      case "events":
        return (
          <EventsPanel
            key={id}
            onClose={() => closePanel(id)}
            onOpen={handleOpenEvent}
            onNew={handleNewEvent}
            selectedId={openingId ?? eventDraft?.id ?? null}
            reloadToken={eventsToken}
          />
        );
      case "teams":
        return <TeamsPanel key={id} me={me} onClose={() => closePanel(id)} />;
      case "library":
        return (
          <LibraryPanel
            key={id}
            onClose={() => closePanel(id)}
            onOpen={handleOpenScript}
            onNew={handleNewScript}
            selectedId={openingId ?? scriptDraft?.id ?? null}
            reloadToken={libraryToken}
          />
        );
    }
  }

  // ── Centre pane ───────────────────────────────────────────────────────────
  function renderCenter() {
    if (center === "run") {
      return selectedRun ? (
        <div className="flex-1 overflow-hidden px-6 py-5">
          <WorkflowDetailErrorBoundary key={selectedRun.id}>
            <WorkflowDetail key={selectedRun.id} run={selectedRun} onUpdate={handleRunUpdate}
              onRefresh={() => refresh(selectedRun.id)} />
          </WorkflowDetailErrorBoundary>
        </div>
      ) : (
        <EmptyCenter onNewRun={() => setShowModal(true)} />
      );
    }
    if (center === "approval") {
      return approvalCase ? (
        <ApprovalDetail
          key={approvalCase.id}
          caseItem={approvalCase}
          onDecided={handleApprovalDecided}
          onClose={() => { setApprovalCase(null); setCenter(null); }}
          onOpenWorkflow={(workflowId) => {
            openPanel("workflows");
            handleEditWorkflow(workflowId);
          }}
          onOpenRun={handleOpenApprovalRun}
        />
      ) : (
        <EmptyCenter onNewRun={() => setShowModal(true)} />
      );
    }
    if (center === "workflow") {
      if (editorLoading) {
        return (
          <div className="flex-1 flex items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading workflow…</span>
          </div>
        );
      }
      return editingWorkflow ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {wfAccess.supported && (
            <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/40 shrink-0">
              <AccessSection resource={wfOwnership} isNew={!!editingWorkflow.isNew} draft={wfAccess} kind="workflow" />
            </div>
          )}
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Pickers inside the editor only offer what this workflow's scope may use. */}
            <UsageScopeProvider scope={wfAccess.scope}>
              <WorkflowEditor
                key={editingWorkflow.id}
                workflow={editingWorkflow}
                onSave={handleSaveWorkflow}
                onCancel={() => { setEditingWorkflow(null); setCenter(null); }}
                saving={saving}
                saveError={saveError}
                readonly={editingWorkflow.readonly}
              />
            </UsageScopeProvider>
          </div>
        </div>
      ) : (
        <EmptyWorkflows onNew={handleNewWorkflow} />
      );
    }
    // A resource editor waits for its full definition, and says so if the fetch
    // failed rather than opening on partial data.
    if (center === "agent" || center === "datasource" || center === "event" || center === "script") {
      if (openingId) {
        return (
          <div className="flex-1 flex items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        );
      }
      if (openError) {
        return (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-red-400">Could not open this item</p>
            <p className="text-xs font-mono text-slate-500">{openError}</p>
          </div>
        );
      }
    }
    if (center === "agent" && agentTarget) {
      return (
        <AgentEditor
          key={agentTarget.agent?.id ?? "new-agent"}
          agent={agentTarget.agent}
          onSave={handleAgentSaved}
          onClose={() => { setAgentTarget(null); setCenter(null); }}
        />
      );
    }
    if (center === "datasource" && dsTarget) {
      return (
        <DatasourceEditor
          key={dsTarget.datasource?.id ?? "new-datasource"}
          datasource={dsTarget.datasource}
          onSave={handleDatasourceSaved}
          onClose={() => { setDsTarget(null); setCenter(null); }}
        />
      );
    }
    if (center === "event" && eventDraft) {
      return (
        <EventEditor
          key={eventDraft.id ?? "new-event"}
          draft={eventDraft}
          onSaved={handleEventSaved}
          onClose={() => { setEventDraft(null); setCenter(null); }}
        />
      );
    }
    if (center === "script" && scriptDraft) {
      return (
        <ScriptEditor
          key={scriptDraft.id ?? "new-script"}
          draft={scriptDraft}
          onSaved={handleScriptSaved}
          onClose={() => { setScriptDraft(null); setCenter(null); }}
        />
      );
    }
    return <EmptyCenter onNewRun={() => setShowModal(true)} />;
  }

  return (
    <div className="flex h-screen bg-slate-950">
      <DockRail
        open={openPanels}
        onToggle={togglePanel}
        badges={{
          runs: pendingApprovals > 0 ? pendingApprovals : undefined,
          approvals: pendingDeletions > 0 ? pendingDeletions : undefined,
        }}
        hidden={canManageTeams ? undefined : TEAMS_HIDDEN}
        footer={
          <div className="flex flex-col items-center gap-2">
            <TeamTag me={me} />
            <BackendHealthIndicator compact />
          </div>
        }
      />

      {PANEL_ORDER.filter((id) => openPanels.has(id) && (id !== "teams" || canManageTeams)).map(renderPanel)}

      {/* ── Centre ─────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {renderCenter()}
      </main>

      {showModal && (
        <SubmitWorkflowModal
          onSubmit={(run) => { addRunId(run.id); setSelectedRunId(run.id); setCenter("run"); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ─── Workflow definition card ─────────────────────────────────────────────────

// Exported for tests — rendered only from the workflows panel above.
export function WorkflowDefinitionCard({ workflow, selected, loading, hidden, disabled, onEdit, onDelete, onToggleHidden, onToggleEnabled }: {
  workflow: WorkflowDefinition; selected: boolean; loading: boolean; hidden: boolean; disabled: boolean;
  onEdit: () => void; onDelete: () => void; onToggleHidden: () => void; onToggleEnabled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Someone else's workflow behaves like a read-only one: no edit, no delete.
  const locked = !!workflow.readonly || workflow.can_edit === false;

  return (
    <>
      {/* Three states have to be readable at a glance:
            enabled + visible  — solid frame (violet when selected)
            enabled + hidden   — solid frame, dimmed to 50%
            disabled           — dotted frame, dimmed to 70%
          Disabled owns the border style and hidden owns the opacity, so a
          workflow that is both still reads as dotted rather than picking one. */}
      <div
        className={clsx(
          "group relative rounded-xl border px-3 py-2.5 cursor-pointer transition-all",
          disabled
            ? "border-dotted border-slate-600 bg-slate-900/20"
            : hidden
              ? "border-slate-800 bg-slate-900/20"
              : selected
                ? "border-violet-600 bg-violet-950/40"
                : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/40",
          hidden ? "opacity-50" : disabled && "opacity-70",
        )}
        onClick={onEdit}
      >
        <div className={clsx("flex items-start gap-2", "pr-20")}>
          {loading
            ? <Loader2 className="w-4 h-4 mt-0.5 shrink-0 text-violet-400 animate-spin" />
            : <span className="text-base leading-none mt-0.5 shrink-0">🔗</span>
          }
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate">{workflow.name}</p>
              <VisibilityBadge resource={workflow} />
            </div>
            {workflow.description && (
              <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5 leading-relaxed">
                {workflow.description}
              </p>
            )}
            <p className="text-[10px] text-slate-600 mt-1 font-mono">{workflow.id}</p>
          </div>
        </div>

        <div className="absolute top-2 right-2 flex items-center gap-0.5">
          {/* Enable/disable toggle — always visible while disabled, like the eye */}
          {!locked && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleEnabled(); }}
              className={clsx(
                "p-1 rounded transition-colors",
                disabled
                  ? "text-amber-500 hover:text-amber-400"
                  : "opacity-0 group-hover:opacity-100 text-slate-500 hover:text-emerald-400",
              )}
              title={disabled ? "Enable workflow" : "Disable workflow (blocks all triggers)"}
            >
              {disabled ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />}
            </button>
          )}
          {/* Eye toggle — always visible */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
            className={clsx(
              "p-1 rounded transition-colors",
              hidden
                ? "text-slate-500 hover:text-slate-300"
                : "opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300",
            )}
            title={hidden ? "Show runs" : "Hide runs"}
          >
            {hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
          {!locked && (
            <>
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-violet-400 transition-colors opacity-0 group-hover:opacity-100" title="Edit">
                <Pencil className="w-3 h-3" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
                className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
          {locked && (
            <span title="Read-only"><Lock className="w-3 h-3 text-slate-600" /></span>
          )}
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirming(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-xs w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-100 mb-1">Delete workflow?</p>
            <p className="text-xs text-slate-400 mb-4">
              <span className="font-mono text-slate-300">{workflow.name}</span> will be permanently removed.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirming(false); onDelete(); }}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-700 text-white hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Backend health indicator ─────────────────────────────────────────────────

function BackendHealthIndicator({ compact = false }: { compact?: boolean }) {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`${BACKEND_URL}/health`)
      .then((r) => setHealthy(r.ok))
      .catch(() => setHealthy(false));
  }, []);
  if (healthy === null) return null;
  if (compact) {
    return (
      <span title={`Backend ${healthy ? "online" : "offline"}`}
        className="flex items-center justify-center w-9 h-9">
        {healthy
          ? <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {healthy ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
      <span className={`text-[10px] ${healthy ? "text-emerald-400" : "text-red-400"}`}>
        Backend {healthy ? "online" : "offline"}
      </span>
    </div>
  );
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function EmptyCenter({ onNewRun }: { onNewRun: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
      <div className="space-y-2">
        <p className="text-5xl">🚀</p>
        <h2 className="text-xl font-bold text-white">LangGraph Control Plane</h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Select a run from the left, or start a new workflow. You can also use
          the chat to manage everything hands-free.
        </p>
      </div>
      <button onClick={onNewRun}
        className="flex items-center gap-2 px-5 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors">
        <Plus className="w-5 h-5" />New Workflow Run
      </button>
      <div className="grid grid-cols-2 gap-3 w-full max-w-sm text-left">
        {[
          { emoji: "💬", title: "Chat to run",   desc: 'Say "Run feature flow to add dark mode"' },
          { emoji: "✋", title: "Approve inline", desc: "Approve or reject right in the chat" },
          { emoji: "📊", title: "Graph view",     desc: "See which LangGraph node is active" },
          { emoji: "🔁", title: "Live polling",   desc: "Status updates every 3 seconds" },
        ].map((item) => (
          <div key={item.title} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
            <p className="text-lg mb-1">{item.emoji}</p>
            <p className="text-xs font-semibold text-slate-300">{item.title}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyWorkflows({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-8">
      <div className="space-y-2">
        <p className="text-5xl">🔗</p>
        <h2 className="text-xl font-bold text-white">Workflow Editor</h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Select a workflow from the left panel to open the visual editor, or
          create a new one from scratch.
        </p>
      </div>
      <button onClick={onNew}
        className="flex items-center gap-2 px-5 py-3 rounded-xl bg-violet-700 hover:bg-violet-600 text-white font-semibold transition-colors">
        <Plus className="w-5 h-5" />New Workflow
      </button>
      <div className="grid grid-cols-3 gap-3 w-full max-w-md text-left">
        {[
          { emoji: "➕", title: "Add nodes",   desc: "Click any type in the left palette" },
          { emoji: "🔗", title: "Connect",      desc: "Drag from handle to handle" },
          { emoji: "✏️",  title: "Edit prompts", desc: "Click a node to configure it" },
        ].map((item) => (
          <div key={item.title} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
            <p className="text-lg mb-1">{item.emoji}</p>
            <p className="text-xs font-semibold text-slate-300">{item.title}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
