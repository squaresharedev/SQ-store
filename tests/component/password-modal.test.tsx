import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { actionError, failed, succeeded } from "@/lib/errors";
import { msg } from "@/i18n/types";

afterEach(cleanup);

const sendPasswordResetMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("@/lib/settings/actions", () => ({
  sendPasswordReset: sendPasswordResetMock,
}));

const { PasswordModal } = await import("@/components/settings/PasswordModal");

beforeEach(() => {
  vi.clearAllMocks();
  sendPasswordResetMock.mockResolvedValue({});
  // The resend cooldown is persisted, so it would otherwise leak between tests.
  sessionStorage.clear();
});

const LAST_SENT_KEY = "sq:password-reset-sent-at";
const RESET_SENT = succeeded(msg("Settings.account.success.resetSent"));

const noop = () => {};

describe("PasswordModal: account that has a password", () => {
  it("offers only the emailed link: there is no field for the current password at all", () => {
    // Settings never holds the existing password. A field for it is one a
    // browser fills on open, and a show/hide toggle would then display it to
    // whoever is at the screen.
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);
    const dialog = screen.getByRole("dialog", { name: "Reset your password" });
    expect(dialog.querySelector("input")).toBeNull();
    expect(document.querySelector('input[type="password"], input[type="text"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /show password/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a link/i })).toBeInTheDocument();
  });

  it("says the password is never shown, and what setting a new one does", () => {
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);
    expect(screen.getByText(/never shown/i)).toHaveTextContent(/signs out your other devices/i);
  });

  it("names the address the link goes to", () => {
    render(<PasswordModal open onClose={noop} hasPassword email="owner@studio.com" />);
    expect(screen.getByText(/owner@studio.com/)).toBeInTheDocument();
  });

  it("cancels without sending anything", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PasswordModal open onClose={onClose} hasPassword email="a@b.com" />);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
    expect(sendPasswordResetMock).not.toHaveBeenCalled();
  });
});

describe("PasswordModal: account with no password", () => {
  it("offers the emailed link, which is how an OAuth account gets one", () => {
    render(
      <PasswordModal open onClose={noop} hasPassword={false} email="a@b.com" />,
    );
    expect(screen.getByRole("dialog", { name: "Set a password" })).toBeInTheDocument();
    expect(document.querySelector('input[type="password"], input[type="text"]')).toBeNull();
    expect(screen.getByRole("button", { name: /email me a link/i })).toBeInTheDocument();
    expect(screen.getByText(/signs in with google/i)).toBeInTheDocument();
  });

  it("names the address the link goes to, and offers no field to change it", () => {
    // The action reads the address from the session; showing it is a promise
    // the form keeps, and the absence of an input is the security property.
    render(
      <PasswordModal open onClose={noop} hasPassword={false} email="owner@studio.com" />,
    );
    expect(screen.getByText(/owner@studio.com/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[name="email"]')).toBeNull();
  });
});

describe("PasswordModal: wiring", () => {
  it("renders nothing when closed", () => {
    render(
      <PasswordModal open={false} onClose={noop} hasPassword email="a@b.com" />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits the request to sendPasswordReset, with no fields", async () => {
    const user = userEvent.setup();
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);

    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    await waitFor(() => expect(sendPasswordResetMock).toHaveBeenCalled());
    const formData = sendPasswordResetMock.mock.calls[0]![1] as FormData;
    expect([...formData.keys()].filter((key) => !key.startsWith("$ACTION"))).toEqual([]);
  });

  it("surfaces an action error to the user", async () => {
    sendPasswordResetMock.mockResolvedValue(
      failed(actionError("server_error", msg("Errors.settings.resetFailed"))),
    );
    const user = userEvent.setup();
    render(<PasswordModal open onClose={noop} hasPassword email="a@b.com" />);

    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not send/i);
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
    sendPasswordResetMock.mockResolvedValue(
      failed(actionError("server_error", msg("Errors.settings.resetFailed"))),
    );
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
