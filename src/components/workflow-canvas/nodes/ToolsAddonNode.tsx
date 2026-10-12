import React from "react";

export const ToolsAddonNode: React.FC<{ id: string; data: any; selected: boolean }> = ({ data, selected }) => {
  const isAttached = !!data.attachedTo;
  const tools = (data.tools ?? {}) as Record<string, boolean>;
  const activeTools = (data.activeTools ?? []) as string[];
  const isActive = activeTools.some((t) => tools[t] === true);
  return (
    <div
      className={isActive ? 'animate-pulse' : ''}
      style={{
        minWidth: 160,
        background: isAttached ? '#04241a' : '#063a2b',
        borderWidth: isActive ? 2 : 1,
        borderStyle: isAttached ? 'solid' : 'dashed',
        borderColor: selected ? '#34d399' : isActive ? '#34d399' : '#0f766e',
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
      {/* Wrench/tool icon */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M14.7 6.3a4 4 0 0 0-5.4 4.9L3 17.5V21h3.5l6.3-6.3a4 4 0 0 0 4.9-5.4l-2.6 2.6-2.1-.5-.5-2.1 2.7-2.5z"
          stroke="#34d399"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{ color: '#6ee7b7', fontSize: 12, fontWeight: 600 }}>Tools</span>
      {!isAttached && (
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginLeft: 'auto' }}>unattached</span>
      )}
    </div>
  );
};
