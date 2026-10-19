import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "../setup/render";
import { orderView } from "../setup/order-view";

// The billing surfaces as each kind of reader meets them, with the server
// actions stubbed: the plans page, the Settings upsell and the Orders export
// button. What each offers depends on the store's plan and on who is looking,
// and pressing an action asks the server, never builds a URL of its own.

vi.mock("@/lib/billing/actions", () => ({
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
  cancelPlan: vi.fn(),
  resumePlan: vi.fn(),
}));
vi.mock("@/lib/orders/actions", () => ({ markOrderShipped: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { PlansPage } from "@/components/billing/PlansPage";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { PlanPricesProvider } from "@/components/billing/plan-context";
import { PlanLimitNotice } from "@/components/billing/PlanLimitNotice";
import type { BillingActions } from "@/components/billing/billing-actions";
import { BillingSection } from "@/components/settings/BillingSection";
import { OrdersExportButton } from "@/components/orders/OrdersExportButton";
import { AnalyticsExportButton } from "@/components/analytics/AnalyticsExportButton";
import { OrderDetail } from "@/components/orders/OrderDetail";
import type { PlanPrices } from "@/lib/billing/fees";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";
import { PRICES_WITH_YEARLY } from "@/app/dev/pricing/fixtures";
import type { AnalyticsSnapshot } from "@/lib/analytics/types";
import { formatLongDate } from "@/lib/format/date";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeAll(() => {
  // jsdom has neither; the calculator's slider reads matchMedia and its chart
  // (Recharts) touches ResizeObserver. Same stubs as color-picker/charts tests.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

/** The seeded prices with yearly rows, and Starter on a launch price: EUR 12
 *  charged against EUR 15 regular (120 against 150 a year). Neither is seeded,
 *  so both are only ever what a later plan_prices row could make them. */
const WITH_LAUNCH: PlanPrices = PRICES_WITH_YEARLY.map((price) =>
  price.planId === "starter" ? { ...price, listPriceCents: price.interval === "year" ? 15_000 : 1500 } : price,
);

const FREE: PricingContext = {
  // Option A, as plan_prices is seeded: Free 5%, Starter EUR 12 + 2%, Pro EUR 39 + 0.5%.
  prices: PLAN_PRICE_SEED,
  plan: "free",
  interval: null,
  status: "none",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  priceCents: null,
  currency: null,
  hasSubscription: false,
  hasBillingAccount: false,
  canManage: true,
  available: true,
  directSales30dCents: 0,
  feeWaived: false,
  grant: null,
  usage: { storefronts: 1, teamSeats: 1, products: 4 },
};

/** The same store once yearly prices are sold. */
const FREE_YEARLY: PricingContext = { ...FREE, prices: PRICES_WITH_YEARLY };

const STARTER: PricingContext = {
  ...FREE,
  plan: "starter",
  interval: "month",
  status: "active",
  priceCents: 1200,
  currency: "EUR",
  hasSubscription: true,
  hasBillingAccount: true,
  currentPeriodEnd: "2026-11-03T12:00:00.000Z",
};

/** How the dialogs write STARTER's period end. */
const PERIOD_END = formatLongDate(STARTER.currentPeriodEnd!, "en");

/** A Free store Square Share gave Starter until GRANT_END: no subscription,
 *  nothing on file at Stripe. */
const GRANTED_STARTER: PricingContext = {
  ...FREE,
  plan: "starter",
  grant: { plan: "starter", endsAt: "2027-01-19T12:00:00.000Z" },
};
const GRANT_END = formatLongDate(GRANTED_STARTER.grant!.endsAt!, "en");

function stubActions(overrides: Partial<BillingActions> = {}): BillingActions {
  return {
    startCheckout: vi.fn(async () => ({ ok: true as const, url: "https://checkout.stripe.com/c/pay/cs_test_1" })),
    openPortal: vi.fn(async () => ({ url: "https://billing.stripe.com/p/session/1" })),
    cancelPlan: vi.fn(async () => ({ ok: true as const, endsAt: STARTER.currentPeriodEnd! })),
    resumePlan: vi.fn(async () => ({ ok: true as const })),
    navigate: vi.fn(),
    ...overrides,
  };
}

/** The upsell on its own: on the page it sits under the section's provider. */
function renderUpsell(context: PricingContext, actions: BillingActions = stubActions()) {
  return render(
    <PlanPricesProvider prices={context.prices}>
      <UpgradeCard context={context} actions={actions} />
    </PlanPricesProvider>,
  );
}

describe("PlansPage", () => {
  it("recommends Starter as the best value", () => {
    render(<PlansPage context={FREE} source={null} actions={stubActions()} />);
    const recommended = document.querySelector("[data-recommended]") as HTMLElement;
    expect(recommended.getAttribute("data-pricing-plan")).toBe("starter");
    expect(within(recommended).getByText("Best value")).toBeTruthy();
  });

  it("offers a Free owner each paid plan, and asks the server for the checkout", async () => {
    const actions = stubActions();
    const user = userEvent.setup();
    render(<PlansPage context={FREE} source="sidebar" actions={actions} />);

    const free = document.querySelector("[data-pricing-plan='free']") as HTMLElement;
    expect(within(free).getByText("Current plan")).toBeTruthy();
    expect(within(free).queryByRole("button")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Upgrade to Pro/ }));
    expect(actions.startCheckout).toHaveBeenCalledWith({ plan: "pro", interval: "month", source: "sidebar" });
    expect(actions.navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("sends the chosen billing period with the upgrade", async () => {
    const actions = stubActions();
    const user = userEvent.setup();
    render(<PlansPage context={FREE_YEARLY} source="settings" actions={actions} />);
    await user.click(screen.getByRole("button", { name: /Yearly/ }));
    await user.click(screen.getByRole("button", { name: /Upgrade to Starter/ }));
    expect(actions.startCheckout).toHaveBeenCalledWith({ plan: "starter", interval: "year", source: "settings" });
  });

  it("shows the prices plan_prices holds, and no billing period to choose while only monthly is sold", () => {
    render(<PlansPage context={FREE} source={null} actions={stubActions()} />);
    const priceOf = (plan: string) =>
      (document.querySelector(`[data-pricing-plan='${plan}'] [data-plan-price]`) as HTMLElement).textContent;
    expect(priceOf("free")).toContain("€0");
    expect(priceOf("starter")).toContain("€12");
    expect(priceOf("pro")).toContain("€39");
    const fee = document.querySelector("[data-compare-row='fee']") as HTMLElement;
    expect(Array.from(fee.querySelectorAll("td")).map((cell) => cell.textContent)).toEqual(["5%", "2%", "0.5%"]);
    // One way to pay is not a choice.
    expect(screen.queryByRole("button", { name: /Yearly/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Monthly/ })).toBeNull();
  });

  it("follows a price changed in the database, with no code to update", () => {
    const repriced = PLAN_PRICE_SEED.map((price) =>
      price.planId === "pro" ? { ...price, priceCents: 4500, directFeeBps: 25 } : price,
    );
    render(<PlansPage context={{ ...FREE, prices: repriced }} source={null} actions={stubActions()} />);
    const pro = document.querySelector("[data-pricing-plan='pro']") as HTMLElement;
    expect((pro.querySelector("[data-plan-price]") as HTMLElement).textContent).toContain("€45");
    expect(within(pro).getByText("0.25% fee per sale")).toBeTruthy();
  });

  it("says what yearly saves on the Yearly option itself, not beside the toggle", () => {
    render(<PlansPage context={FREE_YEARLY} source={null} actions={stubActions()} />);
    const yearly = screen.getByRole("button", { name: /Yearly/ });
    expect(within(yearly).getByText("2 months free")).toBeTruthy();
    // The old standalone pill is gone.
    expect(screen.queryByText("2 months free on yearly")).toBeNull();
    expect(screen.getAllByText("2 months free")).toHaveLength(1);
  });

  it("strikes nothing through while every plan charges its regular price", () => {
    render(<PlansPage context={FREE} source={null} actions={stubActions()} />);
    expect(document.querySelector("[data-plan-list-price]")).toBeNull();
    expect(screen.queryByText(/A launch price is an introductory price/)).toBeNull();
  });

  it("shows a launch price against its regular price, and says which is which", async () => {
    const user = userEvent.setup();
    render(<PlansPage context={{ ...FREE, prices: WITH_LAUNCH }} source={null} actions={stubActions()} />);
    const starter = document.querySelector("[data-pricing-plan='starter']") as HTMLElement;
    const price = starter.querySelector("[data-plan-price]") as HTMLElement;
    expect((price.querySelector("[data-plan-list-price]") as HTMLElement).textContent).toBe("Regular price €15");
    expect(price.querySelector("s")).toBeTruthy();
    expect(price.textContent).toContain("€12");
    expect(within(starter).getByText("Save 20%")).toBeTruthy();
    expect(within(starter).getByText("Launch price (regular €15), excl. VAT")).toBeTruthy();
    // Free and Pro charge their regular price: nothing struck through.
    for (const plan of ["free", "pro"]) {
      expect(document.querySelector(`[data-pricing-plan='${plan}'] [data-plan-list-price]`)).toBeNull();
    }
    expect(screen.getByText(/A launch price is an introductory price/)).toBeTruthy();

    // Yearly: the same saving, per month and for the year.
    await user.click(screen.getByRole("button", { name: /Yearly/ }));
    expect(price.textContent).toContain("€12.50");
    expect(price.textContent).toContain("€10");
    expect(within(starter).getByText("€120 billed once a year at the launch price (regular €150), excl. VAT")).toBeTruthy();
  });

  it("shows the server's refusal instead of leaving", async () => {
    const actions = stubActions({
      startCheckout: vi.fn(async () => ({
        ok: false as const,
        error: { code: "server_error" as const, message: { key: "Errors.billing.unavailable" as const } },
      })),
    });
    const user = userEvent.setup();
    render(<PlansPage context={FREE} source={null} actions={actions} />);
    await user.click(screen.getByRole("button", { name: /Upgrade to Starter/ }));
    expect(await screen.findByText("Paid plans aren't available right now.")).toBeTruthy();
    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it("routes a subscribed owner's switch through the Customer Portal, and Free through the in-app cancel", async () => {
    const actions = stubActions();
    const user = userEvent.setup();
    render(<PlansPage context={STARTER} source={null} actions={actions} />);
    expect(screen.queryByRole("button", { name: /Upgrade to/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Switch to Pro/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Move to Free/ }));
    expect(screen.getByRole("dialog", { name: "Cancel Starter?" })).toBeTruthy();
    expect(actions.openPortal).not.toHaveBeenCalled();
  });

  it("offers a plan that is ending a way back beside the notice, and no second cancel", () => {
    render(<PlansPage context={{ ...STARTER, cancelAtPeriodEnd: true }} source={null} actions={stubActions()} />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(`Your Starter plan ends on ${PERIOD_END}`);
    expect(within(notice).getByRole("button", { name: "Keep my plan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Move to Free/ })).toBeNull();
  });

  it("says a plan Square Share gave is on us, and sells only what is above it", () => {
    render(<PlansPage context={GRANTED_STARTER} source={null} actions={stubActions()} />);
    expect(screen.getByRole("status").textContent).toContain(`Your Starter plan is on us until ${GRANT_END}.`);
    expect(screen.queryByRole("button", { name: /Upgrade to Starter/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Upgrade to Pro/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Move to Free|Switch/ })).toBeNull();
    cleanup();
    // The top plan with no end date: nothing left to buy.
    render(
      <PlansPage
        context={{ ...GRANTED_STARTER, plan: "pro", grant: { plan: "pro", endsAt: null } }}
        source={null}
        actions={stubActions()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Your Pro plan is on us, with no end date.");
    expect(screen.queryByRole("button", { name: /Upgrade to/ })).toBeNull();
  });

  it("gives a teammate the plans to read and nothing to press", () => {
    render(<PlansPage context={{ ...FREE, canManage: false }} source={null} actions={stubActions()} />);
    expect(screen.queryByRole("button", { name: /Upgrade|Switch|Move to Free/ })).toBeNull();
    expect(screen.getByText("Only the store owner can change its plan.")).toBeTruthy();
  });

  it("marks upgrades Soon where billing is not set up", () => {
    render(<PlansPage context={{ ...FREE, available: false }} source={null} actions={stubActions()} />);
    const upgrade = screen.getByRole("button", { name: /Upgrade to Pro/ });
    expect((upgrade as HTMLButtonElement).disabled).toBe(true);
    expect(within(upgrade).getByText("Soon")).toBeTruthy();
  });

  it("points a store with small sales at the plan that costs it least, even Free", () => {
    // €200 a month: Free's fee is still less than any subscription.
    render(<PlansPage context={{ ...FREE, directSales30dCents: 20_000 }} source={null} actions={stubActions()} />);
    expect(document.querySelector("[data-cheapest]")?.getAttribute("data-pricing-cost")).toBe("free");
  });

  it("gives Free the orders export, and lists what each paid plan adds", () => {
    render(<PlansPage context={FREE} source={null} actions={stubActions()} />);
    const free = document.querySelector("[data-pricing-plan='free']") as HTMLElement;
    expect(within(free).getByText("Export your orders to a spreadsheet (CSV)")).toBeTruthy();
    const starter = document.querySelector("[data-pricing-plan='starter']") as HTMLElement;
    expect(within(free).getByText("20 products")).toBeTruthy();
    expect(within(starter).getByText("Everything in Free, plus")).toBeTruthy();
    expect(within(starter).getByText("60 products")).toBeTruthy();
    const pro = document.querySelector("[data-pricing-plan='pro']") as HTMLElement;
    expect(within(pro).getByText("500 products")).toBeTruthy();
    expect(within(pro).getByText("Download analytics reports (CSV)")).toBeTruthy();
    expect(within(pro).getByText("Priority support: your messages answered first")).toBeTruthy();
  });

  it("draws each plan as a shelf that grows, with no glow on the recommended card", () => {
    render(<PlansPage context={FREE} source={null} actions={stubActions()} />);
    const shelf = (plan: string) => document.querySelectorAll(`[data-plan-visual='${plan}'] img`).length;
    expect([shelf("free"), shelf("starter"), shelf("pro")]).toEqual([1, 2, 3]);
    expect(document.querySelector("[data-pricing-plan='starter'] [style*='radial-gradient']")).toBeNull();
  });

  it("compares the plans in sections, ticking what Free already has", () => {
    render(<PlansPage context={FREE} source={null} actions={stubActions()} />);
    expect(Array.from(document.querySelectorAll("[data-compare-group]")).map((group) => group.getAttribute("data-compare-group"))).toEqual(
      ["selling", "store", "tools", "support"],
    );
    const exportRow = document.querySelector("[data-compare-row='ordersExport']") as HTMLElement;
    expect(within(exportRow).getAllByLabelText("Included")).toHaveLength(3);
    const reports = document.querySelector("[data-compare-row='analyticsExport']") as HTMLElement;
    expect(within(reports).getAllByLabelText("Included")).toHaveLength(1);
    // Products are capped per plan, and the import is on every plan.
    const products = document.querySelector("[data-compare-row='products']") as HTMLElement;
    expect(Array.from(products.querySelectorAll("td")).map((cell) => cell.textContent)).toEqual(["20", "60", "500"]);
    const imports = document.querySelector("[data-compare-row='productImport']") as HTMLElement;
    expect(within(imports).getAllByLabelText("Included")).toHaveLength(3);
    // Removed at the owner's request: not selling points of a plan.
    expect(document.querySelector("[data-compare-row='security']")).toBeNull();
    expect(document.querySelector("[data-compare-row='languages']")).toBeNull();
    expect(screen.queryByText(/Two-factor/)).toBeNull();
    expect(screen.queryByText(/languages/)).toBeNull();
  });

  it("keeps the calculator to one slider and a bar per plan", () => {
    render(<PlansPage context={FREE} source={null} actions={stubActions()} />);
    const calculator = document.querySelector("[data-pricing-calculator]") as HTMLElement;
    expect(calculator.querySelectorAll("[data-pricing-cost]")).toHaveLength(3);
    // €1,000 a month by default: Free €50, Starter €32, Pro €44.
    expect(within(calculator).getByText("Cheapest for you").closest("[data-pricing-cost]")?.getAttribute("data-pricing-cost")).toBe(
      "starter",
    );
    expect(document.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("takes the sales figure in a field that shows it whole, and follows what is typed", async () => {
    const user = userEvent.setup();
    render(<PlansPage context={{ ...FREE, directSales30dCents: 183_700 }} source={null} actions={stubActions()} />);
    // Starts on the store's own sales, grouped, with no caption about it.
    const field = screen.getByLabelText("Sales per month") as HTMLInputElement;
    expect(field.value).toBe("1,837");
    expect(screen.queryByText(/Filled in from your last 30 days/)).toBeNull();
    expect(screen.queryByText("Calculator")).toBeNull();

    await user.click(field);
    await user.keyboard("10000");
    await user.tab();
    expect(field.value).toBe("10,000");
    expect(document.querySelector("[data-cheapest]")?.getAttribute("data-pricing-cost")).toBe("pro");
    // The sentence is for screen readers only now; the pill says it on screen.
    const spoken = screen.getByText("At €10,000 a month in sales, Pro costs you least.");
    expect(spoken.className).toContain("sr-only");

    // More than the field goes up to is brought back to its ceiling.
    await user.click(field);
    await user.keyboard("99999");
    await user.tab();
    expect(field.value).toBe("10,000");
  });
});

describe("UpgradeCard (Settings › Plan & billing)", () => {
  it("offers a Free owner Starter, with the fee it drops to and what it adds", async () => {
    const actions = stubActions();
    const user = userEvent.setup();
    renderUpsell(FREE, actions);

    const card = document.querySelector("[data-upsell]") as HTMLElement;
    expect(card.getAttribute("data-upsell")).toBe("starter");
    expect(within(card).getByText("Best value")).toBeTruthy();
    const fee = card.querySelector("[data-upsell-fee]") as HTMLElement;
    expect(fee.textContent).toContain("5%");
    expect(fee.textContent).toContain("2%");
    expect(within(card).getByText("60 products")).toBeTruthy();
    expect(card.querySelector("[style*='radial-gradient']")).toBeNull();
    // No sales yet: where it starts paying for itself, not a saving.
    expect(card.querySelector("[data-upsell-worth]")?.textContent).toMatch(/pays for itself/);

    await user.click(within(card).getByRole("button", { name: /Upgrade to Starter/ }));
    expect(actions.startCheckout).toHaveBeenCalledWith({ plan: "starter", interval: "month", source: "settings" });
    expect(actions.navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("names the saving at the store's own sales when there is one", () => {
    // €2,000 a month: Free's 5% is €100, Starter's 2% plus €12 is €52.
    renderUpsell({ ...FREE, directSales30dCents: 200_000 });
    expect(document.querySelector("[data-upsell-worth]")?.textContent).toMatch(/save you €48\.00 a month/);
  });

  it("claims no saving below the EUR 400 a month where Starter pays for itself", () => {
    // €400 exactly: €20 on Free, €12 + €8 on Starter. Nothing saved, so the
    // card says where it starts paying, never a saving of nothing.
    renderUpsell({ ...FREE, directSales30dCents: 40_000 });
    expect(document.querySelector("[data-upsell-worth]")?.textContent).toMatch(/pays for itself once you sell more than €400/);
    cleanup();
    // €500: €25 against €22.
    renderUpsell({ ...FREE, directSales30dCents: 50_000 });
    expect(document.querySelector("[data-upsell-worth]")?.textContent).toMatch(/save you €3\.00 a month/);
  });

  it("offers a subscribed Starter owner Pro as a switch through the portal", () => {
    renderUpsell(STARTER);
    expect(document.querySelector("[data-upsell]")?.getAttribute("data-upsell")).toBe("pro");
    expect(screen.getByRole("button", { name: /Switch to Pro/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Upgrade to/ })).toBeNull();
  });

  it("shows a Pro store what it has rather than something to buy", () => {
    renderUpsell({ ...STARTER, plan: "pro" });
    expect(document.querySelector("[data-upsell]")?.getAttribute("data-upsell")).toBe("top");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Compare all plans" }).getAttribute("href")).toBe("/plans?from=settings");
  });
});

describe("BillingSection", () => {
  it("states the fee of the plan price in force, on what the buyer pays", () => {
    render(<BillingSection context={FREE} returned={null} actions={stubActions()} />);
    expect(screen.getByText("Fee on each sale: 5% of what the buyer pays.")).toBeTruthy();
    cleanup();
    render(<BillingSection context={{ ...STARTER, plan: "pro" }} returned={null} actions={stubActions()} />);
    expect(screen.getByText("Fee on each sale: 0.5% of what the buyer pays.")).toBeTruthy();
  });

  it("tells a waived store its sales pay no fee, not the plan's rate", () => {
    render(<BillingSection context={{ ...FREE, feeWaived: true }} returned={null} actions={stubActions()} />);
    expect(screen.getByText("No fee on your sales: it is waived for your store.")).toBeTruthy();
    expect(screen.queryByText(/Fee on each sale/)).toBeNull();
  });

  it("replaces the old plans button with the upsell for an owner", () => {
    render(<BillingSection context={FREE} returned={null} actions={stubActions()} />);
    expect(screen.queryByRole("button", { name: /See plans|Change plan/ })).toBeNull();
    expect(document.querySelector("[data-upsell='starter']")).toBeTruthy();
  });

  it("sells nothing to a teammate", () => {
    render(<BillingSection context={{ ...FREE, canManage: false }} returned={null} actions={stubActions()} />);
    expect(document.querySelector("[data-upsell]")).toBeNull();
    expect(screen.getByText("Only the store owner can change the plan or see its invoices.")).toBeTruthy();
  });

  it("asks for a working card, not an upgrade, while a payment is failing", () => {
    render(<BillingSection context={{ ...STARTER, status: "past_due" }} returned={null} actions={stubActions()} />);
    expect(document.querySelector("[data-upsell]")).toBeNull();
    expect(screen.getByRole("button", { name: /Manage billing/ })).toBeTruthy();
  });

  it("gives a subscribed owner a quiet Cancel plan on the plan card, and a teammate none", () => {
    render(<BillingSection context={STARTER} returned={null} actions={stubActions()} />);
    const controls = document.querySelector("[data-plan-controls]") as HTMLElement;
    expect(within(controls).getByRole("button", { name: "Cancel plan" })).toBeTruthy();
    cleanup();
    render(<BillingSection context={{ ...STARTER, canManage: false }} returned={null} actions={stubActions()} />);
    expect(document.querySelector("[data-plan-controls]")).toBeNull();
    cleanup();
    // Free has nothing to cancel.
    render(<BillingSection context={FREE} returned={null} actions={stubActions()} />);
    expect(document.querySelector("[data-plan-controls]")).toBeNull();
  });

  it("shows a plan Square Share gave as on us, until its end date, with nothing to cancel", () => {
    render(<BillingSection context={GRANTED_STARTER} returned={null} actions={stubActions()} />);
    expect(document.querySelector("[data-billing-plan]")?.getAttribute("data-billing-plan")).toBe("starter");
    expect(screen.getByText("On us: Square Share gave your store this plan.")).toBeTruthy();
    expect(screen.getByText(`Until ${GRANT_END}. Nothing is taken down when it ends.`)).toBeTruthy();
    expect(screen.queryByText("No subscription.")).toBeNull();
    expect(document.querySelector("[data-plan-controls]")).toBeNull();
    cleanup();
    render(
      <BillingSection
        context={{ ...GRANTED_STARTER, grant: { plan: "starter", endsAt: null } }}
        returned={null}
        actions={stubActions()}
      />,
    );
    expect(screen.getByText("No end date.")).toBeTruthy();
  });

  it("while a plan is ending, says when and offers Keep my plan in one click", async () => {
    const actions = stubActions();
    const user = userEvent.setup();
    render(<BillingSection context={{ ...STARTER, cancelAtPeriodEnd: true }} returned={null} actions={actions} />);
    expect(screen.getByText(`Ends on ${PERIOD_END}. Your store moves to Free then, and nothing is taken down.`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Keep my plan" }));
    expect(actions.resumePlan).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("You're keeping Starter. It renews as usual.")).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows the server's refusal when the plan cannot be kept", async () => {
    const actions = stubActions({
      resumePlan: vi.fn(async () => ({
        ok: false as const,
        error: { code: "invalid_input" as const, message: { key: "Errors.billing.deletionPending" as const } },
      })),
    });
    const user = userEvent.setup();
    render(<BillingSection context={{ ...STARTER, cancelAtPeriodEnd: true }} returned={null} actions={actions} />);
    await user.click(screen.getByRole("button", { name: "Keep my plan" }));
    expect(await screen.findByText(/Your account is set to be deleted/)).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("Cancelling a plan (CancelPlanDialog)", () => {
  async function openDialog(actions = stubActions()) {
    const user = userEvent.setup();
    render(<BillingSection context={STARTER} returned={null} actions={actions} />);
    await user.click(screen.getByRole("button", { name: "Cancel plan" }));
    return { user, actions, dialog: screen.getByRole("dialog", { name: "Cancel Starter?" }) };
  }

  it("says what happens and what Free goes without, on one screen", async () => {
    const { dialog } = await openDialog();
    // The one sentence, as the dialog's own description.
    expect(dialog).toHaveAccessibleDescription(
      `You keep Starter until ${PERIOD_END}, then move to Free. Nothing is taken down.`,
    );
    // What Free goes without is one line that opens, not a list to read past.
    const lost = within(dialog).getByText("Not included on Free").closest("details") as HTMLDetailsElement;
    expect(lost.open).toBe(false);
    expect(within(dialog).getByText("60 products")).toBeTruthy();
    // Every reason, each a radio, none picked for the owner.
    const reasons = within(dialog).getAllByRole("radio") as HTMLInputElement[];
    expect(reasons.map((radio) => radio.value)).toEqual([
      "too_expensive",
      "unused",
      "missing_features",
      "switched_service",
      "temporary",
      "other",
    ]);
    expect(reasons.some((radio) => radio.checked)).toBe(false);
  });

  it("asks for a note only once a reason is picked", async () => {
    const { user, dialog } = await openDialog();
    expect(within(dialog).queryByLabelText(/What could we do better?/)).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: "Something else" }));
    expect(within(dialog).getByLabelText(/What could we do better?/)).toBeTruthy();
  });

  it("cancels without asking for a reason: the feedback is optional", async () => {
    const { user, actions, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    expect(actions.cancelPlan).toHaveBeenCalledWith({ reason: null, detail: null });
    expect(await screen.findByText(/Changed your mind?/)).toBeTruthy();
  });

  it("sends the reason and the note, then confirms the date and refreshes on close", async () => {
    const { user, actions, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("radio", { name: "Too expensive" }));
    await user.type(within(dialog).getByLabelText(/What could we do better?/), "  Cheaper yearly please  ");
    await user.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    expect(actions.cancelPlan).toHaveBeenCalledWith({ reason: "too_expensive", detail: "Cheaper yearly please" });

    const done = await screen.findByRole("dialog", { name: "Your plan is cancelled" });
    expect(within(done).getByText(new RegExp(`You keep Starter until ${PERIOD_END}`))).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
    await user.click(within(done).getByRole("button", { name: "Done" }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("Keep my plan closes without cancelling anything", async () => {
    const { user, actions, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Keep my plan" }));
    expect(actions.cancelPlan).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("shows the server's refusal in the dialog and stays open", async () => {
    const actions = stubActions({
      cancelPlan: vi.fn(async () => ({
        ok: false as const,
        error: { code: "invalid_input" as const, message: { key: "Errors.billing.notCancellable" as const } },
      })),
    });
    const { user, dialog } = await openDialog(actions);
    await user.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    expect(await within(dialog).findByText(/already set to end/)).toBeTruthy();
    expect(await within(dialog).findByRole("button", { name: "Cancel plan" })).toBeTruthy();
  });
});

describe("PlanLimitNotice (a product page with no room left)", () => {
  it("says the limit in the action's own words, and links to the plans naming it", () => {
    render(<PlanLimitNotice limitKey="products" plan="free" cap={20} />);
    expect(screen.getByText("Your Free plan includes 20 products, and your store has them all.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /See plans/ }).getAttribute("href")).toBe("/plans?from=product_limit");
    // The shelf beside it is the next plan up, the one with more room.
    expect(document.querySelector("[data-plan-visual='starter']")).toBeTruthy();
  });

  it("offers no upgrade on the top plan, where there is none to offer", () => {
    render(<PlanLimitNotice limitKey="products" plan="pro" cap={500} />);
    expect(screen.getByText("Your Pro plan includes 500 products, and your store has them all.")).toBeTruthy();
    expect(screen.getByText(/Remove one you no longer need to add another/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("OrdersExportButton", () => {
  it("locked (a plan without the perk), links to the plans page naming the plan that has it", () => {
    render(<OrdersExportButton enabled={false} />);
    const link = screen.getByRole("link", { name: /Export CSV/ });
    expect(link.getAttribute("href")).toBe("/plans?from=orders_export");
    // Every plan has it today, so the cheapest plan with it is Free.
    expect(within(link).getByText("Free")).toBeTruthy();
  });

  it("on a paid plan, fetches the file and shows the server's refusal in place", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "That's a lot of exports in a short time.", fix: "Wait a few minutes, then try again." }, { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OrdersExportButton enabled />);
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/export", { cache: "no-store" });
    expect(await screen.findByText("That's a lot of exports in a short time.")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("AnalyticsExportButton", () => {
  const snapshot = {
    version: 1,
    range: { from: "2026-09-01", to: "2026-09-30", preset: "30d" },
    currency: "EUR",
    generatedAt: "2026-09-30T12:00:00.000Z",
    sales: { available: true, series: [{ date: "2026-09-01", revenueCents: 5000, sales: 2, aovCents: 2500 }] },
    signals: { available: true, byKind: {}, everRecorded: [], activeBlockTypes: [] },
  } as unknown as AnalyticsSnapshot;

  it("without Pro, links to the plans page naming Pro", () => {
    render(<AnalyticsExportButton enabled={false} snapshot={snapshot} />);
    const link = screen.getByRole("link", { name: /Download report/ });
    expect(link.getAttribute("href")).toBe("/plans?from=analytics_nudge");
    expect(within(link).getByText("Pro")).toBeTruthy();
  });

  it("on Pro, saves the report built from the page's own figures", async () => {
    // jsdom has no object URLs; record the Blob the download was given.
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:report";
    });
    URL.revokeObjectURL = vi.fn();
    try {
      const user = userEvent.setup();
      render(<AnalyticsExportButton enabled snapshot={snapshot} />);
      await user.click(screen.getByRole("button", { name: /Download report/ }));
      expect(created).toHaveLength(1);
      expect(await created[0]!.text()).toContain("2026-09-01,2,50.00,25.00,EUR");
    } finally {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
  });
});

describe("the fee on an order", () => {
  it("names the rate the sale was charged at", () => {
    render(<OrderDetail order={orderView({ platformFeeBps: 300, platformFeeCents: 75 })} onClose={() => {}} />);
    expect(screen.getByText("Platform fee (3%)")).toBeTruthy();
  });

  it("keeps the bare label on orders from before plans", () => {
    render(<OrderDetail order={orderView({ platformFeeBps: null })} onClose={() => {}} />);
    expect(screen.getByText("Platform fee")).toBeTruthy();
  });
});
