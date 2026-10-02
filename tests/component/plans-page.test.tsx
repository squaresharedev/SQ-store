import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "../setup/render";
import { orderView } from "../setup/order-view";

// The billing surfaces as each kind of reader meets them, with the server
// actions stubbed: the plans page, the Settings upsell and the Orders export
// button. What each offers depends on the store's plan and on who is looking,
// and pressing an action asks the server, never builds a URL of its own.

vi.mock("@/lib/billing/actions", () => ({ startCheckout: vi.fn(), openBillingPortal: vi.fn() }));
vi.mock("@/lib/orders/actions", () => ({ markOrderShipped: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));

import { PlansPage } from "@/components/billing/PlansPage";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { PlanLimitNotice } from "@/components/billing/PlanLimitNotice";
import type { BillingActions } from "@/components/billing/billing-actions";
import { BillingSection } from "@/components/settings/BillingSection";
import { OrdersExportButton } from "@/components/orders/OrdersExportButton";
import { AnalyticsExportButton } from "@/components/analytics/AnalyticsExportButton";
import { OrderDetail } from "@/components/orders/OrderDetail";
import type { PricingContext } from "@/lib/billing/pricing-context";
import type { AnalyticsSnapshot } from "@/lib/analytics/types";

afterEach(cleanup);

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

const FREE: PricingContext = {
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
  salesSubtotal30dCents: 0,
  usage: { storefronts: 1, teamSeats: 1, products: 4 },
};

const STARTER: PricingContext = {
  ...FREE,
  plan: "starter",
  interval: "month",
  status: "active",
  priceCents: 1500,
  currency: "EUR",
  hasSubscription: true,
  hasBillingAccount: true,
};

function stubActions(overrides: Partial<BillingActions> = {}): BillingActions {
  return {
    startCheckout: vi.fn(async () => ({ ok: true as const, url: "https://checkout.stripe.com/c/pay/cs_test_1" })),
    openPortal: vi.fn(async () => ({ url: "https://billing.stripe.com/p/session/1" })),
    navigate: vi.fn(),
    ...overrides,
  };
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
    render(<PlansPage context={FREE} source="settings" actions={actions} />);
    await user.click(screen.getByRole("button", { name: "Yearly" }));
    await user.click(screen.getByRole("button", { name: /Upgrade to Starter/ }));
    expect(actions.startCheckout).toHaveBeenCalledWith({ plan: "starter", interval: "year", source: "settings" });
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

  it("routes a subscribed owner's changes through the Customer Portal", () => {
    render(<PlansPage context={STARTER} source={null} actions={stubActions()} />);
    expect(screen.queryByRole("button", { name: /Upgrade to/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Switch to Pro/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Move to Free/ })).toBeTruthy();
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
    render(<PlansPage context={{ ...FREE, salesSubtotal30dCents: 20_000 }} source={null} actions={stubActions()} />);
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
    // €1,000 a month by default: Free €50, Starter €45, Pro €50.
    expect(within(calculator).getByText("Cheapest for you").closest("[data-pricing-cost]")?.getAttribute("data-pricing-cost")).toBe(
      "starter",
    );
    expect(document.querySelector(".recharts-wrapper")).toBeNull();
  });
});

describe("UpgradeCard (Settings › Plan & billing)", () => {
  it("offers a Free owner Starter, with the fee it drops to and what it adds", async () => {
    const actions = stubActions();
    const user = userEvent.setup();
    render(<UpgradeCard context={FREE} actions={actions} />);

    const card = document.querySelector("[data-upsell]") as HTMLElement;
    expect(card.getAttribute("data-upsell")).toBe("starter");
    expect(within(card).getByText("Best value")).toBeTruthy();
    const fee = card.querySelector("[data-upsell-fee]") as HTMLElement;
    expect(fee.textContent).toContain("5%");
    expect(fee.textContent).toContain("3%");
    expect(within(card).getByText("60 products")).toBeTruthy();
    expect(card.querySelector("[style*='radial-gradient']")).toBeNull();
    // No sales yet: where it starts paying for itself, not a saving.
    expect(card.querySelector("[data-upsell-worth]")?.textContent).toMatch(/pays for itself/);

    await user.click(within(card).getByRole("button", { name: /Upgrade to Starter/ }));
    expect(actions.startCheckout).toHaveBeenCalledWith({ plan: "starter", interval: "month", source: "settings" });
    expect(actions.navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("names the saving at the store's own sales when there is one", () => {
    // €2,000 a month: Free's 5% is €100, Starter's 3% plus €15 is €75.
    render(<UpgradeCard context={{ ...FREE, salesSubtotal30dCents: 200_000 }} actions={stubActions()} />);
    expect(document.querySelector("[data-upsell-worth]")?.textContent).toMatch(/save you €25\.00 a month/);
  });

  it("offers a subscribed Starter owner Pro as a switch through the portal", () => {
    render(<UpgradeCard context={STARTER} actions={stubActions()} />);
    expect(document.querySelector("[data-upsell]")?.getAttribute("data-upsell")).toBe("pro");
    expect(screen.getByRole("button", { name: /Switch to Pro/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Upgrade to/ })).toBeNull();
  });

  it("shows a Pro store what it has rather than something to buy", () => {
    render(<UpgradeCard context={{ ...STARTER, plan: "pro" }} actions={stubActions()} />);
    expect(document.querySelector("[data-upsell]")?.getAttribute("data-upsell")).toBe("top");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Compare all plans" }).getAttribute("href")).toBe("/plans?from=settings");
  });
});

describe("BillingSection", () => {
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
