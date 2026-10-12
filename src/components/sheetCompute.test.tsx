/**
 * Tier 2 in the editor: escalation, questions, review, activation, staleness.
 *
 * The property these tests exist to hold is the one that is easiest to lose in
 * a refactor: **the user is never given a way to ask for generated code, and
 * code is never generated without them pressing a button that says so.** Every
 * test below either checks that the escalation is explicit, or checks that a
 * state a user must not miss (not activated, stale, hand-edited) is actually on
 * the screen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type {
  BindingCodeResult,
  CompileComputeResult,
  ComputeStatus,
  SheetBinding,
} from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    compileSheetBindingCode: vi.fn(),
    getSheetBindingCode: vi.fn(),
    editSheetBindingCode: vi.fn(),
    activateSheetBindingCode: vi.fn(),
    retestSheetBindingCode: vi.fn(),
    markSheetBindingStale: vi.fn(),
  };
});

import {
  activateSheetBindingCode,
  compileSheetBindingCode,
  editSheetBindingCode,
  markSheetBindingStale,
  retestSheetBindingCode,
} from "@/lib/api";
import {
  BindingTierBadge,
  SheetComputePanel,
  tier1Rejection,
} from "./SheetComputePanel";

const CODE = [
  "def transform(records, params):",
  "    totals = {}",
  "    for row in records:",
  "        totals[row['owner']] = totals.get(row['owner'], 0) + 1",
  "    return [{'owner': o, 'n': totals[o]} for o in sorted(totals)]",
].join("\n");

function tier1Binding(overrides: Partial<SheetBinding> = {}): SheetBinding {
  return {
    version: 1,
    name: "read_open_projects",
    document: { provider: "google_sheets", file_id: "1AbC", sheet: "Projects" },
    schema: { header_row: 1, headers: ["project_id", "status", "owner"], fingerprint: "sha256:a" },
    operation: "read",
    read: { mode: "rows", columns: ["project_id", "status", "owner"] },
    output: { key: "totals" },
    ...overrides,
  };
}

function status(overrides: Partial<ComputeStatus> = {}): ComputeStatus {
  return {
    name: "read_open_projects",
    operation: "read",
    tier: "script",
    generated: true,
    instruction: "count open rows per owner",
    answers: {},
    authored_by: "llm",
    model_id: "test/model",
    edited_by_human: false,
    compiled_at: "2026-09-01T00:00:00Z",
    schema_fingerprint: "sha256:a",
    script_id: "sheets_tx_abc12345",
    content_hash: "sha256:code",
    signature_version: 1,
    output_shape: "records",
    rationale: "counts open rows per owner",
    activated: true,
    stale: false,
    stale_reason: "",
    golden: {
      rows: 7,
      input_hash: "sha256:in",
      output_hash: "sha256:out",
      verified_at: "2026-09-01T00:00:00Z",
      verified_days_ago: 3,
    },
    ...overrides,
  };
}

function tier2Binding(statusOverrides: Partial<ComputeStatus> = {}): SheetBinding {
  const s = status(statusOverrides);
  return tier1Binding({
    compute: {
      script_id: s.script_id!,
      content_hash: s.content_hash!,
      signature_version: 1,
      code: CODE,
      output_shape: "records",
      rationale: s.rationale!,
      activated: s.activated!,
      stale: s.stale!,
      stale_reason: s.stale_reason!,
      cache_key: "sha256:k",
    },
    compute_status: s,
  });
}

const OK_RESULT: CompileComputeResult = {
  status: "ok",
  binding: "read_open_projects",
  code: CODE,
  rationale: "counts open rows per owner",
  output: [{ owner: "ann", n: 2 }],
  compute: status({ activated: false }),
  attempts: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── The tier-1 check ────────────────────────────────────────────────────────

describe("tier1Rejection", () => {
  it("names the reason a form cannot express an aggregation", () => {
    expect(tier1Rejection("sum hours by owner for open rows")).toBe(
      "grouping + aggregation across rows",
    );
    expect(tier1Rejection("total hours this quarter")).toBe("aggregation across rows");
    expect(tier1Rejection("percent complete per project")).toContain("grouping");
  });

  it("passes an instruction the form can already satisfy", () => {
    // Tier 1 is always the better outcome, so the check has to be conservative
    // about escalating: a plain filtered read must not become generated code.
    expect(tier1Rejection("read the open rows for a given owner")).toBeNull();
    expect(tier1Rejection("set status to reviewed on the matching row")).toBeNull();
  });
});

// ─── Badges ──────────────────────────────────────────────────────────────────

describe("BindingTierBadge", () => {
  it("says a tier-1 binding is deterministic and has no code", () => {
    render(<BindingTierBadge status={undefined} />);
    expect(screen.getByText(/Mapped — deterministic · no code/)).toBeInTheDocument();
  });

  it("says a tier-2 binding is generated code needing review, with its age", () => {
    render(<BindingTierBadge status={status()} />);
    expect(screen.getByText(/Generated code — review required/)).toBeInTheDocument();
    expect(screen.getByText("last verified 3d ago")).toBeInTheDocument();
  });

  it("shows 'not activated' rather than an age for compiled-but-off code", () => {
    render(<BindingTierBadge status={status({ activated: false })} />);
    expect(screen.getByText("not activated")).toBeInTheDocument();
  });

  it("shows a stale binding as stale", () => {
    render(<BindingTierBadge status={status({ stale: true, stale_reason: "headers changed" })} />);
    expect(screen.getByText("stale")).toBeInTheDocument();
  });

  it("marks a hand-edited binding, because it is no longer regenerated", () => {
    render(<BindingTierBadge status={status({ edited_by_human: true })} />);
    expect(screen.getByText("hand-edited")).toBeInTheDocument();
  });
});

// ─── Escalation ──────────────────────────────────────────────────────────────

describe("escalation", () => {
  it("offers no way to ask for generated code before the form has been tried", () => {
    render(<SheetComputePanel sourceId="google-sheets" binding={tier1Binding()} />);
    // The instruction box exists; the Generate button does not, yet.
    expect(screen.getByLabelText("Instruction")).toBeInTheDocument();
    expect(screen.queryByText("Generate code")).not.toBeInTheDocument();
  });

  it("sends the user back to the form when the form can do the job", () => {
    render(<SheetComputePanel sourceId="google-sheets" binding={tier1Binding()} />);
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "read the open rows for a given owner" },
    });
    fireEvent.click(screen.getByText("Check what this needs"));

    expect(screen.getByText(/The form above can express this/)).toBeInTheDocument();
    expect(screen.queryByText("Generate code")).not.toBeInTheDocument();
    expect(compileSheetBindingCode).not.toHaveBeenCalled();
  });

  it("shows the reason and an explicit button, and generates nothing until it is pressed", async () => {
    vi.mocked(compileSheetBindingCode).mockResolvedValue(OK_RESULT);
    render(<SheetComputePanel sourceId="google-sheets" binding={tier1Binding()} />);

    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "sum hours by owner for open rows this quarter" },
    });
    fireEvent.click(screen.getByText("Check what this needs"));

    // The reason, verbatim, plus the way back out.
    expect(screen.getByText(/grouping \+ aggregation across rows/)).toBeInTheDocument();
    expect(screen.getByText("Simplify instruction")).toBeInTheDocument();
    // Nothing has been generated.
    expect(compileSheetBindingCode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Generate code"));
    await waitFor(() => expect(compileSheetBindingCode).toHaveBeenCalledOnce());
  });

  it("offers a way back to a simpler instruction instead of generating", () => {
    render(<SheetComputePanel sourceId="google-sheets" binding={tier1Binding()} />);
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "total hours by owner" },
    });
    fireEvent.click(screen.getByText("Check what this needs"));
    fireEvent.click(screen.getByText("Simplify instruction"));

    expect(screen.getByText(/declarative binding needs no review/)).toBeInTheDocument();
    expect(compileSheetBindingCode).not.toHaveBeenCalled();
  });
});

// ─── Ambiguity questions ─────────────────────────────────────────────────────

describe("ambiguity questions", () => {
  const NEEDS: CompileComputeResult = {
    status: "needs",
    binding: "read_open_projects",
    needs: [{ question: "Which column dates a row?", options: ["created_at", "closed_at"] }],
  };

  async function escalateAndAsk() {
    vi.mocked(compileSheetBindingCode).mockResolvedValueOnce(NEEDS);
    render(<SheetComputePanel sourceId="google-sheets" binding={tier1Binding()} />);
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "total hours by owner this quarter" },
    });
    fireEvent.click(screen.getByText("Check what this needs"));
    fireEvent.click(screen.getByText("Generate code"));
    await waitFor(() =>
      expect(screen.getByText("Which column dates a row?")).toBeInTheDocument(),
    );
  }

  it("renders the questions as dropdowns built from the returned options", async () => {
    await escalateAndAsk();
    const select = screen.getByLabelText("Which column dates a row?");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "created_at" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "closed_at" })).toBeInTheDocument();
  });

  it("will not resubmit until every question is answered", async () => {
    await escalateAndAsk();
    expect(screen.getByText("Generate with these answers")).toBeDisabled();
  });

  it("resubmits the answers to compile", async () => {
    await escalateAndAsk();
    vi.mocked(compileSheetBindingCode).mockResolvedValueOnce(OK_RESULT);

    fireEvent.change(screen.getByLabelText("Which column dates a row?"), {
      target: { value: "created_at" },
    });
    fireEvent.click(screen.getByText("Generate with these answers"));

    await waitFor(() =>
      expect(compileSheetBindingCode).toHaveBeenLastCalledWith(
        "google-sheets",
        "read_open_projects",
        expect.objectContaining({
          answers: { "Which column dates a row?": "created_at" },
        }),
      ),
    );
  });
});

// ─── Review and activation ───────────────────────────────────────────────────

describe("review and activation", () => {
  async function compileOk(binding = tier1Binding()) {
    vi.mocked(compileSheetBindingCode).mockResolvedValue(OK_RESULT);
    render(<SheetComputePanel sourceId="google-sheets" binding={binding} />);
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "total hours by owner" },
    });
    fireEvent.click(screen.getByText("Check what this needs"));
    fireEvent.click(screen.getByText("Generate code"));
    await waitFor(() => expect(screen.getByText(/not running yet/)).toBeInTheDocument());
  }

  it("shows the code, the rationale and the output on the user's own rows", async () => {
    await compileOk();
    expect(screen.getByText(/def transform\(records, params\)/)).toBeInTheDocument();
    expect(screen.getByText("counts open rows per owner")).toBeInTheDocument();
    expect(screen.getByText(/"owner": "ann"/)).toBeInTheDocument();
  });

  it("requires an explicit confirmation to activate", async () => {
    vi.mocked(activateSheetBindingCode).mockResolvedValue({
      status: "ok", binding: "read_open_projects", compute: status(),
    });
    await compileOk();

    // The button says what pressing it means.
    const confirm = screen.getByText("I have read the code — activate it");
    expect(activateSheetBindingCode).not.toHaveBeenCalled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(activateSheetBindingCode).toHaveBeenCalledWith(
        "google-sheets", "read_open_projects",
      ),
    );
  });

  it("keeps the code read-only until the edit toggle is used", async () => {
    await compileOk();
    expect(screen.queryByLabelText("Generated code")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByLabelText("Generated code")).toBeInTheDocument();
  });

  it("warns that saving an edit stops regeneration, then saves it", async () => {
    vi.mocked(editSheetBindingCode).mockResolvedValue({
      status: "ok", binding: "read_open_projects",
      compute: status({ edited_by_human: true }),
    });
    await compileOk();
    fireEvent.click(screen.getByText("Edit"));

    expect(screen.getByText(/stops this binding being regenerated/)).toBeInTheDocument();

    const box = screen.getByLabelText("Generated code");
    fireEvent.change(box, { target: { value: "def transform(records, params):\n    return []" } });
    fireEvent.click(screen.getByText("Save edit"));

    await waitFor(() =>
      expect(editSheetBindingCode).toHaveBeenCalledWith(
        "google-sheets", "read_open_projects",
        "def transform(records, params):\n    return []",
      ),
    );
  });
});

// ─── An existing tier-2 binding ──────────────────────────────────────────────

describe("an existing generated binding", () => {
  it("shows what it was generated from, and by which model", () => {
    render(<SheetComputePanel sourceId="google-sheets" binding={tier2Binding()} />);
    expect(screen.getByText(/count open rows per owner/)).toBeInTheDocument();
    expect(screen.getByText("test/model")).toBeInTheDocument();
    expect(screen.getByText("sheets_tx_abc12345")).toBeInTheDocument();
  });

  it("offers no instruction box: the tier is settled, not re-chosen", () => {
    render(<SheetComputePanel sourceId="google-sheets" binding={tier2Binding()} />);
    expect(screen.queryByLabelText("Instruction")).not.toBeInTheDocument();
  });

  it("says a compiled-but-inactive binding is switched off", () => {
    render(
      <SheetComputePanel
        sourceId="google-sheets"
        binding={tier2Binding({ activated: false })}
      />,
    );
    expect(screen.getByText(/Compiled but switched off/)).toBeInTheDocument();
  });

  it("re-tests on request", async () => {
    vi.mocked(retestSheetBindingCode).mockResolvedValue({
      status: "ok", binding: "read_open_projects", compute: status(),
    });
    render(<SheetComputePanel sourceId="google-sheets" binding={tier2Binding()} />);

    fireEvent.click(screen.getByText("Re-test"));

    await waitFor(() =>
      expect(retestSheetBindingCode).toHaveBeenCalledWith(
        "google-sheets", "read_open_projects",
      ),
    );
  });

  it("can be switched off from the editor", async () => {
    vi.mocked(markSheetBindingStale).mockResolvedValue({
      status: "ok", binding: "read_open_projects", compute: status({ stale: true }),
    });
    render(<SheetComputePanel sourceId="google-sheets" binding={tier2Binding()} />);

    fireEvent.click(screen.getByText("Switch off"));

    await waitFor(() => expect(markSheetBindingStale).toHaveBeenCalled());
  });

  it("refuses to offer a recompile once a person has edited the code", () => {
    render(
      <SheetComputePanel
        sourceId="google-sheets"
        binding={tier2Binding({ edited_by_human: true })}
      />,
    );
    expect(screen.getByText("Recompile")).toBeDisabled();
    expect(screen.getByText(/will not be regenerated/)).toBeInTheDocument();
  });

  it("recompiles from the stored instruction, forcing a fresh generation", async () => {
    vi.mocked(compileSheetBindingCode).mockResolvedValue(OK_RESULT);
    render(<SheetComputePanel sourceId="google-sheets" binding={tier2Binding()} />);

    fireEvent.click(screen.getByText("Recompile"));

    await waitFor(() =>
      expect(compileSheetBindingCode).toHaveBeenCalledWith(
        "google-sheets", "read_open_projects",
        { instruction: "count open rows per owner", force: true },
      ),
    );
  });
});

// ─── Staleness ───────────────────────────────────────────────────────────────

describe("staleness", () => {
  it("says why a binding is stale and that it is not running", () => {
    render(
      <SheetComputePanel
        sourceId="google-sheets"
        binding={tier2Binding({
          stale: true,
          stale_reason: "the sheet's header row changed since this binding was saved",
        })}
      />,
    );
    expect(screen.getByText(/Stale, and not running/)).toBeInTheDocument();
    expect(screen.getByText(/header row changed/)).toBeInTheDocument();
    expect(screen.getByText("Re-test")).toBeInTheDocument();
  });

  it("tells a stale WRITE it needs re-confirmation", () => {
    render(
      <SheetComputePanel
        sourceId="google-sheets"
        writesEnabled
        binding={{
          ...tier2Binding({ operation: "write", stale: true, stale_reason: "drift" }),
          operation: "write",
        }}
      />,
    );
    expect(screen.getByText(/needs re-confirmation before it can run/)).toBeInTheDocument();
  });
});

// ─── The write flag ──────────────────────────────────────────────────────────

describe("the tier-2 write flag", () => {
  const writeBinding = tier1Binding({
    name: "update_project",
    operation: "write",
    read: null,
    write: {
      mode: "update_by_key",
      key_column: "project_id",
      columns: { status: { literal: "" } },
    },
  });

  it("hides the panel entirely for a write while the flag is off", () => {
    const { container } = render(
      <SheetComputePanel sourceId="google-sheets" binding={writeBinding} />,
    );
    // Not a disabled button: the capability is absent, which is the honest way
    // to represent something the backend would refuse.
    expect(container).toBeEmptyDOMElement();
  });

  it("offers generation for a write once the flag is on", () => {
    render(
      <SheetComputePanel sourceId="google-sheets" binding={writeBinding} writesEnabled />,
    );
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "total hours by owner" },
    });
    fireEvent.click(screen.getByText("Check what this needs"));
    expect(screen.getByText("Generate code")).toBeInTheDocument();
  });

  it("points a blocked write at the tier-1 composition instead", () => {
    // An already-generated write still renders, so its state is visible, but
    // the escalation route is closed and says what to do instead.
    render(
      <SheetComputePanel
        sourceId="google-sheets"
        binding={{ ...tier2Binding({ operation: "write" }), operation: "write" }}
      />,
    );
    expect(screen.getByText("Recompile")).toBeDisabled();
  });
});

// ─── Failure ─────────────────────────────────────────────────────────────────

describe("when generation fails", () => {
  it("shows the checker's message and points at tier 1 plus a separate step", async () => {
    vi.mocked(compileSheetBindingCode).mockRejectedValue(
      new Error("API 422: 'eval' is not allowed in a transform"),
    );
    render(<SheetComputePanel sourceId="google-sheets" binding={tier1Binding()} />);
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "total hours by owner" },
    });
    fireEvent.click(screen.getByText("Check what this needs"));
    fireEvent.click(screen.getByText("Generate code"));

    await waitFor(() =>
      expect(screen.getByText(/'eval' is not allowed/)).toBeInTheDocument(),
    );
    // Tier 3 is out of scope, so the way forward is a read binding plus a step.
    expect(
      screen.getByText(/declarative read binding plus a separate workflow step/),
    ).toBeInTheDocument();
  });
});
