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

import { EventModal } from "./EventModal";
import {
  createEvent,
  listEvents,
  updateEvent,
  EventNameConflictError,
  type EventDefinition,
} from "@/lib/api";

function renderModal(event: EventDefinition | null = null) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<EventModal event={event} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

const idField     = () => screen.getByPlaceholderText("orders-events");
const nameField   = () => screen.getByPlaceholderText("Order events");
const topicField  = () => screen.getByPlaceholderText("orders — or projects/my-project/topics/orders");
const schemaField = () => screen.getByPlaceholderText(/"type": "object", "required": \["order_id"\]/);
const submit      = () => screen.getByRole("button", { name: /Create Event/i });

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

describe("EventModal", () => {
  it("asks for a topic and a subscription, never for a URL or credentials", () => {
    renderModal();

    expect(topicField()).toBeInTheDocument();
    expect(screen.getByPlaceholderText("blank — created on first use and saved here")).toBeInTheDocument();
    // An event is subscribed to, not called.
    expect(screen.queryByPlaceholderText("https://api.example.com")).not.toBeInTheDocument();
    expect(screen.queryByText(/Authentication/)).not.toBeInTheDocument();
  });

  it("saves the topic, subscription and parsed schema", async () => {
    renderModal();
    fillCreatable();
    fireEvent.change(schemaField(), {
      target: { value: '{"type": "object", "required": ["order_id"]}' },
    });

    fireEvent.click(submit());

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
    renderModal();
    fillCreatable();
    fireEvent.change(schemaField(), { target: { value: "{not json" } });

    fireEvent.click(submit());

    expect(await screen.findByText("Event schema is not valid JSON")).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("cannot be saved without a topic", () => {
    renderModal();
    fireEvent.change(idField(), { target: { value: "orders-events" } });

    expect(submit()).toBeDisabled();
  });

  it("edits an existing event in place", async () => {
    renderModal({
      id: "orders-events",
      name: "Order events",
      description: null,
      topic: "orders",
      subscription: "",
      project_id: "",
      event_schema: null,
    });

    fireEvent.change(topicField(), { target: { value: "orders-v2" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(vi.mocked(updateEvent).mock.calls[0][0]).toBe("orders-events");
    expect(vi.mocked(updateEvent).mock.calls[0][1].topic).toBe("orders-v2");
  });
});

describe("EventModal name conflicts", () => {
  const clashing: EventDefinition = {
    id: "orders-original",
    name: "Order events",
    description: null,
    topic: "old-topic",
    subscription: "",
    project_id: "",
    event_schema: null,
  };

  beforeEach(() => {
    vi.mocked(createEvent).mockRejectedValue(
      new EventNameConflictError("Event 'Order events' already exists (id 'orders-original')"),
    );
    vi.mocked(listEvents).mockResolvedValue([clashing]);
  });

  it("warns instead of creating a second event with the same name", async () => {
    const { onSave } = renderModal();
    fillCreatable();

    fireEvent.click(submit());

    expect(await screen.findByText("Event already exists")).toBeInTheDocument();
    expect(updateEvent).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("overwrites the event holding the name when asked to", async () => {
    const { onSave } = renderModal();
    fillCreatable();
    fireEvent.click(submit());
    await screen.findByText("Event already exists");

    fireEvent.click(screen.getByRole("button", { name: /Overwrite/i }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    // The existing event is updated — no second "Order events" is created.
    expect(vi.mocked(updateEvent).mock.calls[0][0]).toBe("orders-original");
    expect(vi.mocked(updateEvent).mock.calls[0][1].topic).toBe("orders");
    expect(onSave).toHaveBeenCalled();
  });

  it("cancelling the warning leaves both events alone", async () => {
    const { onSave } = renderModal();
    fillCreatable();
    fireEvent.click(submit());
    await screen.findByText("Event already exists");

    // The dialog's own Cancel — the form behind it has one too.
    const cancels = screen.getAllByRole("button", { name: /Cancel/i });
    fireEvent.click(cancels[cancels.length - 1]);

    await waitFor(() => expect(screen.queryByText("Event already exists")).not.toBeInTheDocument());
    expect(updateEvent).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
