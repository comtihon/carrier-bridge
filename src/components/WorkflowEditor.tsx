"use client";

import React, { useCallback, useState, useMemo, useRef, useEffect } from "react";
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X, Plus, Trash2, Save, ArrowLeft, AlertTriangle, ChevronDown, ChevronUp, Lock, Code, Pin, Bot, Pencil, Database, Radio, Eye, EyeOff, Play, Loader2, Download, Upload, Search } from "lucide-react";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";
import { clsx } from "clsx";
import { deriveEdges, END_MARKER } from "@/lib/graphEdges";
import type {
  ApiStepType,
  EditableNodeConfig,
  EditableWorkflowDefinition,
  NotifyConfig,
  StructuredOutputField,
} from "@/lib/types";
import { useLlmProviders } from "@/hooks/useLlmProviders";
import { useEvents } from "@/hooks/useEvents";
import { useDatasources } from "@/hooks/useDatasources";
import { DatasourceParamsEditor } from "@/components/DatasourceParamsEditor";
import { listAgents, getAgent, createAgent, updateAgent, updateAgentAddons, deleteAgent, listMcpIntegrations, listAgentTools, type AgentToolInfo, type AgentDefinition, type McpIntegration, listDatasources, createDatasource, updateDatasource, deleteDatasource, probeDatasource, tryDatasourceOperation, fetchDatasourceSchema, uploadDatasourceSchema, listConfigKeys, listServiceIdentities, getGoogleSheetsTemplate, DATASOURCE_SECRET_REDACTED, type GoogleSheetsTemplate, type DataSourceDefinition, type DataSourceKind, type DataSourceAuth, type DataSourceAuthWrite, type ServiceIdentitiesResponse, type DataSourceOperation, type DataSourceParamSpec, type DiscoveredSchema, type SchemaImportResult, type TryOperationDestructivePlan, listEvents, createEvent, updateEvent, deleteEvent, EventNameConflictError, type EventDefinition } from "@/lib/api";
import { BACKEND_URL } from "@/lib/config";
import { PythonStepFields } from "./PythonStepFields";
import { DataStepFields, dataStepProblem } from "./DataStepFields";
import { dsFieldCls, dsFieldMonoCls } from "./fieldStyles";
import { GoogleSheetsPanel } from "./GoogleSheetsPanel";
import { SheetBindingsPanel } from "./SheetBindingsPanel";
import { RISK_BADGE_BASE_CLS, RISK_LEVEL_CLS, methodLevel } from "@/lib/datasourceRisk";
import { DatasourceRiskBadge } from "./DatasourceRiskBadge";
import { EventModal, EventNameConflictDialog, parseEventSchema } from "./EventModal";
import { CodeEditor } from "./CodeEditor";
import { ResourceEditorFrame, type EditorSurface } from "./ResourceEditorFrame";
import {
  AccessSection, VisibilityBadge, canEdit, scopeConflict, useCurrentUser, useUsageScope, useVisibilityDraft,
  visibilitySuffix, type UsageScope,
} from "./Visibility";
import { TYPE_ICONS as SHARED_TYPE_ICONS } from "./workflow-canvas/utils/typeIcons";
import { WorkflowStepNode, SharedParallelNode, SharedSwitchNode, SharedJoinNode } from "./workflow-canvas/nodes";
import { PvcAddonNode } from "./workflow-canvas/nodes/PvcAddonNode";
import { McpAddonNode } from "./workflow-canvas/nodes/McpAddonNode";
import { ToolsAddonNode } from "./workflow-canvas/nodes/ToolsAddonNode";
import { S3AddonNode } from "./workflow-canvas/nodes/S3AddonNode";
import { DatasourceAddonNode } from "./workflow-canvas/nodes/DatasourceAddonNode";
import { TYPE_COLORS as SHARED_TYPE_COLORS } from "./workflow-canvas/constants";

import { BaseCanvas } from "./workflow-canvas/BaseCanvas";
import { isDynamicWorkflow, pickDynamicConfig } from "./dynamic/dynamicWorkflow";
import { DynamicWorkflowEditor } from "./dynamic/DynamicWorkflowEditor";
import { configToRFNode, snakePosition, rfNodeToConfig, isAddonNodeType, stepDisplayLabel } from "./workflow-canvas/utils/nodeUtils";

type EnvVarEntry = { name: string; from_config?: string; value?: string };

// ─── Constants ────────────────────────────────────────────────────────────────

// Re-export the shared TYPE_ICONS so existing consumers keep working.
export const TYPE_ICONS: Record<string, string> = SHARED_TYPE_ICONS;

export const TYPE_LABELS: Record<string, string> = {
  llm:              "LLM",
  llm_structured:   "LLM Structured",
  mcp:              "MCP Tool",
  human_approval:   "Approval",
  ask_context:      "Ask Context",
  execute:          "Execute",
  workflow:         "Sub-Workflow",
  cron:             "Cron Trigger",
  http:             "HTTP Trigger",
  pubsub:           "Pub/Sub Trigger",
  http_call:        "HTTP Call",
  python:           "Python",
  "langgraph-agent":"Agent",
  data_source:      "Data Source",
  data:             "Data",
  join:             "Join (And)",
  proceed_or:       "Proceed (Or)",
  storage:          "Storage",
  slack:            "Slack",
};

const TYPE_COLORS = SHARED_TYPE_COLORS;

// Grouped so the palette reads as "what starts a run / what asks or calls out /
// what does the work" instead of one undifferentiated list.
const PALETTE_GROUPS: Array<{ label: string; items: Array<{ type: ApiStepType; label: string }> }> = [
  {
    label: "Triggers",
    items: [
      { type: "cron",   label: "Cron Trigger"   },
      { type: "http",   label: "HTTP Trigger"   },
      { type: "pubsub", label: "Pub/Sub Trigger" },
    ],
  },
  {
    label: "Tools",
    items: [
      { type: "human_approval", label: "Approval"    },
      { type: "ask_context",    label: "Ask Context" },
      { type: "mcp",            label: "MCP Tool"    },
    ],
  },
  {
    label: "Work nodes",
    items: [
      { type: "llm",       label: "LLM"          },
      { type: "python",    label: "Python"       },
      { type: "execute",   label: "Execute"      },
      { type: "http_call", label: "HTTP Call"    },
      { type: "slack",     label: "Slack"        },
      { type: "data",      label: "Data"         },
      { type: "workflow",  label: "Sub-Workflow" },
    ],
  },
];

const PALETTE_ITEMS: Array<{ type: ApiStepType; label: string }> =
  PALETTE_GROUPS.flatMap((group) => group.items);

const OPERATOR_ITEMS: Array<{ type: ApiStepType; label: string }> = [
  { type: "parallel",   label: "Parallel"     },
  { type: "switch",     label: "Switch"       },
  { type: "join",       label: "Join (And)"   },
  { type: "proceed_or", label: "Proceed (Or)" },
  { type: "storage",    label: "Storage"      },
];

// ─── Serialization: EditableNodeConfig → API step dict ────────────────────────

export function configToApiStep(config: EditableNodeConfig): Record<string, unknown> {
  const step: Record<string, unknown> = { id: config.id, type: config.type };
  if (config.name)        step.name        = config.name;
  if (config.description) step.description = config.description;

  switch (config.type) {
    case "llm":
      if (config.llm_provider)  step.llm_provider  = config.llm_provider;
      if (config.model)         step.model         = config.model;
      if (config.system_prompt) step.system_prompt = config.system_prompt;
      if (config.user_template) step.user_template = config.user_template;
      if (config.output_key)    step.output_key    = config.output_key;
      break;
    case "llm_structured":
      if (config.llm_provider)  step.llm_provider  = config.llm_provider;
      if (config.model)         step.model         = config.model;
      if (config.system_prompt)  step.system_prompt  = config.system_prompt;
      if (config.user_template)  step.user_template  = config.user_template;
      if (config.output_fields?.length)  step.output        = config.output_fields;
      if (config.fail_if_false?.length)  step.fail_if_false = config.fail_if_false;
      if (config.bind_mcp_tools !== undefined) step.bind_mcp_tools = config.bind_mcp_tools;
      if (config.max_iterations !== undefined) step.max_iterations = config.max_iterations;
      break;
    case "mcp":
      if (config.tool)       step.tool       = config.tool;
      if (config.tool_input) step.tool_input = config.tool_input;
      if (config.output_key) step.output_key = config.output_key;
      break;
    case "ask_context":
      if (config.questions_key) step.questions_key = config.questions_key;
      if (config.output_key)    step.output_key    = config.output_key;
      break;
    case "human_approval":
      if (config.output_key)        step.output_key        = config.output_key;
      if (config.interrupt_payload) step.interrupt_payload = config.interrupt_payload;
      if (config.notify?.url) {
        const n = config.notify;
        const notify: Record<string, unknown> = { url: n.url };
        if (n.method && n.method !== "POST") notify.method = n.method;
        if (n.headers && Object.keys(n.headers).length)  notify.headers = n.headers;
        if (n.auth?.type) {
          const auth: Record<string, string> = { type: n.auth.type };
          if (n.auth.token)    auth.token    = n.auth.token;
          if (n.auth.username) auth.username = n.auth.username;
          if (n.auth.password) auth.password = n.auth.password;
          notify.auth = auth;
        }
        if (n.payload && Object.keys(n.payload).length) notify.payload = n.payload;
        step.notify = notify;
      }
      break;
    case "execute":
      if (config.conversation_id)       step.conversation_id       = config.conversation_id;
      if (config.repo_template)         step.repo_template         = config.repo_template;
      if (config.instructions_template) step.instructions_template = config.instructions_template;
      if (config.output_key)            step.output_key            = config.output_key;
      if (config.stop_on_failure)       step.stop_on_failure       = true;
      break;
    case "workflow":
      if (config.workflow_id)   step.workflow_id   = config.workflow_id;
      if (config.input_template) step.input_template = config.input_template;
      if (config.output_key)    step.output_key    = config.output_key;
      break;
    case "cron":
      if (config.schedule)          step.schedule          = config.schedule;
      if (config.timezone)          step.timezone          = config.timezone;
      if (config.request_template)  step.request_template  = config.request_template;
      if (config.output_key)        step.output_key        = config.output_key;
      break;
    case "pubsub":
      if (config.topic)        step.topic        = config.topic;
      if (config.subscription) step.subscription = config.subscription;
      if (config.event)        step.event        = config.event;
      else if (config.datasource) step.datasource = config.datasource;
      if (config.project_id)   step.project_id   = config.project_id;
      if (config.request_template) step.request_template = config.request_template;
      if (config.output_key)   step.output_key   = config.output_key;
      if (config.event_schema_text?.trim()) {
        // Invalid JSON must not silently drop the schema the user typed.
        try {
          step.schema = JSON.parse(config.event_schema_text);
        } catch {
          throw new Error(`Step "${config.id}": event schema is not valid JSON`);
        }
      }
      break;
    case "http":
      if (config.auth_mode)      step.auth_mode      = config.auth_mode;
      if (config.webhook_secret) step.webhook_secret = config.webhook_secret;
      if (config.bearer_token)   step.bearer_token   = config.bearer_token;
      if (config.output_key)     step.output_key     = config.output_key;
      break;
    case "http_call":
      if (config.url)                       step.url        = config.url;
      if (config.method)                    step.method     = config.method;
      if (config.headers && Object.keys(config.headers).length) step.headers = config.headers;
      if (config.body    && Object.keys(config.body).length)    step.body    = config.body;
      if (config.output_key)                step.output_key = config.output_key;
      break;
    case "python":
      if (config.script_id)  step.script_id  = config.script_id;
      if (config.code)       step.code       = config.code;
      if (config.output_key) step.output_key = config.output_key;
      // sandbox defaults to true on the backend, so only persist an opt-out
      // and any explicit runtime choice.
      if (config.sandbox === false) step.sandbox = false;
      else if (config.sandbox_runtime && config.sandbox_runtime !== "local") {
        step.sandbox_runtime = config.sandbox_runtime;
      }
      if (config.sandbox !== false && config.sandbox_image) step.sandbox_image = config.sandbox_image;
      if (config.sandbox !== false && config.timeout_seconds) step.timeout_seconds = config.timeout_seconds;
      break;
    case "langgraph-agent":
      if (config.agent_id)         step.agent_id         = config.agent_id;
      if (config.runtime_override) step.runtime_override = config.runtime_override;
      if (config.image)            step.image            = config.image;
      if (config.helm_chart)       step.helm_chart       = config.helm_chart;
      if (config.output_mapping && Object.keys(config.output_mapping).length > 0) step.output_mapping = config.output_mapping;
      else if (config.output_key)  step.output_key       = config.output_key;
      if (config.compression_level && config.compression_level !== "none") step.compression_level = config.compression_level;
      if (config.env_vars && config.env_vars.length > 0) step.env_vars = config.env_vars;
      if (config.slack_input_key) step.slack_input_key = config.slack_input_key;
      if (config.input_mapping && Object.keys(config.input_mapping).length > 0) step.input_mapping = config.input_mapping;
      break;
    case "data_source":
      if (config.source)     step.source     = config.source;
      if (config.operation)  step.operation  = config.operation;
      if (config.params && Object.keys(config.params).length) step.params = config.params;
      if (config.output_key) step.output_key = config.output_key;
      break;
    case "data": {
      // A `data` step is a list of named files and nothing else — no
      // output_key, because it writes nothing back into state.
      const selections = config.selections ?? [];
      // `name` becomes a filename, so a blank or duplicated one is a real
      // config error and refusing the save is the honest response. An empty
      // list is not an error: a node just dropped on the canvas has none.
      const problem = dataStepProblem(config);
      if (problem) throw new Error(`Step "${config.id}": ${problem}`);
      if (selections.length) {
        step.selections = selections.map((sel) => ({
          name: sel.name.trim(),
          from: sel.from.trim(),
          format: sel.format,
        }));
      }
      break;
    }
    case "storage":
      step.action = config.action ?? "get";
      if (config.key) step.key = config.key;
      if (config.action === "set" && config.value !== undefined) step.value = config.value;
      if (config.output_key) step.output_key = config.output_key;
      break;
    case "slack": {
      const action = config.action ?? "post";
      step.action = action;
      // Only the fields the chosen action actually uses are persisted, so a
      // step never carries a stale channel from an action it no longer runs.
      if (config.provider && config.provider !== "slack") step.provider = config.provider;
      if (action !== "dm" && config.channel) step.channel = config.channel;
      if (action === "post" || action === "reply" || action === "dm") {
        if (config.text) step.text = config.text;
      }
      if (action === "reply" || action === "thread") {
        if (config.thread_id) step.thread_id = config.thread_id;
      }
      if (action === "reply") {
        if (config.items) step.items = config.items;
        if (config.skip_if_replied) step.skip_if_replied = true;
      }
      if (action === "dm" && config.user_id) step.user_id = config.user_id;
      if (action === "delete" && config.message_id) step.message_id = config.message_id;
      if (action === "history") {
        if (config.oldest) step.oldest = config.oldest;
        if (config.limit) step.limit = config.limit;
      }
      if (config.ignore_errors) step.ignore_errors = true;
      if (config.output_key) step.output_key = config.output_key;
      break;
    }
    case "parallel":
      if (config.max_parallel) step.max_parallel = config.max_parallel;
      break;
    case "join":
      if (config.max_timeout) step.max_timeout = config.max_timeout;
      if (config.failure_policy) step.failure_policy = config.failure_policy;
      break;
    case "switch":
      // routes are serialised from edges in editableToApiPayload
      break;
    case "dynamic":
      // The whole orchestration config travels on the step as-is.
      Object.assign(step, config.dynamic ?? {});
      break;
  }
  if (config.max_loops !== undefined) step.max_loops = config.max_loops;
  if (config.success_criteria) step.success_criteria = config.success_criteria;
  if (config.fail_criteria) step.fail_criteria = config.fail_criteria;
  if (config.slack_notifications) step.slack_notifications = true;
  return step;
}

/** Convert a raw API step dict → EditableNodeConfig. */
export function apiStepToConfig(step: Record<string, unknown>): EditableNodeConfig {
  return {
    id:                   String(step.id ?? ""),
    type:                 (step.type as ApiStepType) ?? "llm",
    name:                 String(step.name ?? step.id ?? ""),
    description:          step.description as string | undefined,
    success_criteria:     step.success_criteria as string | undefined,
    fail_criteria:        step.fail_criteria as string | undefined,
    llm_provider:         step.llm_provider as string | undefined,
    model:                step.model as string | undefined,
    system_prompt:        step.system_prompt as string | undefined,
    user_template:        step.user_template as string | undefined,
    output_key:           step.output_key as string | undefined,
    output_mapping:       step.output_mapping as Record<string, string> | undefined,
    output_fields:        step.output as StructuredOutputField[] | undefined,
    fail_if_false:        step.fail_if_false as string[] | undefined,
    bind_mcp_tools:       step.bind_mcp_tools as boolean | undefined,
    max_iterations:       step.max_iterations as number | undefined,
    max_loops:            step.max_loops as number | undefined,
    tool:                 step.tool as string | undefined,
    tool_input:           step.tool_input as Record<string, string> | undefined,
    questions_key:        step.questions_key as string | undefined,
    interrupt_payload:    step.interrupt_payload as Record<string, string> | undefined,
    notify:               step.notify as NotifyConfig | undefined,
    repo_template:        step.repo_template as string | undefined,
    instructions_template:step.instructions_template as string | undefined,
    stop_on_failure:      step.stop_on_failure as boolean | undefined,
    workflow_id:          step.workflow_id as string | undefined,
    input_template:       step.input_template as string | undefined,
    schedule:             step.schedule as string | undefined,
    timezone:             step.timezone as string | undefined,
    request_template:     step.request_template as string | undefined,
    event:                step.event as string | undefined,
    topic:                step.topic as string | undefined,
    subscription:         step.subscription as string | undefined,
    datasource:           step.datasource as string | undefined,
    project_id:           step.project_id as string | undefined,
    event_schema_text:    step.schema ? JSON.stringify(step.schema, null, 2) : undefined,
    auth_mode:            step.auth_mode as "hmac" | "bearer" | undefined,
    webhook_secret:       step.webhook_secret as string | undefined,
    bearer_token:         step.bearer_token as string | undefined,
    url:                  step.url as string | undefined,
    method:               step.method as EditableNodeConfig["method"] | undefined,
    headers:              step.headers as Record<string, string> | undefined,
    body:                 step.body as Record<string, string> | undefined,
    code:                 step.code as string | undefined,
    script_id:            step.script_id as string | undefined,
    sandbox:              (step.sandbox as boolean | undefined) ?? true,
    sandbox_runtime:      (step.sandbox_runtime as "local" | "docker" | "k8s" | undefined) ?? "local",
    sandbox_image:        step.sandbox_image as string | undefined,
    timeout_seconds:      step.timeout_seconds as number | undefined,
    max_parallel:         step.max_parallel as number | undefined,
    max_timeout:          step.max_timeout as number | undefined,
    failure_policy:       step.failure_policy as 'and' | 'or' | undefined,
    agent_id:             step.agent_id as string | undefined,
    runtime_override:     step.runtime_override as "local" | "docker" | "k8s" | undefined,
    image:                step.image as string | undefined,
    helm_chart:           step.helm_chart as string | undefined,
    compression_level:    (step.compression_level as "none" | "lite" | "full" | "ultra" | undefined) ?? "none",
    env_vars:             (step.env_vars as EnvVarEntry[] | undefined) ?? [],
    slack_notifications:  step.slack_notifications as boolean | undefined,
    slack_input_key:      step.slack_input_key as string | undefined,
    input_mapping:        step.input_mapping as Record<string, string> | undefined,
    source:               step.source as string | undefined,
    operation:            step.operation as string | undefined,
    params:               step.params as Record<string, string> | undefined,
    selections:           step.selections as EditableNodeConfig["selections"],
    action:               step.action as EditableNodeConfig["action"] | undefined,
    key:                  step.key as string | undefined,
    value:                step.value,
    provider:             step.provider as string | undefined,
    channel:              step.channel as string | undefined,
    text:                 step.text as string | undefined,
    thread_id:            step.thread_id as string | undefined,
    user_id:              step.user_id as string | undefined,
    message_id:           step.message_id as string | undefined,
    oldest:               step.oldest as string | undefined,
    limit:                step.limit as number | undefined,
    items:                step.items as string | undefined,
    skip_if_replied:      step.skip_if_replied as boolean | undefined,
    ignore_errors:        step.ignore_errors as boolean | undefined,
    dynamic:              step.type === "dynamic" ? pickDynamicConfig(step) : undefined,
  };
}

/**
 * Sort nodes into a true topological order: every node is emitted only after all
 * of its predecessors. New nodes appended to the React state array end up there
 * regardless of where the user connected them — this reorders them to match the
 * drawn edges. Disconnected nodes, and any node caught in a cycle, are appended
 * at the end in their original order.
 *
 * This must be a topological sort and not a breadth-first walk. BFS emits a node
 * at its *shallowest* arrival, so a convergence node that every branch routes
 * into lands right after its shortest branch instead of last. The backend gives
 * a step that declares no outgoing edge an implicit fall-through to the next
 * step in this array, so a mid-array convergence node used to acquire an edge
 * into a branch it should only ever be reached *from* — a cycle nobody drew.
 *
 * Termination is now stated rather than implied — a node with nothing drawn
 * leaving it serialises as `next: END` — so that edge is no longer reachable
 * from the editor whatever the order. Sorting topologically keeps the saved
 * array reading the way the canvas looks, which is the point of it.
 */
function sortNodesByEdges(
  nodes: EditableNodeConfig[],
  edges: Array<{ source: string; target: string }>,
): EditableNodeConfig[] {
  if (nodes.length <= 1) return nodes;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const originalIdx = new Map(nodes.map((n, i) => [n.id, i]));

  // Dedupe edges and ignore any pointing outside the step set (addon nodes were
  // filtered out by the caller), so indegrees stay exact — one stale increment
  // would strand a node and silently push it to the tail.
  const adj = new Map<string, string[]>();
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const seenEdge = new Set<string>();
  for (const e of edges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) continue;
    if (e.source === e.target) continue;
    const key = `${e.source} ${e.target}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const byOriginalIdx = (a: string, b: string) =>
    (originalIdx.get(a) ?? 0) - (originalIdx.get(b) ?? 0);

  const ready = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  if (ready.length === 0) return nodes; // every node is in a cycle
  ready.sort(byOriginalIdx);

  const sorted: EditableNodeConfig[] = [];
  const visited = new Set<string>();

  // Kahn's algorithm. Ties are broken by original array index so an unchanged
  // canvas re-serialises byte-identically and saving does not churn the diff.
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited.add(id);
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    let released = false;
    for (const s of adj.get(id) ?? []) {
      const remaining = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, remaining);
      if (remaining === 0 && !visited.has(s)) {
        ready.push(s);
        released = true;
      }
    }
    if (released) ready.sort(byOriginalIdx);
  }

  // Anything left is part of a cycle — the user drew a loop on purpose, or the
  // graph is mid-edit. Keep those nodes rather than dropping them.
  for (const n of nodes) {
    if (!visited.has(n.id)) sorted.push(n);
  }

  return sorted;
}

/** Convert a full editable workflow → payload for POST / PUT. */
export function editableToApiPayload(wf: EditableWorkflowDefinition) {
  // Exclude addon-only nodes (e.g. slack-addon, pvc-addon) from the step list
  const stepNodes = wf.nodes.filter((n) => {
    const t = (n as unknown as Record<string, unknown>).type;
    return t !== "slack-addon" && t !== "pvc-addon" && t !== "mcp-addon" && t !== "tools-addon" && t !== "s3-addon" && t !== "datasource-addon";
  });
  const sorted = sortNodesByEdges(stepNodes, wf.edges);
  const builtSteps: Array<Record<string, unknown>> = sorted.map((node) => {
    const step = configToApiStep(node);
    const out = wf.edges.filter((e) => e.source === node.id);
    // Force `routes:` form (instead of `next:`) whenever any outgoing edge
    // carries a wait — `next:` has no place to put it.
    const anyWait = out.some((e) => typeof e.data?.wait_seconds === "number" && e.data.wait_seconds > 0);
    if (node.type === "parallel") {
      if (out.length > 0) step.targets = out.map((e) => e.target);
    } else if (out.length === 0) {
      // Nothing drawn leaving this node, so say so. Omitting `next` does not
      // mean "ends here" — the engine falls through to the next step in the
      // saved array, which is how a convergence node once acquired an edge into
      // a branch nobody connected it to and looped the tail of the graph. On a
      // canvas an unconnected output is a terminus; this is what writes that down.
      step.next = END_MARKER;
    } else if (out.length === 1 && !anyWait) {
      step.next = out[0].target;
    } else if (out.length >= 1) {
      step.routes = out.map((e) => {
        const r: Record<string, string | number> = { next: e.target };
        const cond = e.data?.condition;
        if (cond) r.when = cond;
        const wait = e.data?.wait_seconds;
        if (typeof wait === "number" && wait > 0) r.wait_seconds = wait;
        return r;
      });
    }
    return step;
  });
  // Push slack_token / slack_payload from attached addon nodes onto the agent step
  for (const n of wf.nodes) {
    const raw = n as unknown as Record<string, unknown>;
    if (raw.type !== "slack-addon" || !raw.attachedTo) continue;
    const target = builtSteps.find((s) => s.id === raw.attachedTo);
    if (!target) continue;
    if (raw.slack_token) target.slack_token = raw.slack_token;
    if (raw.slack_channel) target.slack_channel = raw.slack_channel;
    if (raw.slack_payload) target.slack_payload = raw.slack_payload;
    if ((raw as Record<string, unknown>).slack_input_key) target.slack_input_key = (raw as Record<string, unknown>).slack_input_key as string;
  }
  // Push pvc fields from attached pvc-addon nodes onto the agent step
  for (const n of wf.nodes) {
    const raw = n as unknown as Record<string, unknown>;
    if (raw.type !== "pvc-addon" || !raw.attachedTo) continue;
    const target = builtSteps.find((s) => s.id === raw.attachedTo);
    if (!target) continue;
    target.pvc_name = (raw.pvc_name as string) || "";
    target.pvc_mount_point = (raw.pvc_mount_point as string) || "";
    target.pvc_ttl = (raw.pvc_ttl as string) || "1h";
  }
  return {
    id:          wf.id,
    name:        wf.name,
    description: wf.description ?? "",
    steps: builtSteps,
    ...(() => {
      const uiEdges: Record<string, { waypoints: Array<{ x: number; y: number }> }> = {};
      for (const e of wf.edges) {
        const wp = (e.data as { waypoints?: Array<{ x: number; y: number }> } | undefined)?.waypoints;
        if (wp && wp.length > 0) uiEdges[`${e.source}:${e.target}`] = { waypoints: wp };
      }
      const slackAddonNodes = wf.nodes.filter((n) => (n as unknown as Record<string, unknown>).type === "slack-addon");
      const pvcAddonNodes = wf.nodes.filter((n) => (n as unknown as Record<string, unknown>).type === "pvc-addon");
      const mcpAddonNodes = wf.nodes.filter((n) => (n as unknown as Record<string, unknown>).type === "mcp-addon");
      const toolsAddonNodes = wf.nodes.filter((n) => (n as unknown as Record<string, unknown>).type === "tools-addon");
      const s3AddonNodes = wf.nodes.filter((n) => (n as unknown as Record<string, unknown>).type === "s3-addon");
      const datasourceAddonNodes = wf.nodes.filter((n) => (n as unknown as Record<string, unknown>).type === "datasource-addon");
      const uiAddons = [
        ...slackAddonNodes.map((n) => {
          const raw = n as unknown as Record<string, unknown>;
          return {
            id: raw.id as string,
            type: "slack" as const,
            attachedTo: (raw.attachedTo as string | null) ?? null,
            position: wf.layout?.[raw.id as string] ?? null,
            slack_token: (raw.slack_token as string | undefined) ?? undefined,
            slack_channel: (raw.slack_channel as string | undefined) ?? undefined,
            slack_payload: (raw.slack_payload as string | undefined) ?? undefined,
            slack_input_key: (raw.slack_input_key as string | undefined) ?? undefined,
          };
        }),
        ...pvcAddonNodes.map((n) => {
          const raw = n as unknown as Record<string, unknown>;
          return {
            id: raw.id as string,
            type: "pvc" as const,
            attachedTo: (raw.attachedTo as string | null) ?? null,
            position: wf.layout?.[raw.id as string] ?? null,
          };
        }),
        ...mcpAddonNodes.map((n) => {
          const raw = n as unknown as Record<string, unknown>;
          return {
            id: raw.id as string,
            type: "mcp" as const,
            attachedTo: (raw.attachedTo as string | null) ?? null,
            position: wf.layout?.[raw.id as string] ?? null,
            servers: (raw.servers as Record<string, boolean> | undefined) ?? undefined,
          };
        }),
        ...toolsAddonNodes.map((n) => {
          const raw = n as unknown as Record<string, unknown>;
          return {
            id: raw.id as string,
            type: "tools" as const,
            attachedTo: (raw.attachedTo as string | null) ?? null,
            position: wf.layout?.[raw.id as string] ?? null,
            tools: (raw.tools as Record<string, boolean> | undefined) ?? undefined,
          };
        }),
        ...s3AddonNodes.map((n) => {
          const raw = n as unknown as Record<string, unknown>;
          return {
            id: raw.id as string,
            type: "s3" as const,
            attachedTo: (raw.attachedTo as string | null) ?? null,
            position: wf.layout?.[raw.id as string] ?? null,
            s3_bucket: (raw.s3_bucket as string | undefined) ?? undefined,
            s3_path: (raw.s3_path as string | undefined) ?? undefined,
          };
        }),
        ...datasourceAddonNodes.map((n) => {
          const raw = n as unknown as Record<string, unknown>;
          return {
            id: raw.id as string,
            type: "datasource" as const,
            attachedTo: (raw.attachedTo as string | null) ?? null,
            position: wf.layout?.[raw.id as string] ?? null,
            datasource_id: (raw.datasource_id as string | undefined) ?? undefined,
            allowed_operations: (raw.allowed_operations as string[] | undefined) ?? undefined,
          };
        }),
      ];
      const hasNodes = wf.layout && Object.keys(wf.layout).length > 0;
      const hasEdges = Object.keys(uiEdges).length > 0;
      const hasAddons = uiAddons.length > 0;
      if (!hasNodes && !hasEdges && !hasAddons) return {};
      return {
        ui: {
          ...(hasNodes ? { nodes: wf.layout } : {}),
          ...(hasEdges ? { edges: uiEdges } : {}),
          ...(hasAddons ? { addons: uiAddons } : {}),
        },
      };
    })(),
    use_meta_llm: wf.use_meta_llm ?? true,
    use_storage: wf.use_storage ?? false,
  };
}

// ─── YAML round-trip helpers ──────────────────────────────────────────────────

/** Serialize the current workflow to a YAML string (same format as the backend). */
export function workflowToYaml(wf: EditableWorkflowDefinition): string {
  const payload = editableToApiPayload(wf);
  return yamlDump(payload, { indent: 2, lineWidth: -1, noRefs: true });
}

/** Parse a YAML string back into an EditableWorkflowDefinition.
 *  Edges are derived from `routes` / `next` fields; falls back to sequential order. */
export function yamlToWorkflow(
  text: string,
  fallback: Pick<EditableWorkflowDefinition, "id" | "name" | "description" | "isNew">,
): EditableWorkflowDefinition {
  const parsed = yamlLoad(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid YAML: expected a mapping");
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.steps)) {
    throw new Error('Invalid workflow YAML: missing "steps" array');
  }
  const rawSteps = obj.steps as Record<string, unknown>[];
  const nodes = rawSteps.map(apiStepToConfig);

  type UiEdgeLayoutShape = Record<string, { waypoints: Array<{ x: number; y: number }> }>;
  const uiEdgeLayout = (obj.ui as Record<string, unknown> | undefined)?.edges as
    | UiEdgeLayoutShape
    | undefined;

  const edges: EditableWorkflowDefinition["edges"] = deriveEdges(
    rawSteps,
    nodes.map((n) => n.id),
    uiEdgeLayout,
  );

  const uiObj = obj.ui as Record<string, unknown> | undefined;
  const uiNodes = uiObj?.nodes as Record<string, { x: number; y: number }> | undefined;

  // Restore addon nodes from ui.addons
  type AddonEntry = { id: string; type: string; attachedTo?: string | null; position?: { x: number; y: number } | null; slack_token?: string; slack_channel?: string; slack_payload?: string; slack_input_key?: string };
  const uiAddons = uiObj?.addons as AddonEntry[] | undefined;
  if (uiAddons) {
    for (const addon of uiAddons) {
      if (addon.type === "slack") {
        const entry: Record<string, unknown> = {
          id: addon.id,
          type: "slack-addon",
          name: "Slack",
          position: addon.position ?? { x: 0, y: 0 },
          attachedTo: addon.attachedTo ?? null,
          slack_notifications: undefined,
        };
        if (addon.slack_token) entry.slack_token = addon.slack_token;
        if (addon.slack_channel) entry.slack_channel = addon.slack_channel;
        if (addon.slack_payload) entry.slack_payload = addon.slack_payload;
        if (addon.slack_input_key) entry.slack_input_key = addon.slack_input_key;
        (nodes as unknown as Array<Record<string, unknown>>).push(entry);
      } else if (addon.type === "pvc") {
        const parentStep = (rawSteps as Array<Record<string, unknown>>).find((s) => s.id === addon.attachedTo);
        const entry: Record<string, unknown> = {
          id: addon.id,
          type: "pvc-addon",
          name: "PVC",
          position: addon.position ?? { x: 0, y: 0 },
          attachedTo: addon.attachedTo ?? null,
          pvc_name: (parentStep?.pvc_name as string) ?? "",
          pvc_mount_point: (parentStep?.pvc_mount_point as string) ?? "",
          pvc_ttl: (parentStep?.pvc_ttl as string) ?? "1h",
        };
        (nodes as unknown as Array<Record<string, unknown>>).push(entry);
      } else if (addon.type === "mcp") {
        const entry: Record<string, unknown> = {
          id: addon.id,
          type: "mcp-addon",
          name: "MCP",
          position: addon.position ?? { x: 0, y: 0 },
          attachedTo: addon.attachedTo ?? null,
          servers: (addon as unknown as Record<string, unknown>).servers ?? {},
        };
        (nodes as unknown as Array<Record<string, unknown>>).push(entry);
      } else if (addon.type === "tools") {
        const entry: Record<string, unknown> = {
          id: addon.id,
          type: "tools-addon",
          name: "Tools",
          position: addon.position ?? { x: 0, y: 0 },
          attachedTo: addon.attachedTo ?? null,
          tools: (addon as unknown as Record<string, unknown>).tools ?? {},
        };
        (nodes as unknown as Array<Record<string, unknown>>).push(entry);
      } else if (addon.type === "s3") {
        const entry: Record<string, unknown> = {
          id: addon.id,
          type: "s3-addon",
          name: "S3 Storage",
          position: addon.position ?? { x: 0, y: 0 },
          attachedTo: addon.attachedTo ?? null,
          s3_bucket: (addon as unknown as Record<string, unknown>).s3_bucket ?? "",
          s3_path: (addon as unknown as Record<string, unknown>).s3_path ?? "",
        };
        (nodes as unknown as Array<Record<string, unknown>>).push(entry);
      } else if (addon.type === "datasource") {
        const entry: Record<string, unknown> = {
          id: addon.id,
          type: "datasource-addon",
          name: "Datasource",
          position: addon.position ?? { x: 0, y: 0 },
          attachedTo: addon.attachedTo ?? null,
          datasource_id: (addon as unknown as Record<string, unknown>).datasource_id ?? "",
          allowed_operations: (addon as unknown as Record<string, unknown>).allowed_operations ?? [],
        };
        (nodes as unknown as Array<Record<string, unknown>>).push(entry);
      }
    }
  }

  return {
    id:          String(obj.id          ?? fallback.id),
    name:        String(obj.name        ?? fallback.name),
    description: obj.description != null ? String(obj.description) : undefined,
    nodes,
    edges,
    isNew: fallback.isNew,
    layout: uiNodes ?? {},
  };
}

/**
 * Convert a raw workflow API response object (as returned by GET /api/v1/workflows/:id)
 * directly to an EditableWorkflowDefinition, without the caller needing to import js-yaml.
 * Used by WorkflowDetail to build the run canvas.
 */
export function apiWorkflowToEditable(
  wf: Record<string, unknown>,
): EditableWorkflowDefinition {
  const rawSteps = Array.isArray(wf.steps) ? (wf.steps as Record<string, unknown>[]) : [];
  const yamlText = yamlDump({
    id:          wf.id,
    name:        wf.name,
    description: wf.description,
    steps:       rawSteps,
    ui:          wf.ui,
  });
  return yamlToWorkflow(yamlText, {
    id:          String(wf.id   ?? ""),
    name:        String(wf.name ?? ""),
    description: wf.description as string | undefined,
    isNew:       false,
  });
}

// ─── YAML syntax highlighting ─────────────────────────────────────────────────

function _highlightYamlValue(rest: string): string {
  const m = rest.match(/^(\s+)([\s\S]*)$/);
  const space = m ? m[1] : " ";
  const val   = m ? m[2] : rest.trimStart();
  if (!val) return rest;

  if (/^[|>][|-]?$/.test(val))
    return `${space}<span style="color:#fbbf24">${val}</span>`;
  if (/^(true|false|null|~)$/i.test(val))
    return `${space}<span style="color:#c084fc">${val}</span>`;
  if (/^-?\d+(\.\d+)?$/.test(val))
    return `${space}<span style="color:#fb923c">${val}</span>`;
  if (/^["']/.test(val))
    return `${space}<span style="color:#86efac">${val}</span>`;
  // Unquoted string — highlight {placeholder} tokens
  const hi = val.replace(/(\{[\w_]+\})/g, '<span style="color:#fde68a">$1</span>');
  return `${space}<span style="color:#a5f3fc">${hi}</span>`;
}

function highlightYaml(text: string): string {
  return text.split("\n").map((line) => {
    const esc = line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    if (/^\s*#/.test(esc))
      return `<span style="color:#64748b;font-style:italic">${esc}</span>`;

    // key: value  (handles optional leading "- ")
    const kv = esc.match(/^(\s*(?:-\s+)?)([\w_-]+)(:)(.*)$/);
    if (kv) {
      const [, indent, key, colon, rest] = kv;
      return (
        `${indent}<span style="color:#7dd3fc;font-weight:600">${key}</span>` +
        `<span style="color:#94a3b8">${colon}</span>` +
        _highlightYamlValue(rest)
      );
    }

    // bare list item "  - value"
    const li = esc.match(/^(\s*)(-)(\s+.*)$/);
    if (li) {
      const [, indent, dash, rest] = li;
      return `${indent}<span style="color:#94a3b8">${dash}</span><span style="color:#e2e8f0">${rest}</span>`;
    }

    return `<span style="color:#e2e8f0">${esc}</span>`;
  }).join("\n");
}

// ─── YAML editor component ────────────────────────────────────────────────────

function YamlEditor({
  value, onChange, error, readonly,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  readonly?: boolean;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const highlighted = useMemo(() => highlightYaml(value), [value]);

  const syncScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    if (preRef.current) {
      preRef.current.scrollTop  = e.currentTarget.scrollTop;
      preRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
      {error && (
        <div className="px-4 py-2 bg-red-950/60 border-b border-red-900/50 text-xs text-red-400 shrink-0 font-mono">
          ⚠ {error}
        </div>
      )}
      <div className="relative flex-1 overflow-hidden">
        {/* Syntax-highlighted backdrop */}
        <pre
          ref={preRef}
          aria-hidden
          className="absolute inset-0 overflow-auto m-0 p-4 font-mono text-xs leading-5 whitespace-pre pointer-events-none select-none"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: highlighted + " " }}
        />
        {/* Transparent editable layer */}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          readOnly={readonly}
          spellCheck={false}
          className="absolute inset-0 overflow-auto p-4 bg-transparent text-transparent resize-none focus:outline-none w-full h-full font-mono text-xs leading-5 whitespace-pre"
          style={{ caretColor: "white" }}
        />
      </div>
    </div>
  );
}

// Operator nodes and EditorNode are now shared — see workflow-canvas/nodes

// ─── Slack addon toggle (default vs custom) ───────────────────────────────────

function SlackAddonToggle({
  label,
  defaultHint,
  value,
  onClear,
  onEnable,
  readonly,
  children,
}: {
  label: string;
  defaultHint: string;
  value: string | undefined;
  onClear: () => void;
  onEnable: () => void;
  readonly: boolean;
  children: React.ReactNode;
}) {
  const isCustom = value !== undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <button
          onClick={onClear}
          disabled={readonly}
          className={clsx(
            "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
            !isCustom ? "bg-slate-600 text-slate-100" : "bg-slate-800 text-slate-500 hover:text-slate-300",
          )}
        >Default</button>
        <button
          onClick={onEnable}
          disabled={readonly}
          className={clsx(
            "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
            isCustom ? "bg-sky-700 text-sky-100" : "bg-slate-800 text-slate-500 hover:text-slate-300",
          )}
        >Custom</button>
      </div>
      {!isCustom && <p className="text-[10px] text-slate-500 italic">{defaultHint}</p>}
      {isCustom && children}
    </div>
  );
}

// EditorNode is now WorkflowStepNode from workflow-canvas/nodes; EditableEdge from workflow-canvas/edges

const SlackAddonNode: React.FC<{ id: string; data: any; selected: boolean }> = ({ data, selected }) => {
  const isAttached = !!data.attachedTo;
  return (
    <div
      style={{
        minWidth: 160,
        background: isAttached ? '#2d0f3a' : '#3d1a4a',
        borderWidth: 1,
        borderStyle: isAttached ? 'solid' : 'dashed',
        borderColor: selected ? '#E01E5A' : '#611f69',
        borderRadius: 0,
        padding: '5px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        opacity: isAttached ? 1 : 0.7,
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Slack "S" logo SVG */}
      <svg width="20" height="20" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.7 31.7c0 2.7-2.2 4.9-4.9 4.9S10 34.4 10 31.7s2.2-4.9 4.9-4.9H19.7v4.9z" fill="#E01E5A"/>
        <path d="M22.2 31.7c0-2.7 2.2-4.9 4.9-4.9s4.9 2.2 4.9 4.9V43.1c0 2.7-2.2 4.9-4.9 4.9s-4.9-2.2-4.9-4.9V31.7z" fill="#E01E5A"/>
        <path d="M27.1 19.7c-2.7 0-4.9-2.2-4.9-4.9S24.4 10 27.1 10s4.9 2.2 4.9 4.9V19.7H27.1z" fill="#36C5F0"/>
        <path d="M27.1 22.2c2.7 0 4.9 2.2 4.9 4.9s-2.2 4.9-4.9 4.9H15.7c-2.7 0-4.9-2.2-4.9-4.9s2.2-4.9 4.9-4.9H27.1z" fill="#36C5F0"/>
        <path d="M39.1 27.1c0-2.7 2.2-4.9 4.9-4.9s4.9 2.2 4.9 4.9-2.2 4.9-4.9 4.9H39.1V27.1z" fill="#2EB67D"/>
        <path d="M36.6 27.1c0 2.7-2.2 4.9-4.9 4.9s-4.9-2.2-4.9-4.9V15.7c0-2.7 2.2-4.9 4.9-4.9s4.9 2.2 4.9 4.9V27.1z" fill="#2EB67D"/>
        <path d="M31.7 39.1c2.7 0 4.9 2.2 4.9 4.9S34.4 48.9 31.7 48.9s-4.9-2.2-4.9-4.9V39.1H31.7z" fill="#ECB22E"/>
        <path d="M31.7 36.6c-2.7 0-4.9-2.2-4.9-4.9s2.2-4.9 4.9-4.9H43.1c2.7 0 4.9 2.2 4.9 4.9s-2.2 4.9-4.9 4.9H31.7z" fill="#ECB22E"/>
      </svg>
      <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Slack</span>
      {!isAttached && (
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginLeft: 'auto' }}>unattached</span>
      )}
    </div>
  );
};


// ─── MCP Addon Panel ──────────────────────────────────────────────────────────

// Which MCP servers exist is deployment configuration (the backend's
// MCP_INTEGRATIONS registry), so the list is fetched rather than hardcoded.
function McpAddonPanel({ servers, attachedTo, agentId, readonly, onServersChange }: {
  servers: Record<string, boolean>;
  attachedTo: string | null;
  agentId: string | null;
  readonly: boolean;
  onServersChange: (servers: Record<string, boolean>) => void;
}) {
  const [integrations, setIntegrations] = useState<McpIntegration[]>([]);
  const [nameFilter, setNameFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  useEffect(() => {
    listMcpIntegrations()
      .then(setIntegrations)
      .catch(() => setIntegrations([]));
  }, []);

  const filtered = integrations.filter((mc) => {
    if (nameFilter && !mc.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    if (activeOnly) {
      const enabled = servers[mc.name] === true;
      if (!enabled) return false;
    }
    return true;
  });

  if (!attachedTo) {
    return (
      <div className="rounded-md bg-orange-950/40 border border-orange-900/40 px-3 py-2 text-[11px] text-orange-300/80 leading-relaxed">
        Drag this node onto an agent node to attach it.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-orange-950/40 border border-orange-900/40 px-3 py-2 text-[11px] text-orange-300/80 leading-relaxed">
        Selects which MCP servers are available to the agent. Servers come from
        the backend&apos;s MCP registry.
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="Filter by name…"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          disabled={readonly}
          className="flex-1 rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(e) => setActiveOnly(e.target.checked)}
          disabled={readonly}
          className="accent-orange-500"
        />
        Show active only
      </label>
      <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
        {filtered.length === 0 && (
          <p className="text-[10px] text-slate-500 italic">
            {integrations.length === 0
              ? "No MCP servers configured on the backend (MCP_INTEGRATIONS is empty)."
              : "No integrations found."}
          </p>
        )}
        {filtered.map((mc) => {
          const enabled = servers[mc.name] === true;
          return (
            <label key={mc.name} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none hover:text-slate-100">
              <input
                type="checkbox"
                checked={enabled}
                disabled={readonly}
                onChange={(e) => {
                  const next = { ...servers, [mc.name]: e.target.checked };
                  onServersChange(next);
                }}
                className="accent-orange-500"
              />
              <span className="flex items-center gap-1.5 min-w-0">
                {mc.name}
                <span className="text-[9px] text-slate-600 font-mono">{mc.transport}</span>
                {mc.configured === false && (
                  <span title="Declared on the backend but not reachable — missing endpoint, command, or bearer token"
                    className="text-[9px] px-1 rounded bg-amber-900/50 text-amber-300">
                    incomplete
                  </span>
                )}
                {mc.enabled === false && (
                  <span title="Turned off on the backend — checking it here grants nothing"
                    className="text-[9px] px-1 rounded bg-slate-700/70 text-slate-400">
                    disabled
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tools Addon Panel ────────────────────────────────────────────────────────

// Which bash-level tools exist is deployment configuration (the backend's
// AGENT_TOOLS registry), so the list is fetched rather than hardcoded.
function ToolsAddonPanel({ tools, attachedTo, agentId, readonly, onToolsChange }: {
  tools: Record<string, boolean>;
  attachedTo: string | null;
  agentId: string | null;
  readonly: boolean;
  onToolsChange: (tools: Record<string, boolean>) => void;
}) {
  const [available, setAvailable] = useState<AgentToolInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    listAgentTools()
      .then(setAvailable)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load tools"));
  }, []);

  if (!attachedTo) {
    return (
      <div className="rounded-md bg-emerald-950/40 border border-emerald-900/40 px-3 py-2 text-[11px] text-emerald-300/80 leading-relaxed">
        Drag this node onto an agent node to attach it.
      </div>
    );
  }

  // A tool the agent still enables after it left the registry stays listed, so
  // it can be seen and turned off rather than silently lingering.
  const stale = Object.keys(tools).filter(
    (name) => tools[name] === true && !available.some((t) => t.name === name),
  );

  const persist = (next: Record<string, boolean>) => {
    onToolsChange(next);
    if (agentId) {
      // Merge with existing addons — never replace the whole list.
      getAgent(agentId).then((agentDef) => {
        const existing = (agentDef?.addons ?? []) as import("@/lib/api").AgentAddonEntry[];
        const merged: import("@/lib/api").AgentAddonEntry[] = [
          ...existing.filter((a) => a.type !== "tools"),
          { type: "tools", tools: next },
        ];
        updateAgentAddons(agentId, merged).catch(() => {/* ignore */});
      }).catch(() => {/* ignore */});
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-emerald-950/40 border border-emerald-900/40 px-3 py-2 text-[11px] text-emerald-300/80 leading-relaxed">
        Grants bash-level credentials/binaries to the agent. Tools come from the
        backend&apos;s tool registry.
      </div>
      {loadError && (
        <p className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{loadError}</p>
      )}
      {!loadError && available.length === 0 && stale.length === 0 && (
        <p className="text-[10px] text-slate-500 italic">
          No tools configured on the backend (AGENT_TOOLS is empty).
        </p>
      )}
      <div className="space-y-1">
        {available.map((tool) => (
          <label key={tool.name} className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer select-none hover:text-slate-100">
            <input
              type="checkbox"
              checked={tools[tool.name] === true}
              disabled={readonly}
              onChange={(e) => persist({ ...tools, [tool.name]: e.target.checked })}
              className="mt-0.5 accent-emerald-500"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                {tool.label || tool.name}
                {!tool.configured && (
                  <span title="Some of this tool's env vars have no value on the backend"
                    className="text-[9px] px-1 rounded bg-amber-900/50 text-amber-300">
                    incomplete
                  </span>
                )}
              </span>
              {tool.description && (
                <span className="block text-[10px] text-slate-500 leading-relaxed">{tool.description}</span>
              )}
              {tool.command && (
                <span className="block text-[10px] text-slate-600 font-mono">{tool.command}</span>
              )}
            </span>
          </label>
        ))}
        {stale.map((name) => (
          <label key={name} className="flex items-center gap-2 text-xs text-amber-300/80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked
              disabled={readonly}
              onChange={() => persist({ ...tools, [name]: false })}
              className="accent-amber-500"
            />
            {name}
            <span className="text-[9px] px-1 rounded bg-amber-900/50 text-amber-300">not in registry</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── S3 Addon Panel ───────────────────────────────────────────────────────────

function S3AddonPanel({ s3Bucket, s3Path, attachedTo, agentId, readonly, onChange }: {
  s3Bucket: string;
  s3Path: string;
  attachedTo: string | null;
  agentId: string | null;
  readonly: boolean;
  onChange: (bucket: string, path: string) => void;
}) {
  if (!attachedTo) {
    return (
      <div className="rounded-md bg-amber-950/40 border border-amber-900/40 px-3 py-2 text-[11px] text-amber-300/80 leading-relaxed">
        Drag this node onto an agent node to attach it.
      </div>
    );
  }

  const handleChange = (bucket: string, path: string) => {
    onChange(bucket, path);
    if (agentId) {
      // Use dedicated addons endpoint — preserves agent_input and other fields
      getAgent(agentId).then((agentDef) => {
        const existing = (agentDef?.addons ?? []) as import("@/lib/api").AgentAddonEntry[];
        const merged: import("@/lib/api").AgentAddonEntry[] = [
          ...existing.filter((a) => a.type !== "s3"),
          { type: "s3", bucket, path },
        ];
        updateAgentAddons(agentId, merged).catch(() => {/* ignore */});
      }).catch(() => {/* ignore */});
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-amber-950/40 border border-amber-900/40 px-3 py-2 text-[11px] text-amber-300/80 leading-relaxed">
        Persists the agent workspace to GCS between runs.
      </div>
      <PropField label="Bucket" hint="GCS bucket name">
        <input
          type="text"
          placeholder="langgraph-agent-workspaces"
          value={s3Bucket}
          onChange={(e) => handleChange(e.target.value, s3Path)}
          disabled={readonly}
          className={clsx(
            "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500",
            readonly && "opacity-60 cursor-not-allowed",
          )}
        />
      </PropField>
      <PropField label="Path" hint="{workflow_id} is replaced at runtime">
        <input
          type="text"
          placeholder="{workflow_id}/my-project"
          value={s3Path}
          onChange={(e) => handleChange(s3Bucket, e.target.value)}
          disabled={readonly}
          className={clsx(
            "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500",
            readonly && "opacity-60 cursor-not-allowed",
          )}
        />
      </PropField>
    </div>
  );
}

// ─── Datasource Addon Panel ───────────────────────────────────────────────────

/**
 * The two controls of a datasource grant: which datasource, and which of its
 * operations.
 *
 * The checked list IS the authorization — a ticked POST is a granted POST, with
 * no second confirmation anywhere — so every operation carries its HTTP method
 * badge and the summary counts the writes. `MethodBadge` is the same component
 * the datasource editor uses, reading the same colours out of
 * `@/lib/datasourceRisk`, so a red DELETE means the same thing in both places.
 *
 * Nothing here is a security control: the backend mints a grant from the stored
 * list at spawn time and enforces it on both the tool listing and the call.
 * This panel only decides what gets stored.
 */
export function DatasourceAddonPanel({
  sourceId, allowedOperations, attachedTo, agentId, readonly, onChange,
}: {
  sourceId: string;
  allowedOperations: string[];
  attachedTo: string | null;
  agentId: string | null;
  readonly: boolean;
  onChange: (sourceId: string, allowedOperations: string[]) => void;
}) {
  const { datasources, isLoading } = useDatasources();
  const [opFilter, setOpFilter] = useState("");
  const workflowScope = useUsageScope();
  const me = useCurrentUser();
  // Attached to an agent, this edits the AGENT's own grant (persisted with
  // updateAgentAddons below), so what may be picked follows the agent's scope,
  // not the workflow's. Until the agent loads nothing is blocked; the backend
  // has the last word either way.
  const [agentScope, setAgentScope] = useState<UsageScope | null>(null);
  useEffect(() => {
    setAgentScope(null);
    if (!agentId) return;
    let live = true;
    getAgent(agentId).then((a) => {
      if (!live || !a?.visibility) return;
      setAgentScope({
        visibility: a.visibility,
        teamId: a.visibility === "team"
          ? (a.team_id ?? null)
          // A private agent may use its owner's team's sources; known when
          // the owner is the caller.
          : (a.owner_id && a.owner_id === me?.sub ? (me?.team?.id ?? null) : null),
      });
    }).catch(() => {/* unknown scope: don't block */});
    return () => { live = false; };
  }, [agentId, me]);
  const scope = agentId ? agentScope : workflowScope;

  // pubsub sources carry no operations, so there is nothing to grant on one.
  const selectable = useMemo(
    () => datasources.filter((d) => (d.operations ?? []).length > 0),
    [datasources],
  );
  const selected = useMemo(
    () => datasources.find((d) => d.id === sourceId),
    [datasources, sourceId],
  );
  const operations = selected?.operations ?? [];

  const visible = useMemo(() => {
    const needle = opFilter.trim().toLowerCase();
    if (!needle) return operations;
    return operations.filter((op) =>
      [op.name, op.method, op.path ?? "", op.query ?? ""]
        .join(" ").toLowerCase().includes(needle),
    );
  }, [operations, opFilter]);

  const checked = useMemo(() => new Set(allowedOperations), [allowedOperations]);
  const writeCount = operations.filter(
    (op) => checked.has(op.name) && methodLevel(op.method) !== "read",
  ).length;
  // A ticked operation the datasource no longer declares grants nothing, but it
  // stays visible so the operator can see the grant shrank under them.
  const stale = allowedOperations.filter(
    (name) => !operations.some((op) => op.name === name),
  );

  if (!attachedTo) {
    return (
      <div className="rounded-md bg-cyan-950/40 border border-cyan-900/40 px-3 py-2 text-[11px] text-cyan-300/80 leading-relaxed">
        Drag this node onto an agent node to attach it.
      </div>
    );
  }

  const persist = (nextSourceId: string, nextOperations: string[]) => {
    onChange(nextSourceId, nextOperations);
    if (!agentId) return;
    getAgent(agentId).then((agentDef) => {
      const existing = (agentDef?.addons ?? []) as import("@/lib/api").AgentAddonEntry[];
      // Keyed on (type, source_id), not on type alone: an agent may carry
      // several datasource addons and filtering by type would delete the
      // others. Both the old and the new id are dropped so switching
      // datasources leaves no orphaned grant behind.
      const kept = existing.filter(
        (a) => a.type !== "datasource"
          || (a.source_id !== sourceId && a.source_id !== nextSourceId),
      );
      const merged: import("@/lib/api").AgentAddonEntry[] = nextSourceId
        ? [...kept, {
            type: "datasource",
            source_id: nextSourceId,
            allowed_operations: nextOperations,
          }]
        : kept;
      updateAgentAddons(agentId, merged).catch(() => {/* ignore */});
    }).catch(() => {/* ignore */});
  };

  // Switching datasource clears the ticks rather than intersecting them by
  // name. Two sources can both have a `get_project`, and carrying a tick
  // across would grant an operation on the new source that nobody chose.
  const handleSourceChange = (nextSourceId: string) => persist(nextSourceId, []);

  const toggle = (name: string) => {
    const next = new Set(checked);
    if (next.has(name)) next.delete(name); else next.add(name);
    // Emit in the datasource's own order so the stored list is stable.
    persist(sourceId, operations.filter((op) => next.has(op.name)).map((op) => op.name));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-cyan-950/40 border border-cyan-900/40 px-3 py-2 text-[11px] text-cyan-300/80 leading-relaxed">
        The agent may call exactly the operations ticked below — writes included,
        with no further confirmation. It never sees this datasource&apos;s
        credentials; calls go through the backend. Changes apply to the next run.
      </div>

      <PropField label="Datasource" hint="which registered source">
        <select
          value={sourceId}
          onChange={(e) => handleSourceChange(e.target.value)}
          disabled={readonly}
          aria-label="Datasource"
          className={clsx(
            "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500",
            readonly && "opacity-60 cursor-not-allowed",
          )}
        >
          <option value="">
            {isLoading ? "loading…" : "— select a datasource —"}
          </option>
          {selectable.map((ds) => {
            const conflict = scopeConflict(scope, ds);
            return (
              <option key={ds.id} value={ds.id} disabled={!!conflict && ds.id !== sourceId} title={conflict ?? undefined}>
                {ds.name || ds.id} ({(ds.operations ?? []).length}){visibilitySuffix(ds)}{conflict ? " (not usable here)" : ""}
              </option>
            );
          })}
        </select>
      </PropField>

      {sourceId && !selected && !isLoading && (
        <p className="text-[10px] text-amber-400">
          Datasource <span className="font-mono">{sourceId}</span> no longer
          exists — this addon grants nothing.
        </p>
      )}

      {selected && (
        <PropField
          label="Allowed operations"
          hint={
            operations.length === 0
              ? "this datasource declares none"
              : `${checked.size} of ${operations.length} selected${writeCount > 0 ? ` · ${writeCount} write${writeCount === 1 ? "" : "s"}` : ""}`
          }
        >
          <div className="space-y-1.5">
            {operations.length > 1 && (
              <div className="flex items-center gap-2 text-[11px]">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                  <input
                    value={opFilter}
                    onChange={(e) => setOpFilter(e.target.value)}
                    placeholder="filter operations…"
                    aria-label="Filter operations"
                    className="w-full rounded bg-slate-800 border border-slate-600 pl-7 pr-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <button
                  type="button"
                  disabled={readonly}
                  onClick={() => persist(
                    sourceId,
                    operations
                      .filter((op) => checked.has(op.name) || visible.includes(op))
                      .map((op) => op.name),
                  )}
                  className="text-sky-400 hover:text-sky-300 transition-colors disabled:opacity-40"
                >
                  select {opFilter.trim() ? "shown" : "all"}
                </button>
                <button
                  type="button"
                  disabled={readonly}
                  onClick={() => persist(sourceId, [])}
                  className="text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
                >
                  none
                </button>
              </div>
            )}
            <div className="max-h-56 overflow-y-auto rounded-md border border-slate-700 divide-y divide-slate-800">
              {operations.length === 0 && (
                <p className="text-[10px] text-slate-500 italic px-2 py-2">
                  This datasource declares no operations.
                </p>
              )}
              {operations.length > 0 && visible.length === 0 && (
                <p className="text-[10px] text-slate-500 italic px-2 py-2">
                  Nothing matches that filter.
                </p>
              )}
              {visible.map((op) => (
                <label
                  key={op.name}
                  className={clsx(
                    "flex items-start gap-2 px-2 py-1.5 text-[10px]",
                    readonly ? "opacity-60" : "hover:bg-slate-800/60 cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-cyan-500"
                    disabled={readonly}
                    checked={checked.has(op.name)}
                    onChange={() => toggle(op.name)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-slate-300">{op.name}</span>
                    <MethodBadge method={op.method} className="ml-1 align-middle" />
                    <span className="ml-1 font-mono text-slate-500 break-all">
                      {op.path ?? (op.query ?? "").slice(0, 60)}
                    </span>
                    {(op.params ?? []).length > 0 && (
                      <span className="ml-1 text-slate-500">
                        ({(op.params ?? []).map((prm) => `${prm.name}${prm.required ? "" : "?"}`).join(", ")})
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {checked.size === 0 && operations.length > 0 && (
              <p className="text-[10px] text-slate-500 italic">
                Nothing ticked — this addon grants nothing.
              </p>
            )}
            {stale.length > 0 && (
              <p className="text-[10px] text-amber-400">
                No longer in this datasource:{" "}
                <span className="font-mono">{stale.join(", ")}</span>
              </p>
            )}
          </div>
        </PropField>
      )}
    </div>
  );
}

// ─── Properties panel ─────────────────────────────────────────────────────────

interface PropertiesPanelProps {
  node: Node | null;
  onChange: (id: string, patch: Partial<EditableNodeConfig>) => void;
  onDelete: (id: string) => void;
  readonly?: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  edges?: EditableWorkflowDefinition["edges"];
  onEdgeConditionChange?: (edgeId: string, condition: string | null) => void;
  nodeById?: (id: string) => EditableNodeConfig | undefined;
  /** Every step on the canvas — a `data` step suggests upstream state paths. */
  allNodes?: EditableNodeConfig[];
  workflowName?: string;
  workflowDesc?: string;
  useMetaLlm?: boolean;
  useStorage?: boolean;
  onWorkflowNameChange?: (v: string) => void;
  onWorkflowDescChange?: (v: string) => void;
  onUseMetaLlmChange?: (v: boolean) => void;
  onUseStorageChange?: (v: boolean) => void;
}

/** Slug an event id out of a display name, the way workflow ids are slugged. */
function slugifyEventId(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "").slice(0, 60);
}

/**
 * The `pubsub` trigger step's two ways to name a topic.
 *
 * **Existing** points the step at an event someone already registered.
 * **New** configures one here and saves it into the events, so the next
 * workflow can pick it from Existing instead of retyping the topic — an
 * inline-only trigger would be invisible to everyone else.
 */
function PubSubTriggerFields({ config, events, readonly, onChange, onEventsChanged }: {
  config: EditableNodeConfig;
  events: EventDefinition[];
  readonly: boolean;
  onChange: (patch: Partial<EditableNodeConfig>) => void;
  onEventsChanged: () => void;
}) {
  const selectedId = config.event ?? config.datasource ?? "";
  const selected = events.find((e) => e.id === selectedId);
  const [tab, setTab] = useState<"existing" | "new">(selectedId ? "existing" : "new");

  // Draft of the event being defined in the New tab. Held on the step so a
  // half-filled trigger survives clicking away, exactly as before events.
  const [eventName, setEventName] = useState(config.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const { error: schemaError } = parseEventSchema(config.event_schema_text ?? "");
  const draftId = slugifyEventId(eventName || config.topic || "");
  const canSave = !readonly && !saving && !!config.topic?.trim() && !!draftId && !schemaError;

  /** Point the step at *id* and drop the inline fields, which would override it. */
  function adopt(id: string) {
    onChange({ event: id, datasource: undefined, topic: undefined, subscription: undefined, event_schema_text: undefined });
    setTab("existing");
    onEventsChanged();
  }

  async function saveToEvents() {
    setSaving(true);
    setSaveError(null);
    try {
      const { schema } = parseEventSchema(config.event_schema_text ?? "");
      const created = await createEvent({
        id: draftId,
        name: eventName.trim() || draftId,
        topic: (config.topic ?? "").trim(),
        subscription: (config.subscription ?? "").trim(),
        event_schema: schema,
      });
      adopt(created.id);
    } catch (err) {
      if (err instanceof EventNameConflictError) {
        setConflict(true);
        return;
      }
      setSaveError(err instanceof Error ? err.message : "Failed to save the event");
    } finally {
      setSaving(false);
    }
  }

  async function overwriteEvent() {
    setSaving(true);
    setSaveError(null);
    try {
      const { schema } = parseEventSchema(config.event_schema_text ?? "");
      const name = eventName.trim() || draftId;
      const clash = (await listEvents()).find((e) => e.name === name) ?? (await listEvents()).find((e) => e.id === draftId);
      if (!clash) {
        setSaveError("The conflicting event is gone — try saving again");
        return;
      }
      await updateEvent(clash.id, {
        name,
        topic: (config.topic ?? "").trim(),
        subscription: (config.subscription ?? "").trim(),
        event_schema: schema,
      });
      setConflict(false);
      adopt(clash.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to overwrite the event");
    } finally {
      setSaving(false);
    }
  }

  const tabCls = (active: boolean) => clsx(
    "flex-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors",
    active ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200",
  );

  return (
    <>
      <div className="rounded-md bg-indigo-950/40 border border-indigo-900/40 px-3 py-2 text-[11px] text-indigo-300 leading-relaxed">
        The backend subscribes to this event&apos;s topic and starts a run per message.
        The event body lands in <span className="font-mono">Output Key</span>;
        topic, subscription, message id and attributes land in{" "}
        <span className="font-mono">trigger_info</span>.
      </div>

      <div className="flex gap-1 p-0.5 rounded-lg bg-slate-800/60">
        <button type="button" onClick={() => setTab("existing")} className={tabCls(tab === "existing")}>
          Existing
        </button>
        <button type="button" onClick={() => setTab("new")} className={tabCls(tab === "new")}>
          New
        </button>
      </div>

      {tab === "existing" ? (
        <>
          <PropField label="Event" hint="Supplies topic, schema and subscription">
            <select value={selectedId}
              onChange={(e) => onChange({ event: e.target.value || undefined, datasource: undefined })}
              disabled={readonly}
              className={inputCls}>
              <option value="">— none selected —</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.name || e.id}</option>
              ))}
              {selectedId && !events.some((e) => e.id === selectedId) && (
                <option value={selectedId}>{selectedId} (not found)</option>
              )}
            </select>
          </PropField>
          {selected ? (
            <div className="text-[11px] text-slate-500 leading-relaxed px-0.5">
              Topic <span className="font-mono text-slate-400">{selected.topic}</span>
              {selected.subscription
                ? <> · subscription <span className="font-mono text-slate-400">{selected.subscription.split("/").pop()}</span></>
                : <> · subscription created on first use</>}
              {selected.event_schema ? <> · schema enforced</> : <> · every message starts a run</>}
              . Edit it in the Events panel.
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 px-0.5">
              Nothing selected yet — pick an event, or define one under New.
            </p>
          )}
        </>
      ) : (
        <>
          <PropField label="Event Name" hint={draftId ? `saved as ${draftId}` : "names the event in the Events panel"}>
            <input type="text" value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Order events"
              disabled={readonly}
              className={inputCls} />
          </PropField>
          <PropField label="Topic" hint="Short name, or projects/<project>/topics/<topic>">
            <input type="text" value={config.topic ?? ""}
              onChange={(e) => onChange({ topic: e.target.value })}
              placeholder="e.g. orders"
              disabled={readonly}
              className={`${inputCls} font-mono`} />
          </PropField>
          <PropField label="Subscription" hint="Existing subscription to pull from; blank = created on first use and saved onto the event">
            <input type="text" value={config.subscription ?? ""}
              onChange={(e) => onChange({ subscription: e.target.value })}
              placeholder="blank = create one"
              disabled={readonly}
              className={`${inputCls} font-mono`} />
          </PropField>
          <PropField label="Event Schema" hint="JSON: {type, required, properties}. Events that do not match never start a run.">
            <textarea value={config.event_schema_text ?? ""}
              onChange={(e) => onChange({ event_schema_text: e.target.value })}
              placeholder={'{"type": "object", "required": ["order_id"]}'}
              rows={5}
              disabled={readonly}
              className={`${inputCls} font-mono resize-y`} />
          </PropField>
          {schemaError && (
            <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-900 rounded-md px-2 py-1">
              Not valid JSON — the workflow cannot be saved until this parses
            </p>
          )}
          {saveError && (
            <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-900 rounded-md px-2 py-1">{saveError}</p>
          )}
          <button type="button" onClick={saveToEvents} disabled={!canSave}
            className="w-full py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors disabled:opacity-40">
            {saving ? "Saving…" : "Save to Events"}
          </button>
          <p className="text-[11px] text-slate-500 px-0.5">
            Saving registers the event so other workflows can trigger on it, and points this step at it.
          </p>
        </>
      )}

      <PropField label="Output Key" hint="State key holding the event body">
        <input type="text" value={config.output_key ?? ""}
          onChange={(e) => onChange({ output_key: e.target.value })}
          placeholder="e.g. event"
          disabled={readonly}
          className={`${inputCls} font-mono`} />
      </PropField>
      <PropField label="Request Template" hint="{now} and {date} are available; blank = the event body as JSON">
        <input type="text" value={config.request_template ?? ""}
          onChange={(e) => onChange({ request_template: e.target.value })}
          placeholder="e.g. Handle order event from {date}"
          disabled={readonly}
          className={`${inputCls} font-mono`} />
      </PropField>

      {conflict && (
        <EventNameConflictDialog
          name={eventName.trim() || draftId}
          busy={saving}
          onOverwrite={overwriteEvent}
          onCancel={() => setConflict(false)}
        />
      )}
    </>
  );
}

function NodePropertiesPanel({ node, onChange, onDelete, readonly, pinned, onTogglePin, edges, onEdgeConditionChange, nodeById, allNodes, workflowName, workflowDesc, useMetaLlm, useStorage, onWorkflowNameChange, onWorkflowDescChange, onUseMetaLlmChange, onUseStorageChange }: PropertiesPanelProps) {
  const { providers, defaultProvider, getDefaultModel, isLoading: providersLoading, error: providersError } = useLlmProviders();
  const [configKeys, setConfigKeys] = useState<string[]>([]);
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/v1/llm/config/keys`)
      .then(r => r.ok ? r.json() : { keys: [] })
      .then(d => setConfigKeys(d.keys ?? []))
      .catch(() => setConfigKeys([]));
  }, []);
  // Shared SWR key with the canvas nodes' risk badges, so the operation picked
  // here and the badge shown on the node are reading the same operations.
  const { datasources: dsList } = useDatasources();
  // Shared with the canvas, so an event picked or created here immediately
  // relabels the node it is bound to.
  const { events: eventList, reload: reloadEvents } = useEvents();

  if (!node) {
    return (
      <div className="w-72 shrink-0 border-l border-slate-800 bg-slate-900/40 flex flex-col">
        <div className="flex items-center justify-end px-3 py-2 border-b border-slate-800 shrink-0">
          <button
            onClick={onTogglePin}
            title="Unpin panel"
            className="p-1 rounded text-sky-400 hover:bg-slate-800 transition-colors"
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Workflow Settings</p>
          <PropField label="Name">
            <input
              type="text"
              value={workflowName ?? ""}
              onChange={(e) => onWorkflowNameChange?.(e.target.value)}
              disabled={readonly}
              className={clsx(
                "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500",
                readonly && "opacity-60 cursor-not-allowed",
              )}
            />
          </PropField>
          <PropField label="Description">
            <textarea
              value={workflowDesc ?? ""}
              onChange={(e) => onWorkflowDescChange?.(e.target.value)}
              disabled={readonly}
              rows={3}
              className={clsx(
                "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none",
                readonly && "opacity-60 cursor-not-allowed",
              )}
            />
          </PropField>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useMetaLlm ?? true}
              onChange={(e) => onUseMetaLlmChange?.(e.target.checked)}
              disabled={readonly}
              className="accent-amber-500"
            />
            <span className="text-xs text-slate-300">Use Meta-LLM</span>
          </label>
          {/* Storage is opt-in per workflow: a `storage` step in a workflow that
              has this off fails loudly rather than quietly not persisting. */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useStorage ?? false}
              onChange={(e) => onUseStorageChange?.(e.target.checked)}
              disabled={readonly}
              className="accent-amber-500"
            />
            <span className="text-xs text-slate-300">Use storage</span>
          </label>
          <p className="text-[10px] text-slate-500 -mt-1">
            Key/value state that survives between runs, private to this
            workflow. Read and written by Storage steps.
          </p>
        </div>
      </div>
    );
  }

  const config = node.data as unknown as EditableNodeConfig;
  // The operation this node is bound to, resolved once: both the params form
  // and the Limit field need it, and Limit is only offered when the operation
  // actually pages.
  const selectedOp =
    config.type === "data_source" && config.source && config.operation
      ? dsList
          .find((d) => d.id === config.source)
          ?.operations.find((o) => o.name === config.operation)
      : undefined;
  const colors = TYPE_COLORS[config.type] ?? TYPE_COLORS.llm;

  // Shared routes editor for step types with multiple outgoing branches
  // (switch, langgraph-agent). Renders the current outgoing edges as an
  // ordered, top-to-bottom list of conditions; `introText` carries the
  // type-specific explainer shown above the list.
  const renderRoutesEditor = (introText: React.ReactNode) => (
    <PropField label="Routes" hint="Checked top-to-bottom. First matching condition wins. Leave empty = default fallback.">
      <div className="space-y-2">
        <p className="text-[10px] text-slate-500 leading-relaxed">
          {introText}
        </p>
        {(edges ?? []).filter(e => e.source === node.id).map((edge, idx) => {
          const targetName = nodeById?.(edge.target)?.name ?? edge.target;
          const cond = (edge.data as Record<string, unknown> | undefined)?.condition as string | undefined;
          return (
            <div key={edge.id} className="space-y-1 rounded-md border border-slate-700 bg-slate-800/60 p-2">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-slate-600 w-4 text-right">{idx + 1}.</span>
                <span className="text-[10px] text-slate-400 font-mono truncate flex-1">→ {targetName}</span>
              </div>
              <div className="flex gap-1 items-center">
                <input
                  type="text"
                  value={cond ?? ""}
                  onChange={(e) => onEdgeConditionChange?.(edge.id, e.target.value || null)}
                  placeholder="e.g. score > 4 && approved (empty = default)"
                  disabled={readonly}
                  className={`${inputCls} font-mono flex-1`}
                />
                {cond && (
                  <button type="button" onClick={() => onEdgeConditionChange?.(edge.id, null)}
                    className="text-[10px] text-slate-500 hover:text-red-400 px-1 flex-shrink-0">✕</button>
                )}
              </div>
              <div className="text-[9px] text-slate-600">
                {cond
                  ? <span>when <span className="text-amber-400/80 font-mono">{cond}</span> is truthy</span>
                  : "default — always taken if reached"}
              </div>
            </div>
          );
        })}
        {(edges ?? []).filter(e => e.source === node.id).length === 0 && (
          <p className="text-[10px] text-slate-500 italic">
            No routes yet. Drag from the amber ● handle on the node to connect targets.
          </p>
        )}
      </div>
    </PropField>
  );

  return (
    <div className="w-72 shrink-0 border-l border-slate-800 bg-slate-900/40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2.5"
        style={{
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: '#1e293b',
          borderLeftWidth: 3,
          borderLeftStyle: 'solid',
          borderLeftColor: colors.border,
        }}>
        <span className="text-xl leading-none">{TYPE_ICONS[config.type]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-white truncate">{config.name}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{TYPE_LABELS[config.type] ?? config.type}</p>
        </div>
        <button
          onClick={onTogglePin}
          title={pinned ? "Unpin panel" : "Pin panel"}
          className={clsx(
            "p-1 rounded transition-colors hover:bg-slate-800 shrink-0",
            pinned ? "text-sky-400" : "text-slate-500 hover:text-slate-300",
          )}
        >
          <Pin className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <PropField label="Name">
          <input type="text" value={config.name}
            onChange={(e) => onChange(node.id, { name: e.target.value })}
            disabled={readonly}
            className={clsx(inputCls, readonly && "opacity-60 cursor-not-allowed")} />
        </PropField>

        <PropField label="Description">
          <textarea value={config.description ?? ""} rows={2}
            onChange={(e) => onChange(node.id, { description: e.target.value })}
            placeholder="What does this node do?"
            disabled={readonly}
            className={clsx(`${inputCls} resize-y`, readonly && "opacity-60 cursor-not-allowed")} />
        </PropField>

        {/* ── LLM ────────────────────────────────────────────────────── */}
        {(config.type === "llm" || config.type === "llm_structured") && (
          <>
            <PropField
              label="Provider"
              hint={
                providersLoading
                  ? "loading…"
                  : providersError
                  ? "failed to load"
                  : defaultProvider
                  ? `global default: ${defaultProvider}`
                  : "overrides global LLM_PROVIDER"
              }
            >
              <select
                value={config.llm_provider ?? ""}
                onChange={(e) => {
                  const next = e.target.value || undefined;
                  onChange(node.id, {
                    llm_provider: next,
                    model: getDefaultModel(next),
                  });
                }}
                disabled={readonly}
                className={inputCls}
              >
                <option value="">(global default)</option>
                {providers.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
                {config.llm_provider &&
                  !providers.some((p) => p.name === config.llm_provider) && (
                    <option value={config.llm_provider}>{config.llm_provider} (unknown)</option>
                  )}
              </select>
            </PropField>
            <PropField
              label="Model"
              hint={
                config.llm_provider
                  ? `default: ${getDefaultModel(config.llm_provider) ?? "—"}`
                  : "overrides provider default"
              }
            >
              <input
                type="text"
                value={config.model ?? ""}
                onChange={(e) => onChange(node.id, { model: e.target.value || undefined })}
                placeholder={
                  config.llm_provider
                    ? getDefaultModel(config.llm_provider) ?? "(provider default)"
                    : "(global default)"
                }
                disabled={readonly}
                className={`${inputCls} font-mono`}
              />
            </PropField>
            <PropField label="System Prompt">
              <textarea value={config.system_prompt ?? ""} rows={5}
                onChange={(e) => onChange(node.id, { system_prompt: e.target.value })}
                placeholder="You are a helpful assistant that..."
                className={`${inputCls} resize-y font-mono text-[11px] leading-relaxed`} />
            </PropField>
            <PropField label="User Template" hint="{key} → state value">
              <textarea value={config.user_template ?? ""} rows={3}
                onChange={(e) => onChange(node.id, { user_template: e.target.value })}
                placeholder="Request: {request}"
                className={`${inputCls} resize-y font-mono text-[11px]`} />
            </PropField>
          </>
        )}

        {config.type === "llm" && (
          <PropField label="Output Key">
            <input type="text" value={config.output_key ?? ""}
              onChange={(e) => onChange(node.id, { output_key: e.target.value })}
              placeholder="e.g. plan"
              className={`${inputCls} font-mono`} />
          </PropField>
        )}

        {/* ── LLM Structured ─────────────────────────────────────────── */}
        {config.type === "llm_structured" && (
          <>
            <StructuredOutputEditor
              fields={config.output_fields ?? []}
              onChange={(fields) => onChange(node.id, { output_fields: fields })}
            />
            {/* Fail if false — only relevant for bool output fields */}
            {(config.output_fields ?? []).some((f) => f.type === "bool") && (
              <PropField label="Fail workflow if false" hint="bool fields only">
                <div className="space-y-1 mt-0.5">
                  {(config.output_fields ?? [])
                    .filter((f) => f.type === "bool")
                    .map((f) => {
                      const checked = (config.fail_if_false ?? []).includes(f.name);
                      return (
                        <label key={f.name} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const cur = config.fail_if_false ?? [];
                              const next = e.target.checked
                                ? [...cur, f.name]
                                : cur.filter((n) => n !== f.name);
                              onChange(node.id, { fail_if_false: next.length ? next : undefined });
                            }}
                            className="rounded border-slate-600 bg-slate-800 text-red-500"
                          />
                          <span className="font-mono text-xs text-slate-300 group-hover:text-white transition-colors">
                            {f.name}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </PropField>
            )}
            <PropField label="">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={config.bind_mcp_tools !== false}
                  onChange={(e) => onChange(node.id, { bind_mcp_tools: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-sky-500" />
                <span className="text-xs text-slate-300">Bind MCP tools</span>
              </label>
            </PropField>
            <PropField label="Max iterations" hint="Default: 25">
              <input
                type="number"
                min={1}
                placeholder="25"
                value={config.max_iterations ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange(node.id, { max_iterations: val === "" ? undefined : Number(val) });
                }}
                className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </PropField>
          </>
        )}

        {/* ── MCP ────────────────────────────────────────────────────── */}
        {config.type === "mcp" && (
          <>
            <PropField label="Tool Name">
              <input type="text" value={config.tool ?? ""}
                onChange={(e) => onChange(node.id, { tool: e.target.value })}
                placeholder="e.g. jira_get_issue"
                className={`${inputCls} font-mono`} />
            </PropField>
            <KVEditor
              label="Tool Input"
              hint='Values can use {key} placeholders'
              value={config.tool_input ?? {}}
              onChange={(v) => onChange(node.id, { tool_input: v })}
            />
            <PropField label="Output Key">
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                placeholder="e.g. jira_result"
                className={`${inputCls} font-mono`} />
            </PropField>
          </>
        )}

        {/* ── Ask Context ────────────────────────────────────────────── */}
        {config.type === "ask_context" && (
          <>
            <PropField
              label="Questions Key"
              hint="State key holding the list of questions produced by a previous step"
            >
              <input
                type="text"
                value={config.questions_key ?? ""}
                onChange={(e) => onChange(node.id, { questions_key: e.target.value || undefined })}
                placeholder="e.g. questions"
                className={`${inputCls} font-mono`}
              />
            </PropField>
            <PropField
              label="Output Key"
              hint="State key where the user's answers will be written"
            >
              <input
                type="text"
                value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value || undefined })}
                placeholder="e.g. context_answers"
                className={`${inputCls} font-mono`}
              />
            </PropField>
          </>
        )}

        {/* ── Human Approval ─────────────────────────────────────────── */}
        {config.type === "human_approval" && (
          <>
            <PropField label="Output Key" hint='State key for the bool result — default "approved"'>
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value || undefined })}
                placeholder="approved"
                className={`${inputCls} font-mono`} />
            </PropField>
            <KVEditor
              label="Interrupt Payload"
              hint="Key-value pairs shown to the reviewer"
              value={config.interrupt_payload ?? {}}
              onChange={(v) => onChange(node.id, { interrupt_payload: v })}
            />
            <NotifyEditor
              value={config.notify}
              onChange={(v) => onChange(node.id, { notify: v })}
              nodeId={node.id}
            />
          </>
        )}

        {/* ── Execute ────────────────────────────────────────────────── */}
        {config.type === "execute" && (
          <>
            <PropField label="Conversation ID" hint="Steps sharing the same ID reuse one OpenHands conversation">
              <input type="text" value={config.conversation_id ?? ""}
                onChange={(e) => onChange(node.id, { conversation_id: e.target.value })}
                placeholder="e.g. main-dev"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Repo Template">
              <input type="text" value={config.repo_template ?? ""}
                onChange={(e) => onChange(node.id, { repo_template: e.target.value })}
                placeholder="{repo}"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Instructions Template">
              <textarea value={config.instructions_template ?? ""} rows={3}
                onChange={(e) => onChange(node.id, { instructions_template: e.target.value })}
                placeholder="{plan}"
                className={`${inputCls} resize-y font-mono text-[11px]`} />
            </PropField>
            <PropField label="Output Key">
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                placeholder="e.g. implementation"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="" hint="When checked, an exception inside the node fails the run immediately. Off (default): the error is captured under output_key so the next node can decide whether to retry.">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={!!config.stop_on_failure}
                  onChange={(e) => onChange(node.id, { stop_on_failure: e.target.checked || undefined })}
                  className="rounded border-slate-600 bg-slate-800 text-sky-500" />
                <span className="text-xs text-slate-300">Stop on failure</span>
              </label>
            </PropField>
          </>
        )}

        {/* ── Sub-workflow ────────────────────────────────────────────── */}
        {config.type === "workflow" && (
          <>
            <PropField label="Workflow ID">
              <input type="text" value={config.workflow_id ?? ""}
                onChange={(e) => onChange(node.id, { workflow_id: e.target.value })}
                placeholder="e.g. feature-flow"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Input Template">
              <input type="text" value={config.input_template ?? ""}
                onChange={(e) => onChange(node.id, { input_template: e.target.value })}
                placeholder="{request}"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Output Key">
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                placeholder="e.g. child_result"
                className={`${inputCls} font-mono`} />
            </PropField>
          </>
        )}

        {/* ── Cron Trigger ───────────────────────────────────────────── */}
        {config.type === "cron" && (
          <>
            <PropField label="Schedule" hint="5-field cron expression">
              <input type="text" value={config.schedule ?? ""}
                onChange={(e) => onChange(node.id, { schedule: e.target.value })}
                placeholder="e.g. 0 9 * * 1-5"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Timezone" hint="zone the schedule is read in; blank = UTC. Name a zone for a '09:00 local' schedule — a fixed UTC hour drifts an hour at DST.">
              <input type="text" value={config.timezone ?? ""}
                onChange={(e) => onChange(node.id, { timezone: e.target.value })}
                placeholder="e.g. Europe/Berlin"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Request Template" hint="{now} and {date} are available">
              <input type="text" value={config.request_template ?? ""}
                onChange={(e) => onChange(node.id, { request_template: e.target.value })}
                placeholder="e.g. Daily report for {date}"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Output Key">
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                placeholder="e.g. trigger_info"
                className={`${inputCls} font-mono`} />
            </PropField>
          </>
        )}

        {/* ── Pub/Sub Trigger ────────────────────────────────────────── */}
        {config.type === "pubsub" && (
          <PubSubTriggerFields
            config={config}
            events={eventList}
            readonly={!!readonly}
            onEventsChanged={reloadEvents}
            onChange={(patch) => onChange(node.id, patch)}
          />
        )}

        {/* ── HTTP Trigger ────────────────────────────────────────────── */}
        {config.type === "http" && (
          <>
            <div className="rounded-md bg-green-950/40 border border-green-900/40 px-3 py-2 text-[11px] text-green-300 leading-relaxed">
              Triggered via <span className="font-mono">POST /api/v1/webhooks/{"{workflow_id}"}</span>.
              Choose an auth mode below.
            </div>
            <PropField label="Auth Mode">
              <select value={config.auth_mode ?? "hmac"}
                onChange={(e) => onChange(node.id, {
                  auth_mode: e.target.value as "hmac" | "bearer",
                  webhook_secret: undefined,
                  bearer_token: undefined,
                })}
                className={inputCls}>
                <option value="hmac">HMAC-SHA256 (X-Webhook-Signature)</option>
                <option value="bearer">Bearer Token (Authorization header)</option>
              </select>
            </PropField>
            {(config.auth_mode ?? "hmac") === "hmac" && (
              <PropField label="Webhook Secret" hint="Falls back to global WEBHOOK_SECRET if blank">
                <input type="password" value={config.webhook_secret ?? ""}
                  onChange={(e) => onChange(node.id, { webhook_secret: e.target.value })}
                  placeholder="Leave blank to use global WEBHOOK_SECRET"
                  className={`${inputCls} font-mono`} />
              </PropField>
            )}
            {config.auth_mode === "bearer" && (
              <PropField label="Bearer Token" hint="Caller must send: Authorization: Bearer <token>">
                <input type="password" value={config.bearer_token ?? ""}
                  onChange={(e) => onChange(node.id, { bearer_token: e.target.value })}
                  placeholder="e.g. my-secret-token"
                  className={`${inputCls} font-mono`} />
              </PropField>
            )}
            <PropField label="Output Key" hint="Stores the raw webhook body">
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                placeholder="e.g. trigger_payload"
                className={`${inputCls} font-mono`} />
            </PropField>
          </>
        )}

        {/* ── HTTP Call ──────────────────────────────────────────────── */}
        {config.type === "http_call" && (
          <>
            <PropField label="URL" hint="{key} templates resolved from state">
              <input type="text" value={config.url ?? ""}
                onChange={(e) => onChange(node.id, { url: e.target.value })}
                placeholder="https://api.example.com/endpoint"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Method">
              <select value={config.method ?? "GET"}
                onChange={(e) => onChange(node.id, { method: e.target.value as EditableNodeConfig["method"] })}
                className={`${inputCls}`}>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </PropField>
            <KVEditor
              label="Headers"
              hint="Values support {key} placeholders"
              value={config.headers ?? {}}
              onChange={(v) => onChange(node.id, { headers: v })}
            />
            <KVEditor
              label="Body (JSON)"
              hint="Sent as JSON; values support {key} placeholders"
              value={config.body ?? {}}
              onChange={(v) => onChange(node.id, { body: v })}
            />
            <PropField label="Output Key" hint='Stores {status, body}'>
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                placeholder="e.g. api_response"
                className={`${inputCls} font-mono`} />
            </PropField>
          </>
        )}

        {/* ── Python ─────────────────────────────────────────────────── */}
        {config.type === "python" && (
          <PythonStepFields
            config={config}
            onChange={(patch) => onChange(node.id, patch)}
          />
        )}

        {/* ── Agent ──────────────────────────────────────────────────── */}
        {config.type === "langgraph-agent" && (
          <>
            <PropField label="Agent ID">
              <input type="text" value={config.agent_id ?? ""}
                onChange={(e) => onChange(node.id, { agent_id: e.target.value })}
                placeholder="e.g. my-agent"
                className={`${inputCls} font-mono`} />
            </PropField>
            <PropField label="Runtime override" hint="Leave blank to use the agent's default runtime">
              <select value={config.runtime_override ?? ""}
                onChange={(e) => onChange(node.id, { runtime_override: (e.target.value || undefined) as "local" | "docker" | "k8s" | undefined })}
                className={inputCls}>
                <option value="">— agent default —</option>
                <option value="local">local</option>
                <option value="docker">docker</option>
                <option value="k8s">k8s</option>
              </select>
            </PropField>
            {config.runtime_override === "docker" && (
              <PropField label="Image">
                <input type="text" value={config.image ?? ""}
                  onChange={(e) => onChange(node.id, { image: e.target.value })}
                  placeholder="myregistry/my-agent:latest"
                  className={`${inputCls} font-mono`} />
              </PropField>
            )}
            {config.runtime_override === "docker" && (
              <PropField label="Health timeout (s)" hint="Seconds to wait for agent /health after container starts (default 300)">
                <input type="number" min={10} value={config.health_timeout ?? ""}
                  onChange={(e) => onChange(node.id, { health_timeout: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="300"
                  className={inputCls} />
              </PropField>
            )}
            {config.runtime_override === "k8s" && (
              <PropField label="Helm Chart">
                <input type="text" value={config.helm_chart ?? ""}
                  onChange={(e) => onChange(node.id, { helm_chart: e.target.value })}
                  placeholder="oci://registry/chart:1.0.0"
                  className={`${inputCls} font-mono`} />
              </PropField>
            )}
            {(config.runtime_override === "docker" || config.runtime_override === "k8s") && (
              <PropField label="Environment Variables" hint="Injected into the agent container">
                <div className="space-y-2">
                  {(config.env_vars ?? []).map((entry: EnvVarEntry, i: number) => (
                    <div key={i} className="space-y-1">
                      {/* Row 1: source | name | remove */}
                      <div className="flex gap-1 items-center">
                        <select
                          value={entry.from_config !== undefined ? "__config__" : "__custom__"}
                          onChange={(e) => {
                            const updated = [...(config.env_vars ?? [])];
                            if (e.target.value === "__config__") {
                              updated[i] = { name: entry.name, from_config: configKeys[0] ?? "" };
                            } else {
                              updated[i] = { name: entry.name, value: "" };
                            }
                            onChange(node.id, { env_vars: updated });
                          }}
                          className={`${inputCls} flex-shrink-0 w-28`}
                        >
                          <option value="__custom__">custom</option>
                          <option value="__config__">from config</option>
                        </select>
                        <input
                          type="text"
                          value={entry.name}
                          onChange={(e) => {
                            const updated = [...(config.env_vars ?? [])];
                            updated[i] = { ...updated[i], name: e.target.value };
                            onChange(node.id, { env_vars: updated });
                          }}
                          placeholder="VAR_NAME"
                          className={`${inputCls} font-mono flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (config.env_vars ?? []).filter((_: EnvVarEntry, j: number) => j !== i);
                            onChange(node.id, { env_vars: updated });
                          }}
                          className="text-slate-500 hover:text-red-400 text-xs px-1 flex-shrink-0"
                        >✕</button>
                      </div>
                      {/* Row 2: full-width value */}
                      {entry.from_config !== undefined ? (
                        <select
                          value={entry.from_config}
                          onChange={(e) => {
                            const updated = [...(config.env_vars ?? [])];
                            const newName = !entry.name.trim() ? e.target.value : entry.name;
                            updated[i] = { name: newName, from_config: e.target.value };
                            onChange(node.id, { env_vars: updated });
                          }}
                          className={`${inputCls} w-full font-mono`}
                        >
                          {configKeys.map(k => <option key={k} value={k}>{k}</option>)}
                          {!configKeys.includes(entry.from_config ?? "") && entry.from_config && (
                            <option value={entry.from_config}>{entry.from_config}</option>
                          )}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={entry.value ?? ""}
                          onChange={(e) => {
                            const updated = [...(config.env_vars ?? [])];
                            updated[i] = { name: entry.name, value: e.target.value };
                            onChange(node.id, { env_vars: updated });
                          }}
                          placeholder="value"
                          className={`${inputCls} w-full font-mono`}
                        />
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => onChange(node.id, { env_vars: [...(config.env_vars ?? []), { name: "", value: "" }] })}
                    className="text-xs text-sky-400 hover:text-sky-300"
                  >+ Add variable</button>
                </div>
              </PropField>
            )}
            <PropField label="Compression" hint="Compress agent responses (mirrors caveman mode levels)">
              <select value={config.compression_level ?? "none"}
                onChange={(e) => onChange(node.id, { compression_level: e.target.value as "none" | "lite" | "full" | "ultra" })}
                className={inputCls}>
                <option value="none">none — full verbosity</option>
                <option value="lite">lite — drop filler, fragments OK</option>
                <option value="full">full — caveman style, short synonyms</option>
                <option value="ultra">ultra — maximum compression</option>
              </select>
            </PropField>
            <KVEditor
              label="Input values"
              hint="State keys to pass (left = state key, right = agent key). Empty = send full state."
              value={config.input_mapping ?? {}}
              onChange={(v) => onChange(node.id, { input_mapping: Object.keys(v).length > 0 ? v : undefined })}
            />
            <KVEditor
              label="Output values"
              hint="Map agent output to state (left = agent key, right = state key). e.g. result → research_output"
              value={config.output_mapping ?? {}}
              onChange={(v) => onChange(node.id, { output_mapping: Object.keys(v).length > 0 ? v : undefined, output_key: undefined })}
            />
          </>
        )}

        {/* ── Agent routes ───────────────────────────────────────────── */}
        {config.type === "langgraph-agent" && renderRoutesEditor(
          <>
            Route condition is evaluated after the agent finishes, against the
            mapped output fields (Output values above). Leave one condition
            empty for the default fallback — if no route matches, the run fails.
          </>,
        )}

        {/* ── Data Source ────────────────────────────────────────────── */}
        {config.type === "data_source" && (
          <>
            <PropField label="Source" hint="Datasource ID (set when added from the palette)">
              <input type="text" value={config.source ?? ""} readOnly disabled
                className={`${inputCls} font-mono opacity-60 cursor-not-allowed`} />
            </PropField>
            <PropField label="Operation">
              <div className="flex items-center gap-1.5">
              <select value={config.operation ?? ""}
                onChange={(e) => {
                  const op = dsList.find((d) => d.id === config.source)?.operations.find((o) => o.name === e.target.value);
                  // Seed one entry per declared param, keeping any value the
                  // previous operation had under the same name and falling
                  // back to the param's own default. Typed, not blank
                  // strings: an `object` param seeded with "" is not a valid
                  // request and reads as if it were.
                  const params: Record<string, unknown> = {};
                  for (const p of op?.params ?? []) {
                    const kept = config.params?.[p.name];
                    params[p.name] = kept !== undefined && kept !== "" ? kept : (p.default ?? "");
                  }
                  onChange(node.id, { operation: e.target.value || undefined, params: op ? params : config.params });
                }}
                className={inputCls}>
                <option value="">— select operation —</option>
                {(dsList.find((d) => d.id === config.source)?.operations ?? []).map((op) => (
                  <option key={op.name} value={op.name}>{op.name}</option>
                ))}
                {config.operation && !(dsList.find((d) => d.id === config.source)?.operations ?? []).some((op) => op.name === config.operation) && (
                  <option value={config.operation}>{config.operation}</option>
                )}
              </select>
              {/* The node runs exactly this operation, so its own verb is the
                  honest badge — not the whole source's worst case. */}
              {config.operation && (
                <MethodBadge
                  method={dsList
                    .find((d) => d.id === config.source)
                    ?.operations.find((o) => o.name === config.operation)?.method}
                />
              )}
              </div>
            </PropField>
            {/* Not the generic KVEditor: a datasource operation declares its
                inputs and their types, and an `object` param (a REST API's
                `pagination`) rendered as `[object Object]` in a text box and
                could not be authored at all. */}
            <DatasourceParamsEditor
              specs={selectedOp?.params ?? []}
              paginate={selectedOp?.paginate}
              value={config.params ?? {}}
              onChange={(v) => onChange(node.id, { params: v })}
              readonly={readonly}
            />
            {/* How MUCH, never which page. Blank means every page: the
                executor walks a paginated operation until the API says it is
                done. Only offered when the operation actually pages —
                elsewhere it would promise something the source cannot do. */}
            {selectedOp?.paginate && (
              <PropField
                label="Limit"
                hint="Max records to fetch; blank = all pages"
              >
                <input
                  type="number"
                  min={1}
                  placeholder="all"
                  value={(config.limit as number | undefined) ?? ""}
                  onChange={(e) =>
                    onChange(node.id, {
                      limit: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  disabled={readonly}
                  className={`${inputCls} font-mono`}
                />
              </PropField>
            )}
            <PropField label="Output Key">
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                placeholder="e.g. result"
                className={`${inputCls} font-mono`} />
            </PropField>
          </>
        )}

        {/* ── Parallel ───────────────────────────────────────────────── */}
        {config.type === "parallel" && (
          <PropField label="Max parallel" hint="Max branches running at once (default: unlimited)">
            <input type="number" min={1} placeholder="unlimited"
              value={config.max_parallel ?? ""}
              onChange={(e) => onChange(node.id, { max_parallel: e.target.value ? Number(e.target.value) : undefined })}
              disabled={readonly}
              className={inputCls} />
          </PropField>
        )}

        {/* ── Data (downloadable export) ─────────────────────────────── */}
        {config.type === "data" && (
          <DataStepFields
            config={config}
            nodes={allNodes}
            edges={edges}
            onChange={(patch) => onChange(node.id, patch)}
            readonly={!!readonly}
          />
        )}

        {/* ── Join ───────────────────────────────────────────────────── */}
        {config.type === "join" && (
          <>
            <PropField label="Max timeout (s)" hint="Fail if branches don't complete within this many seconds (default: unlimited)">
              <input type="number" min={1} placeholder="unlimited"
                value={config.max_timeout ?? ""}
                onChange={(e) => onChange(node.id, { max_timeout: e.target.value ? Number(e.target.value) : undefined })}
                disabled={readonly}
                className={inputCls} />
            </PropField>
            <PropField label="Failure Policy" hint="AND: all branches must succeed. OR: at least one branch must succeed.">
              <select value={config.failure_policy ?? "and"}
                onChange={(e) => onChange(node.id, { failure_policy: e.target.value as 'and' | 'or' || undefined })}
                disabled={readonly}
                className={inputCls}>
                <option value="and">and — all branches must succeed</option>
                <option value="or">or — at least one branch must succeed</option>
              </select>
            </PropField>
          </>
        )}

        {/* ── Storage ────────────────────────────────────────────────── */}
        {config.type === "storage" && (
          <>
            <PropField label="Action">
              <select value={config.action ?? "get"}
                onChange={(e) => onChange(node.id, { action: e.target.value as 'get' | 'set' | 'delete' | 'keys' })}
                disabled={readonly}
                className={inputCls}>
                <option value="get">get — read a key (absent = null)</option>
                <option value="set">set — write a key</option>
                <option value="delete">delete — remove a key</option>
                <option value="keys">keys — list this workflow&apos;s keys</option>
              </select>
            </PropField>
            {config.action !== "keys" && (
              <PropField label="Key" hint="Entry name; supports {state_key} templates">
                <input type="text" value={config.key ?? ""}
                  onChange={(e) => onChange(node.id, { key: e.target.value })}
                  placeholder="alert-state"
                  disabled={readonly}
                  className={`${inputCls} font-mono`} />
              </PropField>
            )}
            {config.action === "set" && (
              <PropField label="Value (JSON)" hint="Any JSON; values support {state_key} templates">
                <textarea rows={4}
                  value={typeof config.value === "string" ? config.value : JSON.stringify(config.value ?? {}, null, 2)}
                  onChange={(e) => onChange(node.id, { value: e.target.value })}
                  disabled={readonly}
                  className={`${inputCls} font-mono resize-y`} />
              </PropField>
            )}
            <PropField label="Output Key">
              <input type="text" value={config.output_key ?? ""}
                onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                placeholder="e.g. alert_state"
                disabled={readonly}
                className={`${inputCls} font-mono`} />
            </PropField>
            <p className="text-[11px] text-slate-400 bg-slate-800/60 border border-slate-700 rounded-md px-2.5 py-2">
              Storage is private to this workflow — there is no way to address
              another workflow&apos;s keys. Enable <span className="text-slate-200">Use storage</span> in
              the workflow settings, or this step fails.
            </p>
          </>
        )}

        {/* ── Slack (messaging) ──────────────────────────────────────── */}
        {config.type === "slack" && (() => {
          const action = config.action ?? "post";
          const usesChannel = action !== "dm";
          const usesText = action === "post" || action === "reply" || action === "dm";
          return (
            <>
              <PropField label="Action">
                <select value={action}
                  onChange={(e) => onChange(node.id, { action: e.target.value as EditableNodeConfig["action"] })}
                  disabled={readonly}
                  className={inputCls}>
                  <option value="post">post — new message in a channel</option>
                  <option value="reply">reply — message inside a thread</option>
                  <option value="history">history — read a channel</option>
                  <option value="thread">thread — read one thread</option>
                  <option value="dm">dm — direct message a user</option>
                  <option value="delete">delete — remove a message</option>
                </select>
              </PropField>
              <PropField label="Provider" hint="Messaging provider; slack today">
                <select value={config.provider ?? "slack"}
                  onChange={(e) => onChange(node.id, { provider: e.target.value })}
                  disabled={readonly}
                  className={inputCls}>
                  <option value="slack">slack</option>
                </select>
              </PropField>
              {usesChannel && (
                <PropField label="Channel" hint="Channel id; supports {state_key} templates">
                  <input type="text" value={config.channel ?? ""}
                    onChange={(e) => onChange(node.id, { channel: e.target.value })}
                    placeholder="C0BLDDSEB1D"
                    disabled={readonly}
                    className={`${inputCls} font-mono`} />
                </PropField>
              )}
              {action === "dm" && (
                <PropField label="User" hint="Recipient's user id; the DM channel is opened for you">
                  <input type="text" value={config.user_id ?? ""}
                    onChange={(e) => onChange(node.id, { user_id: e.target.value })}
                    placeholder="{owner_slack_id}"
                    disabled={readonly}
                    className={`${inputCls} font-mono`} />
                </PropField>
              )}
              {(action === "reply" || action === "thread") && (
                <PropField label="Thread" hint="Id of the thread's root message">
                  <input type="text" value={config.thread_id ?? ""}
                    onChange={(e) => onChange(node.id, { thread_id: e.target.value })}
                    placeholder="{message_ts}"
                    disabled={readonly}
                    className={`${inputCls} font-mono`} />
                </PropField>
              )}
              {action === "delete" && (
                <PropField label="Message" hint="Id of the message to delete">
                  <input type="text" value={config.message_id ?? ""}
                    onChange={(e) => onChange(node.id, { message_id: e.target.value })}
                    placeholder="{posted[message_id]}"
                    disabled={readonly}
                    className={`${inputCls} font-mono`} />
                </PropField>
              )}
              {usesText && (
                <PropField label="Text" hint="Message body; supports {state_key} templates">
                  <textarea rows={4} value={config.text ?? ""}
                    onChange={(e) => onChange(node.id, { text: e.target.value })}
                    placeholder="{digest}"
                    disabled={readonly}
                    className={`${inputCls} font-mono resize-y`} />
                </PropField>
              )}
              {action === "history" && (
                <>
                  <PropField label="Oldest" hint="Lower time bound; supports {state_key} templates">
                    <input type="text" value={config.oldest ?? ""}
                      onChange={(e) => onChange(node.id, { oldest: e.target.value })}
                      placeholder="{window_start_ts}"
                      disabled={readonly}
                      className={`${inputCls} font-mono`} />
                  </PropField>
                  <PropField label="Limit" hint="Max messages to read">
                    <input type="number" min={1} value={config.limit ?? ""}
                      onChange={(e) => onChange(node.id, { limit: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="200"
                      disabled={readonly}
                      className={inputCls} />
                  </PropField>
                </>
              )}
              {action === "reply" && (
                <>
                  <PropField label="Items" hint="State path to a list of {thread_id, text} — one reply per entry">
                    <input type="text" value={config.items ?? ""}
                      onChange={(e) => onChange(node.id, { items: e.target.value })}
                      placeholder="overrides.confirmations"
                      disabled={readonly}
                      className={`${inputCls} font-mono`} />
                  </PropField>
                  <PropField label="" hint="Reads the thread first and skips a reply whose text is already there, so re-running does not confirm the same thing twice.">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox"
                        checked={!!config.skip_if_replied}
                        onChange={(e) => onChange(node.id, { skip_if_replied: e.target.checked || undefined })}
                        disabled={readonly}
                        className="rounded border-slate-600 bg-slate-800 text-sky-500" />
                      <span className="text-xs text-slate-300">Skip if already replied</span>
                    </label>
                  </PropField>
                </>
              )}
              <PropField label="Output Key">
                <input type="text" value={config.output_key ?? ""}
                  onChange={(e) => onChange(node.id, { output_key: e.target.value })}
                  placeholder={action === "history" ? "slack_messages" : "e.g. posted"}
                  disabled={readonly}
                  className={`${inputCls} font-mono`} />
              </PropField>
              <PropField label="" hint="On: a provider error is captured under output_key and the run continues. Off (default): the step fails the run.">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox"
                    checked={!!config.ignore_errors}
                    onChange={(e) => onChange(node.id, { ignore_errors: e.target.checked || undefined })}
                    disabled={readonly}
                    className="rounded border-slate-600 bg-slate-800 text-sky-500" />
                  <span className="text-xs text-slate-300">Ignore provider errors</span>
                </label>
              </PropField>
              <p className="text-[11px] text-slate-400 bg-slate-800/60 border border-slate-700 rounded-md px-2.5 py-2">
                There is no token field on purpose. The provider reads{" "}
                <span className="font-mono text-slate-200">SLACK_BOT_TOKEN</span> from
                the deployment&apos;s settings, so a credential is never stored in a
                workflow definition.
              </p>
            </>
          );
        })()}

        {/* ── Proceed (Or) ───────────────────────────────────────────── */}
        {config.type === "proceed_or" && (
          <div className="text-[11px] text-slate-400 bg-slate-800/60 border border-slate-700 rounded-md px-2.5 py-2 space-y-1.5">
            <p>
              The first incoming branch to arrive carries the run onward. Later
              arrivals are dropped, so the steps after this one run{" "}
              <span className="text-slate-200">exactly once</span> rather than
              once per branch.
            </p>
            <p>
              Nothing to configure — unlike <span className="text-violet-300">Join (And)</span>,
              which waits for every branch and has a failure policy.
            </p>
            <p className="text-slate-500">
              This changes what runs, not how fast: while a branch is still
              working the run does not overtake it.
            </p>
          </div>
        )}

        {/* ── Switch ─────────────────────────────────────────────────── */}
        {config.type === "switch" && renderRoutesEditor(
          <>
            Drag from the amber handle to add routes. Conditions support Python expressions:
            <span className="font-mono text-amber-400/80"> score &gt; 4 &amp;&amp; status != &apos;skip&apos;</span>
          </>,
        )}

        {/* ── Slack add-on ───────────────────────────────────────────── */}
        {(node.type as string) === "slack-addon" && (
          <div className="space-y-3">
            <div className="rounded-md bg-violet-950/40 border border-violet-900/40 px-3 py-2 text-[11px] text-violet-300/80 leading-relaxed">
              {(node.data as Record<string, unknown>).attachedTo
                ? "Sends a Slack message when the agent asks for context or approval."
                : "Drag this node onto an agent node to attach it."}
            </div>
            {!!(node.data as Record<string, unknown>).attachedTo && (
              <>
                {/* Bot token */}
                <PropField label="Bot token">
                  <SlackAddonToggle
                    label="token"
                    defaultHint="Uses global SLACK_BOT_TOKEN"
                    value={config.slack_token}
                    onClear={() => onChange(node.id, { slack_token: undefined })}
                    onEnable={() => onChange(node.id, { slack_token: "" })}
                    readonly={readonly ?? false}
                  >
                    <input
                      type="password"
                      placeholder="xoxb-…"
                      value={config.slack_token ?? ""}
                      onChange={(e) => onChange(node.id, { slack_token: e.target.value || undefined })}
                      disabled={readonly}
                      className={clsx(
                        "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500",
                        readonly && "opacity-60 cursor-not-allowed",
                      )}
                    />
                  </SlackAddonToggle>
                </PropField>
                {/* Channel */}
                <PropField label="Channel">
                  <SlackAddonToggle
                    label="channel"
                    defaultHint="Uses global SLACK_APPROVALS_CHANNEL"
                    value={config.slack_channel}
                    onClear={() => onChange(node.id, { slack_channel: undefined })}
                    onEnable={() => onChange(node.id, { slack_channel: "" })}
                    readonly={readonly ?? false}
                  >
                    <input
                      type="text"
                      placeholder="#channel or C0XXXXXXX"
                      value={config.slack_channel ?? ""}
                      onChange={(e) => onChange(node.id, { slack_channel: e.target.value || undefined })}
                      disabled={readonly}
                      className={clsx(
                        "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500",
                        readonly && "opacity-60 cursor-not-allowed",
                      )}
                    />
                  </SlackAddonToggle>
                </PropField>
                {/* Payload */}
                <PropField label="Payload JSON" hint="Use {slack_channel}, {run_id}, {ticket_id}, {questions}.">
                  <SlackAddonToggle
                    label="payload"
                    defaultHint="Default: questions posted as plain text thread"
                    value={config.slack_payload}
                    onClear={() => onChange(node.id, { slack_payload: undefined })}
                    onEnable={() => onChange(node.id, { slack_payload: "" })}
                    readonly={readonly ?? false}
                  >
                    <textarea
                      rows={6}
                      placeholder={`{\n  "channel": "{slack_channel}",\n  "text": "Agent needs input for {ticket_id}:\\n{questions}"\n}`}
                      value={config.slack_payload ?? ""}
                      onChange={(e) => onChange(node.id, { slack_payload: e.target.value || undefined })}
                      disabled={readonly}
                      className={clsx(
                        "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500 resize-y",
                        readonly && "opacity-60 cursor-not-allowed",
                      )}
                    />
                  </SlackAddonToggle>
                </PropField>
                {/* Content key */}
                <PropField label="Content key" hint="Output key to post as message content (e.g. plan_short). Leave empty to disable.">
                  <input
                    type="text"
                    placeholder="plan_short"
                    value={config.slack_input_key ?? ""}
                    onChange={(e) => onChange(node.id, { slack_input_key: e.target.value || undefined })}
                    disabled={readonly}
                    className={clsx(
                      "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500",
                      readonly && "opacity-60 cursor-not-allowed",
                    )}
                  />
                </PropField>
              </>
            )}
          </div>
        )}

        {/* ── PVC add-on ─────────────────────────────────────────────── */}
        {(node.type as string) === "pvc-addon" && !!(node.data as Record<string, unknown>).attachedTo && (
          <div className="p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">PVC Addon</h3>
            <PropField label="PVC Name" hint="Leave blank to auto-generate">
              <input
                type="text"
                placeholder="auto-generated"
                value={config.pvc_name ?? ""}
                onChange={e => onChange(node.id, { pvc_name: e.target.value })}
                disabled={readonly}
                className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </PropField>
            <PropField label="Mount point">
              <input
                type="text"
                placeholder="/workspace"
                value={config.pvc_mount_point ?? ""}
                onChange={e => onChange(node.id, { pvc_mount_point: e.target.value })}
                disabled={readonly}
                className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </PropField>
            <PropField label="TTL" hint="e.g. 1h, 30m, 7d">
              <input
                type="text"
                placeholder="1h"
                value={config.pvc_ttl ?? ""}
                onChange={e => onChange(node.id, { pvc_ttl: e.target.value })}
                disabled={readonly}
                className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </PropField>
          </div>
        )}

        {/* ── MCP add-on ─────────────────────────────────────────────── */}
        {(node.type as string) === "mcp-addon" && (() => {
          const attachedTo = (node.data as Record<string, unknown>).attachedTo as string | null;
          const agentConfig = attachedTo ? nodeById?.(attachedTo) : undefined;
          const agentId = agentConfig?.agent_id;
          return (
            <McpAddonPanel
              servers={(config.servers as Record<string, boolean> | undefined) ?? {}}
              attachedTo={attachedTo}
              agentId={agentId ?? null}
              readonly={readonly ?? false}
              onServersChange={(servers) => {
                onChange(node.id, { servers });
                if (agentId) {
                  // Merge with existing addons — never replace the whole list.
                  getAgent(agentId).then((agentDef) => {
                    const existing = (agentDef?.addons ?? []) as import("@/lib/api").AgentAddonEntry[];
                    const merged: import("@/lib/api").AgentAddonEntry[] = [
                      ...existing.filter((a) => a.type !== "mcp"),
                      { type: "mcp", servers },
                    ];
                    updateAgentAddons(agentId, merged).catch(() => {/* ignore */});
                  }).catch(() => {/* ignore */});
                }
              }}
            />
          );
        })()}

        {/* ── Tools add-on ───────────────────────────────────────────── */}
        {(node.type as string) === "tools-addon" && (() => {
          const attachedTo = (node.data as Record<string, unknown>).attachedTo as string | null;
          const agentConfig = attachedTo ? nodeById?.(attachedTo) : undefined;
          const agentId = agentConfig?.agent_id;
          return (
            <ToolsAddonPanel
              tools={(config.tools as Record<string, boolean> | undefined) ?? {}}
              attachedTo={attachedTo}
              agentId={agentId ?? null}
              readonly={readonly ?? false}
              onToolsChange={(tools) => {
                onChange(node.id, { tools });
              }}
            />
          );
        })()}

        {/* ── S3 add-on ──────────────────────────────────────────────── */}
        {(node.type as string) === "s3-addon" && (() => {
          const attachedTo = (node.data as Record<string, unknown>).attachedTo as string | null;
          const agentConfig = attachedTo ? nodeById?.(attachedTo) : undefined;
          const agentId = agentConfig?.agent_id;
          return (
            <S3AddonPanel
              s3Bucket={(config.s3_bucket as string | undefined) ?? ""}
              s3Path={(config.s3_path as string | undefined) ?? ""}
              attachedTo={attachedTo}
              agentId={agentId ?? null}
              readonly={readonly ?? false}
              onChange={(bucket, path) => {
                onChange(node.id, { s3_bucket: bucket, s3_path: path });
              }}
            />
          );
        })()}

        {/* ── Datasource add-on ──────────────────────────────────────── */}
        {(node.type as string) === "datasource-addon" && (() => {
          const attachedTo = (node.data as Record<string, unknown>).attachedTo as string | null;
          const agentConfig = attachedTo ? nodeById?.(attachedTo) : undefined;
          const agentId = agentConfig?.agent_id;
          return (
            <DatasourceAddonPanel
              sourceId={(config.datasource_id as string | undefined) ?? ""}
              allowedOperations={(config.allowed_operations as string[] | undefined) ?? []}
              attachedTo={attachedTo}
              agentId={agentId ?? null}
              readonly={readonly ?? false}
              onChange={(sourceId, allowedOperations) => {
                onChange(node.id, {
                  datasource_id: sourceId,
                  allowed_operations: allowedOperations,
                });
              }}
            />
          );
        })()}

        {/* ── Loop guard ─────────────────────────────────────────────── */}
        <PropField label="Max loops" hint="Max times node may execute (default: 10)">
          <input
            type="number"
            min={1}
            placeholder="10"
            value={config.max_loops ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              onChange(node.id, { max_loops: val === "" ? undefined : Number(val) });
            }}
            disabled={readonly}
            className={clsx(
              "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500",
              readonly && "opacity-60 cursor-not-allowed",
            )}
          />
        </PropField>

        {/* ── Meta-LLM evaluation criteria ───────────────────────────── */}
        <PropField label="Success Criteria">
          <textarea value={config.success_criteria ?? ""} rows={2}
            onChange={(e) => onChange(node.id, { success_criteria: e.target.value || undefined })}
            placeholder="Describe what a successful output looks like..."
            className={`${inputCls} resize-y`} />
        </PropField>
        <PropField label="Fail Criteria">
          <textarea value={config.fail_criteria ?? ""} rows={2}
            onChange={(e) => onChange(node.id, { fail_criteria: e.target.value || undefined })}
            placeholder="Describe what a failed output looks like..."
            className={`${inputCls} resize-y`} />
        </PropField>
      </div>

      {/* Delete */}
      {!readonly && (
        <div className="p-4 border-t border-slate-800 shrink-0">
          <button onClick={() => onDelete(node.id)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-950/60 hover:bg-red-900/50 border border-red-900/50 text-red-400 hover:text-red-300 text-xs font-medium transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
            Delete Node
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared input style ────────────────────────────────────────────────────────
const inputCls =
  "w-full px-2.5 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 transition-colors";

function PropField({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-baseline gap-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</label>
          {hint && <span className="text-[9px] text-slate-600 normal-case">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Key-value pair editor (for tool_input / interrupt_payload) ────────────────
function KVEditor({
  label, hint, value, onChange,
}: {
  label: string; hint?: string; value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(value);

  const setEntry = (idx: number, k: string, v: string) => {
    const next = [...entries];
    next[idx] = [k, v];
    onChange(Object.fromEntries(next));
  };
  const removeEntry = (idx: number) => {
    const next = entries.filter((_, i) => i !== idx);
    onChange(Object.fromEntries(next));
  };
  const addEntry = () => onChange({ ...value, "": "" });

  return (
    <PropField label={label} hint={hint}>
      <div className="space-y-1.5">
        {entries.map(([k, v], i) => (
          <div key={i} className="flex gap-1 items-center">
            <input value={k}
              onChange={(e) => setEntry(i, e.target.value, v)}
              placeholder="key"
              className="w-[45%] px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300 font-mono placeholder-slate-600 focus:outline-none focus:border-slate-500" />
            <input value={v}
              onChange={(e) => setEntry(i, k, e.target.value)}
              placeholder="value or {key}"
              className="flex-1 px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300 font-mono placeholder-slate-600 focus:outline-none focus:border-slate-500" />
            <button onClick={() => removeEntry(i)}
              className="shrink-0 text-slate-600 hover:text-red-400 transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button onClick={addEntry}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
          <Plus className="w-3 h-3" /> Add entry
        </button>
      </div>
    </PropField>
  );
}

// ── Structured output field editor (for llm_structured) ───────────────────────
function StructuredOutputEditor({
  fields, onChange,
}: {
  fields: StructuredOutputField[];
  onChange: (fields: StructuredOutputField[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const update = (idx: number, patch: Partial<StructuredOutputField>) => {
    const next = fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onChange(next);
  };
  const remove = (idx: number) => onChange(fields.filter((_, i) => i !== idx));
  const add = () => onChange([...fields, { name: "", type: "str", description: "" }]);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-full"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Output Fields
        <span className="ml-auto text-slate-600 normal-case font-normal">{fields.length} field{fields.length !== 1 ? "s" : ""}</span>
      </button>
      {expanded && (
        <div className="space-y-2 pl-1">
          {fields.map((f, i) => (
            <div key={i} className="bg-slate-800/60 rounded-md p-2 space-y-1.5 border border-slate-700/50">
              <div className="flex gap-1 items-center">
                <input value={f.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="name"
                  className="flex-1 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-white font-mono placeholder-slate-600 focus:outline-none focus:border-slate-500" />
                <select value={f.type}
                  onChange={(e) => update(i, { type: e.target.value as StructuredOutputField["type"] })}
                  className="px-1.5 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-slate-300 focus:outline-none focus:border-slate-500">
                  {["str", "bool", "int", "float"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button onClick={() => remove(i)} className="text-slate-600 hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <input value={f.description ?? ""}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="Description…"
                className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-slate-400 placeholder-slate-600 focus:outline-none focus:border-slate-500" />
            </div>
          ))}
          <button onClick={add}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
            <Plus className="w-3 h-3" /> Add field
          </button>
        </div>
      )}
    </div>
  );
}

// ── Approval notification editor ──────────────────────────────────────────────
/** Raw JSON textarea for the notify payload — keyed by nodeId so it
 *  re-initialises when the user switches to a different Approval node. */
function NotifyPayloadEditor({
  initialValue, onChange,
}: {
  initialValue?: Record<string, unknown>;
  onChange: (v: Record<string, unknown> | undefined) => void;
}) {
  const [raw, setRaw] = useState(() =>
    initialValue && Object.keys(initialValue).length
      ? JSON.stringify(initialValue, null, 2)
      : "",
  );
  const [err, setErr] = useState<string | null>(null);

  const handle = (text: string) => {
    setRaw(text);
    if (!text.trim()) { setErr(null); onChange(undefined); return; }
    try   { setErr(null); onChange(JSON.parse(text)); }
    catch { setErr("Invalid JSON"); }
  };

  return (
    <PropField label="Payload (JSON body)" hint="{approve_url} {reject_url} + state keys">
      <textarea
        value={raw}
        onChange={(e) => handle(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={'{\n  "text": "Approval needed for {run_id}",\n  "blocks": [...]\n}'}
        className={`${inputCls} resize-y font-mono text-[11px] leading-relaxed`}
      />
      {err && <p className="text-[10px] text-red-400 mt-0.5">{err}</p>}
    </PropField>
  );
}

function NotifyEditor({
  value, onChange, nodeId,
}: {
  value?: NotifyConfig;
  onChange: (v: NotifyConfig | undefined) => void;
  nodeId: string;
}) {
  const [expanded, setExpanded] = useState(!!value?.url);
  const n = value ?? {};

  const update = (patch: Partial<NotifyConfig>) => onChange({ ...n, ...patch });

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-full"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Notification webhook
        {n.url
          ? <span className="ml-auto text-teal-400 normal-case font-normal">configured</span>
          : <span className="ml-auto text-slate-600 normal-case font-normal">optional</span>
        }
      </button>
      {expanded && (
        <div className="space-y-2 pl-1">
          <div className="rounded-md bg-slate-800/60 border border-slate-700/50 px-3 py-2 text-[10px] text-slate-400 leading-relaxed">
            Fired when approval is needed. Template vars in all string fields:
            {" "}<span className="font-mono text-slate-300">{"{run_id}"}</span>
            {" "}<span className="font-mono text-slate-300">{"{approve_url}"}</span>
            {" "}<span className="font-mono text-slate-300">{"{reject_url}"}</span>
            {" "}+ any state key
          </div>

          <PropField label="URL">
            <input type="text" value={n.url ?? ""}
              onChange={(e) => update({ url: e.target.value || undefined })}
              placeholder="https://hooks.slack.com/..."
              className={`${inputCls} font-mono`} />
          </PropField>

          <PropField label="Method">
            <select value={n.method ?? "POST"}
              onChange={(e) => update({ method: e.target.value })}
              className={inputCls}>
              {["POST", "GET", "PUT", "PATCH"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </PropField>

          <PropField label="Auth type">
            <select
              value={n.auth?.type ?? "none"}
              onChange={(e) => {
                const t = e.target.value;
                update({ auth: t === "none" ? undefined : { ...n.auth, type: t as "bearer" | "basic" } });
              }}
              className={inputCls}>
              {["none", "bearer", "basic"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </PropField>

          {n.auth?.type === "bearer" && (
            <PropField label="Token" hint="supports {key} template">
              <input type="text" value={n.auth.token ?? ""}
                onChange={(e) => update({ auth: { ...n.auth, token: e.target.value } })}
                placeholder="{slack_token}"
                className={`${inputCls} font-mono`} />
            </PropField>
          )}

          {n.auth?.type === "basic" && (
            <>
              <PropField label="Username">
                <input type="text" value={n.auth.username ?? ""}
                  onChange={(e) => update({ auth: { ...n.auth, username: e.target.value } })}
                  className={`${inputCls} font-mono`} />
              </PropField>
              <PropField label="Password">
                <input type="password" value={n.auth.password ?? ""}
                  onChange={(e) => update({ auth: { ...n.auth, password: e.target.value } })}
                  className={`${inputCls} font-mono`} />
              </PropField>
            </>
          )}

          <KVEditor
            label="Headers"
            hint="Values support {key} templates"
            value={n.headers ?? {}}
            onChange={(v) => update({ headers: Object.keys(v).length ? v : undefined })}
          />

          <NotifyPayloadEditor
            key={nodeId}
            initialValue={n.payload}
            onChange={(v) => update({ payload: v })}
          />
        </div>
      )}
    </div>
  );
}

// ─── Agent modal ──────────────────────────────────────────────────────────────

interface AgentModalProps {
  agent: AgentDefinition | null;
  /** Handed the stored agent, so a centre-pane host can adopt a fresh id. */
  onSave: (saved: AgentDefinition) => void;
  onClose: () => void;
  surface?: EditorSurface;
}

export function AgentModal({ agent, onSave, onClose, surface = "modal" }: AgentModalProps) {
  const isEdit = agent !== null;
  const access = useVisibilityDraft(agent, !isEdit);
  const readOnly = isEdit && !canEdit(agent);
  const [id, setId]                         = useState(agent?.id ?? "");
  const [name, setName]                     = useState(agent?.name ?? "");
  const [description, setDescription]       = useState(agent?.description ?? "");
  const [agentInput, setAgentInput]         = useState<string>(() => {
    const v = agent?.agent_input?.system_prompt;
    return typeof v === "string" ? v : "";
  });
  const [agentModel, setAgentModel]         = useState<string>(() => {
    const v = agent?.agent_input?.model;
    return typeof v === "string" ? v : "";
  });
  const [agentProvider, setAgentProvider]   = useState<string>(() => {
    const v = agent?.agent_input?.llm_provider;
    return typeof v === "string" ? v : "";
  });
  const [agentExtra, setAgentExtra]         = useState<string>(() => {
    const v = agent?.agent_input?.extra;
    return v && typeof v === "object" && Object.keys(v).length > 0
      ? JSON.stringify(v, null, 2)
      : "";
  });
  const { providers, defaultProvider } = useLlmProviders();
  const [defaultRuntime, setDefaultRuntime] = useState<"local" | "docker" | "k8s">(agent?.default_runtime ?? "local");
  const [image, setImage]                   = useState(agent?.image ?? "");
  const [healthTimeout, setHealthTimeout]   = useState<number | "">(agent?.health_timeout ?? "");
  const [protocol, setProtocol]             = useState<"http-poll" | "acp">(agent?.protocol ?? "http-poll");
  const [acpAgent, setAcpAgent]             = useState(agent?.acp_agent ?? "");
  const [helmChart, setHelmChart]           = useState(agent?.helm_chart ?? "");
  const [helmValuesText, setHelmValuesText] = useState(
    agent?.helm_values
      ? Object.entries(agent.helm_values)
          .filter(([, v]) => v !== null && typeof v !== "object")
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (access.missingTeam) {
      setError("Choose the team this belongs to.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const helmValuesParsed: Record<string, string> = {};
      for (const line of helmValuesText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        helmValuesParsed[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
      }

      const agentInputDict: Record<string, unknown> = {};
      if (agentInput.trim()) agentInputDict.system_prompt = agentInput.trim();
      if (agentProvider.trim()) agentInputDict.llm_provider = agentProvider.trim();
      if (agentModel.trim()) agentInputDict.model = agentModel.trim();
      if (agentExtra.trim()) {
        try { agentInputDict.extra = JSON.parse(agentExtra.trim()); } catch { /* ignore invalid JSON */ }
      }

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        default_runtime: defaultRuntime,
        agent_input: agentInputDict,
        image: image.trim() || null,
        health_timeout: defaultRuntime === "docker" && healthTimeout !== "" ? Number(healthTimeout) : undefined,
        helm_chart: defaultRuntime === "k8s" ? (helmChart.trim() || null) : null,
        helm_values: defaultRuntime === "k8s" ? helmValuesParsed : {},
        protocol,
        acp_agent: protocol === "acp" ? (acpAgent.trim() || null) : null,
        ...access.payload,
      };
      onSave(isEdit
        ? await updateAgent(agent.id, payload)
        : await createAgent({ id: id.trim(), ...payload }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResourceEditorFrame
      surface={surface}
      title={isEdit ? "Edit Agent" : "Create Agent"}
      subtitle={isEdit ? agent.id : null}
      icon={<Bot className="w-5 h-5 text-fuchsia-400 shrink-0" />}
      onSubmit={handleSubmit}
      onClose={onClose}
      initialWidth={512}
      minWidth={380}
      readOnly={readOnly}
    >
      <AccessSection resource={agent} isNew={!isEdit} draft={access} kind="agent" />
      {!isEdit && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">ID <span className="text-red-400">*</span></label>
          <input
            value={id} onChange={(e) => setId(e.target.value)}
            placeholder="my-agent"
            required
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">Name</label>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="My Agent"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">
          Description <span className="text-slate-500 font-normal">(human-readable only)</span>
        </label>
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this agent do?"
          rows={2}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-sky-500"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">System prompt</label>
        <textarea
          value={agentInput} onChange={(e) => setAgentInput(e.target.value)}
          placeholder="Write the agent's system prompt here…"
          rows={5}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 font-mono resize-y focus:outline-none focus:border-sky-500"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">Provider</label>
        <select
          value={agentProvider}
          onChange={(e) => setAgentProvider(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="">— use default ({defaultProvider ?? "none configured"})</option>
          {providers.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
          {agentProvider && !providers.some((p) => p.name === agentProvider) && (
            <option value={agentProvider}>{agentProvider} (unknown)</option>
          )}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">
          Model <span className="text-slate-500 font-normal">— overrides provider default</span>
        </label>
        <input
          value={agentModel} onChange={(e) => setAgentModel(e.target.value)}
          placeholder="claude-sonnet-4-6"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-sky-500"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">
          Extra config <span className="text-slate-500 font-normal">— JSON, e.g. {"{"}"max_steps": 100{"}"}</span>
        </label>
        <CodeEditor
          value={agentExtra} onChange={setAgentExtra}
          language="json"
          placeholder={'{"max_steps": 100}'}
          minHeight={72}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">
          Protocol <span className="text-slate-500 font-normal">— how carrier talks to the agent process</span>
        </label>
        <select
          aria-label="Protocol"
          value={protocol} onChange={(e) => setProtocol(e.target.value as "http-poll" | "acp")}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="http-poll">HTTP poll (pi-cloud-agent)</option>
          <option value="acp">ACP over WebSocket (acp-web-proxy)</option>
        </select>
      </div>
      {protocol === "acp" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">
            ACP agent <span className="text-slate-500 font-normal">— name in the proxy config, e.g. pi, claude, codex; empty = proxy default</span>
          </label>
          <input
            aria-label="ACP agent"
            value={acpAgent} onChange={(e) => setAcpAgent(e.target.value)}
            placeholder="pi"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-sky-500"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">Default Runtime</label>
        <select
          value={defaultRuntime} onChange={(e) => setDefaultRuntime(e.target.value as "local" | "docker" | "k8s")}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="local">local</option>
          <option value="docker">docker</option>
          <option value="k8s">k8s</option>
        </select>
      </div>
      {defaultRuntime === "docker" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Image</label>
          <input
            value={image} onChange={(e) => setImage(e.target.value)}
            placeholder="myregistry/my-agent:latest"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      )}
      {defaultRuntime === "docker" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">
            Health timeout (s) <span className="text-slate-500 font-normal">— default 300</span>
          </label>
          <input
            type="number" min={10}
            value={healthTimeout}
            onChange={(e) => setHealthTimeout(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="300"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      )}
      {defaultRuntime === "k8s" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Helm Chart</label>
          <input
            value={helmChart} onChange={(e) => setHelmChart(e.target.value)}
            placeholder="oci://registry/chart:1.0.0"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      )}
      {defaultRuntime === "k8s" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">
            Helm Values <span className="text-slate-500 font-normal">(key=value, one per line)</span>
          </label>
          <textarea
            value={helmValuesText} onChange={(e) => setHelmValuesText(e.target.value)}
            placeholder={"replicaCount=1\nimage.tag=latest"}
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 font-mono resize-none focus:outline-none focus:border-sky-500"
          />
        </div>
      )}
      {error && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>
      )}
      {!readOnly && <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose}
          className="flex-1 py-2.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-medium transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={saving || (!isEdit && !id.trim())}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Agent"}
        </button>
      </div>}
    </ResourceEditorFrame>
  );
}

/** The agent editor hosted in the main window instead of over the canvas. */
export function AgentEditor(props: Omit<AgentModalProps, "surface">) {
  return <AgentModal {...props} surface="center" />;
}

// ─── Datasource modal ─────────────────────────────────────────────────────────

type CheckState = "idle" | "checking" | "ok" | "warn" | "fail";

function StatusDot({ state, title }: { state: CheckState; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-block w-2 h-2 rounded-full shrink-0",
        state === "idle" && "bg-slate-600",
        state === "checking" && "bg-amber-400 animate-pulse",
        state === "ok" && "bg-emerald-400",
        state === "warn" && "bg-amber-400",
        state === "fail" && "bg-red-500",
      )}
    />
  );
}

type DsAuthType = DataSourceAuth["type"];

// Read-only verbs are green, writes orange, deletes red — so the risk of an
// operation is visible in the folded list without opening it. The colours come
// from @/lib/datasourceRisk, shared with the aggregate risk badge so one colour
// means one thing everywhere.
/**
 * The second half of a destructive try run.
 *
 * The backend refuses the first call and hands back what the operation would
 * have deleted. This is where that lands: the row count large enough to read
 * without meaning to, a sample of the targets, and a confirm button that
 * spells the number out rather than saying "OK". Confirming is recorded as an
 * approval against the operator's own name.
 */
function TryRunDeleteConfirm({ plan, busy, onConfirm, onCancel }: {
  plan: TryOperationDestructivePlan;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const rows = plan.affected_rows === 1
    ? "1 row"
    : `${plan.affected_rows.toLocaleString()} rows`;
  const sample = plan.affected_sample.slice(0, 5);
  const hidden = plan.affected_rows - sample.length;

  return (
    <div className="rounded-md border border-red-800 bg-red-950/30 px-2.5 py-2 space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-red-300">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Running this deletes {rows}.
      </p>
      {sample.length > 0 && (
        <ul className="font-mono text-[10px] text-slate-300 space-y-0.5">
          {sample.map((item, i) => <li key={i} className="truncate">{item}</li>)}
          {hidden > 0 && (
            <li className="text-slate-500">…and {hidden.toLocaleString()} more</li>
          )}
        </ul>
      )}
      <p className="text-[10px] text-slate-500">
        This is a real call against the live API. Your confirmation is recorded
        in the approvals log.
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="px-2 py-1 rounded-md bg-red-800 hover:bg-red-700 text-white text-[11px] font-semibold disabled:opacity-50 transition-colors"
        >
          {busy ? "Deleting…" : `Delete ${rows}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}


function MethodBadge({ method, className }: { method?: string | null; className?: string }) {
  const label = (method ?? "").trim().toUpperCase();
  return (
    <span
      title={label ? `HTTP method: ${label}` : "No HTTP method"}
      className={clsx(
        RISK_BADGE_BASE_CLS,
        // Unknown or missing (e.g. a GraphQL op carrying only a query) stays neutral.
        RISK_LEVEL_CLS[methodLevel(label)],
        className,
      )}
    >
      {label || "—"}
    </span>
  );
}

interface OpDraft {
  name: string;
  method: string;
  /**
   * Whether this operation needs an approval before it runs — `null` leaves
   * that to the HTTP verb, which is the right default for almost every
   * operation and the reason this is tri-state rather than a checkbox.
   */
  destructive: boolean | null;
  path: string;
  query: string;
  variablesText: string;
  params: DataSourceParamSpec[];
  responseSchemaText: string;
  mapping: string;
}

function opToDraft(op: DataSourceOperation): OpDraft {
  return {
    name: op.name,
    method: op.method || "GET",
    destructive: op.destructive ?? null,
    path: op.path ?? "",
    query: op.query ?? "",
    variablesText: op.variables ? JSON.stringify(op.variables, null, 2) : "",
    params: op.params ?? [],
    responseSchemaText: op.response_schema ? JSON.stringify(op.response_schema, null, 2) : "",
    mapping: op.mapping ?? "",
  };
}

function draftToOp(d: OpDraft, kind: "http" | "graphql"): DataSourceOperation {
  let responseSchema: Record<string, unknown> | null = null;
  if (d.responseSchemaText.trim()) {
    try {
      responseSchema = JSON.parse(d.responseSchemaText);
    } catch {
      throw new Error(`Operation "${d.name}": API output is not valid JSON`);
    }
  }
  let variables: Record<string, unknown> | null = null;
  if (kind === "graphql" && d.variablesText.trim()) {
    try {
      variables = JSON.parse(d.variablesText);
    } catch {
      throw new Error(`Operation "${d.name}": variables is not valid JSON`);
    }
  }
  return {
    name: d.name.trim(),
    method: d.method,
    destructive: d.destructive,
    path: kind === "http" ? d.path.trim() || null : null,
    query: kind === "graphql" ? d.query.trim() || null : null,
    variables,
    params: d.params.filter((p) => p.name.trim()),
    response_schema: responseSchema,
    mapping: d.mapping.trim() || null,
  };
}

/**
 * "Google Sheets" is a preset, not a fourth `kind`: the backend stores it as an
 * ordinary `http` source whose auth type is `google`. So the Kind dropdown
 * offers it, and `authType === "google"` is what the editor keys off.
 */
type DsEditorKind = DataSourceKind | "google_sheets";

const GOOGLE_SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

/**
 * The attached spreadsheet and default tab of a stored Google Sheets source.
 *
 * They live as `default` values on the `spreadsheet_id` and `range` params
 * rather than in a field of their own, because that is the form in which they
 * are actually *useful*: an agent calling `get_values` then does not have to
 * be told the file id, and a bare tab name ("Sheet1") is already a valid A1
 * range meaning the whole tab.
 */
function googleDefaults(ops: OpDraft[]): { spreadsheetId: string; tab: string } {
  const find = (param: string) => {
    for (const op of ops) {
      const spec = op.params.find((p) => p.name === param);
      if (spec && typeof spec.default === "string" && spec.default) return spec.default;
    }
    return "";
  };
  return { spreadsheetId: find("spreadsheet_id"), tab: find("range") };
}

/** Write the attached spreadsheet / tab back onto the operations that take them. */
function withGoogleDefaults(
  ops: DataSourceOperation[], spreadsheetId: string, tab: string,
): DataSourceOperation[] {
  const defaults: Record<string, string> = {};
  if (spreadsheetId) defaults.spreadsheet_id = spreadsheetId;
  if (tab) defaults.range = tab;
  if (Object.keys(defaults).length === 0) return ops;
  return ops.map((op) => ({
    ...op,
    params: (op.params ?? []).map((p) =>
      p.name in defaults ? { ...p, default: defaults[p.name] } : p
    ),
  }));
}

function emptyOpDraft(kind: "http" | "graphql"): OpDraft {
  return {
    name: "",
    method: kind === "graphql" ? "POST" : "GET",
    destructive: null,
    path: "",
    query: "",
    variablesText: "",
    params: [],
    responseSchemaText: "",
    mapping: "",
  };
}

function SecretInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(dsFieldMonoCls, "pr-9")}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Hide value" : "Show value"}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors"
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

interface DatasourceModalProps {
  datasource: DataSourceDefinition | null;
  /** Handed the stored source, so a centre-pane host can adopt a fresh id. */
  onSave: (saved: DataSourceDefinition) => void;
  onClose: () => void;
  surface?: EditorSurface;
}

export function DatasourceModal({ datasource, onSave, onClose, surface = "modal" }: DatasourceModalProps) {
  const isEdit = datasource !== null;
  const access = useVisibilityDraft(datasource, !isEdit);
  const readOnly = isEdit && !canEdit(datasource);
  const [id, setId]                   = useState(datasource?.id ?? "");
  const [name, setName]               = useState(datasource?.name ?? "");
  const [description, setDescription] = useState(datasource?.description ?? "");
  const [kind, setKind]               = useState<DataSourceKind>(datasource?.kind ?? "http");
  const [baseUrl, setBaseUrl]         = useState(datasource?.base_url ?? "");

  const opKind: "http" | "graphql" = kind === "graphql" ? "graphql" : "http";

  const initialAuth = datasource?.auth ?? null;
  const initialAuthType: DsAuthType = initialAuth?.type ?? "none";
  const [authType, setAuthType]       = useState<DsAuthType>(initialAuthType);
  // Secret values. The backend stores them and returns "********" when
  // reading, so in edit mode these start empty and empty = keep the stored
  // secret (the redaction placeholder is sent back to preserve it).
  const [token, setToken]             = useState("");
  const [username, setUsername]       = useState(initialAuth?.type === "basic" ? initialAuth.username : "");
  const [password, setPassword]       = useState("");
  const [headerName, setHeaderName]   = useState(initialAuth?.type === "header" ? initialAuth.header_name : "");
  const [headerValue, setHeaderValue] = useState("");

  // Bearer tokens may come from a backend config key instead of being pasted:
  // the UI only ever sees the key name, the backend resolves it to the value on
  // save. Stored definitions never say which key was used, so edit mode starts
  // on "keep" and switching to "config" is an explicit re-selection.
  const [tokenSource, setTokenSource] = useState<"config" | "manual">(isEdit ? "manual" : "config");
  const [tokenConfigKey, setTokenConfigKey] = useState("");
  const [configKeys, setConfigKeys] = useState<string[]>([]);
  const [configKeysLoaded, setConfigKeysLoaded] = useState(false);
  useEffect(() => {
    listConfigKeys()
      .then((keys) => { setConfigKeys(keys); setConfigKeysLoaded(true); })
      .catch(() => { setConfigKeys([]); setConfigKeysLoaded(true); });
  }, []);
  // Nothing to pick from → paste mode is the only usable option.
  useEffect(() => {
    if (configKeysLoaded && configKeys.length === 0) setTokenSource("manual");
  }, [configKeysLoaded, configKeys.length]);

  // Outbound identities the backend can mint tokens for. A deployment may have
  // several (one per service it calls), so which one to use is a choice.
  const [identities, setIdentities] = useState<ServiceIdentitiesResponse | null>(null);
  const [identitiesLoaded, setIdentitiesLoaded] = useState(false);
  const [serviceIdentityName, setServiceIdentityName] = useState(
    initialAuth?.type === "service_identity" ? initialAuth.identity ?? "" : ""
  );
  useEffect(() => {
    listServiceIdentities()
      .then((r) => { setIdentities(r); setIdentitiesLoaded(true); })
      .catch(() => { setIdentities(null); setIdentitiesLoaded(true); });
  }, []);

  const usableIdentities = (identities?.identities ?? []).filter((i) => i.configured);
  /** Whether picking `service_identity` at all can work on this backend. */
  const serviceIdentityAvailable = usableIdentities.length > 0;
  /** The identity a save would actually use — explicit pick, else the backend default. */
  const effectiveIdentityName =
    serviceIdentityName || identities?.default_identity || (usableIdentities.length === 1 ? usableIdentities[0].name : "");
  const effectiveIdentity = usableIdentities.find((i) => i.name === effectiveIdentityName) ?? null;
  // Several identities and no backend default: leaving it unset would make the
  // backend refuse the call rather than guess, so the pick is required here.
  const identityChoiceRequired =
    authType === "service_identity" && serviceIdentityAvailable && !effectiveIdentity;

  /** True when the bearer token is taken from a backend config key. */
  const usesConfigToken = authType === "bearer" && tokenSource === "config" && !!tokenConfigKey;

  /**
   * The auth block to send, or null for "no credentials to send".
   *
   * `mode: "save"` keeps stored secrets alive: in edit mode an untouched secret
   * field is sent as the redaction placeholder, which the backend resolves back
   * to the stored value. `mode: "probe"` never invents a secret — a field the
   * user has not filled in yields null, so the probe runs unauthenticated and
   * reports "not verified" instead of a false rejection.
   */
  function buildAuth(mode: "save" | "probe"): DataSourceAuthWrite | null {
    const keep = (v: string) =>
      v || (mode === "save" && isEdit && authType === initialAuthType ? DATASOURCE_SECRET_REDACTED : "");
    if (authType === "bearer") {
      if (usesConfigToken) return { type: "bearer", from_config: tokenConfigKey };
      const t = keep(token.trim());
      return t ? { type: "bearer", token: t } : null;
    }
    if (authType === "basic") {
      const p = keep(password);
      return username.trim() && p ? { type: "basic", username: username.trim(), password: p } : null;
    }
    if (authType === "header") {
      const v = keep(headerValue.trim());
      return headerName.trim() && v ? { type: "header", header_name: headerName.trim(), value: v } : null;
    }
    // No secret to collect — the backend mints the token per request. Send the
    // name only when one is picked, so the backend's default keeps applying.
    if (authType === "service_identity") {
      return serviceIdentityName
        ? { type: "service_identity", identity: serviceIdentityName }
        : { type: "service_identity" };
    }
    // Likewise for Google: no secret, and `impersonate_subject` is left out on
    // purpose — the backend resolves it from GOOGLE_IMPERSONATE_SA and refuses
    // a block that names anything else.
    if (authType === "google") {
      return { type: "google", scopes: GOOGLE_SHEETS_SCOPES };
    }
    return mode === "save" ? { type: "none" } : null;
  }

  const [urlStatus, setUrlStatus]   = useState<CheckState>("idle");
  const [urlHint, setUrlHint]       = useState("");
  const [authStatus, setAuthStatus] = useState<CheckState>("idle");
  const [authHint, setAuthHint]     = useState("");

  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered]   = useState<DiscoveredSchema | null>(null);

  const [ops, setOps]       = useState<OpDraft[]>((datasource?.operations ?? []).map(opToDraft));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // ── Google Sheets preset ─────────────────────────────────────────────────
  // `google` auth carries no secret and no choice to make, so selecting it is
  // the whole configuration; what still has to be attached is a spreadsheet,
  // which the panel below does.
  const isGoogleSheets = authType === "google";
  const [googleTemplate, setGoogleTemplate] = useState<GoogleSheetsTemplate | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const initialGoogle = useMemo(
    () => googleDefaults((datasource?.operations ?? []).map(opToDraft)),
    [datasource],
  );
  const [spreadsheetId, setSpreadsheetId] = useState(initialGoogle.spreadsheetId);
  const [sheetTab, setSheetTab]           = useState(initialGoogle.tab);

  /** Fetch the backend's Sheets template, once, and adopt what is still blank. */
  const loadGoogleTemplate = useCallback(async (fillOperations: boolean) => {
    setGoogleError(null);
    try {
      const template = await getGoogleSheetsTemplate();
      setGoogleTemplate(template);
      if (!template.service_account) {
        setGoogleError(
          "This backend has no Google service account configured (GOOGLE_IMPERSONATE_SA), "
          + "so a Google Sheets source cannot reach anything yet."
        );
      }
      // The operation templates are the backend's, never retyped here — but an
      // existing source's own operations are never overwritten.
      if (fillOperations) {
        setBaseUrl((prev) => prev.trim() || template.base_url);
        setName((prev) => prev.trim() || template.name);
        setDescription((prev) => prev.trim() || template.description);
        setOps((prev) => (prev.length === 0 ? template.operations.map(opToDraft) : prev));
      }
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : "Could not read the Google Sheets template");
    }
  }, []);

  // Edit mode: load the template for its `service_account` (the address the
  // panel tells the user to share with) without touching the stored operations.
  useEffect(() => {
    if (isGoogleSheets && googleTemplate === null) loadGoogleTemplate(false);
  }, [isGoogleSheets, googleTemplate, loadGoogleTemplate]);

  // ── specification import ─────────────────────────────────────────────────
  // Nothing about the base URL implies where the schema lives, so the schema
  // location is stated: a URL to fetch through the backend, or an uploaded
  // file. The result is a pick-list — only checked operations reach the draft.
  const [schemaUrl, setSchemaUrl]         = useState("");
  const [schemaBusy, setSchemaBusy]       = useState<"url" | "file" | null>(null);
  const [schemaError, setSchemaError]     = useState<string | null>(null);
  const [imported, setImported]           = useState<SchemaImportResult | null>(null);
  const [picked, setPicked]               = useState<Set<string>>(new Set());
  const [opFilter, setOpFilter]           = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function receiveImport(result: SchemaImportResult) {
    setImported(result);
    setOpFilter("");
    // Pre-check nothing: a 300-endpoint API would otherwise arrive wholesale.
    setPicked(new Set());
    setSchemaError(
      result.operations.length === 0
        ? "The specification parsed, but declares no operations"
        : null,
    );
    // A declared base URL is better than a hand-typed one, but never overwrite
    // what the user already put there.
    if (result.base_url && !baseUrl.trim()) setBaseUrl(result.base_url);
    if (result.kind === "graphql" && kind !== "graphql") setKind("graphql");
  }

  async function handleFetchSchema() {
    const url = schemaUrl.trim();
    if (!url) return;
    setSchemaBusy("url");
    setSchemaError(null);
    try {
      receiveImport(
        await fetchDatasourceSchema({ schema_url: url, kind: opKind, auth: buildAuth("probe") }),
      );
    } catch (err) {
      setImported(null);
      setSchemaError(err instanceof Error ? err.message : "Could not read the schema");
    } finally {
      setSchemaBusy(null);
    }
  }

  async function handleUploadSchema(file: File) {
    setSchemaBusy("file");
    setSchemaError(null);
    try {
      receiveImport(await uploadDatasourceSchema(file, opKind));
    } catch (err) {
      setImported(null);
      setSchemaError(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setSchemaBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** Operations already in the draft — shown as added rather than offered again. */
  const draftOpNames = useMemo(
    () => new Set(ops.map((o) => o.name.trim()).filter(Boolean)),
    [ops],
  );

  const visibleImported = useMemo(() => {
    const all = imported?.operations ?? [];
    const needle = opFilter.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((op) =>
      [op.name, op.method, op.path ?? "", op.query ?? "", op.summary ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [imported, opFilter]);

  const togglePicked = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  function addPickedOperations() {
    const chosen = (imported?.operations ?? []).filter(
      (op) => picked.has(op.name) && !draftOpNames.has(op.name),
    );
    if (chosen.length === 0) return;
    setOps((prev) => [...prev, ...chosen.map(opToDraft)]);
    setPicked(new Set());
  }

  // ── live connectivity check + schema discovery ───────────────────────────
  const checkSeq = useRef(0);

  useEffect(() => {
    const url = baseUrl.trim();
    // A `google` source is not probed: googleapis.com answers 404 to a bare
    // GET on its root, and minting an impersonated token to learn that is
    // pointless — whether it *works* is per-document, which is what the
    // spreadsheet panel's Verify actually checks.
    if (authType === "google" || !/^https?:\/\//.test(url)) {
      setUrlStatus("idle"); setUrlHint("");
      setAuthStatus("idle"); setAuthHint("");
      setDiscovered(null); setDiscovering(false);
      return;
    }
    const seq = ++checkSeq.current;
    const timer = setTimeout(async () => {
      // Auth block for the probe — only when the secret is actually available
      // (pasted, or named via a config key); otherwise probe unauthenticated
      // and the auth check is skipped.
      const probeAuth = buildAuth("probe");

      setUrlStatus("checking"); setUrlHint("");
      setAuthStatus(authType === "none" ? "idle" : "checking"); setAuthHint("");
      // The probe only introspects GraphQL endpoints: for those the base URL is
      // itself the schema endpoint. REST schemas are imported explicitly.
      setDiscovered(null); setDiscovering(kind === "graphql");

      let result;
      try {
        result = await probeDatasource({ base_url: url, kind: opKind, auth: probeAuth });
      } catch {
        if (checkSeq.current !== seq) return;
        setDiscovering(false);
        setUrlStatus("fail"); setUrlHint("Probe failed — backend unavailable");
        setAuthStatus("idle"); setAuthHint("");
        return;
      }
      if (checkSeq.current !== seq) return;
      setDiscovering(false);

      if (result.url_status === "unreachable") {
        setUrlStatus("fail"); setUrlHint(result.error || "Server not reachable");
        setAuthStatus("idle"); setAuthHint("");
        return;
      }

      setUrlStatus("ok");
      setUrlHint(result.url_status === "unauthorized" ? "Server reachable (requires authentication)" : "Server reachable");

      if (result.url_status === "unauthorized") {
        setAuthStatus("fail");
        setAuthHint(
          result.error ||
            (authType === "none"
              ? "Server requires authentication"
              : probeAuth
                ? "Credentials rejected (401/403)"
                : "Authentication required — provide the secret to verify")
        );
        return;
      }

      if (result.auth_status === "ok") {
        setAuthStatus("ok"); setAuthHint("Authentication accepted");
      } else if (result.auth_status === "failed") {
        setAuthStatus("fail"); setAuthHint(result.error || "Authentication failed");
      } else {
        // skipped — no auth configured or secrets not (re-)entered.
        setAuthStatus("idle");
        setAuthHint(authType !== "none" && !probeAuth ? "Not verified — provide the secret to check" : "");
      }

      if (result.discovered) {
        const found = result.discovered;
        setDiscovered(found);
        // Auto-fill only when the user hasn't authored any operations yet.
        setOps((prev) => (prev.length === 0 ? found.operations.map(opToDraft) : prev));
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [baseUrl, kind, authType, headerName, token, username, password, headerValue, tokenSource, tokenConfigKey, serviceIdentityName]);

  // ── operations helpers ────────────────────────────────────────────────────
  const setOp = (idx: number, patch: Partial<OpDraft>) =>
    setOps((prev) => prev.map((op, i) => (i === idx ? { ...op, ...patch } : op)));

  // Operations are folded by default — a source with 30 discovered operations
  // is unreadable otherwise. Only the ones explicitly opened (or just added by
  // hand) are expanded; indices shift with the list on removal.
  // Read-only has no way to unfold an operation (the toggles are disabled with
  // the rest of the form), so it opens with every operation shown.
  const [openOps, setOpenOps] = useState<Set<number>>(
    () => new Set(readOnly ? (datasource?.operations ?? []).map((_, i) => i) : []),
  );
  const toggleOp = (idx: number) =>
    setOpenOps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  const addOp = () => {
    const idx = ops.length;
    setOps((prev) => [...prev, emptyOpDraft(opKind)]);
    setOpenOps((prev) => new Set(prev).add(idx));
  };
  const removeOp = (idx: number) => {
    setOps((prev) => prev.filter((_, i) => i !== idx));
    setOpenOps((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  };
  const setOpParam = (opIdx: number, paramIdx: number, patch: Partial<DataSourceParamSpec>) =>
    setOps((prev) =>
      prev.map((op, i) =>
        i === opIdx
          ? { ...op, params: op.params.map((p, j) => (j === paramIdx ? { ...p, ...patch } : p)) }
          : op
      )
    );

  // ── try-run one operation: fill API output + suggested mapping ────────────
  const [tryingOp, setTryingOp] = useState<number | null>(null);
  const [tryHints, setTryHints] = useState<Record<number, { ok: boolean; msg: string }>>({});
  // A destructive try run comes back refused the first time, carrying the row
  // count it would have deleted. Holding that here is what turns the button
  // into a two-step: the backend previews, the operator reads the number, and
  // only the second call actually deletes anything.
  const [tryConfirm, setTryConfirm] = useState<
    Record<number, TryOperationDestructivePlan | undefined>
  >({});
  // Lets the try-run guard put the cursor in the field it is complaining about.
  const nameInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  async function handleTryOp(i: number, confirmDestructive = false) {
    const draft = ops[i];
    const opName = draft.name.trim();
    setTryHints((prev) => ({ ...prev, [i]: undefined as never }));
    setTryConfirm((prev) => ({ ...prev, [i]: undefined }));
    if (!opName) {
      setTryHints((prev) => ({ ...prev, [i]: { ok: false, msg: "Fill in the operation name field first" } }));
      nameInputRefs.current[i]?.focus();
      return;
    }
    let operations: DataSourceOperation[];
    try {
      operations = ops.filter((o) => o.name.trim()).map((o) => draftToOp(o, opKind));
    } catch (e) {
      setTryHints((prev) => ({ ...prev, [i]: { ok: false, msg: e instanceof Error ? e.message : String(e) } }));
      return;
    }
    const auth = buildAuth("save");
    setTryingOp(i);
    try {
      const result = await tryDatasourceOperation({
        base_url: baseUrl.trim(),
        kind: opKind,
        auth,
        source_id: isEdit ? datasource!.id : null,
        operations,
        operation: opName,
        confirm_destructive: confirmDestructive,
      });
      if (result.status === "error") {
        setTryHints((prev) => ({ ...prev, [i]: { ok: false, msg: result.error || "Request failed" } }));
        return;
      }
      if (result.status === "confirmation_required" && result.destructive) {
        setTryConfirm((prev) => ({ ...prev, [i]: result.destructive }));
        return;
      }
      setOp(i, {
        responseSchemaText: JSON.stringify(result.api_output, null, 2),
        mapping: result.suggested_mapping ?? draft.mapping,
      });
      setTryHints((prev) => ({
        ...prev,
        [i]: {
          ok: true,
          msg: result.suggested_mapping
            ? "Ran OK — output sampled, mapping suggested by meta-LLM"
            : "Ran OK — output sampled (no mapping suggestion)",
        },
      }));
    } catch (e) {
      setTryHints((prev) => ({ ...prev, [i]: { ok: false, msg: e instanceof Error ? e.message : "Backend unavailable" } }));
    } finally {
      setTryingOp(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (access.missingTeam) {
      setError("Choose the team this belongs to.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Empty secret fields in edit mode mean "keep the stored secret": the
      // redaction placeholder is sent and the backend preserves the value.
      // A config key, when chosen, replaces the secret entirely.
      if (identityChoiceRequired) {
        // The backend refuses to guess between identities, so saving this would
        // store a source that fails on its first call.
        setError("Pick which service identity this source should use");
        setSaving(false);
        return;
      }
      const built = buildAuth("save");
      if (authType !== "none" && built === null) {
        // Saving {type: "none"} here would silently drop the chosen auth type.
        setError(
          authType === "bearer" && tokenSource === "config"
            ? "Pick a config key for the bearer token, or switch to pasting it"
            : `Fill in the ${authType} credentials, or set authentication to None`
        );
        setSaving(false);
        return;
      }
      const auth: DataSourceAuthWrite = built ?? { type: "none" };

      // Omit auth entirely when nothing auth-related changed in edit mode —
      // the backend preserves the stored block.
      const authUntouched =
        isEdit &&
        authType === initialAuthType &&
        !usesConfigToken &&
        !token.trim() && !password && !headerValue.trim() &&
        (authType !== "basic" || username.trim() === (initialAuth?.type === "basic" ? initialAuth.username : "")) &&
        (authType !== "header" || headerName.trim() === (initialAuth?.type === "header" ? initialAuth.header_name : ""));

      let operations = ops.filter((d) => d.name.trim()).map((d) => draftToOp(d, opKind));
      if (isGoogleSheets) {
        if (!spreadsheetId) {
          // Saving without one stores a source every call has to be told the
          // file id for, and whose access nobody has checked.
          setError("Verify a spreadsheet first — paste its URL and click Verify");
          setSaving(false);
          return;
        }
        operations = withGoogleDefaults(operations, spreadsheetId, sheetTab);
      }

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        kind,
        base_url: baseUrl.trim(),
        operations,
        ...access.payload,
      };
      onSave(isEdit
        ? await updateDatasource(datasource.id, authUntouched ? payload : { ...payload, auth })
        : await createDatasource({ id: id.trim(), ...payload, auth }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save datasource";
      // A folded operation can be the one that fails validation — unfold them
      // all so the complaint points at something the user can actually see.
      if (msg.startsWith('Operation "')) setOpenOps(new Set(ops.map((_, i) => i)));
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResourceEditorFrame
      surface={surface}
      title={isEdit ? "Edit Datasource" : "Create Datasource"}
      subtitle={isEdit ? datasource.id : null}
      icon={<Database className="w-5 h-5 text-cyan-400 shrink-0" />}
      onSubmit={handleSubmit}
      onClose={onClose}
      initialWidth={640}
      minWidth={420}
      readOnly={readOnly}
    >
      <AccessSection resource={datasource} isNew={!isEdit} draft={access} kind="datasource" />
      {!isEdit && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">ID <span className="text-red-400">*</span></label>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="my-datasource" required className={dsFieldCls} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Datasource" className={dsFieldCls} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Kind</label>
          <select
            value={isGoogleSheets ? "google_sheets" : kind}
            onChange={(e) => {
              const picked = e.target.value as DsEditorKind;
              if (picked === "google_sheets") {
                // Stored as an `http` source with `google` auth; the operations
                // and base URL come from the backend's template.
                setKind("http");
                setAuthType("google");
                loadGoogleTemplate(true);
                return;
              }
              setKind(picked);
              if (isGoogleSheets) setAuthType("none");
            }}
            className={dsFieldCls}
          >
            <option value="http">HTTP / REST</option>
            <option value="graphql">GraphQL</option>
            <option value="google_sheets">Google Sheets</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">Description</label>
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this datasource provide?" rows={2}
          className={clsx(dsFieldCls, "resize-none")}
        />
      </div>

      {/* Base URL + reachability */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
          Base URL <span className="text-red-400">*</span>
          <StatusDot state={urlStatus} title={urlHint} />
          {urlHint && (
            <span className={clsx("font-normal", urlStatus === "fail" ? "text-red-400" : "text-slate-500")}>{urlHint}</span>
          )}
        </label>
        <input
          value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com" required
          className={dsFieldCls}
        />
      </div>

      {/* Authentication */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
          Authentication
          {authType !== "none" && <StatusDot state={authStatus} title={authHint} />}
          {authType !== "none" && authHint && (
            <span className={clsx("font-normal", authStatus === "fail" ? "text-red-400" : authStatus === "warn" ? "text-amber-400" : "text-slate-500")}>
              {authHint}
            </span>
          )}
          {authType === "none" && authStatus === "fail" && (
            <span className="font-normal text-red-400">{authHint}</span>
          )}
        </label>
        <select value={authType} onChange={(e) => setAuthType(e.target.value as DsAuthType)} className={dsFieldCls}>
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic (username / password)</option>
          <option value="header">Custom header</option>
          <option value="service_identity" disabled={identitiesLoaded && !serviceIdentityAvailable}>
            Service identity (backend&apos;s own credentials)
            {identitiesLoaded && !serviceIdentityAvailable ? " — none configured" : ""}
          </option>
          <option value="google">Google (impersonated service account)</option>
        </select>

        {isGoogleSheets && (
          <div className="pt-1 space-y-1.5 text-[10px]">
            <p className="text-slate-400">
              No secret to enter — the backend impersonates its own Google service account and
              mints a fresh, narrowly scoped token per request.
            </p>
            {googleError ? (
              <p className="text-amber-400">{googleError}</p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-slate-500">
                <dt>reads as</dt>
                <dd className="text-slate-400 break-all">
                  {googleTemplate?.service_account || "loading…"}
                </dd>
                <dt>scopes</dt>
                <dd className="text-slate-400 break-all">{GOOGLE_SHEETS_SCOPES.join(", ")}</dd>
              </dl>
            )}
            <p className="text-slate-500">
              Each document is reached only if it has been shared with that address — which is
              also how access is revoked.
            </p>
          </div>
        )}

        {authType === "service_identity" && (
          <div className="pt-1 space-y-1.5 text-[10px]">
            {serviceIdentityAvailable ? (
              <>
                <p className="text-slate-400">
                  No secret to enter — the backend signs an assertion with its own key and mints a
                  fresh token per request.
                </p>
                {(usableIdentities.length > 1 || identityChoiceRequired) && (
                  <select
                    value={serviceIdentityName}
                    onChange={(e) => setServiceIdentityName(e.target.value)}
                    className={clsx(dsFieldMonoCls, !serviceIdentityName && "text-slate-500")}
                  >
                    <option value="">
                      {identities?.default_identity
                        ? `backend default (${identities.default_identity})`
                        : "select an identity…"}
                    </option>
                    {usableIdentities.map((i) => (
                      <option key={i.name} value={i.name}>{i.name}</option>
                    ))}
                  </select>
                )}
                {effectiveIdentity ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-slate-500">
                    <dt>identity</dt><dd className="text-slate-400">{effectiveIdentity.name}</dd>
                    <dt>authenticates as</dt><dd className="text-slate-400">{effectiveIdentity.client_id}</dd>
                    <dt>token endpoint</dt><dd className="text-slate-400 break-all">{effectiveIdentity.token_url}</dd>
                    <dt>scopes</dt><dd className="text-slate-400 break-all">{effectiveIdentity.scopes}</dd>
                  </dl>
                ) : (
                  <p className="text-amber-400">
                    This backend has several identities and no default — pick the one this
                    source should use.
                  </p>
                )}
                {effectiveIdentity && (
                  <p className="text-slate-500">
                    The target must accept this identity — its audience has to be among the scopes above.
                  </p>
                )}
              </>
            ) : (
              <p className="text-amber-400">
                {identities?.error
                  ?? identities?.identities.find((i) => i.error)?.error
                  ?? "Could not read the backend's service identities"}
              </p>
            )}
          </div>
        )}

        {authType === "bearer" && (
          <div className="pt-1 space-y-1.5">
            <div className="flex items-center gap-3">
              <label className="text-[10px] text-slate-500">Token</label>
              <div className="flex rounded-md overflow-hidden border border-slate-700">
                <button type="button" onClick={() => setTokenSource("config")}
                  disabled={configKeys.length === 0}
                  title={configKeys.length === 0 ? "No credentials configured on the backend" : "Use a credential already configured on the backend"}
                  className={clsx("px-2 py-0.5 text-[10px] transition-colors disabled:opacity-40",
                    tokenSource === "config" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200")}>
                  From backend config
                </button>
                <button type="button" onClick={() => setTokenSource("manual")}
                  className={clsx("px-2 py-0.5 text-[10px] transition-colors",
                    tokenSource === "manual" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200")}>
                  Paste token
                </button>
              </div>
            </div>
            {tokenSource === "config" ? (
              <>
                <select
                  value={tokenConfigKey}
                  onChange={(e) => setTokenConfigKey(e.target.value)}
                  className={clsx(dsFieldMonoCls, !tokenConfigKey && "text-slate-500")}
                >
                  <option value="">
                    {configKeysLoaded
                      ? (configKeys.length ? "select a credential…" : "no credentials configured")
                      : "loading…"}
                  </option>
                  {configKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <p className="text-[10px] text-slate-500">
                  The backend resolves the key to its value on save and stores it — the value never reaches this browser.
                </p>
              </>
            ) : (
              <SecretInput
                value={token} onChange={setToken}
                placeholder={isEdit && initialAuthType === "bearer" ? "unchanged (********)" : "paste token"}
              />
            )}
          </div>
        )}
        {authType === "basic" && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" className={dsFieldMonoCls} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">Password</label>
              <SecretInput
                value={password} onChange={setPassword}
                placeholder={isEdit && initialAuthType === "basic" ? "unchanged (********)" : "password"}
              />
            </div>
          </div>
        )}
        {authType === "header" && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">Header name</label>
              <input value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-Api-Key" className={dsFieldMonoCls} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">Value</label>
              <SecretInput
                value={headerValue} onChange={setHeaderValue}
                placeholder={isEdit && initialAuthType === "header" ? "unchanged (********)" : "secret value"}
              />
            </div>
          </div>
        )}
      </div>

      {/* Which spreadsheet, and can we reach it */}
      {isGoogleSheets && (
        <GoogleSheetsPanel
          operations={ops.filter((o) => o.name.trim()).map((o) => draftToOp(o, "http"))}
          baseUrl={baseUrl.trim()}
          sourceId={isEdit ? datasource.id : null}
          serviceAccount={googleTemplate?.service_account ?? ""}
          spreadsheetId={spreadsheetId}
          onSpreadsheetIdChange={setSpreadsheetId}
          tab={sheetTab}
          onTabChange={setSheetTab}
        />
      )}

      {/* Declarative bindings over the attached spreadsheet. Each one compiles
          into an operation of this source, so they belong here next to the
          operation list rather than in a surface of their own. */}
      {isGoogleSheets && (
        <SheetBindingsPanel
          sourceId={isEdit ? datasource.id : null}
          fileId={spreadsheetId}
          fileName={name.trim()}
        />
      )}

      {/* GraphQL introspection — the endpoint URL is the schema endpoint */}
      {discovering && (
        <p className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 animate-pulse">
          Introspecting the GraphQL schema…
        </p>
      )}
      {discovered && (
        <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-800 rounded-lg px-3 py-2">
          <span className="flex-1">
            Schema introspected — {discovered.operations.length} quer{discovered.operations.length === 1 ? "y" : "ies"}
          </span>
          <button
            type="button"
            onClick={() => setOps(discovered.operations.map(opToDraft))}
            className="px-2 py-1 rounded bg-emerald-800/60 hover:bg-emerald-700/60 text-emerald-200 font-medium transition-colors"
          >
            Fill operations
          </button>
        </div>
      )}

      {/* API specification import (optional) — nothing to import for a Google
          Sheets source: its operations come from the backend's template. */}
      {!isGoogleSheets && (
      <div className="space-y-1.5 rounded-lg border border-slate-700 bg-slate-800/30 p-3">
        <label className="text-xs font-medium text-slate-400">
          API specification <span className="text-slate-500 font-normal">— optional</span>
        </label>
        <p className="text-[10px] text-slate-500">
          {kind === "graphql"
            ? "The endpoint above is introspected automatically. Point this at a schema file or a different endpoint to import from there instead."
            : "Nothing is guessed from the base URL. Give the specification's URL, or upload the file, to fill in endpoints, arguments and response schemas."}
        </p>
        <div className="flex gap-2">
          <input
            value={schemaUrl}
            onChange={(e) => setSchemaUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleFetchSchema(); }
            }}
            placeholder={kind === "graphql" ? "https://api.example.com/graphql" : "https://api.example.com/openapi.json"}
            className={clsx(dsFieldMonoCls, "flex-1")}
          />
          <button
            type="button"
            onClick={handleFetchSchema}
            disabled={!schemaUrl.trim() || schemaBusy !== null}
            title="Fetch and parse the specification through the backend"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-50 transition-colors shrink-0"
          >
            {schemaBusy === "url" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Fetch
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={schemaBusy !== null}
            title="Upload an OpenAPI/Swagger (JSON or YAML), GraphQL SDL or introspection file"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-50 transition-colors shrink-0"
          >
            {schemaBusy === "file" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.yaml,.yml,.graphql,.gql,.txt,application/json,text/yaml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadSchema(file);
            }}
          />
        </div>
        {schemaError && (
          <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-900 rounded-md px-2 py-1">
            {schemaError}
          </p>
        )}

        {imported && imported.operations.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-2 text-[11px] text-emerald-300">
              <span className="flex-1 truncate" title={imported.source}>
                {imported.source} ({imported.kind}) — {imported.operations.length} operation
                {imported.operations.length === 1 ? "" : "s"}
              </span>
              <button type="button" onClick={() => setPicked(new Set(visibleImported.map((o) => o.name)))}
                className="text-sky-400 hover:text-sky-300 transition-colors">
                select {opFilter.trim() ? "shown" : "all"}
              </button>
              <button type="button" onClick={() => setPicked(new Set())}
                className="text-slate-400 hover:text-slate-200 transition-colors">
                none
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
              <input
                value={opFilter} onChange={(e) => setOpFilter(e.target.value)}
                placeholder="filter operations…"
                className={clsx(dsFieldMonoCls, "pl-7")}
              />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border border-slate-700 divide-y divide-slate-800">
              {visibleImported.length === 0 && (
                <p className="text-[10px] text-slate-500 italic px-2 py-2">Nothing matches that filter.</p>
              )}
              {visibleImported.map((op) => {
                const already = draftOpNames.has(op.name);
                return (
                  <label
                    key={op.name}
                    className={clsx(
                      "flex items-start gap-2 px-2 py-1.5 text-[10px]",
                      already ? "opacity-50" : "hover:bg-slate-800/60 cursor-pointer",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-sky-500"
                      disabled={already}
                      checked={already || picked.has(op.name)}
                      onChange={() => togglePicked(op.name)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-slate-300">{op.name}</span>
                      <MethodBadge method={op.method} className="ml-1 align-middle" />
                      <span className="ml-1 font-mono text-slate-500 break-all">
                        {op.path ?? (op.query ?? "").slice(0, 90)}
                      </span>
                      {op.params.length > 0 && (
                        <span className="ml-1 text-slate-500">
                          ({op.params.map((p) => `${p.name}${p.required ? "" : "?"}`).join(", ")})
                        </span>
                      )}
                      {op.summary && <span className="block text-slate-500">{op.summary}</span>}
                      {already && <span className="block text-slate-500 italic">already added</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <button
              type="button"
              onClick={addPickedOperations}
              disabled={picked.size === 0}
              className="w-full py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium disabled:opacity-40 transition-colors"
            >
              {picked.size === 0
                ? "Select the operations this datasource needs"
                : `Add ${picked.size} selected operation${picked.size === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>
      )}

      {/* Operations */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-slate-400">Operations</label>
          <button
            type="button"
            onClick={addOp}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-300 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add operation
          </button>
        </div>
        {ops.length === 0 && (
          <p className="text-[11px] text-slate-500 italic">No operations yet — add one manually or let schema discovery fill them.</p>
        )}
        {ops.map((op, i) => {
          const isOpen = openOps.has(i);
          return (
          <div key={i} className="rounded-lg border border-slate-700 bg-slate-800/40">
            {/* folded header — name only, click to expand */}
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button type="button" onClick={() => toggleOp(i)}
                className="flex-1 flex items-center gap-2 min-w-0 text-left group"
                title={isOpen ? "Collapse operation" : "Expand operation"}>
                {isOpen
                  ? <ChevronUp className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 shrink-0" />
                  : <ChevronDown className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 shrink-0" />}
                <MethodBadge method={op.method} />
                <span className={clsx(
                  "font-mono text-xs truncate",
                  op.name.trim() ? "text-slate-200" : "text-slate-500 italic font-sans",
                )}>
                  {op.name.trim() || "unnamed operation"}
                </span>
              </button>
              <button type="button" onClick={() => removeOp(i)}
                className="p-1.5 rounded hover:bg-red-900/50 text-slate-500 hover:text-red-300 transition-colors shrink-0" title="Remove operation">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {isOpen && (
            <div className="px-3 pb-3 space-y-2.5">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-slate-500">Operation name — how agents and workflow steps refer to it</label>
                <input
                  ref={(el) => { nameInputRefs.current[i] = el; }}
                  value={op.name} onChange={(e) => setOp(i, { name: e.target.value })}
                  placeholder="list_projects"
                  className={dsFieldMonoCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500">Method</label>
                <select value={op.method} onChange={(e) => setOp(i, { method: e.target.value })} className={clsx(dsFieldCls, "w-24 text-xs")}>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500" title="A gated operation stops mid-run and waits for someone to approve it, showing how many rows it would remove.">
                  Approval
                </label>
                <select
                  value={op.destructive === null ? "auto" : op.destructive ? "always" : "never"}
                  onChange={(e) => setOp(i, {
                    destructive: e.target.value === "auto" ? null : e.target.value === "always",
                  })}
                  className={clsx(dsFieldCls, "w-40 text-xs")}
                >
                  <option value="auto">
                    From method ({methodLevel(op.method) === "delete" ? "gated" : "not gated"})
                  </option>
                  <option value="always">Always require approval</option>
                  <option value="never">Never require approval</option>
                </select>
              </div>
              <button type="button" onClick={() => handleTryOp(i)} disabled={tryingOp !== null}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors shrink-0"
                title="Run this request once, fill API output with the sampled response and let the meta-LLM suggest the expected-output mapping">
                {tryingOp === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Try run
              </button>
            </div>
            {tryHints[i] && (
              <p className={clsx("text-[11px] rounded-md px-2 py-1 border",
                tryHints[i].ok
                  ? "text-emerald-400 bg-emerald-950/30 border-emerald-900"
                  : "text-red-400 bg-red-950/30 border-red-900")}>
                {tryHints[i].msg}
              </p>
            )}
            {tryConfirm[i] && (
              <TryRunDeleteConfirm
                plan={tryConfirm[i]!}
                busy={tryingOp === i}
                onConfirm={() => handleTryOp(i, true)}
                onCancel={() => setTryConfirm((prev) => ({ ...prev, [i]: undefined }))}
              />
            )}

            {kind === "http" ? (
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500">Request path — templates: {"{params.x}"} and {"{other_op.field}"}</label>
                <input
                  value={op.path} onChange={(e) => setOp(i, { path: e.target.value })}
                  placeholder="/items/{params.id}?q={params.q}"
                  className={dsFieldMonoCls}
                />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500">GraphQL query — templates: {"{params.x}"} and {"{other_op.field}"}</label>
                  <CodeEditor
                    value={op.query} onChange={(query) => setOp(i, { query })}
                    language="graphql"
                    placeholder={"query items($q: String) { items(q: $q) { id name } }"}
                    minHeight={90}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500">Variables (JSON, values may use templates)</label>
                  <CodeEditor
                    value={op.variablesText} onChange={(variablesText) => setOp(i, { variablesText })}
                    language="json"
                    placeholder={'{"q": "{params.q}"}'}
                    minHeight={72}
                  />
                </div>
              </>
            )}

            {/* Input params */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-500">Request input params</label>
                <button
                  type="button"
                  onClick={() => setOp(i, { params: [...op.params, { name: "", type: "string", required: true, description: "" }] })}
                  className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
                >
                  + param
                </button>
              </div>
              {op.params.map((p, j) => (
                <div key={j} className="flex items-center gap-1.5">
                  <input value={p.name} onChange={(e) => setOpParam(i, j, { name: e.target.value })} placeholder="name" className={clsx(dsFieldMonoCls, "w-28")} />
                  <select value={p.type} onChange={(e) => setOpParam(i, j, { type: e.target.value as DataSourceParamSpec["type"] })} className={clsx(dsFieldCls, "w-24 text-xs")}>
                    {["string", "number", "boolean", "array", "object"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
                    <input type="checkbox" checked={p.required} onChange={(e) => setOpParam(i, j, { required: e.target.checked })} className="accent-sky-500" />
                    req
                  </label>
                  <input value={p.description} onChange={(e) => setOpParam(i, j, { description: e.target.value })} placeholder="description" className={clsx(dsFieldCls, "flex-1 text-xs")} />
                  <button type="button" onClick={() => setOp(i, { params: op.params.filter((_, k) => k !== j) })}
                    className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-red-300 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">API output — response schema (JSON, filled from discovered schema)</label>
              <CodeEditor
                value={op.responseSchemaText} onChange={(responseSchemaText) => setOp(i, { responseSchemaText })}
                language="json"
                placeholder={'{"type": "object", "properties": {"items": {"type": "array"}}}'}
                minHeight={90}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">Expected output — JMESPath mapping applied to the response; result becomes the step&apos;s output</label>
              <input
                value={op.mapping} onChange={(e) => setOp(i, { mapping: e.target.value })}
                placeholder="items[].{id: id, name: name}"
                className={dsFieldMonoCls}
              />
            </div>
            </div>
            )}
          </div>
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>
      )}
      {!readOnly && <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose}
          className="flex-1 py-2.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-medium transition-colors">
          Cancel
        </button>
        <button type="submit"
          disabled={saving || (!isEdit && !id.trim()) || !baseUrl.trim()}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Datasource"}
        </button>
      </div>}
    </ResourceEditorFrame>
  );
}

/** The datasource editor hosted in the main window instead of over the canvas. */
export function DatasourceEditor(props: Omit<DatasourceModalProps, "surface">) {
  return <DatasourceModal {...props} surface="center" />;
}

// ─── Node palette ─────────────────────────────────────────────────────────────

function NodePalette({ onAdd, onAddAgent, onAddDatasource, onAddEvent, onAddAddon }: { onAdd: (type: ApiStepType) => void; onAddAgent: (agent: AgentDefinition) => void; onAddDatasource?: (ds: DataSourceDefinition) => void; onAddEvent?: (ev: EventDefinition) => void; onAddAddon?: (kind: "slack" | "pvc" | "mcp" | "tools" | "s3" | "datasource") => void }) {
  const [tab, setTab] = useState<"nodes" | "operators" | "agents">("nodes");
  // What the workflow being edited may use — the rest stays listed (to edit)
  // but cannot be added.
  const scope = useUsageScope();
  const [agents, setAgents]               = useState<AgentDefinition[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError]     = useState<string | null>(null);
  const [agentModal, setAgentModal]       = useState<{ agent: AgentDefinition | null } | null>(null);
  const [datasources, setDatasources]     = useState<DataSourceDefinition[]>([]);
  const [dsLoading, setDsLoading]         = useState(false);
  const [dsError, setDsError]             = useState<string | null>(null);
  const [dsModal, setDsModal]             = useState<{ datasource: DataSourceDefinition | null } | null>(null);
  const [events, setEvents]               = useState<EventDefinition[]>([]);
  const [evLoading, setEvLoading]         = useState(false);
  const [evError, setEvError]             = useState<string | null>(null);
  const [eventModal, setEventModal]       = useState<{ event: EventDefinition | null } | null>(null);

  const fetchDatasources = useCallback(async () => {
    setDsLoading(true);
    setDsError(null);
    try {
      const list = await listDatasources();
      setDatasources(list);
    } catch (err) {
      setDsError(err instanceof Error ? err.message : "Failed to load datasources");
    } finally {
      setDsLoading(false);
    }
  }, []);

  const handleDeleteDatasource = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete datasource "${name}"? This cannot be undone.`)) return;
    try {
      await deleteDatasource(id);
      await fetchDatasources();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete datasource");
    }
  }, [fetchDatasources]);

  const fetchEvents = useCallback(async () => {
    setEvLoading(true);
    setEvError(null);
    try {
      setEvents(await listEvents());
    } catch (err) {
      setEvError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setEvLoading(false);
    }
  }, []);

  const handleDeleteEvent = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete event "${name}"? Workflows triggering on it stop subscribing.`)) return;
    try {
      await deleteEvent(id);
      await fetchEvents();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete event");
    }
  }, [fetchEvents]);

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const list = await listAgents();
      setAgents(list);
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const handleDeleteAgent = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete agent "${name}"? This cannot be undone.`)) return;
    try {
      await deleteAgent(id);
      await fetchAgents();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete agent");
    }
  }, [fetchAgents]);

  useEffect(() => {
    if (tab === "agents") fetchAgents();
    if (tab === "operators") { fetchDatasources(); fetchEvents(); }
  }, [tab, fetchAgents, fetchDatasources, fetchEvents]);

  return (
    <>
      {agentModal !== null && (
        <AgentModal
          agent={agentModal.agent}
          onSave={() => { setAgentModal(null); fetchAgents(); }}
          onClose={() => setAgentModal(null)}
        />
      )}
      {dsModal !== null && (
        <DatasourceModal
          datasource={dsModal.datasource}
          onSave={() => { setDsModal(null); fetchDatasources(); }}
          onClose={() => setDsModal(null)}
        />
      )}
      {eventModal !== null && (
        <EventModal
          event={eventModal.event}
          onSave={() => { setEventModal(null); fetchEvents(); }}
          onClose={() => setEventModal(null)}
        />
      )}
      <div className="w-44 shrink-0 border-r border-slate-800 bg-slate-900/40 flex flex-col overflow-hidden">
        {/* Tab switcher */}
        <div className="flex border-b border-slate-800 shrink-0">
          <button onClick={() => setTab("nodes")}
            className={clsx(
              "flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
              tab === "nodes" ? "text-sky-400 border-b-2 border-sky-400 -mb-px" : "text-slate-500 hover:text-slate-300",
            )}>
            Nodes
          </button>
          <button onClick={() => setTab("operators")}
            className={clsx(
              "flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
              tab === "operators" ? "text-sky-400 border-b-2 border-sky-400 -mb-px" : "text-slate-500 hover:text-slate-300",
            )}>
            Ops
          </button>
          <button onClick={() => setTab("agents")}
            className={clsx(
              "flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
              tab === "agents" ? "text-sky-400 border-b-2 border-sky-400 -mb-px" : "text-slate-500 hover:text-slate-300",
            )}>
            Agents
          </button>
        </div>

        {/* ── Nodes tab ── */}
        {tab === "nodes" && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 space-y-3">
              {PALETTE_GROUPS.map((group, groupIdx) => (
                <div key={group.label} className={clsx("space-y-1", groupIdx > 0 && "pt-2 border-t border-slate-800")}>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-0.5">
                    {group.label}
                  </div>
                  {group.items.map(({ type, label }) => {
                    const colors = TYPE_COLORS[type];
                    return (
                      <button key={type} onClick={() => onAdd(type)}
                        className={clsx(
                          "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs font-medium",
                          "transition-all hover:brightness-110 active:scale-95",
                          colors.bg, colors.text,
                        )}
                        style={{ borderColor: colors.border }}>
                        <span className="text-sm leading-none shrink-0">{TYPE_ICONS[type]}</span>
                        <span className="flex-1 text-left">{label}</span>
                        <Plus className="w-3 h-3 opacity-40 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Operators tab ── */}
        {tab === "operators" && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 space-y-1">
              {OPERATOR_ITEMS.map(({ type, label }) => {
                const colors = TYPE_COLORS[type] ?? TYPE_COLORS.llm;
                return (
                  <button key={type} onClick={() => onAdd(type)}
                    className={clsx(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs font-medium",
                      "transition-all hover:brightness-110 active:scale-95",
                      colors.bg, colors.text,
                    )}
                    style={{ borderColor: colors.border }}>
                    <span className="flex-1 text-left">{label}</span>
                    <Plus className="w-3 h-3 opacity-40 shrink-0" />
                  </button>
                );
              })}
            </div>
            {/* Datasources */}
            <div className="p-2 mt-2 pt-3 border-t border-slate-800">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Datasources
              </div>
              <button onClick={() => setDsModal({ datasource: null })}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors">
                <Plus className="w-3 h-3" />
                New Datasource
              </button>
              <div className="mt-2">
                {dsLoading ? (
                  <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>
                ) : dsError ? (
                  <p className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{dsError}</p>
                ) : datasources.length === 0 ? (
                  <p className="text-[10px] text-slate-500 italic text-center py-3">No datasources yet</p>
                ) : (
                  <div className="space-y-1">
                    {datasources.map((ds) => (
                      <div key={ds.id}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 group">
                        <Database className="w-3 h-3 text-cyan-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 min-w-0">
                            <p className="text-xs font-medium text-slate-200 truncate">{ds.name || ds.id}</p>
                            <VisibilityBadge resource={ds} />
                          </div>
                          <p className="text-[10px] text-slate-500 truncate">
                            {ds.base_url || ds.kind}
                          </p>
                        </div>
                        {/* Not bound to one operation here, so the badge covers
                            everything this source can be made to do. */}
                        <DatasourceRiskBadge
                          operations={ds.operations ?? []}
                          kind={ds.kind}
                        />
                        <button onClick={() => onAddDatasource?.(ds)}
                          disabled={!!scopeConflict(scope, ds)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-cyan-700 text-slate-400 hover:text-white transition-all shrink-0 disabled:hover:bg-transparent disabled:opacity-30 disabled:cursor-not-allowed"
                          title={scopeConflict(scope, ds) ?? "Add to canvas"}>
                          <Plus className="w-3 h-3" />
                        </button>
                        <button onClick={() => setDsModal({ datasource: ds })}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-all shrink-0"
                          title="Edit datasource">
                          <Pencil className="w-3 h-3" />
                        </button>
                        {canEdit(ds) && (
                          <button onClick={() => handleDeleteDatasource(ds.id, ds.name || ds.id)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-800 text-slate-400 hover:text-red-300 transition-all shrink-0"
                            title="Delete datasource">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Events */}
            <div className="p-2 mt-2 pt-3 border-t border-slate-800">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Events
              </div>
              <button onClick={() => setEventModal({ event: null })}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">
                <Plus className="w-3 h-3" />
                New Event
              </button>
              <div className="mt-2">
                {evLoading ? (
                  <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>
                ) : evError ? (
                  <p className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{evError}</p>
                ) : events.length === 0 ? (
                  <p className="text-[10px] text-slate-500 italic text-center py-3">No events yet</p>
                ) : (
                  <div className="space-y-1">
                    {events.map((ev) => (
                      <div key={ev.id}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 group">
                        <Radio className="w-3 h-3 text-indigo-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-200 truncate">{ev.name || ev.id}</p>
                          <p className="text-[10px] text-slate-500 truncate">{ev.topic || "(no topic)"}</p>
                        </div>
                        <button onClick={() => onAddEvent?.(ev)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-indigo-700 text-slate-400 hover:text-white transition-all shrink-0"
                          title="Add trigger to canvas">
                          <Plus className="w-3 h-3" />
                        </button>
                        <button onClick={() => setEventModal({ event: ev })}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-all shrink-0"
                          title="Edit event">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => handleDeleteEvent(ev.id, ev.name || ev.id)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-800 text-slate-400 hover:text-red-300 transition-all shrink-0"
                          title="Delete event">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Agents tab ── */}
        {tab === "agents" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-2 py-2 border-b border-slate-800 shrink-0">
              <button onClick={() => setAgentModal({ agent: null })}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors">
                <Plus className="w-3 h-3" />
                New Agent
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {agentsLoading ? (
                <p className="text-[10px] text-slate-500 text-center py-3">Loading…</p>
              ) : agentsError ? (
                <p className="text-[10px] text-red-400 bg-red-950/30 border border-red-800 rounded px-2 py-1">{agentsError}</p>
              ) : agents.length === 0 ? (
                <p className="text-[10px] text-slate-500 italic text-center py-3">No agents yet</p>
              ) : (
                <div className="space-y-1">
                  {agents.map((a) => (
                    <div key={a.id}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 group">
                      <Bot className="w-3 h-3 text-violet-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <p className="text-xs font-medium text-slate-200 truncate">{a.name || a.id}</p>
                          <VisibilityBadge resource={a} />
                        </div>
                        <p className="text-[10px] text-slate-500 truncate">{a.default_runtime}</p>
                      </div>
                      <button onClick={() => onAddAgent(a)}
                        disabled={!!scopeConflict(scope, a)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-violet-700 text-slate-400 hover:text-white transition-all shrink-0 disabled:hover:bg-transparent disabled:opacity-30 disabled:cursor-not-allowed"
                        title={scopeConflict(scope, a) ?? "Add to canvas"}>
                        <Plus className="w-3 h-3" />
                      </button>
                      <button onClick={() => setAgentModal({ agent: a })}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-all shrink-0"
                        title="Edit agent">
                        <Pencil className="w-3 h-3" />
                      </button>
                      {canEdit(a) && (
                        <button onClick={() => handleDeleteAgent(a.id, a.name || a.id)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-800 text-slate-400 hover:text-red-300 transition-all shrink-0"
                          title="Delete agent">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* Addons */}
              <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
                  Addons
                </div>
                <button
                  onClick={() => onAddAddon?.('slack')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '8px 10px',
                    background: '#4A154B', border: 'none', borderRadius: 8,
                    cursor: 'pointer', color: '#fff',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19.7 31.7c0 2.7-2.2 4.9-4.9 4.9S10 34.4 10 31.7s2.2-4.9 4.9-4.9H19.7v4.9z" fill="#E01E5A"/>
                    <path d="M22.2 31.7c0-2.7 2.2-4.9 4.9-4.9s4.9 2.2 4.9 4.9V43.1c0 2.7-2.2 4.9-4.9 4.9s-4.9-2.2-4.9-4.9V31.7z" fill="#E01E5A"/>
                    <path d="M27.1 19.7c-2.7 0-4.9-2.2-4.9-4.9S24.4 10 27.1 10s4.9 2.2 4.9 4.9V19.7H27.1z" fill="#36C5F0"/>
                    <path d="M27.1 22.2c2.7 0 4.9 2.2 4.9 4.9s-2.2 4.9-4.9 4.9H15.7c-2.7 0-4.9-2.2-4.9-4.9s2.2-4.9 4.9-4.9H27.1z" fill="#36C5F0"/>
                    <path d="M39.1 27.1c0-2.7 2.2-4.9 4.9-4.9s4.9 2.2 4.9 4.9-2.2 4.9-4.9 4.9H39.1V27.1z" fill="#2EB67D"/>
                    <path d="M36.6 27.1c0 2.7-2.2 4.9-4.9 4.9s-4.9-2.2-4.9-4.9V15.7c0-2.7 2.2-4.9 4.9-4.9s4.9 2.2 4.9 4.9V27.1z" fill="#2EB67D"/>
                    <path d="M31.7 39.1c2.7 0 4.9 2.2 4.9 4.9S34.4 48.9 31.7 48.9s-4.9-2.2-4.9-4.9V39.1H31.7z" fill="#ECB22E"/>
                    <path d="M31.7 36.6c-2.7 0-4.9-2.2-4.9-4.9s2.2-4.9 4.9-4.9H43.1c2.7 0 4.9 2.2 4.9 4.9s-2.2 4.9-4.9 4.9H31.7z" fill="#ECB22E"/>
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Slack</span>
                  <span style={{ marginLeft: 'auto', fontSize: 18, lineHeight: '1' }}>+</span>
                </button>
                <button
                  onClick={() => onAddAddon?.('pvc')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '8px 10px', marginTop: 6,
                    background: '#0d3d3d', border: '1px solid #0d9488', borderRadius: 8,
                    cursor: 'pointer', color: '#5eead4',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <ellipse cx="12" cy="6" rx="8" ry="3" stroke="#2dd4bf" strokeWidth="1.5"/>
                    <path d="M4 6v6c0 1.657 3.582 3 8 3s8-1.343 8-3V6" stroke="#2dd4bf" strokeWidth="1.5"/>
                    <path d="M4 12v6c0 1.657 3.582 3 8 3s8-1.343 8-3v-6" stroke="#2dd4bf" strokeWidth="1.5"/>
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>PVC</span>
                  <span style={{ marginLeft: 'auto', fontSize: 18, lineHeight: '1' }}>+</span>
                </button>
                <button
                  onClick={() => onAddAddon?.('mcp')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '8px 10px', marginTop: 6,
                    background: '#2d1a00', border: '1px solid #c2410c', borderRadius: 8,
                    cursor: 'pointer', color: '#fdba74',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="5" y="2" width="14" height="10" rx="2" stroke="#fb923c" strokeWidth="1.5"/>
                    <path d="M8 12v4" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M16 12v4" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M9 16h6" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M12 16v3" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="9" cy="6" r="1" fill="#fb923c"/>
                    <circle cx="15" cy="6" r="1" fill="#fb923c"/>
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>MCP</span>
                  <span style={{ marginLeft: 'auto', fontSize: 18, lineHeight: '1' }}>+</span>
                </button>
                <button
                  onClick={() => onAddAddon?.('tools')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '8px 10px', marginTop: 6,
                    background: '#04241a', border: '1px solid #0f766e', borderRadius: 8,
                    cursor: 'pointer', color: '#6ee7b7',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M14.7 6.3a4 4 0 0 0-5.4 4.9L3 17.5V21h3.5l6.3-6.3a4 4 0 0 0 4.9-5.4l-2.6 2.6-2.1-.5-.5-2.1 2.7-2.5z"
                      stroke="#34d399"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Tools</span>
                  <span style={{ marginLeft: 'auto', fontSize: 18, lineHeight: '1' }}>+</span>
                </button>
                <button
                  onClick={() => onAddAddon?.('s3')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '8px 10px', marginTop: 6,
                    background: '#1a1200', border: '1px solid #b45309', borderRadius: 8,
                    cursor: 'pointer', color: '#fde68a',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <ellipse cx="12" cy="6" rx="8" ry="3" stroke="#fbbf24" strokeWidth="1.5"/>
                    <path d="M4 6v6c0 1.657 3.582 3 8 3s8-1.343 8-3V6" stroke="#fbbf24" strokeWidth="1.5"/>
                    <path d="M4 12v6c0 1.657 3.582 3 8 3s8-1.343 8-3v-6" stroke="#fbbf24" strokeWidth="1.5"/>
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>S3 Storage</span>
                  <span style={{ marginLeft: 'auto', fontSize: 18, lineHeight: '1' }}>+</span>
                </button>
                <button
                  onClick={() => onAddAddon?.('datasource')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '8px 10px', marginTop: 6,
                    background: '#001a1a', border: '1px solid #0e7490', borderRadius: 8,
                    cursor: 'pointer', color: '#a5f3fc',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <ellipse cx="12" cy="6" rx="7" ry="3" stroke="#22d3ee" strokeWidth="1.5"/>
                    <path d="M5 6v6c0 1.657 3.134 3 7 3s7-1.343 7-3V6" stroke="#22d3ee" strokeWidth="1.5"/>
                    <path d="M5 12v6c0 1.657 3.134 3 7 3s7-1.343 7-3v-6" stroke="#22d3ee" strokeWidth="1.5"/>
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Datasource</span>
                  <span style={{ marginLeft: 'auto', fontSize: 18, lineHeight: '1' }}>+</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Inner editor ─────────────────────────────────────────────────────────────

export interface WorkflowEditorProps {
  workflow: EditableWorkflowDefinition;
  onSave?: (updated: EditableWorkflowDefinition) => void;
  onCancel?: () => void;
  saving?: boolean;
  saveError?: string | null;
  readonly?: boolean;
  hideHeader?: boolean;
}

function WorkflowEditorInner({ workflow, onSave, onCancel, saving, saveError, readonly, hideHeader }: WorkflowEditorProps) {
  const [workflowName, setWorkflowName] = useState(workflow.name);
  const [workflowDesc, setWorkflowDesc] = useState(workflow.description ?? "");
  const [workflowId, setWorkflowId]     = useState(workflow.id);
  const [useMetaLlm, setUseMetaLlm]    = useState<boolean>(workflow.use_meta_llm ?? true);
  const [useStorage, setUseStorage]    = useState<boolean>(workflow.use_storage ?? false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pinnedPanel, setPinnedPanel] = useState(true);
  const togglePin = useCallback(() => setPinnedPanel((v) => !v), []);

  // ── Edge condition editor ──────────────────────────────────────────────────
  const [edgeEditor, setEdgeEditor] = useState<{
    edgeId: string;
    condition: string;
    /** Raw text from the input; "" means "no wait". */
    waitSeconds: string;
    x: number;
    y: number;
  } | null>(null);

  // ── View mode ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"visual" | "yaml">("visual");
  const [yamlText, setYamlText] = useState<string>("");
  const [yamlError, setYamlError] = useState<string | null>(null);

  // Stable ref used to pass a delete handler into shared node components without
  // causing unnecessary re-renders. Assigned after handleNodeDelete is defined.
  const deleteNodeRef = useRef<(id: string) => void>(() => {});
  const deleteNodeCb = useCallback((id: string) => deleteNodeRef.current(id), []);

  const initialNodes = useMemo<Node[]>(
    () => workflow.nodes.map((n, i) =>
      configToRFNode(n, workflow.layout?.[n.id] ?? snakePosition(i), readonly ? undefined : deleteNodeCb)
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const initialEdges = useMemo<Edge[]>(
    () => workflow.edges.map((e) => {
      const colored = !!e.data?.condition || (typeof e.data?.wait_seconds === "number" && e.data.wait_seconds > 0);
      return {
        ...e,
        type: "editableEdge",
        style: { stroke: colored ? "#818cf8" : "#475569", strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: colored ? "#818cf8" : "#475569" },
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition: toFlow } = useReactFlow();

  // Names the steps that are bound to an event; same request the trigger's
  // property fields use, so both see an event the moment it is created.
  const { eventNames } = useEvents();

  // ── Addon fold state ──────────────────────────────────────────────────────
  // Agents whose attached addons are currently expanded (visible). Folding is
  // a pure display concern — the underlying `nodes` state is never mutated, so
  // React Flow change events (id-keyed) still resolve against the real nodes.
  const [unfoldedAgents, setUnfoldedAgents] = useState<Set<string>>(new Set());

  const toggleAgentAddons = useCallback((agentId: string) => {
    setUnfoldedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  // Add-only: reveal an agent's addons (used when a new addon is attached).
  const unfoldAgent = useCallback((agentId: string) => {
    if (!agentId) return;
    setUnfoldedAgents((prev) => {
      if (prev.has(agentId)) return prev;
      const next = new Set(prev);
      next.add(agentId);
      return next;
    });
  }, []);

  // agentId → count of addon nodes attached to it.
  const addonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const attachedTo = (n.data as Record<string, unknown>).attachedTo as string | undefined;
      if (isAddonNodeType(n.type as string) && attachedTo) {
        counts.set(attachedTo, (counts.get(attachedTo) ?? 0) + 1);
      }
    }
    return counts;
  }, [nodes]);

  // Display-only view of `nodes`: attached addons are hidden while their agent
  // is folded; agents with addons carry the fold toggle wiring; a step bound to
  // an event is labelled by that event. The label is resolved here rather than
  // baked in by configToRFNode because the events list arrives asynchronously,
  // long after the nodes were built.
  const displayNodes = useMemo(() => {
    return nodes.map((n) => {
      const data = n.data as Record<string, unknown>;
      const attachedTo = data.attachedTo as string | undefined;
      if (isAddonNodeType(n.type as string) && attachedTo) {
        return { ...n, hidden: !unfoldedAgents.has(attachedTo) };
      }
      const count = addonCounts.get(n.id);
      const label = stepDisplayLabel(n.data as unknown as EditableNodeConfig, eventNames);
      // Untouched nodes keep their identity so React Flow does not re-render them.
      if (!count && label === data.label) return n;
      return {
        ...n,
        data: {
          ...n.data,
          label,
          ...(count ? {
            _addonCount: count,
            _addonsUnfolded: unfoldedAgents.has(n.id),
            _onToggleAddons: toggleAgentAddons,
          } : {}),
        },
      };
    });
  }, [nodes, addonCounts, unfoldedAgents, toggleAgentAddons, eventNames]);

  // ── Connection validation: non-llm_structured nodes have at most 1 output ─
  const isValidConnection = useCallback(
    (conn: { source?: string | null; target?: string | null }): boolean => {
      if (!conn.source || !conn.target || conn.source === conn.target) return false;
      const src = nodes.find((n) => n.id === conn.source);
      if (!src) return false;
      const srcType = (src.data as unknown as EditableNodeConfig).type;
      const multiOutputTypes = new Set(["llm_structured", "parallel", "switch", "langgraph-agent"]);
      if (!multiOutputTypes.has(srcType)) {
        if (edges.some((e) => e.source === conn.source)) return false;
      }
      return true;
    },
    [nodes, edges],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  // ── Mode switching ────────────────────────────────────────────────────────

  const switchToYaml = useCallback(() => {
    const layout: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) layout[n.id] = n.position;

    const currentWf: EditableWorkflowDefinition = {
      id:          workflowId,
      name:        workflowName,
      description: workflowDesc || undefined,
      nodes:       nodes.map(rfNodeToConfig),
      edges:       edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        data: e.data as { condition?: string; wait_seconds?: number; waypoints?: Array<{ x: number; y: number }> } | undefined,
      })),
      isNew:       workflow.isNew,
      layout,
    };
    let yaml: string;
    try {
      yaml = workflowToYaml(currentWf);
    } catch (err) {
      // A step that cannot be serialised (e.g. an event schema that is not yet
      // valid JSON) has no YAML form — stay in the visual editor and say why.
      alert(err instanceof Error ? err.message : "This workflow cannot be shown as YAML");
      return;
    }
    setYamlText(yaml);
    setYamlError(null);
    setMode("yaml");
  }, [workflowId, workflowName, workflowDesc, nodes, edges, workflow.isNew]);

  const switchToVisual = useCallback(() => {
    try {
      const parsed = yamlToWorkflow(yamlText, {
        id: workflowId, name: workflowName,
        description: workflowDesc || undefined, isNew: workflow.isNew,
      });
      setWorkflowId(parsed.id);
      setWorkflowName(parsed.name);
      setWorkflowDesc(parsed.description ?? "");
      setNodes(parsed.nodes.map((n, i) => configToRFNode(n, parsed.layout?.[n.id] ?? snakePosition(i), readonly ? undefined : deleteNodeCb)));
      setEdges(parsed.edges.map((e) => {
        const cond = e.data?.condition;
        return {
          ...e,
          type: "editableEdge",
          style: { stroke: cond ? "#818cf8" : "#475569", strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: cond ? "#818cf8" : "#475569" },
        };
      }));
      setYamlError(null);
      setSelectedNodeId(null);
      setMode("visual");
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : "Invalid YAML");
    }
  }, [yamlText, workflowId, workflowName, workflowDesc, workflow.isNew, setNodes, setEdges]);

  // ── Node handlers ─────────────────────────────────────────────────────────

  const handleNodeChange = useCallback(
    (id: string, patch: Partial<EditableNodeConfig>) =>
      setNodes((nds) => nds.map((n) => {
        if (n.id !== id) return n;
        // Keep label in sync with name for WorkflowStepNode display.
        const extra = patch.name !== undefined ? { label: patch.name } : {};
        return { ...n, data: { ...n.data, ...patch, ...extra } };
      })),
    [setNodes],
  );

  const handleNodeDelete = useCallback(
    (id: string) => {
      setNodes((nds) => {
        const deleted = nds.find((n) => n.id === id);
        const agentId = deleted ? (deleted.data as Record<string, unknown>).attachedTo as string | null : null;
        const remaining = nds.filter((n) => n.id !== id);
        if (!agentId) return remaining;
        const agentNode = remaining.find((n) => n.id === agentId);
        if (!agentNode) return remaining;
        const attached = remaining
          .filter((n) => (n.data as Record<string, unknown>).attachedTo === agentId)
          .sort((a, b) => a.position.y - b.position.y);
        const attachedIds = new Map(attached.map((n, i) => [n.id, i]));
        return remaining.map((n) => {
          const idx = attachedIds.get(n.id);
          if (idx !== undefined) {
            return { ...n, position: { x: agentNode.position.x, y: agentNode.position.y + (idx + 1) * 48 } };
          }
          return n;
        });
      });
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges],
  );
  // Wire the stable ref so deleteNodeCb always calls the latest handler.
  deleteNodeRef.current = handleNodeDelete;

  // Returns the center of the visible canvas area in flow coordinates.
  const viewportCenter = useCallback(() =>
    toFlow({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    [toFlow],
  );

  const handleAddNode = useCallback(
    (type: ApiStepType) => {
      const id = `node_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const label = TYPE_LABELS[type] ?? type;
      const config: EditableNodeConfig = {
        id, type, name: label,
        // Python steps are sandboxed unless the author opts out.
        ...(type === "python" ? { sandbox: true, sandbox_runtime: "local" as const } : {}),
      };
      setNodes((nds) => [...nds, configToRFNode(config, viewportCenter(), readonly ? undefined : deleteNodeCb)]);
      setSelectedNodeId(id);
    },
    [setNodes, viewportCenter, deleteNodeCb, readonly],
  );

  const handleAddAgentNode = useCallback(
    (agent: AgentDefinition) => {
      const id = `node_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const config: EditableNodeConfig = {
        id,
        type: "langgraph-agent",
        name: agent.name || agent.id,
        agent_id: agent.id,
      };
      setNodes((nds) => [...nds, configToRFNode(config, viewportCenter(), readonly ? undefined : deleteNodeCb)]);
      setSelectedNodeId(id);
    },
    [setNodes, viewportCenter, deleteNodeCb, readonly],
  );

  const handleAddDatasourceNode = useCallback(
    (ds: DataSourceDefinition) => {
      const existing = new Set(nodes.map((n) => n.id));
      let seq = 1;
      while (existing.has(`ds_${ds.id}_${seq}`)) seq += 1;
      const id = `ds_${ds.id}_${seq}`;
      const firstOp = ds.operations?.[0];
      const params: Record<string, string> = {};
      for (const p of firstOp?.params ?? []) params[p.name] = "";
      const config: EditableNodeConfig = {
        id,
        type: "data_source",
        name: ds.name || ds.id,
        source: ds.id,
        operation: firstOp?.name,
        params,
        output_key: `${ds.id}_result`,
      };
      setNodes((nds) => [...nds, configToRFNode(config, viewportCenter(), readonly ? undefined : deleteNodeCb)]);
      setSelectedNodeId(id);
    },
    [nodes, setNodes, viewportCenter, deleteNodeCb, readonly],
  );

  /** An event is a topic to subscribe to, so it lands as a trigger node. */
  const handleAddEventNode = useCallback(
    (ev: EventDefinition) => {
      const existing = new Set(nodes.map((n) => n.id));
      let seq = 1;
      while (existing.has(`ev_${ev.id}_${seq}`)) seq += 1;
      const id = `ev_${ev.id}_${seq}`;
      const config: EditableNodeConfig = {
        id,
        type: "pubsub",
        name: ev.name || ev.id,
        event: ev.id,
        output_key: "event",
      };
      setNodes((nds) => [...nds, configToRFNode(config, viewportCenter(), readonly ? undefined : deleteNodeCb)]);
      setSelectedNodeId(id);
    },
    [nodes, setNodes, viewportCenter, deleteNodeCb, readonly],
  );

  // ── Slack addon handlers ──────────────────────────────────────────────────

  const [slackHoverTarget, setSlackHoverTarget] = React.useState<string | null>(null);
  const ATTACH_THRESHOLD = 80;
  const AGENT_TYPES = ["langgraph-agent", "claude-agent"];

  const handleAddSlackAddon = React.useCallback(() => {
    const pos = viewportCenter();
    const addonId = `slack-${Date.now()}`;
    const newNode: Node = {
      id: addonId,
      type: "slack-addon",
      position: pos,
      data: { type: "slack-addon", name: "Slack", id: addonId, attachedTo: null },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes.length, setNodes]);

  const handleAgentNodeDrag = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type === "slack-addon" || draggedNode.type === "pvc-addon" || draggedNode.type === "mcp-addon" || draggedNode.type === "tools-addon" || draggedNode.type === "s3-addon" || draggedNode.type === "datasource-addon") return;
    // Co-move any attached slack/pvc/mcp addon — sort by current y so order is stable
    setNodes((nds) => {
      const attached = nds
        .filter((n) => (n.data as Record<string, unknown>).attachedTo === draggedNode.id)
        .sort((a, b) => a.position.y - b.position.y);
      const attachedIds = new Map(attached.map((n, i) => [n.id, i]));
      return nds.map((n) => {
        const idx = attachedIds.get(n.id);
        if (idx !== undefined) {
          return { ...n, position: { x: draggedNode.position.x, y: draggedNode.position.y + (idx + 1) * 48 } };
        }
        return n;
      });
    });
  }, [setNodes]);

  const handleSlackNodeDrag = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "slack-addon") return;
    const agentNodes = nodes.filter((n) => AGENT_TYPES.includes((n.data as Record<string, unknown>)?.type as string));
    let closest: string | null = null;
    let minDist = ATTACH_THRESHOLD;
    for (const agent of agentNodes) {
      const dx = draggedNode.position.x - agent.position.x;
      const dy = draggedNode.position.y - agent.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closest = agent.id; }
    }
    setSlackHoverTarget(closest);
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, _slackHover: n.id === closest },
    })));
  }, [nodes, AGENT_TYPES, ATTACH_THRESHOLD]);

  const handleSlackNodeDragStop = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "slack-addon") return;
    const prevAttached = (draggedNode.data as Record<string, unknown>)?.attachedTo as string | null;
    if (slackHoverTarget) {
      const agentNode = nodes.find((n) => n.id === slackHoverTarget);
      if (agentNode) {
        const otherAddons = nodes.filter((n) => (n.data as Record<string, unknown>).attachedTo === slackHoverTarget && n.id !== draggedNode.id).length;
        const snapPos = { x: agentNode.position.x, y: agentNode.position.y + (otherAddons + 1) * 48 };
        setNodes((nds) => nds.map((n) => {
          if (n.id === draggedNode.id) return { ...n, position: snapPos, data: { ...n.data, attachedTo: slackHoverTarget, _slackHover: false } };
          if (n.id === slackHoverTarget) return { ...n, data: { ...n.data, slack_notifications: true, _slackHover: false } };
          return { ...n, data: { ...n.data, _slackHover: false } };
        }));
        unfoldAgent(slackHoverTarget);
      }
    } else if (prevAttached) {
      setNodes((nds) => nds.map((n) => {
        if (n.id === draggedNode.id) return { ...n, data: { ...n.data, attachedTo: null, _slackHover: false } };
        if (n.id === prevAttached) return { ...n, data: { ...n.data, slack_notifications: false, _slackHover: false } };
        return { ...n, data: { ...n.data, _slackHover: false } };
      }));
    } else {
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, _slackHover: false } })));
    }
    setSlackHoverTarget(null);
  }, [slackHoverTarget, nodes, setNodes, unfoldAgent]);

  // ── PVC addon handlers ────────────────────────────────────────────────────

  const [pvcHoverTarget, setPvcHoverTarget] = React.useState<string | null>(null);

  const handleAddPvcAddon = React.useCallback(() => {
    const pos = viewportCenter();
    const addonId = `pvc-${Date.now()}`;
    const newNode: Node = {
      id: addonId,
      type: "pvc-addon",
      position: pos,
      data: { type: "pvc-addon", name: "PVC", id: addonId, attachedTo: null, pvc_name: "", pvc_mount_point: "", pvc_ttl: "1h" },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes.length, setNodes]);

  const handlePvcNodeDrag = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "pvc-addon") return;
    const agentNodes = nodes.filter((n) => AGENT_TYPES.includes((n.data as Record<string, unknown>)?.type as string));
    let closest: string | null = null;
    let minDist = ATTACH_THRESHOLD;
    for (const agent of agentNodes) {
      const dx = draggedNode.position.x - agent.position.x;
      const dy = draggedNode.position.y - agent.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closest = agent.id; }
    }
    setPvcHoverTarget(closest);
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, _pvcHover: n.id === closest },
    })));
  }, [nodes, AGENT_TYPES, ATTACH_THRESHOLD]);

  const handlePvcNodeDragStop = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "pvc-addon") return;
    const prevAttached = (draggedNode.data as Record<string, unknown>)?.attachedTo as string | null;
    if (pvcHoverTarget) {
      const agentNode = nodes.find((n) => n.id === pvcHoverTarget);
      if (agentNode) {
        const otherAddons = nodes.filter((n) => (n.data as Record<string, unknown>).attachedTo === pvcHoverTarget && n.id !== draggedNode.id).length;
        const snapPos = { x: agentNode.position.x, y: agentNode.position.y + (otherAddons + 1) * 48 };
        setNodes((nds) => nds.map((n) => {
          if (n.id === draggedNode.id) return { ...n, position: snapPos, data: { ...n.data, attachedTo: pvcHoverTarget, _pvcHover: false } };
          if (n.id === pvcHoverTarget) return { ...n, data: { ...n.data, _pvcHover: false } };
          return { ...n, data: { ...n.data, _pvcHover: false } };
        }));
        unfoldAgent(pvcHoverTarget);
      }
    } else if (prevAttached) {
      setNodes((nds) => nds.map((n) => {
        if (n.id === draggedNode.id) return { ...n, data: { ...n.data, attachedTo: null, _pvcHover: false } };
        return { ...n, data: { ...n.data, _pvcHover: false } };
      }));
    } else {
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, _pvcHover: false } })));
    }
    setPvcHoverTarget(null);
  }, [pvcHoverTarget, nodes, setNodes, unfoldAgent]);


  // ── S3 addon handlers ─────────────────────────────────────────────────────

  const [s3HoverTarget, setS3HoverTarget] = React.useState<string | null>(null);

  const handleAddS3Addon = React.useCallback(() => {
    const pos = viewportCenter();
    const addonId = `s3-${Date.now()}`;
    const newNode: Node = {
      id: addonId,
      type: "s3-addon",
      position: pos,
      data: { type: "s3-addon", name: "S3 Storage", id: addonId, attachedTo: null, s3_bucket: "", s3_path: "" },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes.length, setNodes]);

  const handleS3NodeDrag = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "s3-addon") return;
    const agentNodes = nodes.filter((n) => AGENT_TYPES.includes((n.data as Record<string, unknown>)?.type as string));
    let closest: string | null = null;
    let minDist = ATTACH_THRESHOLD;
    for (const agent of agentNodes) {
      const dx = draggedNode.position.x - agent.position.x;
      const dy = draggedNode.position.y - agent.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closest = agent.id; }
    }
    setS3HoverTarget(closest);
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, _s3Hover: n.id === closest },
    })));
  }, [nodes, AGENT_TYPES, ATTACH_THRESHOLD]);

  const handleS3NodeDragStop = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "s3-addon") return;
    const prevAttached = (draggedNode.data as Record<string, unknown>)?.attachedTo as string | null;
    if (s3HoverTarget) {
      const agentNode = nodes.find((n) => n.id === s3HoverTarget);
      if (agentNode) {
        const otherAddons = nodes.filter((n) => (n.data as Record<string, unknown>).attachedTo === s3HoverTarget && n.id !== draggedNode.id).length;
        const snapPos = { x: agentNode.position.x, y: agentNode.position.y + (otherAddons + 1) * 48 };
        setNodes((nds) => nds.map((n) => {
          if (n.id === draggedNode.id) return { ...n, position: snapPos, data: { ...n.data, attachedTo: s3HoverTarget, _s3Hover: false } };
          if (n.id === s3HoverTarget) return { ...n, data: { ...n.data, _s3Hover: false } };
          return { ...n, data: { ...n.data, _s3Hover: false } };
        }));
        unfoldAgent(s3HoverTarget);
      }
    } else if (prevAttached) {
      setNodes((nds) => nds.map((n) => {
        if (n.id === draggedNode.id) return { ...n, data: { ...n.data, attachedTo: null, _s3Hover: false } };
        return { ...n, data: { ...n.data, _s3Hover: false } };
      }));
    } else {
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, _s3Hover: false } })));
    }
    setS3HoverTarget(null);
  }, [s3HoverTarget, nodes, setNodes, unfoldAgent]);

  // ── MCP addon handlers ────────────────────────────────────────────────────

  const [mcpHoverTarget, setMcpHoverTarget] = React.useState<string | null>(null);

  const handleAddMcpAddon = React.useCallback(() => {
    const pos = viewportCenter();
    const addonId = `mcp-${Date.now()}`;
    const newNode: Node = {
      id: addonId,
      type: "mcp-addon",
      position: pos,
      data: { type: "mcp-addon", name: "MCP", id: addonId, attachedTo: null, servers: {} },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes.length, setNodes]);

  const handleMcpNodeDrag = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "mcp-addon") return;
    const agentNodes = nodes.filter((n) => AGENT_TYPES.includes((n.data as Record<string, unknown>)?.type as string));
    let closest: string | null = null;
    let minDist = ATTACH_THRESHOLD;
    for (const agent of agentNodes) {
      const dx = draggedNode.position.x - agent.position.x;
      const dy = draggedNode.position.y - agent.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closest = agent.id; }
    }
    setMcpHoverTarget(closest);
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, _mcpHover: n.id === closest },
    })));
  }, [nodes, AGENT_TYPES, ATTACH_THRESHOLD]);

  const handleMcpNodeDragStop = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "mcp-addon") return;
    const prevAttached = (draggedNode.data as Record<string, unknown>)?.attachedTo as string | null;
    if (mcpHoverTarget) {
      const agentNode = nodes.find((n) => n.id === mcpHoverTarget);
      if (agentNode) {
        const otherAddons = nodes.filter((n) => (n.data as Record<string, unknown>).attachedTo === mcpHoverTarget && n.id !== draggedNode.id).length;
        const snapPos = { x: agentNode.position.x, y: agentNode.position.y + (otherAddons + 1) * 48 };
        setNodes((nds) => nds.map((n) => {
          if (n.id === draggedNode.id) return { ...n, position: snapPos, data: { ...n.data, attachedTo: mcpHoverTarget, _mcpHover: false } };
          if (n.id === mcpHoverTarget) return { ...n, data: { ...n.data, _mcpHover: false } };
          return { ...n, data: { ...n.data, _mcpHover: false } };
        }));
        unfoldAgent(mcpHoverTarget);
      }
    } else if (prevAttached) {
      setNodes((nds) => nds.map((n) => {
        if (n.id === draggedNode.id) return { ...n, data: { ...n.data, attachedTo: null, _mcpHover: false } };
        return { ...n, data: { ...n.data, _mcpHover: false } };
      }));
    } else {
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, _mcpHover: false } })));
    }
    setMcpHoverTarget(null);
  }, [mcpHoverTarget, nodes, setNodes, unfoldAgent]);

  const handleAddToolsAddon = React.useCallback(() => {
    const pos = viewportCenter();
    const addonId = `tools-${Date.now()}`;
    const newNode: Node = {
      id: addonId,
      type: "tools-addon",
      position: pos,
      data: { type: "tools-addon", name: "Tools", id: addonId, attachedTo: null, tools: {} },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes.length, setNodes]);

  const [toolsHoverTarget, setToolsHoverTarget] = React.useState<string | null>(null);

  const handleToolsNodeDrag = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "tools-addon") return;
    const agentNodes = nodes.filter((n) => AGENT_TYPES.includes((n.data as Record<string, unknown>)?.type as string));
    let closest: string | null = null;
    let minDist = ATTACH_THRESHOLD;
    for (const agent of agentNodes) {
      const dx = draggedNode.position.x - agent.position.x;
      const dy = draggedNode.position.y - agent.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closest = agent.id; }
    }
    setToolsHoverTarget(closest);
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, _toolsHover: n.id === closest },
    })));
  }, [nodes, AGENT_TYPES, ATTACH_THRESHOLD]);

  const handleToolsNodeDragStop = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "tools-addon") return;
    const prevAttached = (draggedNode.data as Record<string, unknown>)?.attachedTo as string | null;
    if (toolsHoverTarget) {
      const agentNode = nodes.find((n) => n.id === toolsHoverTarget);
      if (agentNode) {
        const otherAddons = nodes.filter((n) => (n.data as Record<string, unknown>).attachedTo === toolsHoverTarget && n.id !== draggedNode.id).length;
        const snapPos = { x: agentNode.position.x, y: agentNode.position.y + (otherAddons + 1) * 48 };
        setNodes((nds) => nds.map((n) => {
          if (n.id === draggedNode.id) return { ...n, position: snapPos, data: { ...n.data, attachedTo: toolsHoverTarget, _toolsHover: false } };
          if (n.id === toolsHoverTarget) return { ...n, data: { ...n.data, _toolsHover: false } };
          return { ...n, data: { ...n.data, _toolsHover: false } };
        }));
        unfoldAgent(toolsHoverTarget);
      }
    } else if (prevAttached) {
      setNodes((nds) => nds.map((n) => {
        if (n.id === draggedNode.id) return { ...n, data: { ...n.data, attachedTo: null, _toolsHover: false } };
        return { ...n, data: { ...n.data, _toolsHover: false } };
      }));
    } else {
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, _toolsHover: false } })));
    }
    setToolsHoverTarget(null);
  }, [toolsHoverTarget, nodes, setNodes, unfoldAgent]);


  // ── Datasource addon handlers ─────────────────────────────────────────────

  const handleAddDatasourceAddon = React.useCallback(() => {
    const pos = viewportCenter();
    const addonId = `datasource-${Date.now()}`;
    const newNode: Node = {
      id: addonId,
      type: "datasource-addon",
      position: pos,
      // No datasource and no operations yet: an addon grants nothing until the
      // operator picks both, which is the right default for a grant.
      data: {
        type: "datasource-addon", name: "Datasource", id: addonId,
        attachedTo: null, datasource_id: "", allowed_operations: [],
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes.length, setNodes]);

  const [datasourceHoverTarget, setDatasourceHoverTarget] = React.useState<string | null>(null);

  const handleDatasourceNodeDrag = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "datasource-addon") return;
    const agentNodes = nodes.filter((n) => AGENT_TYPES.includes((n.data as Record<string, unknown>)?.type as string));
    let closest: string | null = null;
    let minDist = ATTACH_THRESHOLD;
    for (const agent of agentNodes) {
      const dx = draggedNode.position.x - agent.position.x;
      const dy = draggedNode.position.y - agent.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closest = agent.id; }
    }
    setDatasourceHoverTarget(closest);
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, _datasourceHover: n.id === closest },
    })));
  }, [nodes, AGENT_TYPES, ATTACH_THRESHOLD]);

  const handleDatasourceNodeDragStop = React.useCallback((_: React.MouseEvent, draggedNode: Node) => {
    if (draggedNode.type !== "datasource-addon") return;
    const prevAttached = (draggedNode.data as Record<string, unknown>)?.attachedTo as string | null;
    if (datasourceHoverTarget) {
      const agentNode = nodes.find((n) => n.id === datasourceHoverTarget);
      if (agentNode) {
        const otherAddons = nodes.filter((n) => (n.data as Record<string, unknown>).attachedTo === datasourceHoverTarget && n.id !== draggedNode.id).length;
        const snapPos = { x: agentNode.position.x, y: agentNode.position.y + (otherAddons + 1) * 48 };
        setNodes((nds) => nds.map((n) => {
          if (n.id === draggedNode.id) return { ...n, position: snapPos, data: { ...n.data, attachedTo: datasourceHoverTarget, _datasourceHover: false } };
          if (n.id === datasourceHoverTarget) return { ...n, data: { ...n.data, _datasourceHover: false } };
          return { ...n, data: { ...n.data, _datasourceHover: false } };
        }));
        unfoldAgent(datasourceHoverTarget);
      }
    } else if (prevAttached) {
      setNodes((nds) => nds.map((n) => {
        if (n.id === draggedNode.id) return { ...n, data: { ...n.data, attachedTo: null, _datasourceHover: false } };
        return { ...n, data: { ...n.data, _datasourceHover: false } };
      }));
    } else {
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, _datasourceHover: false } })));
    }
    setDatasourceHoverTarget(null);
  }, [datasourceHoverTarget, nodes, setNodes, unfoldAgent]);


  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge({
        ...connection,
        type: "editableEdge",
        style: { stroke: "#475569", strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#475569" },
      }, eds)),
    [setEdges],
  );

  const onEdgeClick = useCallback(
    (evt: React.MouseEvent, edge: Edge) => {
      const d = edge.data as { condition?: string; wait_seconds?: number } | undefined;
      setEdgeEditor({
        edgeId: edge.id,
        condition: d?.condition ?? "",
        waitSeconds: typeof d?.wait_seconds === "number" ? String(d.wait_seconds) : "",
        x: evt.clientX,
        y: evt.clientY,
      });
    },
    [],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setEdgeEditor(null);
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (mode === "yaml") {
      try {
        const parsed = yamlToWorkflow(yamlText, {
          id: workflowId, name: workflowName,
          description: workflowDesc || undefined, isNew: workflow.isNew,
        });
        onSave?.(parsed);
      } catch (err) {
        setYamlError(err instanceof Error ? err.message : "Invalid YAML");
      }
      return;
    }
    const layout: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) layout[n.id] = n.position;

    onSave?.({
      id:           workflowId.trim() || workflow.id,
      name:         workflowName.trim() || workflow.name,
      description:  workflowDesc.trim() || undefined,
      nodes:        nodes.map(rfNodeToConfig),
      edges:        edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        data: e.data as { condition?: string; wait_seconds?: number; waypoints?: Array<{ x: number; y: number }> } | undefined,
      })),
      isNew:        workflow.isNew,
      layout,
      use_meta_llm: useMetaLlm,
      use_storage: useStorage,
    });
  }, [mode, yamlText, workflow, workflowId, workflowName, workflowDesc, nodes, edges, onSave, useMetaLlm, useStorage]);

  // ── Auto-save when a node is added ────────────────────────────────────────
  //
  // Adding a node is the point where the canvas gains something worth keeping,
  // so it is persisted straight away rather than waiting for the Save button —
  // the parent routes the first save to a create and the rest to updates, and
  // a failure only sets `saveError`, leaving the canvas untouched.
  //
  // Keyed on the node count and fired from an effect: calling handleSave() from
  // inside an add handler would serialise the canvas as it was *before* the
  // setNodes commit.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const lastAutoSavedCount = useRef(nodes.length);
  useEffect(() => {
    if (readonly || mode === "yaml") {
      lastAutoSavedCount.current = nodes.length;
      return;
    }
    if (nodes.length <= lastAutoSavedCount.current) {
      lastAutoSavedCount.current = nodes.length;
      return;
    }
    lastAutoSavedCount.current = nodes.length;
    saveRef.current();
  }, [nodes.length, readonly, mode]);

  // ── Render ────────────────────────────────────────────────────────────────

  const inYaml = mode === "yaml";

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* ── Header ── */}
      {!hideHeader && <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900/60 shrink-0">
        <button onClick={onCancel}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors shrink-0">
          <ArrowLeft className="w-3.5 h-3.5" />
          Workflows
        </button>
        <div className="w-px h-4 bg-slate-700 shrink-0" />

        {/* Workflow ID (slug) */}
        {workflow.isNew && (
          <>
            <input type="text" value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, ""))}
              disabled={inYaml}
              className={clsx(
                "w-36 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-slate-500",
                inYaml && "opacity-40 cursor-not-allowed",
              )}
              placeholder="workflow-id" />
            <div className="w-px h-4 bg-slate-700 shrink-0" />
          </>
        )}

        {/* Name */}
        <input type="text" value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          disabled={readonly || inYaml}
          className={clsx(
            "flex-1 bg-transparent text-white text-sm font-semibold focus:outline-none placeholder-slate-600 min-w-0",
            (readonly || inYaml) && "cursor-default opacity-60",
          )}
          placeholder="Workflow name…" />

        {/* Description */}
        <input type="text" value={workflowDesc}
          onChange={(e) => setWorkflowDesc(e.target.value)}
          disabled={readonly || inYaml}
          className={clsx(
            "w-56 shrink-0 bg-transparent text-slate-400 text-xs focus:outline-none placeholder-slate-600",
            (readonly || inYaml) && "cursor-default opacity-60",
          )}
          placeholder="Short description…" />

        {/* Error */}
        {saveError && (
          <span className="text-xs text-red-400 shrink-0 max-w-[160px] truncate" title={saveError}>
            {saveError}
          </span>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {/* Visual / YAML toggle */}
          {!readonly && (
            <div className="flex items-center rounded-lg overflow-hidden border border-slate-700 text-[11px] font-medium">
              <button
                onClick={inYaml ? switchToVisual : undefined}
                className={clsx(
                  "px-2.5 py-1.5 transition-colors",
                  !inYaml ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200",
                )}
              >
                Visual
              </button>
              <button
                onClick={!inYaml ? switchToYaml : undefined}
                className={clsx(
                  "flex items-center gap-1 px-2.5 py-1.5 transition-colors",
                  inYaml ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200",
                )}
              >
                <Code className="w-3 h-3" />
                YAML
              </button>
            </div>
          )}

          <button onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            {readonly ? "Close" : "Cancel"}
          </button>
          {readonly ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-xs font-medium">
              <Lock className="w-3.5 h-3.5" />
              Read-only
            </span>
          ) : (
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors">
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>}

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {inYaml ? (
          /* Full-width YAML editor */
          <YamlEditor
            value={yamlText}
            onChange={setYamlText}
            error={yamlError}
            readonly={readonly}
          />
        ) : (
          /* Visual graph editor */
          <>
            {!readonly && <NodePalette onAdd={handleAddNode} onAddAgent={handleAddAgentNode} onAddDatasource={handleAddDatasourceNode} onAddEvent={handleAddEventNode} onAddAddon={(kind) => { if (kind === "slack") handleAddSlackAddon(); else if (kind === "pvc") handleAddPvcAddon(); else if (kind === "mcp") handleAddMcpAddon(); else if (kind === "tools") handleAddToolsAddon(); else if (kind === "s3") handleAddS3Addon(); else if (kind === "datasource") handleAddDatasourceAddon(); }} />}

            <div className="flex-1 relative">
              <BaseCanvas
                nodes={displayNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={readonly ? undefined : onConnect}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onEdgeClick={readonly ? undefined : onEdgeClick}
                onNodeDrag={readonly ? undefined : (e, n) => { handleAgentNodeDrag(e, n); handleSlackNodeDrag(e, n); handlePvcNodeDrag(e, n); handleMcpNodeDrag(e, n); handleToolsNodeDrag(e, n); handleS3NodeDrag(e, n); handleDatasourceNodeDrag(e, n); }}
                onNodeDragStop={readonly ? undefined : (e, n) => { handleSlackNodeDragStop(e, n); handlePvcNodeDragStop(e, n); handleMcpNodeDragStop(e, n); handleToolsNodeDragStop(e, n); handleS3NodeDragStop(e, n); handleDatasourceNodeDragStop(e, n); }}
                nodesDraggable={!readonly}
                nodesConnectable={!readonly}
                elementsSelectable
                snapToGrid={!readonly}
                deleteKeyCode={readonly ? null : "Delete"}
                isValidConnection={readonly ? undefined : isValidConnection}
                readonly={!!readonly}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                extraNodeTypes={{ "slack-addon": SlackAddonNode, "pvc-addon": PvcAddonNode, "mcp-addon": McpAddonNode, "tools-addon": ToolsAddonNode, "s3-addon": S3AddonNode, "datasource-addon": DatasourceAddonNode }}
              >
                {!readonly && (
                  <Panel position="bottom-center" className="mb-2">
                    <p className="text-[10px] text-slate-600 bg-slate-900/80 px-3 py-1 rounded-full border border-slate-800">
                      Drag handles to connect · Click edge to edit/delete · Delete key removes selected
                    </p>
                  </Panel>
                )}
              </BaseCanvas>
            </div>

            {edgeEditor && !readonly && (() => {
              const saveEdge = () => {
                const cond = edgeEditor.condition.trim();
                const waitRaw = edgeEditor.waitSeconds.trim();
                const waitNum = waitRaw === "" ? undefined : Number(waitRaw);
                const wait = typeof waitNum === "number" && Number.isFinite(waitNum) && waitNum > 0
                  ? waitNum
                  : undefined;
                const colored = cond || wait !== undefined;
                setEdges((eds) => eds.map((ed) =>
                  ed.id === edgeEditor.edgeId
                    ? {
                        ...ed,
                        data: {
                          ...(ed.data as object),
                          condition: cond || undefined,
                          wait_seconds: wait,
                        },
                        style: { stroke: colored ? "#818cf8" : "#475569", strokeWidth: 1.5 },
                        markerEnd: { type: MarkerType.ArrowClosed, color: colored ? "#818cf8" : "#475569" },
                      }
                    : ed,
                ));
                setEdgeEditor(null);
              };
              return (
              <div
                className="fixed z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-3 flex flex-col gap-2 w-56"
                style={{ left: edgeEditor.x - 112, top: edgeEditor.y + 8 }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Connection label
                  </p>
                  <button
                    className="text-slate-500 hover:text-slate-300 transition-colors"
                    title="Close"
                    onClick={() => setEdgeEditor(null)}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
                <input
                  type="text"
                  value={edgeEditor.condition}
                  onChange={(e) => setEdgeEditor((prev) => prev ? { ...prev, condition: e.target.value } : null)}
                  placeholder="condition, e.g. passed"
                  autoFocus
                  className="px-2 py-1 rounded bg-slate-900 border border-slate-600 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdge();
                    if (e.key === "Escape") setEdgeEditor(null);
                  }}
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={edgeEditor.waitSeconds}
                  onChange={(e) => setEdgeEditor((prev) => prev ? { ...prev, waitSeconds: e.target.value } : null)}
                  placeholder="wait seconds (optional)"
                  className="px-2 py-1 rounded bg-slate-900 border border-slate-600 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdge();
                    if (e.key === "Escape") setEdgeEditor(null);
                  }}
                />
                <div className="flex gap-1.5 justify-end">
                  <button
                    title="Save"
                    className="p-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                    onClick={saveEdge}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.5 6.5l3 3 6-7"/>
                    </svg>
                  </button>
                  <button
                    title="Close"
                    className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                    onClick={() => setEdgeEditor(null)}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                  <button
                    title="Remove connection"
                    className="p-1.5 rounded bg-red-950/60 hover:bg-red-900/60 text-red-400 transition-colors"
                    onClick={() => {
                      setEdges((eds) => eds.filter((e) => e.id !== edgeEditor.edgeId));
                      setEdgeEditor(null);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h8M5 3V2h2v1M4.5 5v4M7.5 5v4M3 3l.5 7h5l.5-7"/>
                    </svg>
                  </button>
                </div>
              </div>
              );
            })()}

            {(pinnedPanel || selectedNode !== null) && (
              <NodePropertiesPanel
                node={selectedNode}
                onChange={handleNodeChange}
                onDelete={handleNodeDelete}
                readonly={readonly}
                pinned={pinnedPanel}
                onTogglePin={togglePin}
                edges={edges.map(e => ({
                  id: e.id,
                  source: e.source as string,
                  target: e.target as string,
                  data: e.data as EditableWorkflowDefinition["edges"][number]["data"],
                }))}
                onEdgeConditionChange={(edgeId, condition) => {
                  setEdges(prev => prev.map(e =>
                    e.id === edgeId
                      ? { ...e, data: { ...(e.data as Record<string, unknown> ?? {}), condition: condition ?? undefined } }
                      : e
                  ));
                }}
                nodeById={(id) => nodes.find(n => n.id === id)?.data as EditableNodeConfig | undefined}
                allNodes={nodes.map(n => n.data as unknown as EditableNodeConfig)}
                workflowName={workflowName}
                workflowDesc={workflowDesc}
                useMetaLlm={useMetaLlm}
                useStorage={useStorage}
                onWorkflowNameChange={setWorkflowName}
                onWorkflowDescChange={setWorkflowDesc}
                onUseMetaLlmChange={setUseMetaLlm}
                onUseStorageChange={setUseStorage}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function WorkflowEditor(props: WorkflowEditorProps) {
  // A dynamic workflow has no graph to draw: its agents are chosen at run
  // time. The designer shows the orchestration config instead.
  if (isDynamicWorkflow(props.workflow)) {
    return <DynamicWorkflowEditor {...props} />;
  }
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
