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
  // The resend cooldown is persisted, so it would otherwise leak between tests.
  sessionStorage.clear();
});

const LAST_SENT_KEY = "sq:password-reset-sent-at";
const RESET_SENT = { success: "Reset link sent. Check your inbox." };

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

/**
 * The real budgets are server-side (5/hour per user and per client). This
 * cooldown exists so an impatient user does not spend an hour's allowance in
 * ten seconds waiting for mail that is already on its way, and so the button
 * stops claiming to be a first send once one has gone out.
 */
describe("PasswordModal: resend cooldown", () => {
  const openReset = () =>
    render(
      <PasswordModal open onClose={noop} hasPassword={false} email="a@b.com" />,
    );

  it("offers a first send when nothing has gone out yet", () => {
    openReset();
    const button = screen.getByRole("button", { name: /email me a link/i });
    expect(button).toBeEnabled();
  });

  it("shuts the button and counts down once a link is sent", async () => {
    sendPasswordResetMock.mockResolvedValue(RESET_SENT);
    const user = userEvent.setup();
    openReset();

    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    const button = await screen.findByRole("button", { name: /resend in \d+s/i });
    expect(button).toBeDisabled();
    expect(screen.queryByRole("button", { name: /email me a link/i })).toBeNull();
  });

  it("does not start a cooldown when the send failed", async () => {
    sendPasswordResetMock.mockResolvedValue({ error: "Could not send the reset email. Try again." });
    const user = userEvent.setup();
    openReset();

    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not send/i);
    // Still a first send: a link that never went out must be retryable.
    const button = screen.getByRole("button", { name: /email me a link/i });
    expect(button).toBeEnabled();
    expect(sessionStorage.getItem(LAST_SENT_KEY)).toBeNull();
  });

  it("keeps counting after the modal is closed and reopened", () => {
    // A cooldown you can skip by pressing Escape is not a cooldown.
    sessionStorage.setItem(LAST_SENT_KEY, String(Date.now() - 5_000));
    openReset();

    const button = screen.getByRole("button", { name: /resend in 5[0-9]s/i });
    expect(button).toBeDisabled();
  });

  it("settles on Resend email once the countdown runs out", async () => {
    sessionStorage.setItem(LAST_SENT_KEY, String(Date.now() - 59_000));
    openReset();

    expect(screen.getByRole("button", { name: /resend in 1s/i })).toBeDisabled();
    const button = await screen.findByRole(
      "button",
      { name: /^resend email$/i },
      { timeout: 3000 },
    );
    expect(button).toBeEnabled();
  });

  it("ignores an unusable sessionStorage rather than breaking the form", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    try {
      openReset();
      // Falls back to a first send; the server limit is what actually bounds it.
      expect(screen.getByRole("button", { name: /email me a link/i })).toBeEnabled();
    } finally {
      getItem.mockRestore();
    }
  });
});
