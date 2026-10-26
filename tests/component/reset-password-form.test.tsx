import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";

// The reset form states the same password rule as sign-up. "At least 8
// characters" alone invited a password the server then refused.

vi.mock("@/lib/auth/actions", () => ({ resetPassword: vi.fn() }));
const { ResetPasswordForm } = await import("@/components/auth/ResetPasswordForm");

afterEach(cleanup);

describe("ResetPasswordForm", () => {
  it("states the real password rule, not just the length floor", () => {
    render(<ResetPasswordForm email="a@shop.test" />);
    const hint = screen.getByText(/at least 8 characters/i);
    expect(hint).toHaveTextContent(/mixing cases, numbers or symbols/i);
    expect(hint).toHaveTextContent(/16\+/);
  });
});
