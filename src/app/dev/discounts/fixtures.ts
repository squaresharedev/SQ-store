import type { DiscountPerformance, DiscountProductChoice, DiscountView } from "@/types/discount";

// One discount in every state the list can show, over a small catalogue, dated
// from `now` so the gallery reads the same whenever it is opened: something
// halfway through its run today is still halfway through it next month.

const DAY_MS = 24 * 60 * 60 * 1000;

const productId = (n: number) => `90d0c700-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Photos the app already serves, standing in for uploaded covers. */
const PHOTO = (name: string) => `/sample-storefront/${name}.webp`;

/** The store's catalogue. One product is priced in dollars, which an amount
 *  off in euro does not lower, one is too cheap for it to lower at all, and
 *  two have no photo, which is drawn as the quiet placeholder tile. */
export const CATALOGUE: DiscountProductChoice[] = [
  { id: productId(1), title: "Blue mug", priceCents: 2400, currency: "EUR", imageUrl: PHOTO("camera") },
  { id: productId(2), title: "Glaze recipes zine", priceCents: 1200, currency: "EUR", imageUrl: null },
  { id: productId(3), title: "Linen apron", priceCents: 3800, currency: "EUR", imageUrl: PHOTO("succulent") },
  {
    id: productId(4),
    title: "Roundhouse coffee table, walnut, six seater",
    priceCents: 48000,
    currency: "EUR",
    imageUrl: PHOTO("camera"),
  },
  { id: productId(5), title: "Speckled dinner plate", priceCents: 2800, currency: "EUR", imageUrl: PHOTO("succulent") },
  { id: productId(6), title: "Sticker", priceCents: 50, currency: "EUR", imageUrl: null },
  { id: productId(7), title: "Stoneware vase", priceCents: 2400, currency: "EUR", imageUrl: PHOTO("succulent") },
  { id: productId(8), title: "Workshop ticket (US)", priceCents: 9500, currency: "USD", imageUrl: PHOTO("camera") },
];

export type DiscountFixtures = {
  discounts: DiscountView[];
  performance: DiscountPerformance[];
  products: DiscountProductChoice[];
};

export function buildDiscountFixtures(now: Date): DiscountFixtures {
  const at = (days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();
  const id = (n: number) => `d15c0000-0000-4000-8000-00000000000${n}`;

  const base: Omit<DiscountView, "id" | "kind" | "value"> = {
    code: null,
    shareChannel: null,
    appliesTo: "all",
    productIds: [],
    startsAt: at(-3),
    endsAt: null,
    usageLimit: null,
    enabled: true,
    createdAt: at(-3),
  };

  const discounts: DiscountView[] = [
    // A running sale, three days into a week.
    { ...base, id: id(1), kind: "automatic", value: { type: "percent", percentOff: 10 }, endsAt: at(4) },
    // A running code with a channel, an end and a limit a third used.
    {
      ...base,
      id: id(2),
      kind: "code",
      code: "SUMMER10",
      shareChannel: "Instagram",
      value: { type: "percent", percentOff: 10 },
      startsAt: at(-10),
      endsAt: at(20),
      usageLimit: 50,
    },
    // A running code on a few products, with no end and no limit.
    {
      ...base,
      id: id(3),
      kind: "code",
      code: "VIP40",
      shareChannel: "Newsletter",
      value: { type: "percent", percentOff: 40 },
      appliesTo: "products",
      productIds: [productId(1), productId(3), productId(7)],
      startsAt: at(-30),
    },
    // An amount off, nothing sold yet, the longest a code can be.
    {
      ...base,
      id: id(4),
      kind: "code",
      code: "WELCOMETOTHESHOP2026X",
      value: { type: "amount", amountOffCents: 500, currency: "EUR" },
      startsAt: at(-1),
    },
    // A sale still to come.
    {
      ...base,
      id: id(5),
      kind: "automatic",
      value: { type: "percent", percentOff: 25 },
      appliesTo: "products",
      productIds: [productId(2), productId(4), productId(5), productId(7)],
      startsAt: at(3),
      endsAt: at(10),
    },
    // A code switched off.
    {
      ...base,
      id: id(6),
      kind: "code",
      code: "FRIENDS15",
      shareChannel: "Creator",
      value: { type: "percent", percentOff: 15 },
      startsAt: at(-20),
      endsAt: at(20),
      enabled: false,
    },
    // A code whose limit is spent.
    {
      ...base,
      id: id(7),
      kind: "code",
      code: "LAUNCH20",
      shareChannel: "Newsletter",
      value: { type: "percent", percentOff: 20 },
      startsAt: at(-45),
      usageLimit: 25,
    },
    // A sale that is over.
    {
      ...base,
      id: id(8),
      kind: "automatic",
      value: { type: "amount", amountOffCents: 1250, currency: "EUR" },
      startsAt: at(-19),
      endsAt: at(-5),
    },
  ];

  const sold = (n: number, orders: number, revenueCents: number, givenCents: number): DiscountPerformance => ({
    discountId: id(n),
    uses: orders,
    orders,
    revenue: [{ currency: "EUR", cents: revenueCents }],
    given: [{ currency: "EUR", cents: givenCents }],
    lastOrderAt: at(-1),
  });

  return {
    discounts,
    performance: [
      sold(1, 12, 48240, 5360),
      sold(2, 18, 120450, 13380),
      sold(3, 2, 9600, 6400),
      sold(6, 4, 21080, 3720),
      sold(7, 25, 189000, 47250),
      sold(8, 31, 244900, 38750),
    ],
    products: CATALOGUE,
  };
}
