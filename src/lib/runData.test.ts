/**
 * The run-data client: URL resolution and the two expected failures.
 *
 * `download_url` is allowed to be either a backend-relative path or an absolute
 * signed URL, and the two need opposite handling — a signed URL must be opened,
 * never fetched, because attaching a bearer token to a cross-origin GET only
 * puts a CORS failure between the user and their file.
 *
 * 410 is not a fault. It is what the endpoint says after the retention window,
 * and it has to arrive as its own error type so the panel can explain it
 * instead of reporting a failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./oidc", () => ({ getAccessToken: vi.fn(async () => "tok_123") }));

import {
  downloadRunDataArtifact,
  downloadRunDataZip,
  getRunData,
  resolveRunDataUrl,
  RunDataExpiredError,
  RunDataZipUnavailableError,
} from "./api";
import { BACKEND_URL } from "./config";

const BASE = `${BACKEND_URL}/api/v1`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fileResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": 'attachment; filename="open_projects.jsonl"',
    },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let openMock: ReturnType<typeof vi.fn>;
let clickMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  openMock = vi.fn();
  clickMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", openMock);
  // jsdom implements neither, and the anchor click is how the blob is saved.
  URL.createObjectURL = vi.fn(() => "blob:run-data");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── The manifest ────────────────────────────────────────────────────────────

describe("getRunData", () => {
  it("reads the run's manifest", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ run_id: "run_abc", artifacts: [] }));

    const manifest = await getRunData("run_abc");

    expect(manifest).toEqual({ run_id: "run_abc", artifacts: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/runs/run_abc/data`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok_123" }),
      }),
    );
  });
});

// ─── URL resolution ──────────────────────────────────────────────────────────

describe("resolveRunDataUrl", () => {
  it("treats an absolute url as signed and leaves it alone", () => {
    expect(resolveRunDataUrl("https://storage.example/x?sig=abc")).toEqual({
      url: "https://storage.example/x?sig=abc",
      signed: true,
    });
  });

  it("joins a bare path to the versioned api base", () => {
    expect(resolveRunDataUrl("/runs/run_abc/data/art_1")).toEqual({
      url: `${BASE}/runs/run_abc/data/art_1`,
      signed: false,
    });
  });

  it("does not double the prefix on a path that already carries it", () => {
    expect(resolveRunDataUrl("/api/v1/runs/run_abc/data/art_1")).toEqual({
      url: `${BACKEND_URL}/api/v1/runs/run_abc/data/art_1`,
      signed: false,
    });
  });
});

// ─── Downloading one artifact ────────────────────────────────────────────────

describe("downloadRunDataArtifact", () => {
  it("fetches a relative path with the bearer token and saves the bytes", async () => {
    fetchMock.mockResolvedValue(fileResponse('{"id":1}\n'));

    await downloadRunDataArtifact({
      filename: "open_projects.jsonl",
      download_url: "/runs/run_abc/data/art_1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/runs/run_abc/data/art_1`,
      { headers: { Authorization: "Bearer tok_123" } },
    );
    expect(clickMock).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("opens a signed url instead of fetching it", async () => {
    await downloadRunDataArtifact({
      filename: "open_projects.jsonl",
      download_url: "https://storage.example/x?sig=abc",
    });

    expect(openMock).toHaveBeenCalledWith("https://storage.example/x?sig=abc", "_blank", "noopener");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a 410 into RunDataExpiredError carrying the backend's detail", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "Artifact expired on 2026-09-10T12:00:00Z" }, 410),
    );

    await expect(
      downloadRunDataArtifact({ filename: "x.jsonl", download_url: "/runs/r/data/a" }),
    ).rejects.toThrowError(RunDataExpiredError);
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "Artifact expired on 2026-09-10T12:00:00Z" }, 410),
    );
    await expect(
      downloadRunDataArtifact({ filename: "x.jsonl", download_url: "/runs/r/data/a" }),
    ).rejects.toThrow("Artifact expired on 2026-09-10T12:00:00Z");
  });

  it("still explains a 410 whose body is not the json envelope", async () => {
    fetchMock.mockResolvedValue(new Response("gone", { status: 410 }));
    await expect(
      downloadRunDataArtifact({ filename: "x.jsonl", download_url: "/runs/r/data/a" }),
    ).rejects.toThrow(/expired/i);
  });

  it("leaves a 404 as an ordinary error — an unknown artifact is a bug, not a lifecycle", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Unknown artifact" }, 404));

    const err = await downloadRunDataArtifact({
      filename: "x.jsonl",
      download_url: "/runs/r/data/a",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RunDataExpiredError);
    expect(err.message).toBe("Unknown artifact");
  });
});

// ─── The optional archive ────────────────────────────────────────────────────

describe("downloadRunDataZip", () => {
  it("saves the archive when the endpoint exists", async () => {
    fetchMock.mockResolvedValue(new Response("PK", { status: 200 }));

    await downloadRunDataZip("run_abc");

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/runs/run_abc/data.zip`,
      { headers: { Authorization: "Bearer tok_123" } },
    );
    expect(clickMock).toHaveBeenCalledOnce();
  });

  it("reports a 404 as 'not implemented here', which the caller degrades on", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Not Found" }, 404));
    await expect(downloadRunDataZip("run_abc")).rejects.toThrowError(
      RunDataZipUnavailableError,
    );
  });

  it("reports a 410 as expiry", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "purged" }, 410));
    await expect(downloadRunDataZip("run_abc")).rejects.toThrowError(RunDataExpiredError);
  });
});
