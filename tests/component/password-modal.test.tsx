import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

const changePasswordMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const sendPasswordResetMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("@/lib/settings/actions", () => ({
  changePassword: changePasswordMock,
  sendPasswordReset: sendPasswordResetMock,
}));

const { PasswordModal } = await import("@/components/settings/PasswordModal");

beforeEach(() => {
  vi.clearAllMocks();
  changePasswordMock.mockResolvedValue({});
  sendPasswordResetMock.mockResolvedValue({});
});

const noop = () => {};

describe("PasswordModal — account that has a password", () => {
  it("opens on the change view and asks for the current password", () => {
    render(
      <PasswordModal open onClose={noop} hasPassword email="a@b.com" />,
    );
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("states the real strength rule rather than just the length floor", () => {
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);
    const hint = screen.getByText(/at least 8 characters/i);
    expect(hint).toHaveTextContent(/mixing cases, numbers or symbols/i);
    expect(hint).toHaveTextContent(/16\+/);
  });

  it("warns that other devices will be signed out", () => {
    // The change really does revoke them, so the form has to say so.
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);
    expect(screen.getByText(/every other device will be signed out/i)).toBeInTheDocument();
  });

  it("offers the fallback as a real button, not a bare link", async () => {
    // It sits inside the change form, so it has to be type="button": a default
    // submit would fire changePassword instead of switching views.
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);
    const forgot = screen.getByRole("button", { name: /forgot password/i });
    expect(forgot).toHaveAttribute("type", "button");
  });

  it("switches to the reset view and back without leaving the modal", async () => {
    const user = userEvent.setup();
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);

    await user.click(screen.getByRole("button", { name: /forgot password/i }));
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a link/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
  });
});

describe("PasswordModal — account with no password", () => {
  it("offers only the emailed link, never a current-password field", () => {
    // There is nothing to re-authenticate against, so asking would be a dead
    // end. This is also the only route by which an OAuth account gets one.
    render(
      <PasswordModal open onClose={noop} hasPassword={false} email="a@b.com" />,
    );
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a link/i })).toBeInTheDocument();
    expect(screen.getByText(/signs in with google/i)).toBeInTheDocument();
  });

  it("names the address the link goes to, and offers no field to change it", () => {
    // The action reads the address from the session; showing it is a promise
    // the form keeps, and the absence of an input is the security property.
    render(
      <PasswordModal open onClose={noop} hasPassword={false} email="owner@studio.com" />,
    );
    expect(screen.getByText(/owner@studio\.com/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[name="email"]')).toBeNull();
  });
});

describe("PasswordModal — wiring", () => {
  it("renders nothing when closed", () => {
    render(
      <PasswordModal open={false} onClose={noop} hasPassword email="a@b.com" />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits the change to the changePassword action", async () => {
    const user = userEvent.setup();
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);

    await user.type(screen.getByLabelText("Current password"), "old-Password-1");
    await user.type(screen.getByLabelText("New password"), "Kettle-Boat-99");
    await user.type(screen.getByLabelText("Confirm new password"), "Kettle-Boat-99");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(changePasswordMock).toHaveBeenCalled());
    expect(sendPasswordResetMock).not.toHaveBeenCalled();
  });

  it("submits the reset request to sendPasswordReset", async () => {
    const user = userEvent.setup();
    render(
      <PasswordModal open onClose={noop} hasPassword={false} email="a@b.com" />,
    );

    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    await waitFor(() => expect(sendPasswordResetMock).toHaveBeenCalled());
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("surfaces an action error to the user", async () => {
    changePasswordMock.mockResolvedValue({ error: "Current password is incorrect." });
    const user = userEvent.setup();
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);

    await user.type(screen.getByLabelText("Current password"), "wrong");
    await user.type(screen.getByLabelText("New password"), "Kettle-Boat-99");
    await user.type(screen.getByLabelText("Confirm new password"), "Kettle-Boat-99");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect/i);
  });

  it("closes itself once the change succeeds", async () => {
    changePasswordMock.mockResolvedValue({ success: "Password updated." });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PasswordModal open onClose={onClose} hasPassword email="a@b.com" />);

    await user.type(screen.getByLabelText("Current password"), "old-Password-1");
    await user.type(screen.getByLabelText("New password"), "Kettle-Boat-99");
    await user.type(screen.getByLabelText("Confirm new password"), "Kettle-Boat-99");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 3000 });
  });
});
