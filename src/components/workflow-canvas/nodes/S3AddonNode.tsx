import React from "react";

export const S3AddonNode: React.FC<{ id: string; data: any; selected: boolean }> = ({ data, selected }) => {
  const isAttached = !!data.attachedTo;
  const bucket = (data.s3_bucket || "") as string;
  const path = (data.s3_path || "") as string;
  return (
    <div
      style={{
        minWidth: 160,
        background: isAttached ? '#1a1200' : '#2a1e00',
        borderWidth: 1,
        borderStyle: isAttached ? 'solid' : 'dashed',
        borderColor: selected ? '#fbbf24' : '#b45309',
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
      {/* Storage bucket icon */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="12" cy="6" rx="8" ry="3" stroke="#fbbf24" strokeWidth="1.5"/>
        <path d="M4 6v6c0 1.657 3.582 3 8 3s8-1.343 8-3V6" stroke="#fbbf24" strokeWidth="1.5"/>
        <path d="M4 12v6c0 1.657 3.582 3 8 3s8-1.343 8-3v-6" stroke="#fbbf24" strokeWidth="1.5"/>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ color: '#fde68a', fontSize: 12, fontWeight: 600 }}>S3 Storage</span>
        {isAttached && bucket && (
          <span style={{ color: '#a16207', fontSize: 9, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
            {bucket}
          </span>
        )}
        {isAttached && path && (
          <span style={{ color: '#a16207', fontSize: 9, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
            {path}
          </span>
        )}
      </div>
      {!isAttached && (
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginLeft: 'auto' }}>unattached</span>
      )}
    </div>
  );
};
