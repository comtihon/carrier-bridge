import React from "react";

export const McpAddonNode: React.FC<{ id: string; data: any; selected: boolean }> = ({ data, selected }) => {
  const isAttached = !!data.attachedTo;
  const servers = (data.servers ?? {}) as Record<string, boolean>;
  const activeMcpServers = (data.activeMcpServers ?? []) as string[];
  const isActive = activeMcpServers.some((s) => servers[s] === true);
  return (
    <div
      className={isActive ? 'animate-pulse' : ''}
      style={{
        minWidth: 160,
        background: isAttached ? '#2d1a00' : '#3d2400',
        borderWidth: isActive ? 2 : 1,
        borderStyle: isAttached ? 'solid' : 'dashed',
        borderColor: selected ? '#fb923c' : isActive ? '#f97316' : '#c2410c',
        borderRadius: 0,
        padding: '5px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'default',
        opacity: isAttached ? 1 : 0.7,
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Plug/server icon */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="2" width="14" height="10" rx="2" stroke="#fb923c" strokeWidth="1.5"/>
        <path d="M8 12v4" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M16 12v4" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M9 16h6" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M12 16v3" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="9" cy="6" r="1" fill="#fb923c"/>
        <circle cx="15" cy="6" r="1" fill="#fb923c"/>
      </svg>
      <span style={{ color: '#fdba74', fontSize: 12, fontWeight: 600 }}>MCP</span>
      {!isAttached && (
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginLeft: 'auto' }}>unattached</span>
      )}
    </div>
  );
};
