import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, render, screen, within } from "../setup/render";
import { msg } from "@/i18n/types";
import messages from "../../messages/en";
import { invalidInput } from "@/lib/errors";
import { coveredProducts } from "@/lib/discounts/covered";
import { summarizeDiscounts, type DiscountsSummary } from "@/lib/discounts/summary";
import type { DiscountPerformance, DiscountProductChoice, DiscountView } from "@/types/discount";
import type { ProductSale } from "@/types/product";

// The seller's Discounts tab and the buyer's sale price, as each reader sees
// them. The server actions are replaced; everything that decides what is
// shown (the wording, the summary, the statuses) is real.

const actions = vi.hoisted(() => ({
  createDiscount: vi.fn(),
  updateDiscount: vi.fn(),
  setCodeEnabled: vi.fn(),
  endSale: vi.fn(),
  deleteDiscount: vi.fn(),
}));
vi.mock("@/lib/discounts/actions", () => actions);

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/discounts",
  useSearchParams: () => new URLSearchParams(),
}));

// The rest of the props go through: an icon-only link is named by its aria-label.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DiscountForm } = await import("@/components/discounts/DiscountForm");
const { DiscountFormView } = await import("@/components/discounts/DiscountFormView");
const { DiscountsPage } = await import("@/components/discounts/DiscountsPage");
const { DiscountRow } = await import("@/components/discounts/DiscountRow");
const { ProductPrice } = await import("@/components/product-page/ProductPrice");

/** Mid-morning on a whole hour, so every half-hour rounding is a no-op in any
 *  time zone the suite runs in. */
const NOW = new Date("2026-10-05T10:00:00.000Z");

const MUG = "11111111-1111-4111-8111-111111111111";
const APRON = "22222222-2222-4222-8222-222222222222";
const PRODUCTS: DiscountProductChoice[] = [
  { id: MUG, title: "Blue mug", priceCents: 2400, currency: "EUR" },
  { id: APRON, title: "Linen apron", priceCents: 3800, currency: "EUR" },
];

function discount(patch: Partial<DiscountView> = {}): DiscountView {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    kind: "code",
    code: "SUMMER10",
    shareChannel: "Instagram",
    value: { type: "percent", percentOff: 10 },
    appliesTo: "all",
    productIds: [],
    startsAt: "2026-10-01T09:00:00.000Z",
    endsAt: null,
    usageLimit: null,
    enabled: true,
    createdAt: "2026-10-01T09:00:00.000Z",
    ...patch,
  };
}

const sale = (patch: Partial<DiscountView> = {}) =>
  discount({ kind: "automatic", code: null, shareChannel: null, value: { type: "percent", percentOff: 20 }, ...patch });

function sold(id: string, orders: number, revenueCents: number, givenCents: number): DiscountPerformance {
  return {
    discountId: id,
    uses: orders,
    orders,
    revenue: [{ currency: "EUR", cents: revenueCents }],
    given: [{ currency: "EUR", cents: givenCents }],
    lastOrderAt: "2026-10-04T10:00:00.000Z",
  };
}

beforeAll(() => {
  // The channel chart measures itself and asks about reduced motion; jsdom
  // has neither to answer with.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue({ ok: true, id: "x" });
  push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const summaryBox = () => document.querySelector<HTMLElement>("[data-discount-summary]")!;

describe("the discount form", () => {
  it("starts as a sale; a code arrives filled in, is said back with an example, and sends exactly what the server parses", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    expect(screen.getByRole("radio", { name: /^Sale/ })).toBeChecked();
    expect(screen.queryByLabelText("Code")).toBeNull();

    // Choosing a code fills one in, from the unambiguous alphabet.
    await user.click(screen.getByRole("radio", { name: /^Discount code/ }));
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    // Typed in any case, kept in capitals: buyers can type it either way.
    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), "summer10");
    expect(screen.getByLabelText("Code")).toHaveValue("SUMMER10");
    await user.click(screen.getByRole("button", { name: "Instagram" }));
    expect(screen.getByLabelText("Shared on (optional)")).toHaveValue("Instagram");
    expect(screen.getByRole("button", { name: "Instagram" })).toHaveAttribute("aria-pressed", "true");

    expect(summaryBox()).toHaveTextContent("SUMMER10 · 10% off the order · All products");
    expect(summaryBox()).toHaveTextContent("Starts now · No end date");
    expect(summaryBox()).toHaveTextContent("Example: Blue mug at €24.00 costs €21.60.");

    // One tap for a week from now: the end becomes a date the seller can see.
    await user.click(screen.getByRole("button", { name: "1 week" }));
    expect(within(screen.getByRole("group", { name: "Ends" })).getByRole("button", { name: "On a date" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(summaryBox()).not.toHaveTextContent("No end date");

    await user.click(screen.getByRole("button", { name: "Create discount" }));
    expect(actions.createDiscount).toHaveBeenCalledWith({
      kind: "code",
      value: { type: "percent", percentOff: 10 },
      appliesTo: "all",
      productIds: [],
      startsAt: null,
      endsAt: "2026-10-12T10:00:00.000Z",
      code: "SUMMER10",
      shareChannel: "Instagram",
      usageLimit: null,
      enabled: true,
    });
    expect(await screen.findByText("Discount created.")).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/discounts");
  });

  it("generates another code on request", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    await user.click(screen.getByRole("radio", { name: /^Discount code/ }));
    await user.clear(screen.getByLabelText("Code"));
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it("sends a code's limit from one optional box, none when it is left empty, and the code switched on", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    await user.click(screen.getByRole("radio", { name: /^Discount code/ }));
    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), "VIP25");
    // No switch to find first: the box says what empty means.
    expect(screen.queryByRole("switch")).toBeNull();
    const limit = screen.getByLabelText("Max orders (optional)");
    expect(limit).toHaveAttribute("placeholder", "No limit");
    await user.type(limit, "40");

    await user.click(screen.getByRole("button", { name: "Create discount" }));
    expect(actions.createDiscount).toHaveBeenCalledWith(
      expect.objectContaining({ code: "VIP25", shareChannel: "", usageLimit: 40, enabled: true }),
    );
  });

  it("sends a switched-off code back switched off: the switch lives on its row in the list", async () => {
    const user = userEvent.setup();
    const code = discount({ enabled: false, usageLimit: 25 });
    render(<DiscountForm discount={code} products={PRODUCTS} />);
    expect(screen.getByLabelText("Max orders (optional)")).toHaveValue(25);
    await user.clear(screen.getByLabelText("Max orders (optional)"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.updateDiscount).toHaveBeenCalledWith(
      code.id,
      expect.objectContaining({ usageLimit: null, enabled: false }),
    );
  });

  it("asks how much in one box, its unit beside it: a percentage or the catalogue's own currency", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    const unit = screen.getByRole("group", { name: "Percentage or amount" });
    // An all-euro catalogue has one currency to offer, so no currency to pick.
    expect(within(unit).getAllByRole("button").map((option) => option.textContent)).toEqual(["%", "€"]);
    expect(screen.getByLabelText("Percentage off")).toHaveValue(10);
    await user.click(within(unit).getByRole("button", { name: "€" }));
    expect(screen.getByLabelText("Amount off")).toBeInTheDocument();
    expect(screen.queryByText("Applies only to products priced in this currency.")).toBeNull();
    cleanup();

    // Two currencies on sale: both on offer, and a word on what that means.
    render(
      <DiscountForm
        discount={null}
        products={[...PRODUCTS, { id: "33333333-3333-4333-8333-333333333333", title: "Zine", priceCents: 1200, currency: "USD" }]}
      />,
    );
    const both = screen.getByRole("group", { name: "Percentage or amount" });
    expect(within(both).getAllByRole("button").map((option) => option.textContent)).toEqual(["%", "€", "$"]);
    await user.click(within(both).getByRole("button", { name: "$" }));
    await user.type(screen.getByLabelText("Amount off"), "2");
    expect(screen.getByText("Applies only to products priced in this currency.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create discount" }));
    expect(actions.createDiscount).toHaveBeenCalledWith(
      expect.objectContaining({ value: { type: "amount", amountOffCents: 200, currency: "USD" } }),
    );
  });

  it("says the time zone only once a date is in play", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    expect(screen.queryByText(/Times are in your time zone/)).toBeNull();
    await user.click(within(screen.getByRole("group", { name: "Ends" })).getByRole("button", { name: "On a date" }));
    expect(screen.getByText(/Times are in your time zone/)).toBeInTheDocument();
  });

  it("leads a sale, and only a sale, to how sales look on the storefront, in a new tab", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} chipHref="/storefront/abc?setting=sale-chip" />);
    const link = screen.getByRole("link", { name: "Change how sales look on your storefront" });
    expect(link).toHaveAttribute("href", "/storefront/abc?setting=sale-chip");
    expect(link).toHaveAttribute("target", "_blank");
    await user.click(screen.getByRole("radio", { name: /^Discount code/ }));
    expect(screen.queryByRole("link", { name: "Change how sales look on your storefront" })).toBeNull();
  });

  it("makes a sale: no code, channel or limit, an amount off each chosen product", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    expect(screen.queryByLabelText("Code")).toBeNull();
    expect(screen.queryByLabelText("Max orders (optional)")).toBeNull();
    expect(screen.getByText("Taken off the price of each item.")).toBeInTheDocument();

    await user.click(within(screen.getByRole("group", { name: "Percentage or amount" })).getByRole("button", { name: "€" }));
    await user.type(screen.getByLabelText("Amount off"), "5");
    // An amount off is not a product's price, so it does not publish itself as one.
    expect(document.querySelector("[data-product-field]")).toBeNull();
    expect(summaryBox()).toHaveTextContent("€5.00 off each item · All products");

    await user.click(screen.getByRole("button", { name: "Specific products" }));
    await user.click(screen.getByRole("button", { name: "Choose products" }));
    await user.click(screen.getByRole("checkbox", { name: /Linen apron/ }));
    expect(summaryBox()).toHaveTextContent("€5.00 off each item · 1 product");
    expect(summaryBox()).toHaveTextContent("Example: Linen apron at €38.00 costs €33.00.");

    await user.click(screen.getByRole("button", { name: "Create discount" }));
    expect(actions.createDiscount).toHaveBeenCalledWith({
      kind: "automatic",
      value: { type: "amount", amountOffCents: 500, currency: "EUR" },
      appliesTo: "products",
      productIds: [APRON],
      startsAt: null,
      endsAt: null,
    });
  });

  it("shows the server's refusal and stays on the page", async () => {
    const user = userEvent.setup();
    actions.createDiscount.mockResolvedValue({
      ok: false,
      error: invalidInput(msg("Errors.discounts.codeTaken.message"), msg("Errors.discounts.codeTaken.fix")),
    });
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    await user.click(screen.getByRole("radio", { name: /^Discount code/ }));
    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), "SUMMER10");
    await user.click(screen.getByRole("button", { name: "Create discount" }));
    expect(await screen.findByText("That code is already in use in this store.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("offers only the end of a sale that has started, and keeps its start", async () => {
    const user = userEvent.setup();
    const running = sale();
    render(<DiscountForm discount={running} products={PRODUCTS} />);

    // What can still change is said first, and nothing else is offered: the
    // kind is not asked, and the terms are in the summary, not in dead fields.
    expect(document.querySelector("[data-discount-locked]")).toHaveTextContent(/only its end can change/);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByLabelText("Percentage off")).toBeNull();
    expect(screen.queryByRole("group", { name: "Percentage or amount" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Which products?" })).toBeNull();
    expect(summaryBox()).toHaveTextContent("20% off each item · All products");
    // Its start is told as a fact, in the schedule and in the summary.
    expect(screen.getAllByText(/^Started /)).toHaveLength(2);
    expect(summaryBox()).not.toHaveTextContent("Starts");

    // A preset on a running sale counts from now, not from its start.
    await user.click(screen.getByRole("button", { name: "3 days" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.updateDiscount).toHaveBeenCalledWith(running.id, {
      kind: "automatic",
      value: { type: "percent", percentOff: 20 },
      appliesTo: "all",
      productIds: [],
      startsAt: running.startsAt,
      endsAt: "2026-10-08T10:00:00.000Z",
    });
    expect(await screen.findByText("Discount saved.")).toBeInTheDocument();
  });

  it("sends back a start and an end nobody touched exactly as they were stored", async () => {
    // The database's own spelling, to the second and between two half hours.
    // Opening the form and saving must not move either by a minute, or a
    // running code would be refused for a start "in the past".
    const user = userEvent.setup();
    const code = discount({ startsAt: "2026-10-01T09:41:27.123456+00:00", endsAt: "2026-10-20T17:13:45+00:00" });
    render(<DiscountForm discount={code} products={PRODUCTS} />);
    await user.clear(screen.getByLabelText("Percentage off"));
    await user.type(screen.getByLabelText("Percentage off"), "15");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.updateDiscount).toHaveBeenCalledWith(
      code.id,
      expect.objectContaining({ startsAt: code.startsAt, endsAt: code.endsAt }),
    );
    // A code that is already running says so: its start is a fact by now,
    // shown rather than offered ("Later" with a date in the past made no sense).
    expect(summaryBox()).toHaveTextContent(/Started /);
    expect(screen.queryByRole("group", { name: "Starts" })).toBeNull();
    expect(screen.getByRole("group", { name: "Ends" })).toBeInTheDocument();
  });

  it("still offers the start of a code that has not started yet", async () => {
    render(<DiscountForm discount={discount({ startsAt: "2026-10-20T09:00:00.000Z" })} products={PRODUCTS} />);
    const starts = screen.getByRole("group", { name: "Starts" });
    expect(within(starts).getByRole("button", { name: "Later" })).toHaveAttribute("aria-pressed", "true");
    expect(summaryBox()).toHaveTextContent(/Starts /);
  });

  it("opens a date on a moment still to come: tomorrow morning, and a week's run", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    await user.click(within(screen.getByRole("group", { name: "Starts" })).getByRole("button", { name: "Later" }));
    await user.click(within(screen.getByRole("group", { name: "Ends" })).getByRole("button", { name: "On a date" }));
    await user.click(screen.getByRole("button", { name: "Create discount" }));

    const start = new Date(NOW);
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    expect(actions.createDiscount).toHaveBeenCalledWith(
      expect.objectContaining({ startsAt: start.toISOString(), endsAt: end.toISOString() }),
    );
  });

  it("lets a code be edited in full, without changing its kind", async () => {
    const user = userEvent.setup();
    const code = discount();
    render(<DiscountForm discount={code} products={PRODUCTS} />);
    // The kind is not asked again; the page's heading says it (DiscountFormView).
    expect(screen.queryByRole("radio")).toBeNull();
    const percent = screen.getByLabelText("Percentage off");
    expect(percent).toBeEnabled();
    await user.clear(percent);
    await user.type(percent, "15");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.updateDiscount).toHaveBeenCalledWith(
      code.id,
      expect.objectContaining({ kind: "code", code: "SUMMER10", value: { type: "percent", percentOff: 15 } }),
    );
  });

  it("heads an edit with what the discount is, a sale or a code, since that is no longer a choice", () => {
    render(<DiscountFormView discount={sale()} products={PRODUCTS} chipHref={null} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Edit sale");
    cleanup();
    render(<DiscountFormView discount={discount()} products={PRODUCTS} chipHref={null} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Edit discount code");
    cleanup();
    render(<DiscountFormView discount={null} products={PRODUCTS} chipHref={null} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("New discount");
  });
});

describe("the discounts page", () => {
  const code = discount();
  const running = sale({ id: "aaaaaaaa-0000-4000-8000-000000000002", endsAt: "2026-10-31T12:00:00.000Z" });
  const over = sale({
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    startsAt: "2026-09-01T09:00:00.000Z",
    endsAt: "2026-09-08T09:00:00.000Z",
  });

  function summary(): DiscountsSummary {
    const performance = new Map([
      [code.id, sold(code.id, 3, 6480, 720)],
      [running.id, sold(running.id, 1, 1920, 480)],
    ]);
    return summarizeDiscounts([code, running, over], performance, new Map(), NOW);
  }

  const row = (id: string) => document.querySelector<HTMLElement>(`[data-discount-row='${id}']`)!;

  it("invites the first discount, and only from someone who may create one", () => {
    const empty: DiscountsSummary = { items: [], orders: 0, revenue: [], given: [], channels: [] };
    const { unmount } = render(<DiscountsPage products={PRODUCTS} summary={empty} canWrite />);
    expect(screen.getByRole("heading", { name: "No discounts yet" })).toBeInTheDocument();
    // The card in the picture and a plain button under it: both go to the form.
    const create = screen.getAllByRole("link", { name: "Create discount" });
    expect(create.length).toBeGreaterThan(0);
    for (const link of create) expect(link).toHaveAttribute("href", "/discounts/new");
    unmount();

    render(<DiscountsPage products={PRODUCTS} summary={empty} canWrite={false} />);
    expect(screen.getByText("Owners and editors can create discounts here.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create discount" })).toBeNull();
  });

  it("shows what each discount is, where it stands and what it sold", () => {
    render(<DiscountsPage products={PRODUCTS} summary={summary()} canWrite />);

    expect(row(code.id)).toHaveAttribute("data-discount-status", "active");
    expect(within(row(code.id)).getByText("SUMMER10")).toBeInTheDocument();
    // Each fact is its own glyph-led line, not one dotted sentence.
    for (const fact of ["10% off the order", "All products", "Shared on Instagram", "3 orders", "€64.80"]) {
      expect(within(row(code.id)).getByText(fact)).toBeInTheDocument();
    }
    expect(within(row(code.id)).getByText("Discount code")).toBeInTheDocument();

    expect(row(running.id)).toHaveTextContent("20% off each item");
    expect(row(running.id)).toHaveTextContent("Sale");
    expect(row(running.id)).toHaveTextContent(/Ends /);
    expect(row(over.id)).toHaveAttribute("data-discount-status", "ended");
    expect(row(over.id)).toHaveTextContent("No orders yet");

    // Totals across every discount, and the channels that brought them.
    const performance = document.querySelector<HTMLElement>("[data-discount-performance]")!;
    expect(within(performance).getByText("Orders with a discount")).toBeInTheDocument();
    expect(performance).toHaveTextContent("€84.00");
    expect(performance).toHaveTextContent("€12.00");
    expect(within(performance).getByRole("heading", { name: "Orders by channel" })).toBeInTheDocument();
  });

  it("keeps an ended sale as history: no edit, but it can be deleted", () => {
    render(<DiscountsPage products={PRODUCTS} summary={summary()} canWrite />);
    expect(within(row(over.id)).queryByRole("link", { name: "Edit" })).toBeNull();
    expect(within(row(over.id)).queryByRole("button", { name: "End now" })).toBeNull();
    expect(within(row(over.id)).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    // A running sale can be ended; a code is switched off instead.
    expect(within(row(running.id)).getByRole("button", { name: "End now" })).toBeInTheDocument();
    expect(within(row(code.id)).queryByRole("button", { name: "End now" })).toBeNull();
    expect(within(row(code.id)).getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/discounts/${code.id}/edit`);
  });

  it("switches a code off in one click", async () => {
    const user = userEvent.setup();
    render(<DiscountsPage products={PRODUCTS} summary={summary()} canWrite />);
    await user.click(within(row(code.id)).getByRole("switch", { name: "On" }));
    expect(actions.setCodeEnabled).toHaveBeenCalledWith(code.id, false);
    expect(await screen.findByText("Code switched off.")).toBeInTheDocument();
  });

  it("asks before ending a sale", async () => {
    const user = userEvent.setup();
    render(<DiscountsPage products={PRODUCTS} summary={summary()} canWrite />);
    await user.click(within(row(running.id)).getByRole("button", { name: "End now" }));
    const dialog = screen.getByRole("dialog", { name: "End this sale now?" });
    expect(actions.endSale).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "End sale" }));
    expect(actions.endSale).toHaveBeenCalledWith(running.id);
    expect(await screen.findByText("Sale ended.")).toBeInTheDocument();
  });

  it("asks before deleting, and can be talked out of it", async () => {
    const user = userEvent.setup();
    render(<DiscountsPage products={PRODUCTS} summary={summary()} canWrite />);
    await user.click(within(row(code.id)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this discount?" })).getByRole("button", { name: "Cancel" }));
    expect(actions.deleteDiscount).not.toHaveBeenCalled();

    await user.click(within(row(code.id)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete discount" }));
    expect(actions.deleteDiscount).toHaveBeenCalledWith(code.id);
    expect(await screen.findByText("Discount deleted.")).toBeInTheDocument();
  });

  it("shows a viewer the figures and no controls", () => {
    render(<DiscountsPage products={PRODUCTS} summary={summary()} canWrite={false} />);
    expect(row(code.id)).toHaveTextContent("SUMMER10");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("a sale price on the product page", () => {
  const proven: ProductSale = {
    regularPriceCents: 2400,
    priorPriceCents: 2400,
    percentOff: 20,
    offerPercent: 20,
    endsAt: "2026-10-31T12:00:00.000Z",
  };

  function price(sale: ProductSale | null, size: "lg" | "sm" = "lg") {
    return render(
      <ProductPrice
        priceCents={1920}
        currency="EUR"
        sale={sale}
        priceNote="none"
        shippingNote="none"
        isDigital={false}
        ink="#171717"
        size={size}
      />,
    );
  }

  it("strikes through the regular price, says what it is, and when the sale ends", () => {
    price(proven);
    expect(screen.getByText("Was €24.00, now €19.20")).toBeInTheDocument();
    expect(document.querySelector("del")).toHaveTextContent("€24.00");
    // The percent, the end date and what the struck price is: one ticket.
    const ticket = document.querySelector<HTMLElement>("[data-product-sale-ticket]")!;
    expect(ticket.querySelector("[data-product-sale-percent='20']")).toHaveTextContent("-20%");
    expect(within(ticket).getByText("Crossed-out price: the lowest price in the 30 days before this sale.")).toBeInTheDocument();
    expect(within(ticket).getByText("Sale ends 31 October 2026")).toBeInTheDocument();
    // Said once: the price line no longer carries a second percent.
    expect(document.querySelectorAll("[data-product-sale-percent]")).toHaveLength(1);
  });

  it("draws the ticket for a proven sale with no end date, without a date", () => {
    price({ ...proven, endsAt: null });
    const ticket = document.querySelector<HTMLElement>("[data-product-sale-ticket]")!;
    expect(ticket.querySelector("[data-product-sale-percent='20']")).toHaveTextContent("-20%");
    expect(within(ticket).getByText(/Crossed-out price/)).toBeInTheDocument();
    expect(screen.queryByText(/Sale ends/)).toBeNull();
  });

  it("still strikes the regular price through when nothing more can be proved, and claims no percentage", () => {
    price({ ...proven, priorPriceCents: null, percentOff: null });
    expect(document.querySelector("[data-product-price='1920']")).toHaveTextContent("€19.20");
    // A buyer sees what the sale takes it down from.
    expect(document.querySelector("del")).toHaveTextContent("€24.00");
    // What is NOT claimed: a percentage, or that the struck price was the
    // lowest of the last 30 days. The ticket calls it what it is.
    expect(document.querySelector("[data-product-sale-percent]")).toBeNull();
    const ticket = document.querySelector<HTMLElement>("[data-product-sale-ticket]")!;
    expect(within(ticket).getByText("Crossed-out price: the regular price.")).toBeInTheDocument();
    expect(screen.queryByText(/lowest price/)).toBeNull();
    expect(within(ticket).getByText("Sale ends 31 October 2026")).toBeInTheDocument();
  });

  it("keeps the sticky bar to one line", () => {
    price(proven, "sm");
    expect(document.querySelector("del")).toHaveTextContent("€24.00");
    // The one line keeps its percent as a chip, and has no room for a ticket.
    expect(document.querySelector("[data-product-sale-percent='20']")).toHaveTextContent("-20%");
    expect(document.querySelector("[data-product-sale-ticket]")).toBeNull();
    expect(screen.queryByText(/Crossed-out price/)).toBeNull();
    expect(screen.queryByText(/Sale ends/)).toBeNull();
  });
});

describe("what the server may say about a date", () => {
  // The server renders in ITS time zone (UTC once deployed), the seller reads
  // in theirs. Anything that would print a local date or time is therefore
  // held back until the browser has spoken (useNow), never rendered in the
  // server's zone and left there. renderToString is the server's render.
  const onServer = (ui: React.ReactElement) =>
    renderToString(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>,
    );

  it("draws the form's placeholder, with no time zone and no dates in it", () => {
    const html = onServer(
      <DiscountForm discount={discount({ endsAt: "2026-10-20T17:13:45+00:00" })} products={PRODUCTS} />,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("data-discount-form");
    expect(html).not.toContain("time zone");
    expect(html).not.toMatch(/2026|Oct/);
  });

  it("holds a row's dates back, and says everything else", () => {
    const [item] = summarizeDiscounts(
      [discount({ endsAt: "2026-10-20T17:13:45+00:00" })],
      new Map(),
      new Map(),
      NOW,
    ).items;
    const html = onServer(
      <ul>
        <DiscountRow item={item} products={[]} canWrite busy={false} onToggle={() => {}} onEnd={() => {}} onDelete={() => {}} />
      </ul>,
    );
    expect(html).toContain("SUMMER10");
    expect(html).toContain("10% off the order");
    expect(html).toContain("data-discount-schedule");
    expect(html).not.toMatch(/Ends |20 Oct/);
  });

  it("says them in the browser, once it knows the reader's clock", () => {
    const [item] = summarizeDiscounts(
      [discount({ endsAt: "2026-10-20T17:13:45+00:00" })],
      new Map(),
      new Map(),
      NOW,
    ).items;
    render(
      <ul>
        <DiscountRow item={item} products={[]} canWrite busy={false} onToggle={() => {}} onEnd={() => {}} onDelete={() => {}} />
      </ul>,
    );
    expect(document.querySelector("[data-discount-schedule]")).toHaveTextContent(/^Ends \d+ Oct 2026, \d{2}:\d{2}$/);
  });
});

describe("a discount's row", () => {
  const limited = discount({ endsAt: "2026-10-20T17:13:45+00:00", usageLimit: 50 });
  const running = sale({ id: "aaaaaaaa-0000-4000-8000-000000000002", endsAt: "2026-10-31T12:00:00.000Z" });
  const over = sale({
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    startsAt: "2026-09-01T09:00:00.000Z",
    endsAt: "2026-09-08T09:00:00.000Z",
  });
  const itemOf = (view: DiscountView) =>
    summarizeDiscounts([view], new Map([[limited.id, sold(limited.id, 3, 6480, 720)]]), new Map(), NOW).items[0];

  function mount(
    view: DiscountView,
    { canWrite = true, products = PRODUCTS }: { canWrite?: boolean; products?: DiscountProductChoice[] } = {},
  ) {
    const controls = { onToggle: vi.fn(), onEnd: vi.fn(), onDelete: vi.fn() };
    render(
      <ul>
        <DiscountRow
          item={itemOf(view)}
          products={coveredProducts(view, products)}
          canWrite={canWrite}
          busy={false}
          {...controls}
        />
      </ul>,
    );
    return { row: document.querySelector<HTMLElement>(`[data-discount-row='${view.id}']`)!, ...controls };
  }

  it("says what a code is, when it ends and what it sold, with its controls", async () => {
    const user = userEvent.setup();
    const { row, onToggle, onDelete } = mount(limited);

    expect(row).toHaveAttribute("data-discount-kind", "code");
    expect(row).toHaveAttribute("data-discount-status", "active");
    expect(row.querySelector("[data-discount-code]")).toHaveTextContent("SUMMER10");
    expect(row.querySelector("[data-discount-schedule]")).toHaveTextContent(/^Ends \d+ Oct 2026, \d{2}:\d{2}$/);
    expect(row.querySelector("[data-discount-orders]")).toHaveAttribute("data-discount-orders", "3");
    for (const fact of [
      "Active",
      "Discount code",
      "10% off the order",
      "All products",
      "Shared on Instagram",
      "3 orders",
      "€64.80",
      "3 of 50 uses",
    ]) {
      expect(within(row).getByText(fact)).toBeInTheDocument();
    }
    // 3 of 50, drawn.
    expect(row.querySelector("[data-meter='6']")).not.toBeNull();

    await user.click(within(row).getByRole("switch", { name: "On" }));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(within(row).getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/discounts/${limited.id}/edit`);
    expect(within(row).queryByRole("button", { name: "End now" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("lets a running sale be ended, and an ended one only deleted", async () => {
    const user = userEvent.setup();
    const { row, onEnd } = mount(running);

    expect(row).toHaveAttribute("data-discount-kind", "automatic");
    expect(within(row).getByText("20% off each item")).toBeInTheDocument();
    expect(within(row).getByText("Sale")).toBeInTheDocument();
    expect(within(row).getByText("No orders yet")).toBeInTheDocument();
    expect(within(row).queryByRole("switch")).toBeNull();
    await user.click(within(row).getByRole("button", { name: "End now" }));
    expect(onEnd).toHaveBeenCalledOnce();
    cleanup();

    const ended = mount(over).row;
    expect(ended).toHaveAttribute("data-discount-status", "ended");
    expect(within(ended).getByText("Ended")).toBeInTheDocument();
    expect(ended.querySelector("[data-discount-schedule]")).toHaveTextContent(/^Ended \d+ Sept? 2026, \d{2}:\d{2}$/);
    expect(within(ended).queryByRole("link", { name: "Edit" })).toBeNull();
    expect(within(ended).queryByRole("button", { name: "End now" })).toBeNull();
    expect(within(ended).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("gives a viewer the facts and no controls", () => {
    const { row } = mount(limited, { canWrite: false });
    expect(row.querySelector("[data-discount-code]")).toHaveTextContent("SUMMER10");
    expect(within(row).queryByRole("switch")).toBeNull();
    expect(within(row).queryByRole("link", { name: "Edit" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
    // Looking at what a discount covers is not a write.
    expect(within(row).getByRole("button", { name: "All products" })).toBeInTheDocument();
  });

  it("opens to list the products it covers, with what each costs under it", async () => {
    const user = userEvent.setup();
    const { row } = mount(running);
    const toggle = within(row).getByRole("button", { name: "All products" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(row.querySelector("[data-discount-products]")).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = row.querySelector<HTMLElement>("[data-discount-products]")!;
    expect(list).toHaveAttribute("id", toggle.getAttribute("aria-controls"));
    expect(list).toHaveAttribute("data-discount-products", "2");
    // 20% off each: €24.00 becomes €19.20, €38.00 becomes €30.40.
    const [mug, apron] = within(list).getAllByRole("listitem");
    expect(mug).toHaveTextContent("Blue mug");
    expect(within(mug).getByText("Was €24.00, now €19.20")).toBeInTheDocument();
    expect(mug.querySelector("del")).toHaveTextContent("€24.00");
    expect(apron).toHaveTextContent("Linen apron");
    expect(within(apron).getByText("Was €38.00, now €30.40")).toBeInTheDocument();

    await user.click(toggle);
    expect(row.querySelector("[data-discount-products]")).toBeNull();
  });

  it("shows each product's photo beside its name, and a placeholder where it has none", async () => {
    const user = userEvent.setup();
    const withPhoto: DiscountProductChoice[] = [
      { id: MUG, title: "Blue mug", priceCents: 2400, currency: "EUR", imageUrl: "/photos/mug.webp" },
      { id: APRON, title: "Linen apron", priceCents: 3800, currency: "EUR", imageUrl: null },
    ];
    const { row } = mount(running, { products: withPhoto });
    await user.click(within(row).getByRole("button", { name: "All products" }));
    const [mug, apron] = within(row.querySelector<HTMLElement>("[data-discount-products]")!).getAllByRole("listitem");
    expect(mug.querySelector("img")).toHaveAttribute("src", "/photos/mug.webp");
    // Decorative: the name beside it is what is read out.
    expect(mug.querySelector("img")).toHaveAttribute("alt", "");
    expect(apron.querySelector("img")).toBeNull();
    expect(apron).toHaveTextContent("Linen apron");
  });

  it("lists only the products a discount names, and none it cannot find", async () => {
    const user = userEvent.setup();
    const gone = "33333333-3333-4333-8333-333333333333";
    const { row } = mount(discount({ appliesTo: "products", productIds: [APRON, gone] }));
    // The count is what the discount names; the list is what is still there.
    await user.click(within(row).getByRole("button", { name: "2 products" }));
    const list = row.querySelector<HTMLElement>("[data-discount-products]")!;
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list).toHaveTextContent("Linen apron");
    expect(within(list).getByText("Was €38.00, now €34.20")).toBeInTheDocument();
  });

  it("says a price the discount does not lower plainly, and has nothing to open without products", async () => {
    const user = userEvent.setup();
    const dollars: DiscountProductChoice = { id: MUG, title: "Blue mug", priceCents: 2400, currency: "USD" };
    const euroOff = discount({ value: { type: "amount", amountOffCents: 500, currency: "EUR" } });
    const { row } = mount(euroOff, { products: [dollars] });
    await user.click(within(row).getByRole("button", { name: "All products" }));
    const [item] = within(row.querySelector<HTMLElement>("[data-discount-products]")!).getAllByRole("listitem");
    expect(item).toHaveTextContent("$24.00");
    expect(item.querySelector("del")).toBeNull();
    cleanup();

    const empty = mount(euroOff, { products: [] }).row;
    expect(within(empty).getByText("All products")).toBeInTheDocument();
    expect(within(empty).queryByRole("button", { name: "All products" })).toBeNull();
  });
});
