import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ScriptDefinition, ScriptSummary } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listScriptSummaries: vi.fn(async () => [] as ScriptSummary[]),
    getScript: vi.fn(),
    createScript: vi.fn(),
  };
});

import { listScriptSummaries, getScript, createScript, ScriptNameConflictError } from "@/lib/api";
import { PythonStepFields } from "./PythonStepFields";
import type { EditableNodeConfig } from "@/lib/types";

const SCRIPT: ScriptDefinition = {
  id: "normalize-payload",
  name: "Normalize payload",
  description: "flattens the webhook body",
  code: 'output = state["payload"]',
};

// The picker lists summaries — no bodies. The chosen script's code arrives from
// getScript, so the library's whole source is not pulled to fill a dropdown.
const SCRIPT_SUMMARY: ScriptSummary = {
  id: SCRIPT.id, name: SCRIPT.name, description: SCRIPT.description,
};

function baseConfig(overrides: Partial<EditableNodeConfig> = {}): EditableNodeConfig {
  return { id: "node_1", type: "python", name: "Python", code: "output = 1", ...overrides };
}

describe("PythonStepFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listScriptSummaries).mockResolvedValue([SCRIPT_SUMMARY]);
  });

  it("treats a step with no explicit flag as sandboxed", async () => {
    render(<PythonStepFields config={baseConfig()} onChange={() => {}} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.getByText(/no backend env vars, tools, bash/i)).toBeInTheDocument();
  });

  it("hides the runtime picker once the sandbox is turned off", () => {
    render(<PythonStepFields config={baseConfig({ sandbox: false })} onChange={() => {}} />);
    expect(screen.queryByText(/child process/i)).not.toBeInTheDocument();
    expect(screen.getByText(/full access to its env vars/i)).toBeInTheDocument();
  });

  it("does not disable the sandbox until the warning is confirmed", async () => {
    const onChange = vi.fn();
    render(<PythonStepFields config={baseConfig()} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox"));

    // The change must not be applied by the click alone.
    expect(onChange).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/inside the backend process/i);
    expect(dialog).toHaveTextContent(/admin permission/i);
  });

  it("applies sandbox:false only after confirming", async () => {
    const onChange = vi.fn();
    render(<PythonStepFields config={baseConfig()} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /turn off sandbox/i }));

    expect(onChange).toHaveBeenCalledWith({ sandbox: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the sandbox on when the warning is dismissed", async () => {
    const onChange = vi.fn();
    render(<PythonStepFields config={baseConfig()} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /keep sandbox/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("re-enables the sandbox immediately, with no confirmation", async () => {
    const onChange = vi.fn();
    render(<PythonStepFields config={baseConfig({ sandbox: false })} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith({ sandbox: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("warns on an already-unsandboxed step that saving needs admin", () => {
    render(<PythonStepFields config={baseConfig({ sandbox: false })} onChange={() => {}} />);
    expect(screen.getByText(/requires admin permission to save/i)).toBeInTheDocument();
  });

  it("shows an image field only for the docker and k8s runtimes", () => {
    const { rerender } = render(
      <PythonStepFields config={baseConfig({ sandbox_runtime: "local" })} onChange={() => {}} />,
    );
    expect(screen.queryByPlaceholderText("python:3.12-slim")).not.toBeInTheDocument();

    rerender(<PythonStepFields config={baseConfig({ sandbox_runtime: "k8s" })} onChange={() => {}} />);
    expect(screen.getByPlaceholderText("python:3.12-slim")).toBeInTheDocument();
  });

  it("loads the body of a script picked from the library", async () => {
    vi.mocked(getScript).mockResolvedValue(SCRIPT);
    const onChange = vi.fn();
    render(<PythonStepFields config={baseConfig()} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /library/i }));
    const option = await screen.findByRole("option", { name: "Normalize payload" });
    const picker = option.closest("select")!;
    fireEvent.change(picker, { target: { value: "normalize-payload" } });

    await waitFor(() => expect(getScript).toHaveBeenCalledWith("normalize-payload"));
    expect(onChange).toHaveBeenCalledWith({ script_id: "normalize-payload", code: SCRIPT.code });
  });

  it("asks before overwriting a script whose name is taken", async () => {
    vi.mocked(createScript)
      .mockRejectedValueOnce(new ScriptNameConflictError("Script 'Cleanup' already exists"))
      .mockResolvedValueOnce({ ...SCRIPT, id: "cleanup", name: "Cleanup" });
    const onChange = vi.fn();
    render(<PythonStepFields config={baseConfig()} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Python"), { target: { value: "Cleanup" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await screen.findByText(/already exists\. Overwrite it\?/i);
    expect(createScript).toHaveBeenCalledWith(expect.objectContaining({ overwrite: false }));

    fireEvent.click(screen.getByRole("button", { name: /overwrite/i }));
    await waitFor(() =>
      expect(createScript).toHaveBeenLastCalledWith(expect.objectContaining({
        name: "Cleanup", overwrite: true,
      })),
    );
    // The node follows the saved copy so both stay in step.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ script_id: "cleanup" }));
  });
});
