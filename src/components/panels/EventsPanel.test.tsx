import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listEventSummaries: vi.fn(async () => []),
    deleteEvent: vi.fn(async () => undefined),
    createEvent: vi.fn(async (payload) => payload),
    updateEvent: vi.fn(async (_id, payload) => payload),
  };
});

import { EventsPanel } from "./EventsPanel";
import { deleteEvent, listEventSummaries, type EventSummary } from "@/lib/api";

// A summary is all the panel gets: no event_schema, no subscription.
const orders: EventSummary = {
  id: "orders-events",
  name: "Order events",
  description: "Shop orders",
  topic: "orders",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listEventSummaries).mockResolvedValue([orders]);
});

function renderPanel(props: Partial<React.ComponentProps<typeof EventsPanel>> = {}) {
  const onOpen = vi.fn();
  const onNew = vi.fn();
  render(<EventsPanel onClose={vi.fn()} onOpen={onOpen} onNew={onNew} {...props} />);
  return { onOpen, onNew };
}

describe("EventsPanel", () => {
  it("lists events by name and topic", async () => {
    renderPanel();

    expect(await screen.findByText("Order events")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("says so when there are none", async () => {
    vi.mocked(listEventSummaries).mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText("No events yet.")).toBeInTheDocument();
  });

  it("hands a clicked event's id to the centre editor instead of opening a dialog", async () => {
    const { onOpen } = renderPanel();

    fireEvent.click(await screen.findByText("Order events"));

    // An id, not the row: the row has no schema, and the editor needs one.
    expect(onOpen).toHaveBeenCalledWith("orders-events");
    // The editor lives in the main window now — nothing is layered over the app.
    expect(screen.queryByText("Edit Event")).not.toBeInTheDocument();
  });

  it("asks the centre editor for a blank event rather than a create dialog", async () => {
    const { onNew } = renderPanel();
    await screen.findByText("Order events");

    fireEvent.click(screen.getByTitle("New event"));

    expect(onNew).toHaveBeenCalled();
    expect(screen.queryByText("Create Event")).not.toBeInTheDocument();
  });

  it("marks the event the centre editor is showing", async () => {
    renderPanel({ selectedId: "orders-events" });

    const row = (await screen.findByText("Order events")).closest("div.group");
    expect(row?.className).toContain("border-indigo-600");
  });

  it("asks before deleting, then reloads", async () => {
    renderPanel();
    await screen.findByText("Order events");

    fireEvent.click(screen.getByTitle("Delete"));
    expect(await screen.findByText("Delete event?")).toBeInTheDocument();
    expect(deleteEvent).not.toHaveBeenCalled();

    // The dialog's Delete — the row's icon button carries the same label.
    const deletes = screen.getAllByRole("button", { name: /^Delete$/ });
    fireEvent.click(deletes[deletes.length - 1]);

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith("orders-events"));
    expect(listEventSummaries).toHaveBeenCalledTimes(2);
  });

  it("surfaces a load failure instead of showing an empty list", async () => {
    vi.mocked(listEventSummaries).mockRejectedValue(new Error("API 500: boom"));
    renderPanel();

    expect(await screen.findByText("API 500: boom")).toBeInTheDocument();
  });
});
