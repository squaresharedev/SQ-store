import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

// Mock the server actions before importing the component.
const mockAuthenticate = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("@/lib/auth/actions", () => ({
  authenticate: mockAuthenticate,
  signInWithGoogle: vi.fn(),
}));

vi.mock("@/components/auth/PasswordResetModal", () => ({
  PasswordResetModal: () => null,
}));

const { LoginForm } = await import("@/components/auth/LoginForm");
const { parseSignInMethod, SIGN_IN_METHODS } = await import(
  "@/lib/auth/last-method"
);

const BADGE = /last used/i;

const google = () => screen.getByRole("button", { name: /continue with google/i });
const signInTab = () =>
  screen.getAllByRole("button", { name: /^sign in/i })[0];
const magicToggle = () =>
  screen.getByRole("button", { name: /magic link/i });
/** The label row above the identifier input, where the badge now lives. */
const identifierRow = () => screen.getByText("Email or username").parentElement!;

describe("LoginForm — last used sign-in option", () => {
  beforeEach(() => mockAuthenticate.mockClear());

  it("badges nothing when this browser has never signed in", () => {
    render(<LoginForm />);
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
  });

  it("badges the Google button when Google was last used", () => {
    render(<LoginForm lastUsed="google" />);
    expect(within(google()).getByText(BADGE)).toBeInTheDocument();
    // Exactly one option is ever marked.
    expect(screen.getAllByText(BADGE)).toHaveLength(1);
  });

  it("badges the identifier FIELD when a password was last used", () => {
    // On the box you type into, not the tab above it: "which of these did I
    // use last" is a question about the field, and it mirrors the password
    // row's label/"Forgot?" pairing.
    render(<LoginForm lastUsed="password" />);
    expect(within(identifierRow()).getByText(BADGE)).toBeInTheDocument();
    expect(within(signInTab()).queryByText(BADGE)).not.toBeInTheDocument();
    expect(within(google()).queryByText(BADGE)).not.toBeInTheDocument();
    expect(screen.getAllByText(BADGE)).toHaveLength(1);
  });

  it("drops the badge in sign-up mode, where it would label the wrong box", async () => {
    const user = userEvent.setup();
    render(<LoginForm lastUsed="password" />);
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));

    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
  });

  it("badges the magic-link toggle when a magic link was last used", () => {
    render(<LoginForm lastUsed="magic" />);
    expect(within(magicToggle()).getByText(BADGE)).toBeInTheDocument();
  });

  it("drops the magic badge once that button offers the password instead", async () => {
    const user = userEvent.setup();
    render(<LoginForm lastUsed="magic" />);
    await user.click(magicToggle());

    // Now in magic mode: the same button offers "Use a password instead", so
    // a badge on it would point at the wrong option.
    expect(
      screen.getByRole("button", { name: /use a password instead/i }),
    ).not.toHaveTextContent(BADGE);
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
  });

  it("keeps the badge inside the control's accessible name", () => {
    render(<LoginForm lastUsed="google" />);
    // A returning user's screen reader should hear which option they used.
    expect(google()).toHaveAccessibleName(/last used/i);
  });

  it("never positions the badge over other content", () => {
    // An overlaid badge covers whatever is beneath it; in flow it can only
    // push. This is what keeps a long typed email (or a wrapped label) legible.
    // Checked on the badge and every ancestor up to the card, since an
    // absolutely positioned WRAPPER would overlay just as effectively.
    for (const method of ["google", "password", "magic"] as const) {
      cleanup();
      render(<LoginForm lastUsed={method} />);
      for (
        let node: HTMLElement | null = screen.getByText(BADGE);
        node;
        node = node.parentElement
      ) {
        expect(node.className.toString()).not.toMatch(/\babsolute\b/);
      }
    }
  });

  it("leaves a long typed email fully readable in its own field", async () => {
    const user = userEvent.setup();
    render(<LoginForm lastUsed="password" />);
    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    const long = "a.very.long.address.for.testing@some-quite-long-domain.example.com";
    await user.type(email, long);

    expect(email.value).toBe(long);
    // The badge shares a row with the LABEL, not with the input, so a long
    // address has the full field width and is never squeezed or overlaid.
    expect(within(identifierRow()).getByText(BADGE)).toBeInTheDocument();
    expect(identifierRow()).not.toContainElement(email);
  });

  it("renders the badge in sentence case, not shouted", () => {
    render(<LoginForm lastUsed="google" />);
    const badge = screen.getByText(BADGE);
    expect(badge).toHaveTextContent("Last used");
    expect(badge.className).not.toMatch(/uppercase/);
  });
});

describe("parseSignInMethod", () => {
  it("accepts every known method", () => {
    for (const method of SIGN_IN_METHODS) {
      expect(parseSignInMethod(method)).toBe(method);
    }
  });

  it("rejects anything else, since it arrives from a URL and a cookie", () => {
    for (const junk of ["", "  google", "GOOGLE", "javascript:x", null, undefined]) {
      expect(parseSignInMethod(junk)).toBeNull();
    }
  });
});
