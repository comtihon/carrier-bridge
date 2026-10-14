import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    createAgent: vi.fn(async (p: Record<string, unknown>) => ({ ...p })),
    updateAgent: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    listAgentSummaries: vi.fn(),
    listScriptSummaries: vi.fn(),
    getScript: vi.fn(),
    listLlmProviders: vi.fn(async () => []),
    listTeams: vi.fn(),
    listUsers: vi.fn(),
    createTeam: vi.fn(async (name: string) => ({ id: "t-new", name, members: [] })),
    renameTeam: vi.fn(async (id: string, name: string) => ({ id, name, members: [] })),
    deleteTeam: vi.fn(async () => undefined),
    setTeamMember: vi.fn(async () => ({})),
    removeTeamMember: vi.fn(async () => undefined),
  };
});
vi.mock("@/hooks/useLlmProviders", () => ({ useLlmProviders: () => ({ providers: [], defaultProvider: null }) }));

import * as api from "@/lib/api";
import type { AgentDefinition, CurrentUser, ScriptSummary, Team, UserInfo } from "@/lib/api";
import { AgentModal } from "./WorkflowEditor";
import { AgentsPanel } from "./panels/AgentsPanel";
import { TeamsPanel } from "./panels/TeamsPanel";
import { DockRail } from "./panels/dock";
import { PythonStepFields } from "./PythonStepFields";
import { TeamTag, UsageScopeProvider, resetCurrentUserCache, scopeConflict } from "./Visibility";

const ALPHA = { id: "t-alpha", name: "Alpha" };
const MEMBER: CurrentUser = {
  sub: "u-me", name: "Me", is_admin: false, is_super_admin: false, auth_enabled: true,
  team: { ...ALPHA, role: "member" },
};
const NO_TEAM: CurrentUser = { sub: "u-me", name: "Me", is_admin: false, auth_enabled: true, team: null };
const SUPER: CurrentUser = { sub: "u-root", name: "Root", is_admin: true, is_super_admin: true, auth_enabled: true, team: null };
const TEAM_ADMIN: CurrentUser = { ...MEMBER, team: { ...ALPHA, role: "admin" } };

const TEAMS: Team[] = [
  { id: "t-alpha", name: "Alpha", members: [
    { sub: "u-me", name: "Me", email: "me@example.com", role: "admin" },
    { sub: "u-bob", name: "Bob", email: "bob@example.com", role: "member" },
  ] },
  { id: "t-beta", name: "Beta", members: [{ sub: "u-cat", name: "Cat", email: "cat@example.com", role: "member" }] },
];
const USERS: UserInfo[] = [
  { sub: "u-me", name: "Me", email: "me@example.com", team_id: "t-alpha", team_name: "Alpha" },
  { sub: "u-bob", name: "Bob", email: "bob@example.com", team_id: "t-alpha", team_name: "Alpha" },
  { sub: "u-cat", name: "Cat", email: "cat@example.com", team_id: "t-beta", team_name: "Beta" },
  { sub: "u-dan", name: "Dan", email: "dan@example.com", team_id: null, team_name: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetCurrentUserCache();
  vi.mocked(api.getCurrentUser).mockResolvedValue(MEMBER);
  vi.mocked(api.listTeams).mockResolvedValue(TEAMS);
  vi.mocked(api.listUsers).mockResolvedValue(USERS);
});

async function createAgentWithId(id: string) {
  fireEvent.change(screen.getByPlaceholderText("my-agent"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
}

describe("the visibility control", () => {
  it("offers Private, Team (named) and Public, and sends team without a team_id", async () => {
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    const team = await screen.findByRole("radio", { name: "Team" });
    expect(team).toHaveTextContent("Alpha");
    expect(team).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Private/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(team);
    expect(screen.getByText(/Members of Alpha can see it/)).toBeInTheDocument();
    await createAgentWithId("helper");
    await waitFor(() => expect(api.createAgent).toHaveBeenCalled());
    const body = vi.mocked(api.createAgent).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(body.visibility).toBe("team");
    expect(body).not.toHaveProperty("team_id");
  });

  it("disables Team for someone who is in no team", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue(NO_TEAM);
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    const team = await screen.findByRole("radio", { name: "Team" });
    expect(team).toBeDisabled();
    expect(team).toHaveAttribute("title", "You're not in a team");
  });

  it("lets a super admin with no team pick any team, and requires one", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue(SUPER);
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    const team = await screen.findByRole("radio", { name: "Team" });
    expect(team).toBeEnabled();
    fireEvent.click(team);
    const select = await screen.findByRole("combobox", { name: "Team" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "Beta" })).toBeInTheDocument());

    // No team chosen yet: refused before it reaches the backend.
    await createAgentWithId("helper");
    expect(await screen.findByText(/Choose the team/)).toBeInTheDocument();
    expect(api.createAgent).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "t-beta" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
    await waitFor(() => expect(api.createAgent).toHaveBeenCalled());
    expect(api.createAgent).toHaveBeenCalledWith(expect.objectContaining({ visibility: "team", team_id: "t-beta" }));
  });

  it("treats is_admin as super admin when is_super_admin is missing", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ sub: "u-root", name: "Root", is_admin: true, auth_enabled: true, team: null });
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Team" }));
    expect(await screen.findByRole("combobox", { name: "Team" })).toBeInTheDocument();
  });

  it("shows the team of an existing team resource", async () => {
    const shared: AgentDefinition = {
      id: "pi", name: "Pi", description: "coder", default_runtime: "local", agent_input: {},
      image: null, helm_chart: null, helm_values: {},
      visibility: "team", team_id: "t-alpha", team_name: "Alpha", owner_id: "u-bob", owner_name: "Bob", can_edit: false,
    };
    render(<AgentModal agent={shared} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("radio", { name: "Team" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Members of Alpha/)).toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
  });
});

describe("a backend without teams", () => {
  it("offers only Private and Public, as before", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ sub: "u-me", name: "Me", is_admin: false, auth_enabled: true });
    render(<AgentModal agent={null} onSave={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("radio", { name: /Private/ });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: "Team" })).not.toBeInTheDocument();
    expect(api.listTeams).not.toHaveBeenCalled();
  });
});

describe("lists", () => {
  it("marks team resources with the team", async () => {
    vi.mocked(api.listAgentSummaries).mockResolvedValue([
      { id: "a1", name: "Shared", description: "", default_runtime: "local", visibility: "team", team_id: "t-alpha", team_name: "Alpha" },
      { id: "a2", name: "Mine", description: "", default_runtime: "local", visibility: "private" },
      { id: "a3", name: "Legacy", description: "", default_runtime: "local" },
    ]);
    render(<AgentsPanel onClose={vi.fn()} onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(await screen.findByLabelText("Team: Alpha")).toBeInTheDocument();
    expect(screen.getByLabelText("Private")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^(Private|Team: .*)$/)).toHaveLength(2);
  });
});

describe("what a resource may use", () => {
  const pub = { visibility: "public" as const };
  const priv = { visibility: "private" as const };
  const alpha = { visibility: "team" as const, team_id: "t-alpha", team_name: "Alpha" };
  const beta = { visibility: "team" as const, team_id: "t-beta", team_name: "Beta" };

  it("follows public > team > private, and keeps teams apart", () => {
    const fromPublic = { visibility: "public" as const, teamId: null };
    expect(scopeConflict(fromPublic, pub)).toBeNull();
    expect(scopeConflict(fromPublic, alpha)).toMatch(/only use public/);
    expect(scopeConflict(fromPublic, priv)).toMatch(/only use public/);

    const fromAlpha = { visibility: "team" as const, teamId: "t-alpha" };
    expect(scopeConflict(fromAlpha, alpha)).toBeNull();
    expect(scopeConflict(fromAlpha, pub)).toBeNull();
    expect(scopeConflict(fromAlpha, priv)).toMatch(/can't use private/);
    expect(scopeConflict(fromAlpha, beta)).toMatch(/another team/);

    const fromPrivate = { visibility: "private" as const, teamId: "t-alpha" };
    expect(scopeConflict(fromPrivate, priv)).toBeNull();
    expect(scopeConflict(fromPrivate, alpha)).toBeNull();
    expect(scopeConflict(fromPrivate, beta)).toMatch(/another team/);

    // Legacy resources and editors outside any scope never block.
    expect(scopeConflict(null, priv)).toBeNull();
    expect(scopeConflict(fromPublic, {})).toBeNull();
  });

  it("greys out library scripts a public workflow can't use", async () => {
    const scripts: ScriptSummary[] = [
      { id: "s-pub", name: "Open", description: "", visibility: "public" },
      { id: "s-team", name: "Shared", description: "", visibility: "team", team_id: "t-alpha", team_name: "Alpha" },
      { id: "s-priv", name: "Mine", description: "", visibility: "private" },
    ];
    vi.mocked(api.listScriptSummaries).mockResolvedValue(scripts);
    render(
      <UsageScopeProvider scope={{ visibility: "public", teamId: null }}>
        <PythonStepFields config={{ id: "n1", type: "python", name: "Py", code: "", script_id: "" }} onChange={vi.fn()} />
      </UsageScopeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /library/i }));
    const open = await screen.findByRole("option", { name: "Open" });
    expect(open).toBeEnabled();
    expect(screen.getByRole("option", { name: /Shared · team/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Mine · private/ })).toBeDisabled();
  });

  it("lets a team workflow use its team's scripts but not private ones", async () => {
    vi.mocked(api.listScriptSummaries).mockResolvedValue([
      { id: "s-team", name: "Shared", description: "", visibility: "team", team_id: "t-alpha", team_name: "Alpha" },
      { id: "s-other", name: "Theirs", description: "", visibility: "team", team_id: "t-beta", team_name: "Beta" },
      { id: "s-priv", name: "Mine", description: "", visibility: "private" },
    ]);
    render(
      <UsageScopeProvider scope={{ visibility: "team", teamId: "t-alpha" }}>
        <PythonStepFields config={{ id: "n1", type: "python", name: "Py", code: "", script_id: "" }} onChange={vi.fn()} />
      </UsageScopeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /library/i }));
    expect(await screen.findByRole("option", { name: /^Shared · team$/ })).toBeEnabled();
    expect(screen.getByRole("option", { name: /Theirs/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Mine/ })).toBeDisabled();
  });
});

describe("Teams panel — super admin", () => {
  it("creates, renames and deletes teams", async () => {
    render(<TeamsPanel me={SUPER} onClose={vi.fn()} />);
    await screen.findByTestId("team-t-beta");

    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    fireEvent.change(screen.getByLabelText("New team name"), { target: { value: "Gamma" } });
    fireEvent.click(screen.getByTitle("Create team"));
    await waitFor(() => expect(api.createTeam).toHaveBeenCalledWith("Gamma"));

    const beta = screen.getByTestId("team-t-beta");
    fireEvent.click(within(beta).getByTitle("Rename team"));
    fireEvent.change(within(beta).getByLabelText("Team name"), { target: { value: "Bravo" } });
    fireEvent.click(within(beta).getByTitle("Save name"));
    await waitFor(() => expect(api.renameTeam).toHaveBeenCalledWith("t-beta", "Bravo"));

    fireEvent.click(within(screen.getByTestId("team-t-beta")).getByTitle("Delete team"));
    fireEvent.click(within(screen.getByTestId("team-t-beta")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteTeam).toHaveBeenCalledWith("t-beta"));
  });

  it("moves a user from another team", async () => {
    render(<TeamsPanel me={SUPER} onClose={vi.fn()} />);
    const alpha = await screen.findByTestId("team-t-alpha");
    const select = within(alpha).getByRole("combobox", { name: "Add member to Alpha" });
    const cat = within(select).getByRole("option", { name: "Cat (in Beta)" });
    expect(cat).toBeEnabled();
    fireEvent.change(select, { target: { value: "u-cat" } });
    fireEvent.click(within(alpha).getByTitle("Add member"));
    await waitFor(() => expect(api.setTeamMember).toHaveBeenCalledWith("t-alpha", "u-cat"));
  });

  it("shows the backend's reason when a change is refused", async () => {
    vi.mocked(api.deleteTeam).mockRejectedValueOnce(new Error("Team Beta still owns 3 team resources"));
    render(<TeamsPanel me={SUPER} onClose={vi.fn()} />);
    const beta = await screen.findByTestId("team-t-beta");
    fireEvent.click(within(beta).getByTitle("Delete team"));
    fireEvent.click(within(beta).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Team Beta still owns 3 team resources");
  });
});

describe("Teams panel — team admin", () => {
  beforeEach(() => {
    vi.mocked(api.listTeams).mockResolvedValue([TEAMS[0]]);
    vi.mocked(api.listUsers).mockResolvedValue(USERS.filter((u) => u.team_id === "t-alpha" || !u.team_id).concat(USERS[2]));
  });

  it("manages only the roster: no create, rename or delete", async () => {
    render(<TeamsPanel me={TEAM_ADMIN} onClose={vi.fn()} />);
    const alpha = await screen.findByTestId("team-t-alpha");
    expect(screen.queryByRole("button", { name: /New/ })).not.toBeInTheDocument();
    expect(within(alpha).queryByTitle("Rename team")).not.toBeInTheDocument();
    expect(within(alpha).queryByTitle("Delete team")).not.toBeInTheDocument();
    expect(within(alpha).getByText("admin")).toBeInTheDocument();
  });

  it("can add people in no team, not people in another team", async () => {
    render(<TeamsPanel me={TEAM_ADMIN} onClose={vi.fn()} />);
    const alpha = await screen.findByTestId("team-t-alpha");
    const select = within(alpha).getByRole("combobox", { name: "Add member to Alpha" });
    expect(within(select).getByRole("option", { name: "Cat (in Beta)" })).toBeDisabled();
    expect(within(select).getByRole("option", { name: "Dan" })).toBeEnabled();
    fireEvent.change(select, { target: { value: "u-dan" } });
    fireEvent.click(within(alpha).getByTitle("Add member"));
    await waitFor(() => expect(api.setTeamMember).toHaveBeenCalledWith("t-alpha", "u-dan"));
  });

  it("promotes, demotes and removes members", async () => {
    render(<TeamsPanel me={TEAM_ADMIN} onClose={vi.fn()} />);
    await screen.findByTestId("team-t-alpha");
    fireEvent.click(screen.getByRole("button", { name: "Promote Bob" }));
    await waitFor(() => expect(api.setTeamMember).toHaveBeenCalledWith("t-alpha", "u-bob", "admin"));
    fireEvent.click(screen.getByRole("button", { name: "Demote Me" }));
    await waitFor(() => expect(api.setTeamMember).toHaveBeenCalledWith("t-alpha", "u-me", "member"));
    fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
    await waitFor(() => expect(api.removeTeamMember).toHaveBeenCalledWith("t-alpha", "u-bob"));
  });
});

describe("the dock", () => {
  it("hides the Teams panel when asked", () => {
    render(<DockRail open={new Set()} onToggle={vi.fn()} hidden={new Set(["teams"])} />);
    expect(screen.queryByTitle("Open Teams")).not.toBeInTheDocument();
    expect(screen.getByTitle("Open Library")).toBeInTheDocument();
  });

  it("names a member's team and role", () => {
    render(<TeamTag me={MEMBER} />);
    expect(screen.getByTitle("Team Alpha — member")).toHaveTextContent("Alpha");
  });

  it("shows nothing for someone in no team", () => {
    const { container } = render(<TeamTag me={NO_TEAM} />);
    expect(container).toBeEmptyDOMElement();
  });
});
