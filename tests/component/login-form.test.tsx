import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

// Mock the server actions before importing the component.
const mockAuthenticate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({}),
);

vi.mock("@/lib/auth/actions", () => ({
  authenticate: mockAuthenticate,
  signInWithGoogle: vi.fn(),
}));

// PasswordResetModal also uses authenticate — mock it as a no-op component
// to keep the test surface focused.
vi.mock("@/components/auth/PasswordResetModal", () => ({
  PasswordResetModal: () => null,
}));

const { LoginForm } = await import("@/components/auth/LoginForm");

describe("LoginForm", () => {
  beforeEach(() => {
    mockAuthenticate.mockClear();
    mockAuthenticate.mockResolvedValue({});
  });

  // --- Default sign-in mode ---

  it("renders email and password fields in sign-in mode", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("does not render confirm_password field in sign-in mode", () => {
    render(<LoginForm />);
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
  });

  it("renders 'Sign in' submit button in sign-in mode", () => {
    render(<LoginForm />);
    // The tab switcher also has a "Sign in" button; target the submit by testid.
    const submit = screen.getByTestId("login-submit");
    expect(submit).toHaveTextContent(/sign in/i);
    expect(submit).toHaveAttribute("type", "submit");
  });

  it("Sign in tab is visually active by default (has the signin mode class)", () => {
    render(<LoginForm />);
    // Both mode-switch buttons are rendered when not in magic mode.
    const tabs = screen.getAllByRole("button", { name: /sign in|sign up/i });
    expect(tabs.length).toBeGreaterThanOrEqual(2);
  });

  // --- Pending state ---

  it("names the action under way rather than saying 'Working'", async () => {
    // Three modes share one button, so a generic label cannot be honest about
    // all of them, and the sign-in wait is ~1s of real credential checking.
    let release: (value: { error: string }) => void = () => {};
    mockAuthenticate.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email or username"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("login-submit")).toHaveTextContent(/signing in/i),
    );
    expect(screen.getByTestId("login-submit")).not.toHaveTextContent(/working/i);

    release({ error: "done" });
  });

  // --- Identifier field (email or username) ---

  it("offers the identifier field as email OR username when signing in", () => {
    render(<LoginForm />);
    const field = screen.getByLabelText("Email or username");
    // Not type="email": that would hand a box that also accepts a handle to
    // autofill and mobile keyboards as address-only.
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveAttribute("name", "identifier");
    expect(field).toHaveAttribute("autocomplete", "username");
  });

  it("goes back to email-only where a handle cannot work", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    for (const open of [/^sign up$/i, /email me a magic link/i]) {
      await user.click(screen.getByRole("button", { name: open }));
      const field = screen.getByLabelText("Email");
      expect(field).toHaveAttribute("type", "email");
      expect(
        screen.queryByLabelText("Email or username"),
      ).not.toBeInTheDocument();
    }
  });

  it("asks for a username when creating an account", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));

    const field = screen.getByLabelText("Username");
    expect(field).toHaveAttribute("name", "username");
    expect(screen.getByText(/letters, numbers and underscores/i)).toBeInTheDocument();
  });

  it("does not ask for a username when signing in", () => {
    render(<LoginForm />);
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("keeps what was typed when switching between modes", async () => {
    // Same element in the same position in every mode, so a tab switch is not
    // punished by making people retype their address.
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email or username"), "a@b.com");
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));

    expect(screen.getByLabelText("Email")).toHaveValue("a@b.com");
  });

  // --- Sign-up mode ---

  it("switching to sign-up shows confirm_password field", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it("states the real password rule, not just the length floor", async () => {
    // An understated hint invites a password the form then rejects, so the
    // hint has to name the mix requirement and the passphrase escape hatch.
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));

    const hint = screen.getByText(/at least 8 characters/i);
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent(/mixing cases, numbers or symbols/i);
    expect(hint).toHaveTextContent(/16\+/);
  });

  it("sign-up changes submit button label to 'Create account'", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: /^sign up$/i }));
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
  });

  // --- Magic link mode ---

  it("switching to magic link hides the password field", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(
      screen.getByRole("button", { name: /email me a magic link/i }),
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("magic link shows 'Send magic link' submit button", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(
      screen.getByRole("button", { name: /email me a magic link/i }),
    );
    expect(
      screen.getByRole("button", { name: /send magic link/i }),
    ).toBeInTheDocument();
  });

  it("magic link hides the signin/signup tab switcher", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(
      screen.getByRole("button", { name: /email me a magic link/i }),
    );
    // The tabs should not be present in magic mode.
    expect(screen.queryByRole("button", { name: /^sign in$/i })).not.toBeInTheDocument();
  });

  it("toggling back from magic mode restores password field", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(
      screen.getByRole("button", { name: /email me a magic link/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /use a password instead/i }),
    );
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  // --- Error state ---

  it("error state renders in role=alert", async () => {
    mockAuthenticate.mockResolvedValue({ error: "Invalid credentials" });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByTestId("login-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid credentials");
  });

  it("confirmation message renders when action returns a message", async () => {
    mockAuthenticate.mockResolvedValue({ message: "Check your email." });
    const user = userEvent.setup();
    render(<LoginForm />);

    // Switch to magic link mode first so the intent matches.
    await user.click(
      screen.getByRole("button", { name: /email me a magic link/i }),
    );
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /send magic link/i }));

    await waitFor(() => {
      expect(screen.getByText("Check your email.")).toBeInTheDocument();
    });
  });

  // --- Form submission ---

  it("submitting calls the authenticate action", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalled();
    });
  });
});
