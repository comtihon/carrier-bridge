"use client";

import { useRef, useState } from "react";
import { clsx } from "clsx";
import { X } from "lucide-react";
import {
  createEvent,
  listEvents,
  updateEvent,
  EventNameConflictError,
  type EventDefinition,
} from "@/lib/api";
import { CodeEditor } from "./CodeEditor";
import { dsFieldCls, dsFieldMonoCls } from "./fieldStyles";

/**
 * Warning shown when a save would land on a name that already exists.
 *
 * Two events called "orders" are indistinguishable in every picker, so the
 * second one is never created silently: the author either overwrites the one
 * that is there or goes back and renames.
 */
export function EventNameConflictDialog({ name, onOverwrite, onCancel, busy = false }: {
  name: string;
  onOverwrite: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-slate-100 mb-1">Event already exists</p>
        <p className="text-xs text-slate-400 mb-4">
          An event named <span className="font-mono text-slate-300">{name}</span> is already
          registered. Overwriting replaces its topic, subscription and schema for every workflow
          that subscribes to it.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onOverwrite} disabled={busy}
            className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white hover:bg-amber-500 transition-colors disabled:opacity-50">
            {busy ? "Overwriting…" : "Overwrite"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The event fields, shared by this modal and the pubsub step's New tab. */
export function EventFields({ topic, subscription, eventSchemaText, onChange, disabled = false }: {
  topic: string;
  subscription: string;
  eventSchemaText: string;
  onChange: (patch: { topic?: string; subscription?: string; eventSchemaText?: string }) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">
          Topic <span className="text-red-400">*</span>
        </label>
        <input
          value={topic} onChange={(e) => onChange({ topic: e.target.value })}
          placeholder="orders — or projects/my-project/topics/orders"
          disabled={disabled}
          className={dsFieldMonoCls}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">Subscription</label>
        <input
          value={subscription} onChange={(e) => onChange({ subscription: e.target.value })}
          placeholder="blank — created on first use and saved here"
          disabled={disabled}
          className={dsFieldMonoCls}
        />
        <p className="text-[11px] text-slate-500">
          Name an existing subscription to pull from, or leave it blank: the first
          workflow that subscribes creates one and it is written back onto this event.
        </p>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-slate-400">Event schema</label>
          <label className="text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer transition-colors">
            <input
              type="file" accept=".json,application/json" className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                onChange({ eventSchemaText: await file.text() });
                e.target.value = "";
              }}
            />
            upload .json
          </label>
        </div>
        <CodeEditor
          value={eventSchemaText} onChange={(text) => onChange({ eventSchemaText: text })}
          language="json"
          placeholder={'{"type": "object", "required": ["order_id"], "properties": {"order_id": {"type": "string"}}}'}
          minHeight={180}
          readOnly={disabled}
        />
        <p className="text-[11px] text-slate-500">
          Events that do not match never start a run. Leave blank to accept every message.
        </p>
      </div>
    </>
  );
}

/** Parsed event schema, or an error message when the text is not JSON. */
export function parseEventSchema(text: string): { schema: Record<string, unknown> | null; error: string | null } {
  if (!text.trim()) return { schema: null, error: null };
  try {
    return { schema: JSON.parse(text), error: null };
  } catch {
    return { schema: null, error: "Event schema is not valid JSON" };
  }
}

interface EventModalProps {
  event: EventDefinition | null;
  onSave: () => void;
  onClose: () => void;
}

export function EventModal({ event, onSave, onClose }: EventModalProps) {
  const isEdit = event !== null;
  const [id, setId]                   = useState(event?.id ?? "");
  const [name, setName]               = useState(event?.name ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [topic, setTopic]             = useState(event?.topic ?? "");
  const [subscription, setSubscription] = useState(event?.subscription ?? "");
  const [eventSchemaText, setEventSchemaText] = useState(
    event?.event_schema ? JSON.stringify(event.event_schema, null, 2) : "",
  );

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  // Set when a create came back 409: the overwrite prompt is showing.
  const [conflict, setConflict] = useState(false);

  // ── resize state (same pattern as DatasourceModal) ────────────────────────
  const [size, setSize] = useState({ w: 560, h: 0 });
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
        w: Math.max(420, dragRef.current.startW + (ev.clientX - dragRef.current.startX)),
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

  function buildPayload() {
    const { schema, error: schemaError } = parseEventSchema(eventSchemaText);
    if (schemaError) return { payload: null, error: schemaError };
    return {
      payload: {
        name: name.trim(),
        description: description.trim() || null,
        topic: topic.trim(),
        subscription: subscription.trim(),
        event_schema: schema,
      },
      error: null,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (!topic.trim()) {
        setError("An event needs a topic");
        return;
      }
      const { payload, error: buildError } = buildPayload();
      if (!payload) {
        setError(buildError);
        return;
      }
      if (isEdit) {
        await updateEvent(event.id, payload);
      } else {
        await createEvent({ id: id.trim(), ...payload });
      }
      onSave();
    } catch (err) {
      if (err instanceof EventNameConflictError) {
        setConflict(true);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to save event");
    } finally {
      setSaving(false);
    }
  }

  /** Overwrite: the name is taken, so write onto the event that holds it. */
  async function handleOverwrite() {
    setSaving(true);
    setError(null);
    try {
      const { payload } = buildPayload();
      if (!payload) return;
      // The id the author typed is free (a duplicate id is refused separately),
      // so the clash is on the name — find that event and update it.
      const existing = (await listEvents()).find((e) => e.name === payload.name);
      if (!existing) {
        setError("The conflicting event is gone — try saving again");
        return;
      }
      await updateEvent(existing.id, payload);
      setConflict(false);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to overwrite event");
    } finally {
      setSaving(false);
    }
  }

  const containerStyle: React.CSSProperties = {
    width: size.w,
    ...(size.h > 0 ? { height: size.h } : {}),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        ref={containerRef}
        style={containerStyle}
        className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <h2 className="text-sm font-semibold text-white">{isEdit ? "Edit Event" : "Create Event"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* scrollable form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="rounded-lg bg-indigo-950/40 border border-indigo-900/40 px-3 py-2 text-[11px] text-indigo-300 leading-relaxed">
            An event is not called like an API — it names a Pub/Sub topic that
            <span className="font-mono"> pubsub</span> trigger steps subscribe to.
          </div>
          {!isEdit && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">ID <span className="text-red-400">*</span></label>
              <input value={id} onChange={(e) => setId(e.target.value)} placeholder="orders-events" required className={dsFieldCls} />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Order events" className={dsFieldCls} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Description</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this topic carry?" rows={2}
              className={clsx(dsFieldCls, "resize-none")}
            />
          </div>

          <EventFields
            topic={topic}
            subscription={subscription}
            eventSchemaText={eventSchemaText}
            onChange={(patch) => {
              if (patch.topic !== undefined) setTopic(patch.topic);
              if (patch.subscription !== undefined) setSubscription(patch.subscription);
              if (patch.eventSchemaText !== undefined) setEventSchemaText(patch.eventSchemaText);
            }}
          />

          {error && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button type="submit"
              disabled={saving || (!isEdit && !id.trim()) || !topic.trim()}
              className="px-4 py-2 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50">
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Event"}
            </button>
          </div>
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

      {conflict && (
        <EventNameConflictDialog
          name={name.trim()}
          busy={saving}
          onOverwrite={handleOverwrite}
          onCancel={() => setConflict(false)}
        />
      )}
    </div>
  );
}
