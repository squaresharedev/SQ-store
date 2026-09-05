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
import { render, screen, cleanup, waitFor } from "../setup/render";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

// Mock the server action — the component imports it from this path.
const mockSaveTaxInfo = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/settings/actions", () => ({
  saveTaxInfo: mockSaveTaxInfo,
}));

const { TaxSection } = await import("@/components/settings/TaxSection");

const SAVED = {
  businessName: "Root Labs Studio",
  address: "12 Market Street\nDublin",
  email: "hello@rootlabs.example",
  vatId: "",
  country: "",
  phone: "+353 1 234 5678",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveTaxInfo.mockResolvedValue({});
});

describe("TaxSection — initial state", () => {
  it("seeds every text field from the saved props", () => {
    render(<TaxSection {...SAVED} />);

    expect(screen.getByLabelText("Business name")).toHaveValue(
      "Root Labs Studio",
    );
    expect(screen.getByLabelText("Phone")).toHaveValue("+353 1 234 5678");
    expect(screen.getByLabelText("Contact email")).toHaveValue(
      "hello@rootlabs.example",
    );
  });
});

describe("TaxSection — SET-01: field retention after a failed save", () => {
  it("keeps what the user typed in every valid field after the server rejects", async () => {
    // The server rejects because the contact email is malformed. The two valid
    // fields (business name, phone) that were also changed must not revert.
    mockSaveTaxInfo.mockResolvedValue({
      error: "The contact email doesn't look like an email address.",
    });

    const user = userEvent.setup();
    render(<TaxSection {...SAVED} />);

    // Type a new business name (perfectly valid, but the whole save fails).
    const bizField = screen.getByLabelText("Business name");
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
    mockSaveTaxInfo.mockResolvedValue({
      error: "The contact email doesn't look like an email address.",
    });

    const user = userEvent.setup();
    render(<TaxSection {...SAVED} />);

    const bizField = screen.getByLabelText("Business name");
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
    mockSaveTaxInfo.mockResolvedValue({
      success: "Business & seller details saved.",
    });

    const user = userEvent.setup();
    render(<TaxSection {...SAVED} />);

    const bizField = screen.getByLabelText("Business name");
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
