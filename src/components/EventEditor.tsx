"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Radio, Save, X } from "lucide-react";
import {
  createEvent,
  listEvents,
  updateEvent,
  EventNameConflictError,
  type EventDefinition,
} from "@/lib/api";
import { EventFields, EventNameConflictDialog, parseEventSchema } from "./EventModal";
import { dsFieldCls } from "./fieldStyles";

export interface EventDraft {
  /** null for an event that has never been saved — its id is still being typed. */
  id: string | null;
  name: string;
  description: string;
  topic: string;
  subscription: string;
  /** Kept as text, so a half-written schema is not thrown away on every keystroke. */
  eventSchemaText: string;
}

export const emptyEventDraft: EventDraft = {
  id: null, name: "", description: "", topic: "", subscription: "", eventSchemaText: "",
};

/** Turn a stored event into the draft the centre editor works on. */
export function eventToDraft(event: EventDefinition): EventDraft {
  return {
    id: event.id,
    name: event.name ?? "",
    description: event.description ?? "",
    topic: event.topic ?? "",
    subscription: event.subscription ?? "",
    eventSchemaText: event.event_schema ? JSON.stringify(event.event_schema, null, 2) : "",
  };
}

/**
 * Centre-pane editor for one event.
 *
 * An event carries the JSON schema that decides which messages start a run, so
 * it is a document, not a two-field prompt: it belongs in the main window next
 * to the canvas — where the schema can be read against the workflow it gates —
 * rather than behind an overlay that hides exactly that.
 *
 * A new event is POSTed with the id the author typed; a name that is already
 * taken comes back as a 409 and turns into an overwrite confirmation. An
 * existing event is PUT in place, so its id — and every step referencing it —
 * survives a rename.
 */
export function EventEditor({
  draft, onSaved, onClose,
}: {
  draft: EventDraft;
  onSaved: (event: EventDefinition) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState(draft.id ?? "");
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [topic, setTopic] = useState(draft.topic);
  const [subscription, setSubscription] = useState(draft.subscription);
  const [eventSchemaText, setEventSchemaText] = useState(draft.eventSchemaText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when a create came back 409: the overwrite prompt is showing.
  const [conflict, setConflict] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Selecting another event in the panel replaces the form contents.
  useEffect(() => {
    setId(draft.id ?? "");
    setName(draft.name);
    setDescription(draft.description);
    setTopic(draft.topic);
    setSubscription(draft.subscription);
    setEventSchemaText(draft.eventSchemaText);
    setError(null);
    setConflict(false);
    setSavedAt(null);
  }, [draft]);

  const isNew = draft.id === null;

  const save = useCallback(async () => {
    if (!topic.trim()) {
      setError("An event needs a topic");
      return;
    }
    const { schema, error: schemaError } = parseEventSchema(eventSchemaText);
    if (schemaError) {
      setError(schemaError);
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      topic: topic.trim(),
      subscription: subscription.trim(),
      event_schema: schema,
    };
    setSaving(true);
    setError(null);
    try {
      const saved = draft.id
        ? await updateEvent(draft.id, payload)
        : await createEvent({ id: id.trim(), ...payload });
      setConflict(false);
      setSavedAt(new Date().toLocaleTimeString());
      onSaved(saved);
    } catch (err) {
      if (err instanceof EventNameConflictError) setConflict(true);
      else setError(err instanceof Error ? err.message : "Failed to save event");
    } finally {
      setSaving(false);
    }
  }, [draft.id, id, name, description, topic, subscription, eventSchemaText, onSaved]);

  /** Overwrite: the name is taken, so write onto the event that already holds it. */
  const overwrite = useCallback(async () => {
    const { schema, error: schemaError } = parseEventSchema(eventSchemaText);
    if (schemaError) {
      setError(schemaError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // The id the author typed is free (a duplicate id is refused separately),
      // so the clash is on the name — find that event and update it.
      const existing = (await listEvents()).find((e) => e.name === name.trim());
      if (!existing) {
        setError("The conflicting event is gone — try saving again");
        return;
      }
      const saved = await updateEvent(existing.id, {
        name: name.trim(),
        description: description.trim() || null,
        topic: topic.trim(),
        subscription: subscription.trim(),
        event_schema: schema,
      });
      setConflict(false);
      setSavedAt(new Date().toLocaleTimeString());
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to overwrite event");
    } finally {
      setSaving(false);
    }
  }, [name, description, topic, subscription, eventSchemaText, onSaved]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 shrink-0">
        <Radio className="w-5 h-5 text-indigo-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">
            {isNew ? "New event" : name || draft.id}
          </p>
          {!isNew && <p className="text-[10px] text-slate-500 font-mono truncate">{draft.id}</p>}
        </div>
        {savedAt && <span className="text-[10px] text-emerald-400">Saved {savedAt}</span>}
        <button onClick={save} disabled={saving || (isNew && !id.trim()) || !topic.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {isNew ? "Create Event" : "Save Changes"}
        </button>
        <button onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors"
          title="Close editor">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <p className="mx-6 mt-4 text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-3xl">
        <div className="rounded-lg bg-indigo-950/40 border border-indigo-900/40 px-3 py-2 text-[11px] text-indigo-300 leading-relaxed">
          An event is not called like an API — it names a Pub/Sub topic that
          <span className="font-mono"> pubsub</span> trigger steps subscribe to.
        </div>

        <div className="grid grid-cols-2 gap-3">
          {isNew && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">ID <span className="text-red-400">*</span></label>
              <input value={id} onChange={(e) => setId(e.target.value)}
                placeholder="orders-events" className={dsFieldCls} />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Name</label>
            <input value={name} onChange={(e) => { setName(e.target.value); setConflict(false); }}
              placeholder="Order events" className={dsFieldCls} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this topic carry?" className={dsFieldCls} />
          </div>
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
      </div>

      {conflict && (
        <EventNameConflictDialog
          name={name.trim()}
          busy={saving}
          onOverwrite={overwrite}
          onCancel={() => setConflict(false)}
        />
      )}
    </div>
  );
}
