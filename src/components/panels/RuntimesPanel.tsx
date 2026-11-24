"use client";

import { PanelShell } from "./dock";
import { RunnersPanel } from "./RunnersPanel";
import { PoolsPanel } from "./PoolsPanel";

/**
 * Runtimes: where agents run. Connected machines (each offering its local ACP
 * agents) and runtime pools (sets of machines' agents a workflow run takes one
 * of) side by side. Agents themselves — roles with a prompt — are in the
 * Agents panel; a workflow picks a runtime per use of an agent.
 */
export function RuntimesPanel({ onClose, onConnect, onOpenAgent, onAgentAdded, reloadToken }: {
  onClose: () => void;
  onConnect: () => void;
  onOpenAgent?: (id: string) => void;
  onAgentAdded?: () => void;
  reloadToken?: number;
}) {
  return (
    <PanelShell id="runners" onClose={onClose}>
      <div className="flex-1 overflow-y-auto">
        <RunnersPanel embedded onClose={onClose} onConnect={onConnect} onOpenAgent={onOpenAgent}
          onAgentAdded={onAgentAdded} reloadToken={reloadToken} />
        <PoolsPanel embedded onClose={onClose} reloadToken={reloadToken} />
      </div>
    </PanelShell>
  );
}
