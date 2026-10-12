import type { Node } from "@xyflow/react";
import type { EditableNodeConfig } from "@/lib/types";

export const SNAKE_COLS = 6;
export const SNAKE_X_GAP = 185;
export const SNAKE_Y_GAP = 120;

export const ADDON_NODE_TYPES = [
  "slack-addon",
  "pvc-addon",
  "mcp-addon",
  "tools-addon",
  "s3-addon",
  "datasource-addon",
] as const;

export function isAddonNodeType(t: string): boolean {
  return (ADDON_NODE_TYPES as readonly string[]).includes(t);
}

export function snakePosition(i: number): { x: number; y: number } {
  const col = i % SNAKE_COLS;
  const row = Math.floor(i / SNAKE_COLS);
  return {
    x: 20 + col * SNAKE_X_GAP,
    y: 60 + row * SNAKE_Y_GAP,
  };
}

/**
 * What the canvas writes across a step.
 *
 * A trigger's own name is whatever the palette put there ("Pub/Sub Trigger") —
 * it tells the reader nothing. The event the step fires on is its real
 * identity, so a bound event's name wins. Verbatim, underscores intact: the
 * label is the identifier the user configured and has to stay matchable
 * against the events list.
 *
 * `eventNames` maps event id → display name. An id that is not in it — list
 * still loading, or the event deleted server-side — falls back to the step's
 * own name, so a node never renders blank. `datasource` is the pre-events
 * spelling of the binding but holds a datasource id the events list cannot
 * resolve, so only `event` is looked up.
 */
export function stepDisplayLabel(
  config: Pick<EditableNodeConfig, "name" | "type" | "event">,
  eventNames?: ReadonlyMap<string, string>,
): string {
  if (config.type === "pubsub" && config.event) {
    const eventName = eventNames?.get(config.event);
    if (eventName) return eventName;
  }
  return config.name;
}

export function configToRFNode(
  config: EditableNodeConfig,
  position: { x: number; y: number },
  onDelete?: (id: string) => void,
): Node {
  const t = config.type as string;
  const rfType = (t === "parallel" || t === "switch" || t === "join" || t === "proceed_or") ? t
    : isAddonNodeType(t) ? t
    : "editorNode";
  return {
    id: config.id,
    type: rfType,
    position,
    data: {
      ...config,
      label: config.name,
      stepType: config.type,
      onDelete: onDelete ?? undefined,
    },
  };
}

export function rfNodeToConfig(node: Node): EditableNodeConfig {
  // Strip injected display/handler keys so they don't pollute the saved config.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {
    label: _label,
    stepType: _stepType,
    onDelete: _onDelete,
    _slackHover,
    _pvcHover,
    _s3Hover,
    _mcpHover,
    _toolsHover,
    _addonCount,
    _addonsUnfolded,
    _onToggleAddons,
    activeMcpServers,
    activeTools,
    ...rest
  } = node.data as Record<string, unknown>;
  void _slackHover; void _pvcHover; void _s3Hover; void _mcpHover; void _toolsHover;
  void _addonCount; void _addonsUnfolded; void _onToggleAddons; void activeMcpServers; void activeTools;
  return rest as unknown as EditableNodeConfig;
}
