import React from "react";

export const SlackAddonNode: React.FC<{ id: string; data: any; selected: boolean }> = ({ data, selected }) => {
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
        cursor: 'default',
        opacity: isAttached ? 1 : 0.7,
        userSelect: 'none',
        position: 'relative',
      }}
    >
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
