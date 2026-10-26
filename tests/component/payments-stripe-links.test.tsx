import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "../setup/render";

/**
 * Every Stripe button on /payments goes to Stripe. None of them may stop at a
 * dialog whose own button does nothing, or reopen the "what is Stripe" intro
 * for a seller who has already been through it.
 */

const startStripeOnboarding = vi.fn(async () => ({ ok: true as const, url: "https://stripe.test/onboarding" }));
vi.mock("@/lib/payments/connect/actions", () => ({
  startStripeOnboarding: () => startStripeOnboarding(),
  openStripeDashboard: vi.fn(),
}));
const leaveForStripe = vi.fn();
vi.mock("@/components/billing/billing-actions", () => ({ leaveForStripe: (url: string) => leaveForStripe(url) }));

const { ConnectionStatusCard } = await import("@/components/payments/ConnectionStatusCard");
const { PayoutMethodCard } = await import("@/components/payments/PayoutMethodCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const connected = {
  connected: true,
  accountId: "acct_1",
  chargesEnabled: true,
  payoutsEnabled: false,
  detailsSubmitted: true,
  requirementsDue: [] as string[],
};

describe("Stripe buttons on /payments", () => {
  it("Finish on Stripe goes straight to Stripe, not back to the intro dialog", async () => {
    const onConnect = vi.fn();
    render(<ConnectionStatusCard account={{ ...connected, chargesEnabled: false }} onConnect={onConnect} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish on Stripe/ }));
    await waitFor(() => expect(leaveForStripe).toHaveBeenCalledWith("https://stripe.test/onboarding"));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("missing details after connecting come with the way to give them", async () => {
    render(<ConnectionStatusCard account={{ ...connected, requirementsDue: ["external_account"] }} onConnect={() => {}} />);
    expect(screen.getByText(/needs more information/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Finish on Stripe/ }));
    await waitFor(() => expect(leaveForStripe).toHaveBeenCalledOnce());
  });

  it("a payable account with nothing due shows no button at all", () => {
    render(<ConnectionStatusCard account={connected} onConnect={() => {}} />);
    expect(screen.queryByRole("button", { name: /Finish on Stripe/ })).toBeNull();
  });

  it("Manage in Stripe opens the seller's Stripe dashboard", async () => {
    const manage = vi.fn(async () => ({ ok: true as const, url: "https://stripe.test/express" }));
    const method = {
      id: "ba_1",
      type: "bank_account" as const,
      bankName: "AIB",
      last4: "4242",
      currency: "EUR",
      country: "IE",
      isDefault: true,
    };
    render(<PayoutMethodCard method={method} manage={manage} />);
    fireEvent.click(screen.getByRole("button", { name: /Manage in Stripe/ }));
    await waitFor(() => expect(leaveForStripe).toHaveBeenCalledWith("https://stripe.test/express"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
