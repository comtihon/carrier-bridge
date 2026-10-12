/**
 * The workflows-panel card must make three states readable at a glance —
 * enabled+visible, enabled+hidden, disabled — and the toggle must persist the
 * flip through the workflow update endpoint without losing the definition.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/oidc", () => ({ getAccessToken: vi.fn(async () => undefined) }));

import { WorkflowDefinitionCard } from "./Dashboard";
import { setWorkflowEnabled } from "@/lib/api";
import type { WorkflowDefinition } from "@/lib/types";

const base: WorkflowDefinition = {
  id: "nightly-report",
  name: "Nightly report",
  description: "Sends the nightly digest",
  steps: [],
};

function renderCard(
  overrides: {
    workflow?: Partial<WorkflowDefinition>;
    hidden?: boolean;
    disabled?: boolean;
    selected?: boolean;
  } = {},
) {
  const onToggleEnabled = vi.fn();
  const { container } = render(
    <WorkflowDefinitionCard
      workflow={{ ...base, ...overrides.workflow }}
      selected={overrides.selected ?? false}
      loading={false}
      hidden={overrides.hidden ?? false}
      disabled={overrides.disabled ?? false}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onToggleHidden={vi.fn()}
      onToggleEnabled={onToggleEnabled}
    />,
  );
  const frame = container.querySelector("div.group") as HTMLElement;
  return { frame, onToggleEnabled };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkflowDefinitionCard enable/disable", () => {
  it("renders the toggle alongside the visibility, edit and delete buttons", () => {
    renderCard();
    expect(
      screen.getByTitle("Disable workflow (blocks all triggers)"),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Hide runs")).toBeInTheDocument();
    expect(screen.getByTitle("Edit")).toBeInTheDocument();
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });

  it("offers to enable a disabled workflow", () => {
    const { onToggleEnabled } = renderCard({ disabled: true });
    const button = screen.getByTitle("Enable workflow");
    fireEvent.click(button);
    expect(onToggleEnabled).toHaveBeenCalledTimes(1);
  });

  it("hides the toggle on a read-only workflow, like edit and delete", () => {
    renderCard({ workflow: { readonly: true } });
    expect(screen.queryByTitle("Disable workflow (blocks all triggers)")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
  });

  it("gives a disabled workflow a dotted frame", () => {
    const { frame } = renderCard({ disabled: true });
    expect(frame.className).toContain("border-dotted");
    expect(frame.className).toContain("opacity-70");
  });

  it("keeps the dotted frame when a disabled workflow is also hidden", () => {
    const { frame } = renderCard({ disabled: true, hidden: true });
    expect(frame.className).toContain("border-dotted");
    // Hidden owns the opacity, so the two states stay distinguishable.
    expect(frame.className).toContain("opacity-50");
  });

  it("dims but does not dot an enabled-and-hidden workflow", () => {
    const { frame } = renderCard({ hidden: true });
    expect(frame.className).toContain("opacity-50");
    expect(frame.className).not.toContain("border-dotted");
  });

  it("leaves an enabled, visible workflow with the default solid frame", () => {
    const { frame } = renderCard();
    expect(frame.className).not.toContain("border-dotted");
    expect(frame.className).not.toContain("opacity-50");
    expect(frame.className).not.toContain("opacity-70");
  });
});

describe("setWorkflowEnabled", () => {
  it("re-sends the stored definition so the flip cannot blank the steps", async () => {
    const stored = {
      id: "nightly-report",
      name: "Nightly report",
      description: "Sends the nightly digest",
      steps: [{ id: "step1", type: "llm" }],
      ui: { layout: {} },
      use_meta_llm: true,
      enabled: true,
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...stored, enabled: false }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await setWorkflowEnabled("nightly-report", false);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/workflows/nightly-report");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(calls[1].init?.method).toBe("PUT");
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({
      name: "Nightly report",
      description: "Sends the nightly digest",
      steps: [{ id: "step1", type: "llm" }],
      ui: { layout: {} },
      use_meta_llm: true,
      enabled: false,
    });

    vi.unstubAllGlobals();
  });
});
