/**
 * The page an assistant sends a seller to before it may work on their store
 * (/oauth/authorize): why one switch cannot move, which store is shared, what
 * saying no does, and why a code is asked for before anything is approved.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import type { ConsentStore } from "@/components/agent/ConsentForm";
import { AGENT_SCOPES, AGENT_SCOPE_IDS, scopeBadge } from "@/lib/agent/scopes";
import { TEAM_PERMISSIONS } from "@/lib/team/permissions";

vi.mock("@/lib/agent/consent-actions", () => ({ approveAgentConnection: vi.fn().mockResolvedValue({}) }));
// StepUp fetches passkey options from here; no passkey is used in these specs.
vi.mock("@/lib/auth/mfa-actions", () => ({ passkeyStepUpOptions: vi.fn().mockResolvedValue({}) }));

const { ConsentForm } = await import("@/components/agent/ConsentForm");
const { StepUpProvider } = await import("@/components/auth/StepUp");

afterEach(cleanup);

const OWN: ConsentStore = { accountId: "own", name: "Root Labs", role: "owner", permissions: TEAM_PERMISSIONS.owner };
const FRIEND: ConsentStore = { accountId: "friend", name: "Friend's Shop", role: "viewer", permissions: TEAM_PERMISSIONS.viewer };
const DENY_HREF = "https://client.example/callback?error=access_denied";

/** Every scope, as the page builds them for an app that named none. */
const SCOPES = AGENT_SCOPE_IDS.map((id) => ({
  id,
  label: AGENT_SCOPES[id].label,
  hint: AGENT_SCOPES[id].hint,
  requires: AGENT_SCOPES[id].requires,
  required: "required" in AGENT_SCOPES[id],
  badge: scopeBadge(id),
  ticked: !("optIn" in AGENT_SCOPES[id]),
}));

function consent(stores: ConsentStore[] = [OWN]) {
  return (
    <ConsentForm
      appName="Test Assistant"
      redirectHost="client.example"
      hidden={{}}
      denyHref={DENY_HREF}
      stores={stores}
      scopes={SCOPES}
    />
  );
}

function scopeRow(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-agent-scope="${id}"]`)!;
}

describe("ConsentForm", () => {
  it("says on the row why the one switch everything needs cannot be turned off", () => {
    render(consent());
    const required = scopeRow("store:read");
    expect(within(required).getByRole("switch")).toBeDisabled();
    expect(within(required).getByText("Required")).toBeInTheDocument();
    expect(within(scopeRow("destructive")).getByText("Off by default")).toBeInTheDocument();
    expect(within(scopeRow("products:write")).queryByText("Required")).toBeNull();
  });

  it("tells a seller with several stores that only the one picked is shared", () => {
    render(consent([OWN, FRIEND]));
    expect(screen.getByText("Only the store you pick is shared. Your other stores stay private.")).toBeInTheDocument();
    cleanup();
    // One store: no picker, and nothing to explain.
    render(consent());
    expect(screen.queryByText(/Only the store you pick/)).toBeNull();
  });

  it("names saying no for what it does: the app is told, and the seller goes back to it", () => {
    render(consent());
    const deny = screen.getByRole("link", { name: "Don't connect" });
    expect(deny).toHaveAttribute("href", DENY_HREF);
    expect(deny).toHaveAccessibleDescription(
      "Don't connect takes you back to Test Assistant and tells it you said no.",
    );
  });

  it("asks for the authenticator code in the consent's own words", async () => {
    render(
      <StepUpProvider enrolled freshUntil={0} factors={[{ id: "app-1", name: "Phone", type: "totp" }]}>
        {consent()}
      </StepUpProvider>,
    );
    expect(
      await screen.findByText(
        "Connecting Test Assistant gives it access to your store. Enter the current code from your authenticator app to confirm it's you.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/This is a sensitive change/)).toBeNull();
  });
});
