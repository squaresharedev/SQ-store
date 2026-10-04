// The buy button's attribution: `?via=` from the seller's link, through the
// product page and checkout, to the order's channel. Attribution only, so every
// hop allowlists it and nothing that prices an order can see it.
import { describe, expect, it } from "vitest";
import { resolveCtaTarget } from "@/components/product-page/cta-target";
import type { QuoteRequest } from "@/lib/checkout/quote";
import { buyButtonPrompt, buyButtonSnippet } from "@/lib/storefront/embed-snippet";
import {
  LINK_CHANNELS,
  VIA_QUERY_PARAM,
  checkoutPath,
  productPagePath,
  productPageUrl,
  requestedVia,
} from "@/lib/storefront/product-page-url";
import { placeOrderSchema } from "@/lib/validation/checkout";
import { ORDER_CHANNELS } from "@/types/order-view";

const SF = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";

describe("requestedVia", () => {
  it("reads the two link channels", () => {
    expect(requestedVia({ [VIA_QUERY_PARAM]: "button" })).toBe("button");
    expect(requestedVia({ [VIA_QUERY_PARAM]: "embed" })).toBe("embed");
  });

  it("ignores anything else, so a forged value is no marker at all", () => {
    for (const value of ["marketplace", "direct", "Button", "button ", "<b>", ""]) {
      expect(requestedVia({ [VIA_QUERY_PARAM]: value })).toBeNull();
    }
    expect(requestedVia({})).toBeNull();
  });

  it("takes the first of a repeated parameter, as every other one does", () => {
    expect(requestedVia({ [VIA_QUERY_PARAM]: ["button", "embed"] })).toBe("button");
    expect(requestedVia({ [VIA_QUERY_PARAM]: ["junk", "button"] })).toBeNull();
  });

  it("names only real channels, never marketplace or direct", () => {
    for (const channel of LINK_CHANNELS) expect(ORDER_CHANNELS).toContain(channel);
    expect(LINK_CHANNELS).not.toContain("marketplace");
    expect(LINK_CHANNELS).not.toContain("direct");
  });
});

describe("the links that carry it", () => {
  it("adds the marker to the product page only when asked", () => {
    expect(productPagePath(SF, PRODUCT)).toBe(`/s/${SF}/p/${PRODUCT}`);
    expect(productPagePath(SF, PRODUCT, { via: null })).toBe(`/s/${SF}/p/${PRODUCT}`);
    expect(productPagePath(SF, PRODUCT, { via: "button" })).toBe(`/s/${SF}/p/${PRODUCT}?via=button`);
    expect(productPageUrl(SF, PRODUCT, { via: "button" })).toMatch(
      new RegExp(`^https?://[^/]+/s/${SF}/p/${PRODUCT}\\?via=button$`),
    );
  });

  it("hands it on to the checkout beside the version and quantity", () => {
    expect(checkoutPath("s", "p", { quantity: 2, via: "button" })).toBe("/s/s/p/p/checkout?q=2&via=button");
    expect(checkoutPath("s", "p", { via: "embed" })).toBe("/s/s/p/p/checkout?via=embed");
    expect(checkoutPath("s", "p", { via: null })).toBe("/s/s/p/p/checkout");
  });

  it("rides on the checkout target, and never on the seller's own purchase link", () => {
    const checkout = { storefrontId: "s", productId: "p", via: "button" as const };
    expect(resolveCtaTarget(null, "a@b.co", "Vase", "Q", checkout)).toEqual({ kind: "checkout", ...checkout });
    const link = resolveCtaTarget("https://shop.example.com/x?sig=1", "a@b.co", "Vase", "Q", checkout);
    expect(link).toEqual({ kind: "link", href: "https://shop.example.com/x?sig=1", host: "shop.example.com" });
  });
});

describe("the order body", () => {
  const body = {
    attemptId: "33333333-3333-4333-8333-333333333333",
    optionIds: [],
    quantity: 1,
    email: "buyer@example.com",
    locale: "en",
  };

  it("accepts the link channels, and no channel at all", () => {
    expect(placeOrderSchema.safeParse(body).success).toBe(true);
    for (const channel of LINK_CHANNELS) {
      expect(placeOrderSchema.safeParse({ ...body, channel }).success).toBe(true);
    }
  });

  it("refuses any other channel rather than filing the order under it", () => {
    for (const channel of ["marketplace", "direct", "BUTTON", 1, null]) {
      expect(placeOrderSchema.safeParse({ ...body, channel }).success).toBe(false);
    }
  });

  it("cannot reach the quote, the only thing that prices an order", () => {
    // A compile-time pin: if a quote request ever took a channel, this stops
    // compiling and the build fails before any test runs.
    const quoteHasNoChannel: "channel" extends keyof QuoteRequest ? false : true = true;
    expect(quoteHasNoChannel).toBe(true);
  });
});

describe("buyButtonSnippet", () => {
  it("is one plain link, nothing that runs", () => {
    const snippet = buyButtonSnippet(`https://app.example/s/${SF}/p/${PRODUCT}?via=button`, "Buy now");
    expect(snippet).toBe(`<a href="https://app.example/s/${SF}/p/${PRODUCT}?via=button">Buy now</a>`);
    expect(snippet).not.toMatch(/<script|on\w+=/i);
  });

  it("escapes both parts, so neither can break out of the tag", () => {
    expect(buyButtonSnippet(`https://x.example/?a="1"&b=<2>`, `Buy <now> & "save" 'it'`)).toBe(
      `<a href="https://x.example/?a=&quot;1&quot;&amp;b=&lt;2&gt;">Buy &lt;now&gt; &amp; &quot;save&quot; &#39;it&#39;</a>`,
    );
  });
});

describe("buyButtonPrompt", () => {
  it("is the task, the URL on its own line, the snippet, then the rules as a list", () => {
    const url = `https://app.example/s/${SF}/p/${PRODUCT}?via=button`;
    const snippet = buyButtonSnippet(url, "Buy now");
    expect(buyButtonPrompt(url, snippet, { task: "Do this:", html: "As HTML:", rules: ["One.", "Two."] })).toBe(
      ["Do this:", url, "", "As HTML:", snippet, "", "- One.", "- Two."].join("\n"),
    );
  });

  it("takes no free text of its own: only the sentences it is handed and the two values", () => {
    // The signature is the guard. A product title has no way in, which is what
    // keeps text a team member can edit out of a prompt run on the owner's site.
    expect(buyButtonPrompt.length).toBe(3);
    expect(buyButtonPrompt("U", "S", { task: "T", html: "H", rules: [] })).toBe("T\nU\n\nH\nS\n");
  });
});
