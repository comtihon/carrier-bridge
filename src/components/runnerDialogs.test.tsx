import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    lookupRunnerEnrollment: vi.fn(),
    approveRunnerEnrollment: vi.fn(),
    denyRunnerEnrollment: vi.fn(async () => undefined),
  };
});

import * as api from "@/lib/api";
import type { CurrentUser, Runner, RunnerEnrollment } from "@/lib/api";
import {
  ApproveRunnerDialog, ConnectRunnerDialog, installPrompt, useApproveRunnerDeepLink,
} from "./RunnerDialogs";
import { resetCurrentUserCache } from "./Visibility";

const ME: CurrentUser = { sub: "u-me", name: "Me", is_admin: false, auth_enabled: true, team: null };

const enrollment: RunnerEnrollment = {
  id: "enr-1",
  hostname: "valerii-mbp",
  os: "darwin",
  arch: "arm64",
  tz: "Europe/Berlin",
  version: "0.4.0",
  agents: ["claude", "codex"],
  default_agent: "claude",
  request_ip: "203.0.113.7",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 9 * 60_000).toISOString(),
};

const runner = { id: "r1", name: "my laptop", agents: ["claude", "codex"] } as Runner;

beforeEach(() => {
  vi.clearAllMocks();
  resetCurrentUserCache();
  vi.mocked(api.getCurrentUser).mockResolvedValue(ME);
  vi.mocked(api.lookupRunnerEnrollment).mockResolvedValue(enrollment);
  vi.mocked(api.approveRunnerEnrollment).mockResolvedValue({
    runner,
    agents: [{ id: "claude-my-laptop", name: "Claude (my laptop)" } as api.AgentDefinition],
  });
});

function enterCode(code: string) {
  fireEvent.change(screen.getByLabelText("Approval number"), { target: { value: code } });
}

describe("ApproveRunnerDialog", () => {
  it("only lets a six-digit number through, spaces and dashes aside", () => {
    render(<ApproveRunnerDialog onClose={vi.fn()} />);
    const next = screen.getByRole("button", { name: "Next" });

    enterCode("482 91");
    expect(next).toBeDisabled();
    enterCode("482-913");
    expect(next).toBeEnabled();
  });

  it("looks the number up, shows the machine, then approves with the chosen settings", async () => {
    const onApproved = vi.fn();
    render(<ApproveRunnerDialog onClose={vi.fn()} onApproved={onApproved} />);

    enterCode("482 913");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(api.lookupRunnerEnrollment).toHaveBeenCalledWith("482913"));
    const details = await screen.findByTestId("enrollment-details");
    expect(details).toHaveTextContent("valerii-mbp");
    expect(details).toHaveTextContent("darwin / arm64");
    expect(details).toHaveTextContent("Europe/Berlin");
    expect(details).toHaveTextContent("Claude, Codex");
    expect(details).toHaveTextContent("203.0.113.7");
    expect(screen.getByText(/Never enter a number someone sent you/)).toBeInTheDocument();

    // Name defaults to the hostname, visibility to private, every agent ticked.
    expect(screen.getByLabelText("Name")).toHaveValue("valerii-mbp");
    expect(screen.getByRole("radio", { name: /Private/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radio", { name: /Public/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "my laptop" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Codex/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(api.approveRunnerEnrollment).toHaveBeenCalledWith("enr-1", {
      code: "482913",
      name: "my laptop",
      visibility: "private",
      agents: ["claude"],
    }));
    expect(await screen.findByText("my laptop")).toBeInTheDocument();
    expect(screen.getByText("Claude (my laptop)")).toBeInTheDocument();
    expect(onApproved).toHaveBeenCalled();
  });

  it("shows the backend's reason inline when no machine has that number", async () => {
    vi.mocked(api.lookupRunnerEnrollment).mockRejectedValue(new Error("No pending request has that number."));
    render(<ApproveRunnerDialog onClose={vi.fn()} />);

    enterCode("111111");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No pending request has that number.");
    // Still on the number: nothing to confirm.
    expect(screen.getByLabelText("Approval number")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("denies with the same number", async () => {
    render(<ApproveRunnerDialog onClose={vi.fn()} />);
    enterCode("482913");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));

    await waitFor(() => expect(api.denyRunnerEnrollment).toHaveBeenCalledWith("enr-1", "482913"));
    expect(await screen.findByText(/will not be connected/)).toBeInTheDocument();
    expect(api.approveRunnerEnrollment).not.toHaveBeenCalled();
  });
});

describe("ConnectRunnerDialog", () => {
  it("shows the install line with a copy button and leads to the number", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onHaveNumber = vi.fn();
    render(<ConnectRunnerDialog onClose={vi.fn()} onHaveNumber={onHaveNumber} />);

    expect(screen.getByTestId("install-prompt")).toHaveTextContent(
      /^Install acp-web-proxy and connect it to \S+: npx -y github:comtihon\/acp-web-proxy install \S+$/,
    );
    fireEvent.click(screen.getByTitle("Copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(installPrompt()));

    fireEvent.click(screen.getByRole("button", { name: "I have a number" }));
    expect(onHaveNumber).toHaveBeenCalled();
  });
});

describe("useApproveRunnerDeepLink", () => {
  it("opens on #approve-runner and clears the hash", () => {
    window.history.replaceState(null, "", "/#approve-runner");
    const onOpen = vi.fn();
    renderHook(() => useApproveRunnerDeepLink(onOpen));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("");
  });

  it("ignores any other hash", () => {
    window.history.replaceState(null, "", "/#something-else");
    const onOpen = vi.fn();
    renderHook(() => useApproveRunnerDeepLink(onOpen));

    expect(onOpen).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });
});
