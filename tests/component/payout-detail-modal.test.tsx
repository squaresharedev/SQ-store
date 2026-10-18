// The payout dialog. Pinned here: that EVERYTHING about a payout is on screen
// the moment it opens (nothing folded away, nothing waiting on an animation),
// that the wording follows the status, and that the picture is decoration over
// real text. How it looks is judged by eye on /dev/modals.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import { PayoutDetailModal } from "@/components/payments/PayoutDetailModal";
import type { Payout, PayoutMethod, PayoutStatus } from "@/lib/payments/types";

const PAYOUT: Payout = {
  id: "po_test_1NxQ2e",
  amountCents: 48250,
  currency: "EUR",
  status: "paid",
  arrivalDate: "2026-10-02T00:00:00Z",
  createdAt: "2026-09-30T09:12:00Z",
  method: "standard",
  destinationLast4: "4821",
  automatic: true,
  statementDescriptor: "SQUARESHARE PAYOUT",
};

const METHOD: PayoutMethod = {
  id: "ba_test",
  type: "bank_account",
  bankName: "Erste Bank",
  last4: "4821",
  currency: "EUR",
  country: "AT",
  isDefault: true,
};

const FAILED_SENTENCE = /could not be delivered/;
const STATUS_WORDS: Record<PayoutStatus, string> = {
  paid: "Paid",
  pending: "Pending",
  in_transit: "In transit",
  failed: "Failed",
  canceled: "Canceled",
};

afterEach(cleanup);

const open = (payout: Payout = PAYOUT, method: PayoutMethod | null = METHOD) =>
  render(<PayoutDetailModal open onClose={() => {}} payout={payout} method={method} />);
const dialog = () => screen.getByRole("dialog", { name: "Payout" });
const track = () => document.querySelector("[data-payout-track]") as HTMLElement;

describe("PayoutDetailModal", () => {
  it("shows everything about the payout the moment it opens, with nothing to open", () => {
    open();
    for (const text of [
      "€482.50",
      "Paid",
      "Initiated",
      // The hour is the viewer's own (lib/format/date), so only the minutes are fixed.
      /^30 Sept 2026, [0-9]{2}:12$/,
      "Arrived",
      "2 Oct 2026",
      "Sent to",
      "Erste Bank ···· 4821",
      "Type",
      "Standard · Automatic",
      "On your bank statement",
      "SQUARESHARE PAYOUT",
      "Payout ID",
      "po_test_1NxQ2e",
    ]) {
      expect(within(dialog()).getByText(text), String(text)).toBeVisible();
    }
    expect(dialog().querySelector("details")).toBeNull();
  });

  for (const status of Object.keys(STATUS_WORDS) as PayoutStatus[]) {
    it(`${status}: says so in words, and draws that status`, () => {
      open({ ...PAYOUT, status });
      expect(within(dialog()).getByText(STATUS_WORDS[status])).toBeVisible();
      expect(track().getAttribute("data-payout-track")).toBe(status);
    });
  }

  it("says Arrived only once it has, and explains a failure only when there is one", () => {
    for (const status of Object.keys(STATUS_WORDS) as PayoutStatus[]) {
      open({ ...PAYOUT, status });
      expect(screen.queryByText("Arrived") !== null, status).toBe(status === "paid");
      expect(screen.queryByText("Arrives") !== null, status).toBe(status !== "paid");
      expect(screen.queryByText(FAILED_SENTENCE) !== null, status).toBe(status === "failed");
      cleanup();
    }
  });

  it("strikes the arrival date of a payout that is not coming", () => {
    for (const status of Object.keys(STATUS_WORDS) as PayoutStatus[]) {
      open({ ...PAYOUT, status });
      const struck = screen.getByText("2 Oct 2026").className.includes("line-through");
      expect(struck, status).toBe(status === "failed" || status === "canceled");
      cleanup();
    }
  });

  it("keeps the picture out of the accessibility tree, and the dates in it", () => {
    open();
    const picture = track().querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(picture.querySelector(".pixel-trail")).not.toBeNull();
    expect(picture.textContent).toBe("");
    expect(within(track()).getByText("2 Oct 2026").closest('[aria-hidden="true"]')).toBeNull();
  });

  it("leaves out the statement line when the payout has none, and tells manual from instant", () => {
    open({ ...PAYOUT, statementDescriptor: null, method: "instant", automatic: false });
    expect(screen.queryByText("On your bank statement")).toBeNull();
    expect(screen.getByText("Instant · Manual")).toBeInTheDocument();
  });

  it("draws a status it does not know as pending instead of breaking", () => {
    open({ ...PAYOUT, status: "something_new" as PayoutStatus });
    expect(track().getAttribute("data-payout-track")).toBe("pending");
    expect(within(dialog()).getByText("Pending")).toBeVisible();
  });

  it("names the bank only when the payout went to the account on file", () => {
    open();
    expect(screen.getByText("Erste Bank ···· 4821")).toBeInTheDocument();
    cleanup();

    open({ ...PAYOUT, destinationLast4: "9999" });
    expect(screen.queryByText(/Erste Bank/)).toBeNull();
    expect(screen.getByText("Bank account ···· 9999")).toBeInTheDocument();
    cleanup();

    open(PAYOUT, null);
    expect(screen.getByText("Bank account ···· 4821")).toBeInTheDocument();
  });

  it("ends on one button, which closes it", () => {
    const onClose = vi.fn();
    render(<PayoutDetailModal open onClose={onClose} payout={PAYOUT} />);
    screen.getByRole("button", { name: "Done" }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
