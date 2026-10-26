"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";

/** Where a resource editor is hosted. */
export type EditorSurface = "modal" | "center";

/**
 * Chrome shared by the resource editors — one form, two hosts.
 *
 * Opened from the dock, a resource fills the main window, so it can be read
 * against the canvas it configures and stays put while the author looks
 * elsewhere. Opened from the canvas palette it still floats, because there the
 * author is part-way through wiring a node and has to come back to it.
 *
 * Only the frame branches on that: the fields, the validation and the save path
 * stay single-sourced, which is the whole point of hosting them here.
 */
export function ResourceEditorFrame({
  surface,
  title,
  subtitle,
  icon,
  onSubmit,
  onClose,
  initialWidth = 512,
  minWidth = 380,
  readOnly = false,
  access,
  children,
}: {
  surface: EditorSurface;
  title: string;
  /** The resource's id, shown under the title in the main window. */
  subtitle?: string | null;
  icon?: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  /** Overlay only — the main window is sized by the layout. */
  initialWidth?: number;
  minWidth?: number;
  /**
   * The caller may look but not change it (someone else's resource). Every
   * control in the form is disabled and submitting does nothing; the close
   * button lives outside the form and keeps working.
   */
  readOnly?: boolean;
  /**
   * Above the fields and outside `readOnly`: who can see and use the resource.
   * Someone who may not edit it can still be the one who shares it (a team
   * admin), so these controls decide their own enablement.
   */
  access?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: initialWidth, h: 0 }); // h=0 means auto
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function onResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height };
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      setSize({
        w: Math.max(minWidth, dragRef.current.startW + (ev.clientX - dragRef.current.startX)),
        h: Math.max(400, dragRef.current.startH + (ev.clientY - dragRef.current.startY)),
      });
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const submit = readOnly ? (e: React.FormEvent) => e.preventDefault() : onSubmit;
  const fields = readOnly
    ? <fieldset disabled className="space-y-4 min-w-0">{children}</fieldset>
    : children;
  const body = access ? <>{access}{fields}</> : fields;

  if (surface === "center") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 shrink-0">
          {icon}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{title}</p>
            {subtitle && <p className="text-[10px] text-slate-500 font-mono truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} title="Close editor"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* The form scrolls, so the fields keep their modal layout unchanged. */}
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-3xl">
          {body}
        </form>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        ref={containerRef}
        style={{ width: size.w, ...(size.h > 0 ? { height: size.h } : {}) }}
        className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {body}
        </form>

        {/* resize handle — bottom-right corner */}
        <div
          onMouseDown={onResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{ borderBottomRightRadius: "1rem" }}
        >
          <svg viewBox="0 0 16 16" className="w-full h-full text-slate-600 opacity-60 hover:opacity-100 transition-opacity">
            <path d="M14 14L6 14M14 14L14 6M14 14L10 14M14 14L14 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
