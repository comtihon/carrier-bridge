/**
 * The run view's data panel.
 *
 * The failure this file is mostly about is silent: someone downloads a
 * truncated export, believes it is the whole answer, and acts on it. So the
 * tests assert the truncation warning is *text on the surface* — findable by
 * its words, not hidden in a title attribute — and that it appears both as a
 * row badge and as a sentence.
 *
 * The rest cover the outcomes that are expected rather than exceptional: an
 * empty manifest (a run with no data step), an artifact past its retention
 * window, and a 410 arriving from a download the manifest still listed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RunDataArtifact } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getRunData: vi.fn(),
    downloadRunDataArtifact: vi.fn(),
    downloadRunDataZip: vi.fn(),
  };
});

import {
  downloadRunDataArtifact,
  downloadRunDataZip,
  getRunData,
  RunDataExpiredError,
  RunDataZipUnavailableError,
} from "@/lib/api";
import { RunDataPanel, isExpired, relativeExpiry } from "./RunDataPanel";

const NOW = new Date("2026-09-03T12:00:00Z");

function artifact(overrides: Partial<RunDataArtifact> = {}): RunDataArtifact {
  return {
    id: "art_9f2c4a",
    step_id: "export_rows",
    name: "open_projects",
    format: "jsonl",
    filename: "open_projects.jsonl",
    shape: "list",
    items: 1234,
    bytes: 456789,
    truncated: false,
    source_id: "google-sheets",
    operation: "read_open_projects",
    created_at: "2026-09-03T12:00:00Z",
    expires_at: "2026-09-10T12:00:00Z",
    download_url: "/runs/run_abc/data/art_9f2c4a",
    ...overrides,
  };
}

function manifest(artifacts: RunDataArtifact[]) {
  return { run_id: "run_abc", artifacts };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  vi.mocked(getRunData).mockResolvedValue(manifest([artifact()]));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── The manifest list ───────────────────────────────────────────────────────

describe("the artifact list", () => {
  it("shows filename, step, item count, human size, format and expiry", async () => {
    render(<RunDataPanel runId="run_abc" />);

    expect(await screen.findByText("open_projects.jsonl")).toBeInTheDocument();
    expect(screen.getByText("export_rows")).toBeInTheDocument();
    expect(screen.getByText("1,234 items")).toBeInTheDocument();
    expect(screen.getByText("446.1 KB")).toBeInTheDocument();
    expect(screen.getByText("jsonl")).toBeInTheDocument();
    expect(screen.getByText(/expires in 7 days/)).toBeInTheDocument();
    expect(screen.getByText("google-sheets/read_open_projects")).toBeInTheDocument();
  });

  it("says capturing the data changed nothing about the run", async () => {
    render(<RunDataPanel runId="run_abc" />);
    expect(await screen.findByText(/Capturing changed nothing about the/)).toBeInTheDocument();
  });

  it("downloads through the manifest's own url", async () => {
    vi.mocked(downloadRunDataArtifact).mockResolvedValue(undefined);
    render(<RunDataPanel runId="run_abc" />);

    fireEvent.click(await screen.findByText("Download"));

    await waitFor(() => expect(downloadRunDataArtifact).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadRunDataArtifact).mock.calls[0][0]).toMatchObject({
      download_url: "/runs/run_abc/data/art_9f2c4a",
      filename: "open_projects.jsonl",
    });
  });

  it("reports a real failure as a failure", async () => {
    vi.mocked(downloadRunDataArtifact).mockRejectedValue(new Error("API 500: boom"));
    render(<RunDataPanel runId="run_abc" />);

    fireEvent.click(await screen.findByText("Download"));

    expect(await screen.findByText("API 500: boom")).toBeInTheDocument();
  });

  it("surfaces a manifest read failure", async () => {
    vi.mocked(getRunData).mockRejectedValue(new Error("API 503: unavailable"));
    render(<RunDataPanel runId="run_abc" />);
    expect(await screen.findByText("API 503: unavailable")).toBeInTheDocument();
  });
});

// ─── Truncation ──────────────────────────────────────────────────────────────

describe("a truncated artifact", () => {
  it("is badged and explained in words, not in a tooltip", async () => {
    vi.mocked(getRunData).mockResolvedValue(
      manifest([artifact({ truncated: true, items: 5000 })]),
    );
    render(<RunDataPanel runId="run_abc" />);

    // The badge on the row.
    expect(await screen.findByText(/Truncated — partial export/)).toBeInTheDocument();
    // And the sentence, saying what that means for the file.
    expect(screen.getByText(/This file is incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/a prefix of the data, not all of it/)).toBeInTheDocument();
    expect(screen.getByText(/holds the first/)).toHaveTextContent("5,000 items");
  });

  it("warns at the top of the panel too, so it survives a long list", async () => {
    vi.mocked(getRunData).mockResolvedValue(
      manifest([
        artifact({ id: "a1", truncated: true }),
        artifact({ id: "a2", name: "summary", filename: "summary.json", format: "json" }),
      ]),
    );
    render(<RunDataPanel runId="run_abc" />);

    expect(
      await screen.findByText(/One of these files is truncated/),
    ).toBeInTheDocument();
  });

  it("counts them when several are truncated", async () => {
    vi.mocked(getRunData).mockResolvedValue(
      manifest([
        artifact({ id: "a1", truncated: true }),
        artifact({ id: "a2", truncated: true, filename: "summary.json" }),
      ]),
    );
    render(<RunDataPanel runId="run_abc" />);
    expect(await screen.findByText(/2 of these files are truncated/)).toBeInTheDocument();
  });

  it("leaves a complete file unmarked", async () => {
    render(<RunDataPanel runId="run_abc" />);
    await screen.findByText("open_projects.jsonl");
    expect(screen.queryByText(/Truncated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/This file is incomplete/)).not.toBeInTheDocument();
  });
});

// ─── Expiry ──────────────────────────────────────────────────────────────────

describe("an expired artifact", () => {
  it("renders as expired instead of offering a download that would 410", async () => {
    vi.mocked(getRunData).mockResolvedValue(
      manifest([artifact({ expires_at: "2026-09-01T12:00:00Z" })]),
    );
    render(<RunDataPanel runId="run_abc" />);

    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/expired 2 days ago/)).toBeInTheDocument();
    expect(screen.queryByText("Download")).not.toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });

  it("still offers a download while the window is open", async () => {
    render(<RunDataPanel runId="run_abc" />);
    expect(await screen.findByText("Download")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("explains a 410 as the retention window rather than a failure", async () => {
    vi.mocked(downloadRunDataArtifact).mockRejectedValue(
      new RunDataExpiredError("This export expired on 2026-09-10."),
    );
    render(<RunDataPanel runId="run_abc" />);

    fireEvent.click(await screen.findByText("Download"));

    expect(await screen.findByText("This export expired on 2026-09-10.")).toBeInTheDocument();
    expect(screen.getByText(/kept only for the retention window/)).toBeInTheDocument();
    expect(screen.getByText(/Re-run the workflow to export it again/)).toBeInTheDocument();
    // The row is now what the 410 said it is, so it stops offering a download.
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByText("Download")).not.toBeInTheDocument();
  });
});

describe("isExpired", () => {
  it("is true only once the moment has passed", () => {
    expect(isExpired("2026-09-01T00:00:00Z", NOW.getTime())).toBe(true);
    expect(isExpired("2026-09-10T00:00:00Z", NOW.getTime())).toBe(false);
  });

  it("does not hide a file whose timestamp cannot be parsed", () => {
    expect(isExpired("not a date", NOW.getTime())).toBe(false);
    expect(isExpired(null, NOW.getTime())).toBe(false);
  });
});

describe("relativeExpiry", () => {
  it("reads forwards and backwards", () => {
    expect(relativeExpiry("2026-09-10T12:00:00Z", NOW.getTime())).toBe("in 7 days");
    expect(relativeExpiry("2026-09-03T13:00:00Z", NOW.getTime())).toBe("in 1 hour");
    expect(relativeExpiry("2026-09-02T12:00:00Z", NOW.getTime())).toBe("1 day ago");
  });
});

// ─── Empty ───────────────────────────────────────────────────────────────────

describe("an empty manifest", () => {
  it("is a normal outcome, stated plainly, and not an error", async () => {
    vi.mocked(getRunData).mockResolvedValue(manifest([]));
    render(<RunDataPanel runId="run_abc" />);

    expect(await screen.findByText("No data was captured on this run.")).toBeInTheDocument();
    expect(screen.getByText(/no data step, or the run did not reach one/)).toBeInTheDocument();
    expect(screen.getByText(/normal — nothing failed/)).toBeInTheDocument();
  });
});

// ─── Download all ───────────────────────────────────────────────────────────

describe("download all", () => {
  const two = () =>
    manifest([
      artifact({ id: "a1" }),
      artifact({ id: "a2", name: "summary", filename: "summary.json", format: "json" }),
    ]);

  it("is offered once there is more than one file", async () => {
    vi.mocked(getRunData).mockResolvedValue(two());
    vi.mocked(downloadRunDataZip).mockResolvedValue(undefined);
    render(<RunDataPanel runId="run_abc" />);

    fireEvent.click(await screen.findByText("Download all"));
    await waitFor(() => expect(downloadRunDataZip).toHaveBeenCalledWith("run_abc"));
  });

  it("is not offered for a single file", async () => {
    render(<RunDataPanel runId="run_abc" />);
    await screen.findByText("open_projects.jsonl");
    expect(screen.queryByText("Download all")).not.toBeInTheDocument();
  });

  it("retires itself when the backend does not implement the endpoint", async () => {
    vi.mocked(getRunData).mockResolvedValue(two());
    vi.mocked(downloadRunDataZip).mockRejectedValue(
      new RunDataZipUnavailableError("no zip here"),
    );
    render(<RunDataPanel runId="run_abc" />);

    fireEvent.click(await screen.findByText("Download all"));

    // Degraded, not broken: the per-file downloads are still there.
    await waitFor(() =>
      expect(screen.queryByText("Download all")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("no zip here")).not.toBeInTheDocument();
    expect(screen.getAllByText("Download")).toHaveLength(2);
  });
});
