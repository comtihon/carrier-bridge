"use client";

import React, { type ReactNode } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeTypes,
  type EdgeTypes,
  type IsValidConnection,
  type FitViewOptions,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ReadonlyContext } from "./ReadonlyContext";
import { EditableEdge } from "./edges/EditableEdge";
import { WorkflowStepNode, SharedParallelNode, SharedSwitchNode, SharedJoinNode } from "./nodes";
import { SlackAddonNode } from "./nodes/SlackAddonNode";
import { PvcAddonNode } from "./nodes/PvcAddonNode";
import { McpAddonNode } from "./nodes/McpAddonNode";
import { ToolsAddonNode } from "./nodes/ToolsAddonNode";
import { S3AddonNode } from "./nodes/S3AddonNode";

// EdgeMouseHandler is not exported from @xyflow/react; define locally
type EdgeMouseHandler = (event: React.MouseEvent, edge: Edge) => void;

const BASE_NODE_TYPES: NodeTypes = {
  editorNode: WorkflowStepNode,
  "slack-addon": SlackAddonNode,
  "pvc-addon": PvcAddonNode,
  "mcp-addon": McpAddonNode,
  "tools-addon": ToolsAddonNode,
  "s3-addon": S3AddonNode,
  parallel: SharedParallelNode,
  switch: SharedSwitchNode,
  join: SharedJoinNode,
};

const BASE_EDGE_TYPES: EdgeTypes = {
  editableEdge: EditableEdge,
};

export interface BaseCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange?: OnNodesChange;
  onEdgesChange?: OnEdgesChange;
  onConnect?: OnConnect;
  onNodeClick?: NodeMouseHandler;
  onPaneClick?: () => void;
  onEdgeClick?: EdgeMouseHandler;
  onNodeDrag?: OnNodeDrag;
  onNodeDragStop?: OnNodeDrag;
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  elementsSelectable?: boolean;
  snapToGrid?: boolean;
  deleteKeyCode?: string | null;
  isValidConnection?: IsValidConnection;
  readonly?: boolean;
  fitView?: boolean;
  fitViewOptions?: FitViewOptions;
  extraNodeTypes?: NodeTypes;
  children?: ReactNode;
}

export function BaseCanvas({
  nodes, edges,
  onNodesChange, onEdgesChange, onConnect,
  onNodeClick, onPaneClick, onEdgeClick,
  onNodeDrag, onNodeDragStop,
  nodesDraggable = true,
  nodesConnectable = true,
  elementsSelectable = true,
  snapToGrid = false,
  deleteKeyCode = null,
  isValidConnection,
  readonly = false,
  fitView = true,
  fitViewOptions = { padding: 0.3 },
  extraNodeTypes,
  children,
}: BaseCanvasProps) {
  const nodeTypes = extraNodeTypes
    ? { ...BASE_NODE_TYPES, ...extraNodeTypes }
    : BASE_NODE_TYPES;

  return (
    <ReadonlyContext.Provider value={readonly}>
      <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={BASE_EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        nodesDraggable={nodesDraggable}
        nodesConnectable={nodesConnectable}
        elementsSelectable={elementsSelectable}
        snapToGrid={snapToGrid}
        snapGrid={[10, 10]}
        deleteKeyCode={deleteKeyCode}
        isValidConnection={isValidConnection}
        fitView={fitView}
        fitViewOptions={fitViewOptions}
        panOnScroll
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#1e293b" />
        <Controls
          showInteractive={false}
          className="[&>button]:bg-slate-800 [&>button]:border-slate-700 [&>button]:text-slate-300 [&>button:hover]:bg-slate-700"
        />
        {children}
      </ReactFlow>
      </div>
    </ReadonlyContext.Provider>
  );
}
