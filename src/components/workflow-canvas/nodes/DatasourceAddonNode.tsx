import React from "react";

import { DatasourceRiskBadge } from "@/components/DatasourceRiskBadge";
import { useDatasources } from "@/hooks/useDatasources";

/**
 * A datasource grant attached to an agent.
 *
 * The node shows the source it grants and the risk of the *granted* operations
 * — not of the datasource as a whole — because the grant is what the agent can
 * actually do. Ticking three reads of a source that also has deletes should
 * read as green here; only a ticked write turns it amber, only a ticked delete
 * turns it red.
 */
export const DatasourceAddonNode: React.FC<{
  id: string;
  data: any;
  selected: boolean;
}> = ({ data, selected }) => {
  const isAttached = !!data.attachedTo;
  const sourceId = (data.datasource_id ?? "") as string;
  const allowed = (data.allowed_operations ?? []) as string[];
  const { byId } = useDatasources();

  const ds = sourceId ? byId.get(sourceId) : undefined;
  const grantedOperations = (ds?.operations ?? []).filter((op) =>
    allowed.includes(op.name),
  );

  return (
    <div
      style={{
        minWidth: 160,
        background: isAttached ? "#001a1a" : "#002424",
        borderWidth: 1,
        borderStyle: isAttached ? "solid" : "dashed",
        borderColor: selected ? "#22d3ee" : "#0e7490",
        borderRadius: 0,
        padding: "5px 10px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        cursor: "default",
        opacity: isAttached ? 1 : 0.7,
        userSelect: "none",
        position: "relative",
      }}
    >
      {/* Stacked-disc "database" glyph */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="12" cy="6" rx="7" ry="3" stroke="#22d3ee" strokeWidth="1.5" />
        <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" stroke="#22d3ee" strokeWidth="1.5" />
        <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" stroke="#22d3ee" strokeWidth="1.5" />
      </svg>
      <span style={{ color: "#a5f3fc", fontSize: 12, fontWeight: 600 }}>Data</span>
      {sourceId && (
        <span
          title={sourceId}
          style={{
            color: "rgba(255,255,255,0.6)",
            fontSize: 9,
            maxWidth: 90,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sourceId}
        </span>
      )}
      {grantedOperations.length > 0 && (
        <DatasourceRiskBadge
          operations={grantedOperations}
          kind={ds?.kind}
          className="ml-auto"
        />
      )}
      {!isAttached && (
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 9, marginLeft: "auto" }}>
          unattached
        </span>
      )}
    </div>
  );
};
