import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./oidc", () => ({ getAccessToken: vi.fn(async () => "tok") }));

import { getCurrentUser, updateScript } from "./api";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function respond(status: number, body: string) {
  fetchMock.mockResolvedValue(new Response(body, { status }));
}

// Visibility refusals (403 not the owner, 409 still referenced, 422 public
// using private) carry a sentence for people in `detail`.
describe("API errors", () => {
  it("surfaces the backend's detail as the message", async () => {
    respond(409, JSON.stringify({ detail: "Cannot make this script private: workflow 'nightly' uses it" }));
    await expect(updateScript("s", { name: "s", code: "" })).rejects.toThrow(
      /^Cannot make this script private: workflow 'nightly' uses it$/,
    );
  });

  it("keeps the status prefix when the body is not a detail envelope", async () => {
    respond(500, "boom");
    await expect(updateScript("s", { name: "s", code: "" })).rejects.toThrow("API 500: boom");
  });
});

describe("getCurrentUser", () => {
  it("returns the caller", async () => {
    respond(200, JSON.stringify({ sub: "u1", name: "U", is_admin: false, auth_enabled: true }));
    await expect(getCurrentUser()).resolves.toMatchObject({ sub: "u1", auth_enabled: true });
  });

  it("is null on an older backend without /me", async () => {
    respond(404, JSON.stringify({ detail: "Not Found" }));
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
