"use client";

import React, { useMemo, useEffect, useCallback } from "react";
import {
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import type {
  EditableWorkflowDefinition,
  WorkflowRun,
  WorkflowStepDefinition,
} from "@/lib/types";
import { configToRFNode, snakePosition, isAddonNodeType } from "./utils/nodeUtils";
import { deriveNodeState, shouldAnimateEdge } from "./utils/runState";
import { BaseCanvas } from "./BaseCanvas";

function computeTokenTotal(step: WorkflowStepDefinition, run: WorkflowRun): number | undefined {
  if (step.type !== "agent") return undefined;
  const io = run.intermediate_outputs as Record<string, unknown> | undefined;
  const usage =
    (io?.[`_agent_token_usage_${step.id}`] as { total_tokens?: number } | undefined)
    ?? (deriveNodeState(step, run) === "active"
      ? (io?._live_token_usage as { total_tokens?: number } | undefined)
      : undefined);
  return usage?.total_tokens;
}

// Post-compact meta-LLM usage for this step, kept as a separate bucket from
// the agent's own token total above — never merged.
function computeMetaTokenTotal(step: WorkflowStepDefinition, run: WorkflowRun): number | undefined {
  if (step.type !== "agent") return undefined;
  const io = run.intermediate_outputs as Record<string, unknown> | undefined;
  const usage = io?.[`_meta_token_usage_${step.id}`] as { total_tokens?: number } | undefined;
  return usage?.total_tokens;
}

function getActiveMcpServers(run: WorkflowRun): string[] {
  const io = run.intermediate_outputs as Record<string, unknown> | undefined;
  return (io?._active_mcp_servers as string[] | undefined) ?? [];
}

function getActiveTools(run: WorkflowRun): string[] {
  const io = run.intermediate_outputs as Record<string, unknown> | undefined;
  return (io?._active_tools as string[] | undefined) ?? [];
}

// Whether an addon node should be hidden in run mode. mcp/tools addons are
// revealed only while one of their configured targets is live; slack/pvc/s3
// addons are always hidden in run mode.
function computeAddonHidden(
  node: Node,
  activeMcp: string[],
  activeTools: string[],
): boolean {
  if (node.type === "mcp-addon") {
    const servers = (node.data.servers ?? {}) as Record<string, boolean>;
    return !activeMcp.some((s) => servers[s] === true);
  }
  if (node.type === "tools-addon") {
    const tools = (node.data.tools ?? {}) as Record<string, boolean>;
    return !activeTools.some((t) => tools[t] === true);
  }
  return true;
}

// ─── Inner component (must be inside ReactFlowProvider) ───────────────────────

interface WorkflowRunCanvasProps {
  workflow: EditableWorkflowDefinition;
  run: WorkflowRun;
  selectedStepId?: string | null;
  onStepClick?: (stepId: string | null) => void;
  onS3AddonClick?: (p: { agentId: string; bucket: string; path: string }) => void;
}

function WorkflowRunCanvasInner({ workflow, run, onStepClick, onS3AddonClick }: WorkflowRunCanvasProps) {
  const { setCenter } = useReactFlow();

  const initialNodes = useMemo<Node[]>(() => {
    const runSteps = run.steps ?? [];
    const activeMcp = getActiveMcpServers(run);
    const activeTools = getActiveTools(run);
    // Count of addon nodes attached to each agent (drives the count badge).
    const addonCounts = new Map<string, number>();
    for (const n of workflow.nodes) {
      const t = n.type as string;
      const attachedTo = (n as { attachedTo?: string }).attachedTo;
      if (isAddonNodeType(t) && attachedTo) {
        addonCounts.set(attachedTo, (addonCounts.get(attachedTo) ?? 0) + 1);
      }
    }
    return workflow.nodes.map((n, i) => {
      let rfNode = configToRFNode(n, workflow.layout?.[n.id] ?? snakePosition(i), undefined);
      const step = runSteps.find(s => s.id === n.id);
      if (step) {
        const state = deriveNodeState(step, run, n.type as string);
        rfNode.data = {
          ...rfNode.data,
          runState: state,
          tokenTotal: computeTokenTotal(step, run),
          metaTotal: computeMetaTokenTotal(step, run),
        };
      }
      const _count = addonCounts.get(n.id);
      if (_count) {
        rfNode = { ...rfNode, data: { ...rfNode.data, _addonCount: _count } };
      }
      if (rfNode.type === "mcp-addon") {
        rfNode = { ...rfNode, data: { ...rfNode.data, activeMcpServers: activeMcp } };
      }
      if (rfNode.type === "tools-addon") {
        rfNode = { ...rfNode, data: { ...rfNode.data, activeTools } };
      }
      if (isAddonNodeType(rfNode.type as string)) {
        rfNode = { ...rfNode, hidden: computeAddonHidden(rfNode, activeMcp, activeTools) };
      }
      return rfNode;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialEdges = useMemo<Edge[]>(() =>
    workflow.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "editableEdge",
      data: e.data,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

  // Sync run state updates as run progresses
  useEffect(() => {
    const runSteps = run.steps ?? [];
    const activeMcp = getActiveMcpServers(run);
    const activeTools = getActiveTools(run);
    setNodes(prev => prev.map(n => {
      if (n.type === "mcp-addon") {
        const prev2 = (n.data.activeMcpServers as string[] | undefined) ?? [];
        const newHidden = computeAddonHidden(n, activeMcp, activeTools);
        if (JSON.stringify(prev2) === JSON.stringify(activeMcp) && n.hidden === newHidden) return n;
        return { ...n, hidden: newHidden, data: { ...n.data, activeMcpServers: activeMcp } };
      }
      if (n.type === "tools-addon") {
        const prev2 = (n.data.activeTools as string[] | undefined) ?? [];
        const newHidden = computeAddonHidden(n, activeMcp, activeTools);
        if (JSON.stringify(prev2) === JSON.stringify(activeTools) && n.hidden === newHidden) return n;
        return { ...n, hidden: newHidden, data: { ...n.data, activeTools } };
      }
      const step = runSteps.find(s => s.id === n.id);
      if (!step) return n;
      const newState = deriveNodeState(step, run, n.data.stepType as string | undefined);
      const newTokenTotal = computeTokenTotal(step, run);
      const newMetaTotal = computeMetaTokenTotal(step, run);
      if (
        n.data.runState === newState
        && n.data.tokenTotal === newTokenTotal
        && n.data.metaTotal === newMetaTotal
      ) return n;
      return { ...n, data: { ...n.data, runState: newState, tokenTotal: newTokenTotal, metaTotal: newMetaTotal } };
    }));
  }, [run, setNodes]);

  // Map node id → position in workflow.nodes (used to detect backward/loop edges).
  const nodeIndexMap = useMemo(
    () => new Map(workflow.nodes.map((n, i) => [n.id, i])),
    [workflow.nodes],
  );

  // Animate the edges the run actually traversed. See shouldAnimateEdge.
  useEffect(() => {
    const nodeStateMap = new Map(nodes.map(n => [n.id as string, n.data.runState as string]));
    setEdges(prev => prev.map(e => {
      const isForward =
        (nodeIndexMap.get(e.target as string) ?? 0) >
        (nodeIndexMap.get(e.source as string) ?? 0);
      const animate = shouldAnimateEdge(
        nodeStateMap.get(e.source as string),
        nodeStateMap.get(e.target as string),
        isForward,
      );
      if (e.animated === animate) return e;
      return { ...e, animated: animate };
    }));
  }, [nodes, setEdges, nodeIndexMap]);

  // Auto-center on active node
  const activeNodeId = useMemo(() =>
    nodes.find(n => n.data.runState === "active")?.id ?? null,
    [nodes]
  );

  useEffect(() => {
    if (!activeNodeId) return;
    const node = nodes.find(n => n.id === activeNodeId);
    if (!node) return;
    const id = setTimeout(() =>
      setCenter(node.position.x + 88, node.position.y + 20, { zoom: 1, duration: 600 }),
      100
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeId, setCenter]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "s3-addon") {
      const attachedNode = nodes.find(n => n.id === node.data.attachedTo);
      const agentId = attachedNode?.data?.agent_id as string | undefined;
      if (agentId) {
        onS3AddonClick?.({
          agentId,
          bucket: node.data.s3_bucket as string,
          path: node.data.s3_path as string,
        });
        return;
      }
    }
    onStepClick?.(node.id);
  }, [onStepClick, onS3AddonClick, nodes]);

  const onPaneClick = useCallback(() => {
    onStepClick?.(null);
  }, [onStepClick]);

  return (
    <BaseCanvas
      nodes={nodes}
      edges={edges}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      readonly
    />
  );
}

// ─── Public export (wraps with ReactFlowProvider) ─────────────────────────────

export function WorkflowRunCanvas(props: WorkflowRunCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowRunCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
