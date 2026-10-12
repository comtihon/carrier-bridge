import React from "react";

export const PvcAddonNode: React.FC<{ id: string; data: any; selected: boolean }> = ({ data, selected }) => {
  const isAttached = !!data.attachedTo;
  return (
    <div
      style={{
        minWidth: 160,
        background: isAttached ? '#0d2d2d' : '#0f3838',
        borderWidth: 1,
        borderStyle: isAttached ? 'solid' : 'dashed',
        borderColor: selected ? '#2dd4bf' : '#0d9488',
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
      {/* Database/disk icon */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="12" cy="6" rx="8" ry="3" stroke="#2dd4bf" strokeWidth="1.5"/>
        <path d="M4 6v6c0 1.657 3.582 3 8 3s8-1.343 8-3V6" stroke="#2dd4bf" strokeWidth="1.5"/>
        <path d="M4 12v6c0 1.657 3.582 3 8 3s8-1.343 8-3v-6" stroke="#2dd4bf" strokeWidth="1.5"/>
      </svg>
      <span style={{ color: '#5eead4', fontSize: 12, fontWeight: 600 }}>PVC</span>
      {!isAttached && (
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginLeft: 'auto' }}>unattached</span>
      )}
    </div>
  );
};
