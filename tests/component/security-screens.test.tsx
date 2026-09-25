/**
 * Settings › Security and the two-factor sign-in challenge. Their copy moved
 * into the catalogue; what a reader sees in English must not have moved by a
 * character. Codes, factor names, emails and dates are data and pass through
 * untouched.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { failed, actionError } from "@/lib/errors";
import { msg } from "@/i18n/types";

afterEach(cleanup);

const verifyMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/auth/mfa-actions", () => ({
  verifyTwoFactorSignIn: verifyMock,
  signInWithRecoveryCode: vi.fn().mockResolvedValue({}),
  removeAuthenticator: vi.fn().mockResolvedValue({}),
  regenerateRecoveryCodes: vi.fn().mockResolvedValue({}),
  beginTwoFactorSetup: vi.fn().mockResolvedValue({}),
  confirmTwoFactorSetup: vi.fn().mockResolvedValue({}),
  cancelTwoFactorSetup: vi.fn().mockResolvedValue(undefined),
  signOutToReauthenticate: vi.fn().mockResolvedValue(undefined),
  confirmIdentity: vi.fn().mockResolvedValue({}),
  beginPasskeySetup: vi.fn().mockResolvedValue({}),
  confirmPasskeySetup: vi.fn().mockResolvedValue({}),
  passkeySignInOptions: vi.fn().mockResolvedValue({}),
  passkeyStepUpOptions: vi.fn().mockResolvedValue({}),
  verifyPasskeySignIn: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));

const { TwoFactorChallenge } = await import("@/components/auth/TwoFactorChallenge");
const { RecoveryCodesCard } = await import("@/components/settings/security/RecoveryCodesCard");
const { RecoveryCodesDisplay } = await import("@/components/settings/security/RecoveryCodesDisplay");
const { SecurityActivityCard } = await import("@/components/settings/security/SecurityActivityCard");
const { SecuritySection } = await import("@/components/settings/security/SecuritySection");
const { TwoFactorCard } = await import("@/components/settings/security/TwoFactorCard");

const PHONE = { id: "a0000000-0000-4000-8000-00000000000a", name: "Phone" };
const TABLET = { id: "b0000000-0000-4000-8000-00000000000b", name: "Tablet" };

function intro(): string | null | undefined {
  return screen.getByRole("heading", { name: "Two-factor authentication" }).nextElementSibling
    ?.textContent;
}

describe("TwoFactorChallenge", () => {
  it("names the one authenticator and the account, as one sentence", () => {
    render(<TwoFactorChallenge next="/" email="seller@example.com" factors={[PHONE]} />);
    expect(intro()).toBe(
      "Enter the 6-digit code from your authenticator app (Phone) to finish signing in as seller@example.com.",
    );
    expect(screen.getByText("Phone")).toHaveClass("font-medium");
    expect(screen.getByText("seller@example.com")).toHaveClass("font-medium");
  });

  it("reads correctly with several authenticators, or no email", () => {
    render(<TwoFactorChallenge next="/" email="seller@example.com" factors={[PHONE, TABLET]} />);
    expect(intro()).toBe(
      "Enter the 6-digit code from your authenticator app to finish signing in as seller@example.com.",
    );
    cleanup();
    render(<TwoFactorChallenge next="/" email="" factors={[PHONE]} />);
    expect(intro()).toBe("Enter the 6-digit code from your authenticator app (Phone).");
    cleanup();
    render(<TwoFactorChallenge next="/" email="" factors={[PHONE, TABLET]} />);
    expect(intro()).toBe("Enter the 6-digit code from your authenticator app.");
  });

  it("shows a refusal in the reader's words, and a way back when the session is gone", async () => {
    verifyMock.mockResolvedValue({
      ...failed(actionError("session_expired", msg("Errors.mfa.signInExpired"))),
      expired: true,
    });
    const user = userEvent.setup();
    render(<TwoFactorChallenge next="/orders" email="seller@example.com" factors={[PHONE]} />);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your sign-in expired. Sign in again.");
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/login?next=%2Forders",
    );
  });

  it("switches to the recovery-code form and back", async () => {
    const user = userEvent.setup();
    render(<TwoFactorChallenge next="/" email="" factors={[PHONE]} />);
    await user.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    expect(screen.getByRole("heading", { name: "Use a recovery code" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Each code works once. Using one turns two-factor authentication off and signs out your other devices, so you can set it up again on your new phone.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not you? Sign out" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use your authenticator app instead" }));
    expect(screen.getByLabelText("Authentication code")).toBeInTheDocument();
  });
});

describe("RecoveryCodesCard", () => {
  const line = (remaining: number) => {
    render(<RecoveryCodesCard remaining={remaining} />);
    const text = document.querySelector(`[data-recovery-remaining="${remaining}"]`)?.textContent;
    cleanup();
    return text;
  };

  it("counts what is left, and says so plainly when it runs low or out", () => {
    expect(line(7)).toBe("7 of 10 codes left.");
    expect(line(3)).toBe("3 of 10 codes left. Running low: generate a new set.");
    expect(line(1)).toBe("1 of 10 codes left. Running low: generate a new set.");
    expect(line(0)).toBe("0 of 10 codes left. You have none left: generate a new set now.");
  });

  it("owns up to a count it could not read", () => {
    render(<RecoveryCodesCard remaining={null} />);
    expect(screen.getByText("We couldn’t check how many you have left.")).toBeInTheDocument();
  });
});

describe("RecoveryCodesDisplay", () => {
  it("shows every code exactly as minted, with the shown-once warning", () => {
    const codes = ["7k2m-9qpx-r4tb-hc0w", "aaaa-bbbb-cccc-dddd"];
    render(<RecoveryCodesDisplay codes={codes} onDone={() => {}} />);
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(codes);
    expect(screen.getByRole("list", { name: "Recovery codes" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Save these somewhere safe, like a password manager. Each works once, they’re the only way back in if you lose your phone, and you won’t see them again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("I’ve saved my recovery codes somewhere safe.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });
});

describe("SecurityActivityCard", () => {
  it("labels known events, shows unknown ones as their slug, and times in UTC", () => {
    const at = "2026-07-02T14:05:00Z";
    render(
      <SecurityActivityCard
        items={[
          { id: "1", label: "Settings.security.activity.events.twoFactorEnabled", event: "mfa.enabled", at },
          { id: "2", label: null, event: "mfa.something_new", at },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Recent security activity" });
    expect(list).toHaveTextContent("Two-factor authentication turned on");
    expect(list).toHaveTextContent("mfa.something_new");
    // What the card printed before its copy moved into the catalogue.
    const before = `${new Date(at).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    })} UTC`;
    for (const time of list.querySelectorAll("time")) expect(time.textContent).toBe(before);
  });
});

describe("TwoFactorCard", () => {
  it("lists each authenticator with the day it was added, in UTC", () => {
    const createdAt = "2026-07-02T23:30:00Z";
    render(
      <TwoFactorCard
        enrolled
        factors={[{ ...PHONE, createdAt, type: "totp" }]}
        hasPassword
        signedInRecently
        signsInWithGoogle={false}
        passkeysAvailable={false}
        openSetup={false}
      />,
    );
    const before = new Date(createdAt).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    expect(screen.getByText(`Authenticator app · Added ${before}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Phone" })).toHaveTextContent("Remove");
    expect(screen.getByRole("list", { name: "Passkeys and authenticator apps" })).toBeInTheDocument();
  });

  it("tells a passkey apart from an authenticator app", () => {
    const createdAt = "2026-09-25T10:00:00Z";
    render(
      <TwoFactorCard
        enrolled
        factors={[
          { ...PHONE, createdAt, type: "totp" },
          { ...TABLET, name: "iPhone", createdAt, type: "passkey" },
        ]}
        hasPassword
        signedInRecently
        signsInWithGoogle={false}
        passkeysAvailable
        openSetup={false}
      />,
    );
    const list = screen.getByRole("list", { name: "Passkeys and authenticator apps" });
    const kinds = Array.from(list.querySelectorAll("[data-factor-type]")).map((row) =>
      row.getAttribute("data-factor-type"),
    );
    expect(kinds).toEqual(["totp", "passkey"]);
    expect(list).toHaveTextContent(/iPhone\s*Passkey · Added/);
    expect(screen.getByRole("button", { name: "Add another passkey or app" })).toBeInTheDocument();
  });

  it("makes the case for turning it on", () => {
    render(
      <TwoFactorCard
        enrolled={false}
        factors={[]}
        hasPassword
        signedInRecently
        signsInWithGoogle={false}
        passkeysAvailable={false}
        openSetup={false}
      />,
    );
    expect(
      screen.getByText("Changes to your business details, your team and your account need your passkey or a code."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up two-factor authentication" })).toBeInTheDocument();
    expect(screen.getByText("Takes about a minute.")).toBeInTheDocument();
  });
});

describe("SecuritySection", () => {
  it("after a recovery-code sign-in, says 2FA is off in one sentence with the headline in bold", () => {
    render(
      <SecuritySection
        enrolled={false}
        factors={[]}
        hasPassword
        signedInRecently
        signsInWithGoogle={false}
        passkeysAvailable={false}
        recoveryCodesRemaining={null}
        activity={[]}
        recovered
        openSetup={false}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe(
      "Two-factor authentication is off. You signed in with a recovery code, which removed your old passkeys and authenticator apps and signed out your other devices. Set it up again now so your password isn’t the only thing protecting your account.",
    );
    expect(status.querySelector(".font-semibold")?.textContent).toBe("Two-factor authentication is off.");
  });
});
