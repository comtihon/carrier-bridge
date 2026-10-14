import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listTeams: vi.fn(),
    listUsers: vi.fn(),
    setUserTeam: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
    getLoginScript: vi.fn(),
    saveLoginScript: vi.fn(),
    testLoginScript: vi.fn(),
    createTeam: vi.fn(),
    renameTeam: vi.fn(),
    deleteTeam: vi.fn(),
    setTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
  };
});

import * as api from "@/lib/api";
import type { CurrentUser, LoginScript, Team, UserInfo } from "@/lib/api";
import { AdminView } from "./admin/AdminView";
import { UsersAdmin, formatLastSeen } from "./admin/UsersAdmin";
import { LoginScriptAdmin } from "./admin/LoginScriptAdmin";
import { TeamsPanel } from "./panels/TeamsPanel";

const SUPER: CurrentUser = { sub: "u-root", name: "Root", is_admin: true, is_super_admin: true, auth_enabled: true, team: null };
const TEAM_ADMIN: CurrentUser = {
  sub: "u-me", name: "Me", is_admin: false, is_super_admin: false, auth_enabled: true,
  team: { id: "t-alpha", name: "Alpha", role: "admin" },
};

const TEAMS: Team[] = [
  { id: "t-alpha", name: "Alpha", members: [] },
  { id: "t-beta", name: "Beta", members: [] },
];
const USERS: UserInfo[] = [
  {
    sub: "u-root", name: "Root", email: "root@example.com", team: null, team_id: null, team_name: null,
    is_super_admin: true, roles: ["admin", "ops"], last_seen: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    sub: "u-bob", name: "Bob", email: "bob@example.com", team: { id: "t-alpha", name: "Alpha", role: "member" },
    team_id: "t-alpha", team_name: "Alpha", is_super_admin: false, roles: [], last_seen: null,
  },
  {
    sub: "u-cat", name: "Cat", email: null, team: { id: "t-beta", name: "Beta", role: "admin" },
    team_id: "t-beta", team_name: "Beta", is_super_admin: false, roles: ["engineering"], last_seen: null,
  },
];

function script(over: Partial<LoginScript> = {}): LoginScript {
  return { source: "none", editable: true, script: null, timeout_ms: 500, updated_at: null, updated_by: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listTeams).mockResolvedValue(TEAMS);
  vi.mocked(api.listUsers).mockResolvedValue(USERS);
  vi.mocked(api.getLoginScript).mockResolvedValue(script());
});

describe("formatLastSeen", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  it("reads relative times", () => {
    expect(formatLastSeen(null, now)).toBe("never");
    expect(formatLastSeen("2026-01-10T11:59:30Z", now)).toBe("just now");
    expect(formatLastSeen("2026-01-10T11:45:00Z", now)).toBe("15 min ago");
    expect(formatLastSeen("2026-01-10T09:00:00Z", now)).toBe("3 h ago");
    expect(formatLastSeen("2026-01-09T12:00:00Z", now)).toBe("1 day ago");
  });
});

describe("the users table", () => {
  it("lists users with team, role, super admin badge, roles and last seen", async () => {
    render(<UsersAdmin me={SUPER} />);
    const root = await screen.findByTestId("user-u-root");
    expect(within(root).getByText("(you)")).toBeInTheDocument();
    const badge = within(root).getByLabelText("Super admin");
    expect(badge).toHaveAttribute("title", expect.stringMatching(/identity provider/));
    expect(within(root).getByText("ops")).toBeInTheDocument();
    expect(within(root).getByText("5 min ago")).toBeInTheDocument();
    expect(within(root).getByRole("combobox", { name: "Team of Root" })).toHaveValue("");
    expect(within(root).getByRole("combobox", { name: "Team role of Root" })).toBeDisabled();

    const cat = screen.getByTestId("user-u-cat");
    expect(within(cat).getByRole("combobox", { name: "Team of Cat" })).toHaveValue("t-beta");
    expect(within(cat).getByRole("combobox", { name: "Team role of Cat" })).toHaveValue("admin");
    expect(within(cat).queryByLabelText("Super admin")).toBeNull();
  });

  it("filters by name, email, sub, team or role", async () => {
    render(<UsersAdmin me={SUPER} />);
    await screen.findByTestId("user-u-bob");
    const search = screen.getByRole("textbox", { name: "Search users" });
    fireEvent.change(search, { target: { value: "bob@" } });
    expect(screen.queryByTestId("user-u-root")).toBeNull();
    expect(screen.getByTestId("user-u-bob")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "engineering" } });
    expect(screen.getByTestId("user-u-cat")).toBeInTheDocument();
    expect(screen.queryByTestId("user-u-bob")).toBeNull();
    fireEvent.change(search, { target: { value: "nobody" } });
    expect(screen.getByText("No users match.")).toBeInTheDocument();
  });

  it("moves a user to another team, keeping their role", async () => {
    render(<UsersAdmin me={SUPER} />);
    const bob = await screen.findByTestId("user-u-bob");
    fireEvent.change(within(bob).getByRole("combobox", { name: "Team of Bob" }), { target: { value: "t-beta" } });
    await waitFor(() => expect(api.setUserTeam).toHaveBeenCalledWith("u-bob", "t-beta", "member"));
    await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(2));
  });

  it("takes a user out of every team", async () => {
    render(<UsersAdmin me={SUPER} />);
    const cat = await screen.findByTestId("user-u-cat");
    fireEvent.change(within(cat).getByRole("combobox", { name: "Team of Cat" }), { target: { value: "" } });
    await waitFor(() => expect(api.setUserTeam).toHaveBeenCalledWith("u-cat", null, "admin"));
  });

  it("changes a user's role in their team", async () => {
    render(<UsersAdmin me={SUPER} />);
    const bob = await screen.findByTestId("user-u-bob");
    fireEvent.change(within(bob).getByRole("combobox", { name: "Team role of Bob" }), { target: { value: "admin" } });
    await waitFor(() => expect(api.setUserTeam).toHaveBeenCalledWith("u-bob", "t-alpha", "admin"));
  });

  it("deletes a user only after confirming in the page", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<UsersAdmin me={SUPER} />);
    const bob = await screen.findByTestId("user-u-bob");
    fireEvent.click(within(bob).getByRole("button", { name: "Delete Bob" }));
    expect(api.deleteUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/next login/)).toBeNull();

    fireEvent.click(within(bob).getByRole("button", { name: "Delete Bob" }));
    expect(screen.getByText(/next login/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteUser).toHaveBeenCalledWith("u-bob"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("shows the backend's reason when a change is refused", async () => {
    vi.mocked(api.setUserTeam).mockRejectedValueOnce(new Error("Team not found"));
    render(<UsersAdmin me={SUPER} />);
    const bob = await screen.findByTestId("user-u-bob");
    fireEvent.change(within(bob).getByRole("combobox", { name: "Team of Bob" }), { target: { value: "t-beta" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Team not found");
  });

  it("warns that an active login script may overwrite membership", async () => {
    vi.mocked(api.getLoginScript).mockResolvedValue(script({ source: "db", script: "function onLogin(){}" }));
    render(<UsersAdmin me={SUPER} />);
    expect(await screen.findByRole("note")).toHaveTextContent(/overwrite a user's team membership at their next login/);
  });

  it("shows no warning without a login script", async () => {
    render(<UsersAdmin me={SUPER} />);
    await screen.findByTestId("user-u-bob");
    await waitFor(() => expect(api.getLoginScript).toHaveBeenCalled());
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the login script editor", () => {
  it("shows a stored script with who changed it, and saves edits", async () => {
    vi.mocked(api.getLoginScript).mockResolvedValue(script({
      source: "db", script: "function onLogin(ctx) {}", updated_at: "2026-01-10T12:00:00Z", updated_by: "root@example.com",
    }));
    vi.mocked(api.saveLoginScript).mockImplementation(async (s) => script({ source: "db", script: s }));
    render(<LoginScriptAdmin />);
    expect(await screen.findByTestId("login-script-source")).toHaveTextContent("stored here");
    expect(screen.getByText(/by root@example.com/)).toBeInTheDocument();
    const editor = screen.getByDisplayValue("function onLogin(ctx) {}");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(editor, { target: { value: "function onLogin(ctx) { return {}; }" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(api.saveLoginScript).toHaveBeenCalledWith("function onLogin(ctx) { return {}; }"));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows a compile error from the backend", async () => {
    vi.mocked(api.getLoginScript).mockResolvedValue(script({ source: "db", script: "function onLogin(ctx) {}" }));
    vi.mocked(api.saveLoginScript).mockRejectedValue(new Error("SyntaxError: Unexpected end of input"));
    render(<LoginScriptAdmin />);
    const editor = await screen.findByDisplayValue("function onLogin(ctx) {}");
    fireEvent.change(editor, { target: { value: "function onLogin(" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SyntaxError: Unexpected end of input");
  });

  it("disables the script after confirming", async () => {
    vi.mocked(api.getLoginScript).mockResolvedValue(script({ source: "db", script: "function onLogin(ctx) {}" }));
    vi.mocked(api.saveLoginScript).mockResolvedValue(script());
    render(<LoginScriptAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
    expect(api.saveLoginScript).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: "Disable" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.saveLoginScript).toHaveBeenCalledWith(null));
    expect(await screen.findByTestId("login-script-source")).toHaveTextContent("disabled");
  });

  it("is read-only with an explanation when the config manages it", async () => {
    vi.mocked(api.getLoginScript).mockResolvedValue(script({ source: "config", editable: false, script: "function onLogin(ctx) {}" }));
    render(<LoginScriptAdmin />);
    expect(await screen.findByText(/set in the deployment's configuration/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
    expect(screen.getByDisplayValue("function onLogin(ctx) {}")).toHaveAttribute("readonly");
  });

  it("explains the onLogin contract", async () => {
    render(<LoginScriptAdmin />);
    expect(await screen.findByText("How the login script works")).toBeInTheDocument();
    expect(screen.getByText(/keeps the membership set by hand/)).toBeInTheDocument();
  });

  it("tests the draft against sample claims and a chosen user", async () => {
    vi.mocked(api.getLoginScript).mockResolvedValue(script({ source: "db", script: "function onLogin(ctx) {}" }));
    vi.mocked(api.testLoginScript).mockResolvedValue({ ok: true, result: { roles: ["eng"] }, error: null, duration_ms: 7 });
    render(<LoginScriptAdmin />);
    const claims = await screen.findByRole("textbox", { name: "Claims (JSON)" });
    expect(JSON.parse((claims as HTMLTextAreaElement).value)).toEqual({ sub: "123", email: "user@example.com", groups: ["engineering"] });
    const userSelect = screen.getByRole("combobox", { name: "Test as user" });
    await waitFor(() => expect(within(userSelect).getByRole("option", { name: "Bob" })).toBeInTheDocument());
    fireEvent.change(userSelect, { target: { value: "u-bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(api.testLoginScript).toHaveBeenCalledWith({
      script: "function onLogin(ctx) {}",
      claims: { sub: "123", email: "user@example.com", groups: ["engineering"] },
      sub: "u-bob",
    }));
    const result = screen.getByTestId("login-script-test-result");
    expect(await within(result).findByText("OK")).toBeInTheDocument();
    expect(within(result).getByText(/7 ms/)).toBeInTheDocument();
    expect(within(result).getByText(/"eng"/)).toBeInTheDocument();
  });

  it("shows a failing test's error", async () => {
    vi.mocked(api.testLoginScript).mockResolvedValue({ ok: false, result: null, error: "ReferenceError: x is not defined", duration_ms: 2 });
    render(<LoginScriptAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Run test" }));
    const result = screen.getByTestId("login-script-test-result");
    expect(await within(result).findByText("Failed")).toBeInTheDocument();
    expect(within(result).getByText("ReferenceError: x is not defined")).toBeInTheDocument();
  });

  it("refuses claims that are not a JSON object before calling the backend", async () => {
    render(<LoginScriptAdmin />);
    const claims = await screen.findByRole("textbox", { name: "Claims (JSON)" });
    fireEvent.change(claims, { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
    fireEvent.change(claims, { target: { value: "[1]" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText("Claims must be a JSON object.")).toBeInTheDocument();
    expect(api.testLoginScript).not.toHaveBeenCalled();
  });
});

describe("administration access", () => {
  it("shows Users and Login script tabs to a super admin", async () => {
    const onTabChange = vi.fn();
    render(<AdminView me={SUPER} tab="users" onTabChange={onTabChange} onClose={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Users" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Login script" }));
    expect(onTabChange).toHaveBeenCalledWith("login-script");
    expect(await screen.findByTestId("user-u-bob")).toBeInTheDocument();
  });

  it("renders nothing for anyone else", () => {
    const { container } = render(<AdminView me={TEAM_ADMIN} tab="users" onTabChange={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.listUsers).not.toHaveBeenCalled();
  });

  it("links to Users and Login script from the Teams panel for super admins", async () => {
    const onOpenAdmin = vi.fn();
    render(<TeamsPanel me={SUPER} onClose={vi.fn()} onOpenAdmin={onOpenAdmin} />);
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    expect(onOpenAdmin).toHaveBeenCalledWith("users");
    fireEvent.click(screen.getByRole("button", { name: "Login script" }));
    expect(onOpenAdmin).toHaveBeenCalledWith("login-script");
    await screen.findByTestId("team-t-alpha");
  });

  it("does not offer them to a team admin", async () => {
    render(<TeamsPanel me={TEAM_ADMIN} onClose={vi.fn()} onOpenAdmin={vi.fn()} />);
    await screen.findByTestId("team-t-alpha");
    expect(screen.queryByRole("button", { name: "Users" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Login script" })).toBeNull();
  });
});
