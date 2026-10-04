import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, render, screen, within } from "../setup/render";
import { msg } from "@/i18n/types";
import messages from "../../messages/en";
import { invalidInput } from "@/lib/errors";
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

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { DiscountForm } = await import("@/components/discounts/DiscountForm");
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
  it("starts as a code, says it back with an example, and sends exactly what the server parses", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    expect(screen.getByRole("radio", { name: /^Discount code/ })).toBeChecked();

    // Typed in any case, kept in capitals: buyers can type it either way.
    await user.type(screen.getByLabelText("Code"), "summer10");
    expect(screen.getByLabelText("Code")).toHaveValue("SUMMER10");
    await user.click(screen.getByRole("button", { name: "Instagram" }));
    expect(screen.getByLabelText("Channel (optional)")).toHaveValue("Instagram");
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

  it("generates a code from the unambiguous alphabet", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it("sends a usage limit and the switch with a code", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    await user.type(screen.getByLabelText("Code"), "VIP25");
    await user.click(screen.getByRole("switch", { name: "Limit how many orders can use it" }));
    const limit = screen.getByLabelText("Number of orders");
    expect(limit).toHaveValue(100);
    await user.clear(limit);
    await user.type(limit, "40");
    await user.click(screen.getByRole("switch", { name: "Code is switched on" }));

    await user.click(screen.getByRole("button", { name: "Create discount" }));
    expect(actions.createDiscount).toHaveBeenCalledWith(
      expect.objectContaining({ code: "VIP25", shareChannel: "", usageLimit: 40, enabled: false }),
    );
  });

  it("makes a sale: no code, channel or limit, an amount off each chosen product", async () => {
    const user = userEvent.setup();
    render(<DiscountForm discount={null} products={PRODUCTS} />);
    await user.click(screen.getByRole("radio", { name: /^Automatic sale/ }));
    expect(screen.queryByLabelText("Code")).toBeNull();
    expect(screen.queryByText("Limits")).toBeNull();
    expect(screen.getByText("Taken off the price of each item.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fixed amount" }));
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
    await user.type(screen.getByLabelText("Code"), "SUMMER10");
    await user.click(screen.getByRole("button", { name: "Create discount" }));
    expect(await screen.findByText("That code is already in use in this store.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("offers only the end of a sale that has started, and keeps its start", async () => {
    const user = userEvent.setup();
    const running = sale();
    render(<DiscountForm discount={running} products={PRODUCTS} />);

    // The kind is told, not offered; the terms are shown, not editable.
    expect(document.querySelector("[data-discount-kind-fixed='automatic']")).toHaveTextContent("Automatic sale");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByLabelText("Percentage off")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fixed amount" })).toBeDisabled();
    // Its start is told as a fact, in the schedule and in the summary.
    expect(screen.getAllByText(/^Started /)).toHaveLength(2);
    expect(summaryBox()).not.toHaveTextContent("Starts");
    expect(screen.getByText(/only its end can change/)).toBeInTheDocument();

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
    await user.type(screen.getByLabelText("Code"), "LATER10");
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
    expect(screen.getByText("A discount can't change kind. To switch, create a new one.")).toBeInTheDocument();
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
    const { unmount } = render(<DiscountsPage summary={empty} canWrite />);
    expect(screen.getByRole("heading", { name: "No discounts yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create discount" })).toHaveAttribute("href", "/discounts/new");
    unmount();

    render(<DiscountsPage summary={empty} canWrite={false} />);
    expect(screen.getByText("Owners and editors can create discounts here.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create discount" })).toBeNull();
  });

  it("shows what each discount is, where it stands and what it sold", () => {
    render(<DiscountsPage summary={summary()} canWrite />);

    expect(row(code.id)).toHaveAttribute("data-discount-status", "active");
    expect(within(row(code.id)).getByText("SUMMER10")).toBeInTheDocument();
    expect(row(code.id)).toHaveTextContent("10% off the order · All products · Shared on Instagram");
    expect(row(code.id)).toHaveTextContent("3 orders · €64.80");

    expect(row(running.id)).toHaveTextContent("20% off each item");
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
    render(<DiscountsPage summary={summary()} canWrite />);
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
    render(<DiscountsPage summary={summary()} canWrite />);
    await user.click(within(row(code.id)).getByRole("switch", { name: "On" }));
    expect(actions.setCodeEnabled).toHaveBeenCalledWith(code.id, false);
    expect(await screen.findByText("Code switched off.")).toBeInTheDocument();
  });

  it("asks before ending a sale", async () => {
    const user = userEvent.setup();
    render(<DiscountsPage summary={summary()} canWrite />);
    await user.click(within(row(running.id)).getByRole("button", { name: "End now" }));
    const dialog = screen.getByRole("dialog", { name: "End this sale now?" });
    expect(actions.endSale).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "End sale" }));
    expect(actions.endSale).toHaveBeenCalledWith(running.id);
    expect(await screen.findByText("Sale ended.")).toBeInTheDocument();
  });

  it("asks before deleting, and can be talked out of it", async () => {
    const user = userEvent.setup();
    render(<DiscountsPage summary={summary()} canWrite />);
    await user.click(within(row(code.id)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this discount?" })).getByRole("button", { name: "Cancel" }));
    expect(actions.deleteDiscount).not.toHaveBeenCalled();

    await user.click(within(row(code.id)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete discount" }));
    expect(actions.deleteDiscount).toHaveBeenCalledWith(code.id);
    expect(await screen.findByText("Discount deleted.")).toBeInTheDocument();
  });

  it("shows a viewer the figures and no controls", () => {
    render(<DiscountsPage summary={summary()} canWrite={false} />);
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
        size={size}
      />,
    );
  }

  it("strikes through the proven 30-day price, says what it is, and when the sale ends", () => {
    price(proven);
    expect(screen.getByText("Was €24.00, now €19.20")).toBeInTheDocument();
    expect(document.querySelector("del")).toHaveTextContent("€24.00");
    expect(document.querySelector("[data-product-sale-percent='20']")).toHaveTextContent("-20%");
    expect(screen.getByText("Crossed-out price: the lowest price in the 30 days before this sale.")).toBeInTheDocument();
    expect(screen.getByText("Sale ends 31 October 2026")).toBeInTheDocument();
  });

  it("claims no reduction it cannot prove: the sale price alone, still with its end", () => {
    price({ ...proven, priorPriceCents: null, percentOff: null });
    expect(document.querySelector("[data-product-price='1920']")).toHaveTextContent("€19.20");
    expect(document.querySelector("del")).toBeNull();
    expect(document.querySelector("[data-product-sale-percent]")).toBeNull();
    expect(screen.queryByText(/Crossed-out price/)).toBeNull();
    expect(screen.getByText("Sale ends 31 October 2026")).toBeInTheDocument();
  });

  it("keeps the sticky bar to one line", () => {
    price(proven, "sm");
    expect(document.querySelector("del")).toHaveTextContent("€24.00");
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
        <DiscountRow item={item} canWrite busy={false} onToggle={() => {}} onEnd={() => {}} onDelete={() => {}} />
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
        <DiscountRow item={item} canWrite busy={false} onToggle={() => {}} onEnd={() => {}} onDelete={() => {}} />
      </ul>,
    );
    expect(document.querySelector("[data-discount-schedule]")).toHaveTextContent(/^Ends \d+ Oct 2026, \d{2}:\d{2}$/);
  });
});
