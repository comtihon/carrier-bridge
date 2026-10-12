import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listEvents: vi.fn(async () => []),
    createEvent: vi.fn(async (payload) => payload),
    updateEvent: vi.fn(async (_id, payload) => payload),
  };
});

import { EventEditor, emptyEventDraft, eventToDraft, type EventDraft } from "./EventEditor";
import {
  createEvent,
  listEvents,
  updateEvent,
  EventNameConflictError,
  type EventDefinition,
} from "@/lib/api";

const orders: EventDefinition = {
  id: "orders-events",
  name: "Order events",
  description: "Shop orders",
  topic: "orders",
  subscription: "",
  project_id: "",
  event_schema: { type: "object", required: ["order_id"] },
};

function renderEditor(draft: EventDraft = emptyEventDraft) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<EventEditor draft={draft} onSaved={onSaved} onClose={onClose} />);
  return { onSaved, onClose };
}

const idField     = () => screen.getByPlaceholderText("orders-events");
const nameField   = () => screen.getByPlaceholderText("Order events");
const topicField  = () => screen.getByPlaceholderText("orders — or projects/my-project/topics/orders");
const schemaField = () => screen.getByPlaceholderText(/"type": "object", "required": \["order_id"\]/);

function fillCreatable() {
  fireEvent.change(idField(), { target: { value: "orders-events" } });
  fireEvent.change(nameField(), { target: { value: "Order events" } });
  fireEvent.change(topicField(), { target: { value: "orders" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listEvents).mockResolvedValue([]);
  vi.mocked(createEvent).mockImplementation(async (payload) => payload as EventDefinition);
});

describe("EventEditor", () => {
  it("fills itself in from a stored event, schema included", () => {
    renderEditor(eventToDraft(orders));

    expect(topicField()).toHaveValue("orders");
    expect(schemaField()).toHaveValue(JSON.stringify(orders.event_schema, null, 2));
    // A saved event's id is fixed — renaming must not orphan the steps using it.
    expect(screen.queryByPlaceholderText("orders-events")).not.toBeInTheDocument();
  });

  it("edits the schema in a highlighted editor, not a bare textarea", () => {
    renderEditor(eventToDraft(orders));

    // react-simple-code-editor keeps a real textarea and paints a Prism <pre>
    // behind it, so the highlighted tokens prove the editor is wired up.
    const highlighted = document.querySelector("pre .token.property");
    expect(highlighted).not.toBeNull();
    expect(highlighted?.textContent).toBe('"type"');
  });

  it("saves the topic, subscription and parsed schema", async () => {
    renderEditor();
    fillCreatable();
    fireEvent.change(schemaField(), {
      target: { value: '{"type": "object", "required": ["order_id"]}' },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create Event/i }));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(vi.mocked(createEvent).mock.calls[0][0]).toEqual({
      id: "orders-events",
      name: "Order events",
      description: null,
      topic: "orders",
      subscription: "",
      event_schema: { type: "object", required: ["order_id"] },
    });
  });

  it("refuses a schema that is not JSON instead of saving it", async () => {
    renderEditor();
    fillCreatable();
    fireEvent.change(schemaField(), { target: { value: "{not json" } });

    fireEvent.click(screen.getByRole("button", { name: /Create Event/i }));

    expect(await screen.findByText("Event schema is not valid JSON")).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("cannot be saved without a topic", () => {
    renderEditor();
    fireEvent.change(idField(), { target: { value: "orders-events" } });

    expect(screen.getByRole("button", { name: /Create Event/i })).toBeDisabled();
  });

  it("updates an existing event in place", async () => {
    renderEditor(eventToDraft(orders));

    fireEvent.change(topicField(), { target: { value: "orders-v2" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(vi.mocked(updateEvent).mock.calls[0][0]).toBe("orders-events");
    expect(vi.mocked(updateEvent).mock.calls[0][1].topic).toBe("orders-v2");
  });

  it("warns on a taken name, then overwrites the event holding it", async () => {
    const clashing: EventDefinition = { ...orders, id: "orders-original", topic: "old-topic" };
    vi.mocked(createEvent).mockRejectedValue(
      new EventNameConflictError("Event 'Order events' already exists (id 'orders-original')"),
    );
    vi.mocked(listEvents).mockResolvedValue([clashing]);

    const { onSaved } = renderEditor();
    fillCreatable();
    fireEvent.click(screen.getByRole("button", { name: /Create Event/i }));

    expect(await screen.findByText("Event already exists")).toBeInTheDocument();
    expect(updateEvent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Overwrite/i }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    // The existing event is updated — no second "Order events" is created.
    expect(vi.mocked(updateEvent).mock.calls[0][0]).toBe("orders-original");
    expect(vi.mocked(updateEvent).mock.calls[0][1].topic).toBe("orders");
    expect(onSaved).toHaveBeenCalled();
  });
});
