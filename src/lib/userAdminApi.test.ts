import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./oidc", () => ({ getAccessToken: vi.fn(async () => "tok") }));

import { deleteUser, listUsers, saveLoginScript, setUserTeam, testLoginScript } from "./api";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function respond(status: number, body: string | null) {
  fetchMock.mockImplementation(async () => new Response(body, { status }));
}

function lastCall(): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : undefined };
}

describe("listUsers", () => {
  it("fills team_id/team_name from the team object", async () => {
    respond(200, JSON.stringify([
      { sub: "u1", name: "Ann", email: null, team: { id: "t1", name: "One", role: "admin" }, is_super_admin: true, roles: ["admin"], last_seen: null },
    ]));
    const [u] = await listUsers();
    expect(u).toMatchObject({ team_id: "t1", team_name: "One", team: { id: "t1", role: "admin" }, is_super_admin: true, roles: ["admin"] });
  });

  it("fills the team object from an older flat row", async () => {
    respond(200, JSON.stringify([{ sub: "u1", name: "Ann", email: "a@x", team_id: "t1", team_name: "One" }]));
    const [u] = await listUsers();
    expect(u.team).toEqual({ id: "t1", name: "One" });
  });

  it("keeps a user without a team in none", async () => {
    respond(200, JSON.stringify([{ sub: "u1", name: null, email: null, team: null }]));
    const [u] = await listUsers();
    expect(u).toMatchObject({ team: null, team_id: null, team_name: null });
  });
});

describe("user admin calls", () => {
  it("sets and clears a user's team", async () => {
    respond(200, "{}");
    await setUserTeam("a/b", "t1", "admin");
    expect(lastCall()).toMatchObject({ url: expect.stringMatching(/\/users\/a%2Fb\/team$/), method: "PUT", body: { team_id: "t1", role: "admin" } });
    await setUserTeam("u1", null);
    expect(lastCall().body).toEqual({ team_id: null, role: "member" });
  });

  it("deletes a user", async () => {
    respond(204, null);
    await deleteUser("u1");
    expect(lastCall()).toMatchObject({ url: expect.stringMatching(/\/users\/u1$/), method: "DELETE" });
  });
});

describe("login script calls", () => {
  it("sends an empty script as null", async () => {
    respond(200, JSON.stringify({ source: "none", editable: true, script: null, timeout_ms: 1000, updated_at: null, updated_by: null }));
    await saveLoginScript("   ");
    expect(lastCall()).toMatchObject({ url: expect.stringMatching(/\/auth\/login-script$/), method: "PUT", body: { script: null } });
  });

  it("surfaces a compile error's detail", async () => {
    respond(400, JSON.stringify({ detail: "SyntaxError: Unexpected token" }));
    await expect(saveLoginScript("function (")).rejects.toThrow(/^SyntaxError: Unexpected token$/);
  });

  it("posts a test run", async () => {
    respond(200, JSON.stringify({ ok: true, result: {}, error: null, duration_ms: 3 }));
    await testLoginScript({ claims: { sub: "1" }, sub: "u1" });
    expect(lastCall()).toMatchObject({ url: expect.stringMatching(/\/auth\/login-script\/test$/), method: "POST", body: { claims: { sub: "1" }, sub: "u1" } });
  });
});
