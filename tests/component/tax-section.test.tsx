/**
 * TaxSection — the SET-01 invariant test.
 *
 * The invariant: after a failed save, every field still holds what the user
 * typed; after a successful save, every field holds what was saved. This
 * protects against the React 19 form-reset behaviour that wiped all fields on
 * any action completion (success or failure) when inputs were uncontrolled.
 *
 * These tests exercise the component's controlled-state model. They do not
 * re-test the server action or the validation schema — those live in
 * tests/unit/actions/settings-actions.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { failed, invalidInput, succeeded } from "@/lib/errors";
import { msg } from "@/i18n/types";

afterEach(cleanup);

// Mock the server actions — the component imports them from these paths.
const mockSaveTaxInfo = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/settings/actions", () => ({
  saveTaxInfo: mockSaveTaxInfo,
}));
const mockSendCode = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockConfirmCode = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/contact-verification/actions", () => ({
  sendContactCode: mockSendCode,
  confirmContactCode: mockConfirmCode,
}));
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: mockRefresh }),
  usePathname: () => "/settings/tax",
  useSearchParams: () => new URLSearchParams(),
}));

const { TaxSection } = await import("@/components/settings/TaxSection");

const SAVED = {
  businessName: "Root Labs Studio",
  address: "12 Market Street\nDublin",
  email: "hello@rootlabs.example",
  vatId: "",
  country: "",
  phone: "+353 87 123 4567",
  continueHref: "/storefront",
} as const;

/** A deployment that can prove both channels, with email proof required. */
const PROVABLE = { email: true, phone: true, emailRequired: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveTaxInfo.mockResolvedValue({});
  mockSendCode.mockResolvedValue(
    succeeded(
      msg("Settings.contactVerification.success.sent", {
        channel: "email",
        target: "hello@rootlabs.example",
      }),
    ),
  );
  mockConfirmCode.mockResolvedValue(
    succeeded(msg("Settings.contactVerification.success.confirmed", { channel: "email" })),
  );
});

describe("TaxSection — initial state", () => {
  it("seeds every text field from the saved props", () => {
    render(<TaxSection {...SAVED} />);

    expect(screen.getByLabelText(/Trader name/)).toHaveValue(
      "Root Labs Studio",
    );
    expect(screen.getByLabelText("Phone")).toHaveValue("+353 87 123 4567");
    // Substring match: the three required fields carry a RequiredMark
    // asterisk inside their label, which lands in the label's text content.
    expect(screen.getByLabelText(/Contact email/)).toHaveValue(
      "hello@rootlabs.example",
    );
  });
});

describe("TaxSection — SET-01: field retention after a failed save", () => {
  it("keeps what the user typed in every valid field after the server rejects", async () => {
    // The server rejects because the contact email is malformed. The two valid
    // fields (business name, phone) that were also changed must not revert.
    mockSaveTaxInfo.mockResolvedValue(
      failed(invalidInput(msg("Validation.email.contactEmail.format"))),
    );

    const user = userEvent.setup();
    render(<TaxSection {...SAVED} />);

    // Type a new business name (perfectly valid, but the whole save fails).
    const bizField = screen.getByLabelText(/Trader name/);
    await user.clear(bizField);
    await user.type(bizField, "SHOULD SURVIVE Ltd");

    // Type a new phone (also valid).
    const phoneField = screen.getByLabelText("Phone");
    await user.clear(phoneField);
    await user.type(phoneField, "+353 99 000 0000");

    // Submit. The mocked action returns an error.
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Both fields must still show what was typed, not the saved prop values.
    // If these inputs were uncontrolled, React 19's post-action form reset
    // would have reverted them to defaultValue (the saved values).
    await waitFor(() => {
      expect(bizField).toHaveValue("SHOULD SURVIVE Ltd");
      expect(phoneField).toHaveValue("+353 99 000 0000");
    });
  });

  it("does not revert a field that was correctly edited alongside a bad one", async () => {
    // The audit scenario: typed {biz:"SHOULD SURVIVE Ltd", email:"broken"}
    // -> failed save -> biz reverted to "Root Labs Studio". After the fix,
    // biz must stay as typed.
    mockSaveTaxInfo.mockResolvedValue(
      failed(invalidInput(msg("Validation.email.contactEmail.format"))),
    );

    const user = userEvent.setup();
    render(<TaxSection {...SAVED} />);

    const bizField = screen.getByLabelText(/Trader name/);
    await user.clear(bizField);
    await user.type(bizField, "SHOULD SURVIVE Ltd");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(bizField).toHaveValue("SHOULD SURVIVE Ltd");
      // The original saved value must NOT appear.
      expect(bizField).not.toHaveValue("Root Labs Studio");
    });
  });
});

describe("TaxSection — SET-01: field state after a successful save", () => {
  it("fields show the typed (= saved) value immediately after success", async () => {
    // After a successful save, the in-memory state already holds the typed
    // value, which is also the saved value. The component stays consistent
    // before the RSC re-mount brings the freshly saved props back from the
    // server.
    mockSaveTaxInfo.mockResolvedValue(
      succeeded(msg("Settings.tax.success.sellerDetailsSaved")),
    );

    const user = userEvent.setup();
    render(<TaxSection {...SAVED} />);

    const bizField = screen.getByLabelText(/Trader name/);
    await user.clear(bizField);
    await user.type(bizField, "ACME Corp Ltd");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(bizField).toHaveValue("ACME Corp Ltd");
    });
  });
});

describe("TaxSection — SET-04: VAT advisory", () => {
  it("warns when the VAT ID prefix implies a different country than selected", async () => {
    render(
      <TaxSection
        {...SAVED}
        vatId="DE123456789"
        country="IE"
      />,
    );

    // DE prefix + IE country -> advisory
    expect(
      screen.getByText(/looks like it was issued by Germany/i),
    ).toBeInTheDocument();
  });

  it("warns when an EU VAT ID is paired with Not in the EU", async () => {
    render(
      <TaxSection
        {...SAVED}
        vatId="IE1234567A"
        country=""
      />,
    );

    expect(
      screen.getByText(/looks like it was issued by Ireland/i),
    ).toBeInTheDocument();
  });

  it("shows no advisory when the VAT ID matches the selected country", async () => {
    render(
      <TaxSection
        {...SAVED}
        vatId="IE1234567A"
        country="IE"
      />,
    );

    expect(screen.queryByText(/looks like/i)).toBeNull();
  });

  it("shows no advisory when the VAT ID is blank", async () => {
    render(<TaxSection {...SAVED} vatId="" country="IE" />);
    expect(screen.queryByText(/looks like/i)).toBeNull();
  });

  it("handles the Greece EL/GR divergence: EL prefix matches GR country", async () => {
    render(
      <TaxSection
        {...SAVED}
        vatId="EL123456789"
        country="GR"
      />,
    );

    // EL is Greece's VAT prefix even though the ISO code is GR — no advisory.
    expect(screen.queryByText(/looks like/i)).toBeNull();
  });
});

describe("TaxSection — proving the contact details", () => {
  const row = (channel: "email" | "phone") =>
    document.querySelector<HTMLElement>(`[data-contact-verification="${channel}"]`);

  it("offers a code for an unproven email, then asks for it", async () => {
    const user = userEvent.setup();
    render(<TaxSection {...SAVED} verification={PROVABLE} />);

    expect(row("email")).toHaveAttribute("data-proof-state", "unconfirmed");
    expect(row("email")).toHaveTextContent(/can't publish until it is/i);
    await user.click(within(row("email")!).getByRole("button", { name: "Send code" }));

    // The form carries the channel and nothing else: the recipient is never
    // the browser's to name.
    await waitFor(() => expect(mockSendCode).toHaveBeenCalledTimes(1));
    const sent = mockSendCode.mock.calls[0]![1] as FormData;
    expect([...sent.keys()]).toEqual(["channel"]);
    expect(sent.get("channel")).toBe("email");

    await waitFor(() => expect(row("email")).toHaveAttribute("data-proof-state", "awaitingCode"));
    expect(row("email")).toHaveTextContent(
      "Enter the 8-digit code we emailed to hello@rootlabs.example.",
    );
  });

  it("submits the code on the last digit, and shows the proof", async () => {
    const user = userEvent.setup();
    render(
      <TaxSection
        {...SAVED}
        verification={PROVABLE}
        pendingCodes={{ email: true, phone: false }}
      />,
    );

    await user.type(within(row("email")!).getByLabelText("Confirmation code"), "1234 5678");

    await waitFor(() => expect(mockConfirmCode).toHaveBeenCalledTimes(1));
    const posted = mockConfirmCode.mock.calls[0]![1] as FormData;
    expect(posted.get("channel")).toBe("email");
    expect(posted.get("code")).toBe("1234 5678");
    await waitFor(() => expect(row("email")).toHaveAttribute("data-proof-state", "confirmed"));
    // The gate and the buyer page are server-rendered: they are asked to refresh.
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("keeps the code box open after a wrong code", async () => {
    mockConfirmCode.mockResolvedValue(
      failed(invalidInput(msg("Errors.contactVerification.wrongCode"))),
    );
    const user = userEvent.setup();
    render(
      <TaxSection {...SAVED} verification={PROVABLE} pendingCodes={{ email: true, phone: false }} />,
    );

    await user.type(within(row("email")!).getByLabelText("Confirmation code"), "00000000");

    await waitFor(() => expect(mockConfirmCode).toHaveBeenCalledTimes(1));
    expect(row("email")).toHaveAttribute("data-proof-state", "awaitingCode");
  });

  it("never offers a code for an edit that has not been saved", async () => {
    const user = userEvent.setup();
    render(<TaxSection {...SAVED} verification={PROVABLE} />);

    await user.type(screen.getByLabelText(/Contact email/), "x");

    expect(row("email")).toHaveAttribute("data-proof-state", "dirty");
    expect(row("email")).toHaveTextContent(/Save to send a code to the new address/i);
    expect(within(row("email")!).queryByRole("button", { name: "Send code" })).toBeNull();
  });

  it("says a phone cannot be shown when this deployment cannot text", () => {
    render(<TaxSection {...SAVED} verification={{ ...PROVABLE, phone: false }} />);
    expect(row("phone")).toHaveAttribute("data-proof-state", "unavailable");
    expect(row("phone")).toHaveTextContent(/confirming by text isn't available yet/i);
  });

  it("shows a proven phone as confirmed", () => {
    render(<TaxSection {...SAVED} verification={PROVABLE} phoneVerified />);
    expect(row("phone")).toHaveAttribute("data-proof-state", "confirmed");
  });

  it("has no email row where email proof is off entirely", () => {
    render(<TaxSection {...SAVED} />);
    expect(row("email")).toBeNull();
  });
});
