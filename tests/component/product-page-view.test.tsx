import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { ProductPageData } from "@/types/product-page";
import type { ProductPageProduct } from "@/types/product";

afterEach(cleanup);

const COLOUR_GROUP = "11111111-1111-4111-8111-111111111111";
const RED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BLUE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const POWER_GROUP = "22222222-2222-4222-8222-222222222222";
const W500 = "33333333-3333-4333-8333-333333333333";
const W750 = "44444444-4444-4444-8444-444444444444";

/** A second axis whose values are words, not colours — the case the old
 *  colour-only model could not express at all. */
const POWER_GROUP_DEF = {
  id: POWER_GROUP,
  name: "Power output",
  display: "chip" as const,
  options: [
    { id: W500, name: "500 W", available: true },
    { id: W750, name: "750 W", available: true },
  ],
};

function product(overrides: Partial<ProductPageProduct> = {}): ProductPageProduct {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    title: "Oak lamp",
    description: "Warm light for long evenings.\n\nHand finished in Lisbon.",
    priceCents: 12900,
    currency: "EUR",
    purchaseUrl: "https://shop.example.com/lamp",
    shippingProfileId: null,
    images: [
      { url: "https://cdn.test/cover.jpg", alt: "Oak lamp" },
      { url: "https://cdn.test/blue.jpg", alt: "Blue lamp", optionId: BLUE },
    ],
    optionGroups: [
      {
        id: COLOUR_GROUP,
        name: "Colour",
        display: "swatch",
        options: [
          { id: RED, name: "Red", swatch: "#cc0000", available: true },
          { id: BLUE, name: "Blue", swatch: "#0000cc", available: true },
          { id: GONE, name: "Green", available: false },
        ],
      },
    ],
    details: { materials: "Oak", dimensions: { length: 40, width: 20, height: 30, unit: "cm" } },
    documents: [],
    isDigital: false,
    digitalFormat: null,
    stock: { state: "low_stock", remaining: 2 },
    soldOut: false,
    ...overrides,
  };
}

function data(overrides: {
  product?: Partial<ProductPageProduct>;
  productPage?: Partial<ProductPageData["storefront"]["productPage"]>;
  theme?: Partial<ProductPageData["storefront"]["theme"]>;
  seller?: ProductPageData["storefront"]["seller"];
  policies?: ProductPageData["storefront"]["policies"];
  shippingProfiles?: ProductPageData["storefront"]["shippingProfiles"];
} = {}): ProductPageData {
  return {
    storefront: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Studio",
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, ...overrides.theme },
      productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, ...overrides.productPage },
      policies: overrides.policies ?? { shipping: "Ships in 3 days. Tracked.", returns: "30 days." },
      shippingProfiles: overrides.shippingProfiles ?? [],
      seller: overrides.seller ?? { businessName: "Studio Ltd", email: "hi@studio.example", country: "IE" },
      backgroundImageUrl: null,
      customFontUrl: null,
    },
    product: product(overrides.product),
    productUrl: "https://dashboard.squareshare.eu/s/x/p/y",
  };
}

const hero = () => screen.getAllByRole("img", { name: /lamp/i })[0]!;

describe("ProductPageView", () => {
  it("shows the essentials: title, price with its notes, seller, availability and trust lines", () => {
    render(<ProductPageView page={data()} mode="public" />);
    expect(screen.getByRole("heading", { level: 1, name: "Oak lamp" })).toBeInTheDocument();
    // Twice: once in the page, once in the phone-width sticky bar.
    expect(screen.getAllByText("€129.00")).toHaveLength(2);
    expect(screen.getAllByText("incl. VAT, plus shipping")).toHaveLength(2);
    expect(screen.getByText("Sold by Studio Ltd")).toBeInTheDocument();
    expect(screen.getByText("Only 2 left")).toBeInTheDocument();
    const trust = document.querySelector("[data-product-trust]")!;
    expect(within(trust as HTMLElement).getByText("Ships in 3 days.")).toBeInTheDocument();
  });

  it("renders the sections in the seller's order, skipping hidden and empty ones", () => {
    const sections = [
      { id: "specs" as const, show: true },
      { id: "description" as const, show: true },
      { id: "documents" as const, show: true }, // no documents: empty, so absent
      { id: "shipping" as const, show: false },
      { id: "returns" as const, show: true },
      { id: "safety" as const, show: true }, // no safety block: empty, so absent
      { id: "seller" as const, show: true },
    ];
    render(<ProductPageView page={data({ productPage: { sections } })} mode="public" />);
    const list = document.querySelector("[data-product-sections]")!;
    // Neither "description" nor "seller": the description reads under the
    // title, and the seller stands open at the foot of the page. Both keep
    // their switch here, and neither is ever an accordion row.
    expect(list.getAttribute("data-product-sections")).toBe("specs returns");
    // Statutory lines: an EU seller gets them whatever the returns text says.
    expect(document.querySelector("[data-product-statutory]")).not.toBeNull();
    expect(screen.getByText("40 × 20 × 30 cm")).toBeInTheDocument();
  });

  it("prints the seller open at the foot of the page, never behind a disclosure", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const block = document.querySelector("[data-product-section='seller']")!;
    expect(block).not.toBeNull();
    // The trader identity is the one block a buyer must never have to ask
    // for, so it is not a <details> and has nothing to open.
    expect(block.tagName).toBe("SECTION");
    expect(block.closest("details")).toBeNull();
    expect(within(block as HTMLElement).getByText("Studio Ltd")).toBeInTheDocument();
    expect(
      within(block as HTMLElement).getByRole("link", { name: "hi@studio.example" }),
    ).toBeInTheDocument();
    // Last thing in the article, after the reference sections.
    const details = document.querySelector("[data-product-sections]")!;
    expect(details.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe("shipping profiles", () => {
    const BULKY = "11111111-1111-4111-8111-111111111111";
    const profiles = [
      {
        id: BULKY,
        name: "Bulky items",
        dispatch: "Made to order, allow 3 weeks",
        body: "Delivered by pallet courier to a ground-floor address.",
      },
    ];

    it("prints the store's default terms for a product that names no profile", () => {
      render(<ProductPageView page={data({ shippingProfiles: profiles })} mode="public" />);
      const shipping = document.querySelector("[data-product-section='shipping']")!;
      expect(within(shipping as HTMLElement).getByText(/Ships in 3 days/)).toBeInTheDocument();
      expect(within(shipping as HTMLElement).queryByText(/pallet courier/)).toBeNull();
    });

    it("prints the named profile INSTEAD of the default, never on top of it", () => {
      render(
        <ProductPageView
          page={data({ shippingProfiles: profiles, product: { shippingProfileId: BULKY } })}
          mode="public"
        />,
      );
      const shipping = document.querySelector("[data-product-section='shipping']")!;
      expect(within(shipping as HTMLElement).getByText(/pallet courier/)).toBeInTheDocument();
      // A profile REPLACES the default: the store's own terms must not still
      // be standing beside terms that were chosen to supersede them.
      expect(within(shipping as HTMLElement).queryByText(/Ships in 3 days/)).toBeNull();
      // ...and its dispatch line leads the trust list beside the button.
      const trust = document.querySelector("[data-product-trust]")!;
      expect(
        within(trust as HTMLElement).getByText("Made to order, allow 3 weeks"),
      ).toBeInTheDocument();
      expect(within(trust as HTMLElement).queryByText("Ships in 3 days.")).toBeNull();
    });

    it("falls back to the store default when the id names a profile this store lacks", () => {
      // A deleted profile, or a product placed on a second storefront that
      // never had it. Both get the terms the store DOES offer, because that
      // is the only thing it can honestly promise.
      render(
        <ProductPageView
          page={data({ shippingProfiles: [], product: { shippingProfileId: BULKY } })}
          mode="public"
        />,
      );
      const shipping = document.querySelector("[data-product-section='shipping']")!;
      expect(within(shipping as HTMLElement).getByText(/Ships in 3 days/)).toBeInTheDocument();
    });

    it("puts the store's dispatch line at the head of the trust list", () => {
      render(
        <ProductPageView
          page={data({
            policies: { shipping: "Ships in 3 days. Tracked.", dispatch: "Ships within 24 hours" },
          })}
          mode="public"
        />,
      );
      const trust = document.querySelector("[data-product-trust]")!;
      const lines = within(trust as HTMLElement)
        .getAllByRole("listitem")
        .map((item) => item.textContent);
      expect(lines[0]).toBe("Ships within 24 hours");
      expect(lines[1]).toBe("Ships in 3 days.");
    });
  });

  it("hides the seller entirely when its switch is off", () => {
    const sections = DEFAULT_PRODUCT_PAGE_CONFIG.sections.map((entry) =>
      entry.id === "seller" ? { ...entry, show: false } : entry,
    );
    render(<ProductPageView page={data({ productPage: { sections } })} mode="public" />);
    expect(document.querySelector("[data-product-section='seller']")).toBeNull();
  });

  it("reads the description under the title, and only there", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const description = document.querySelector("[data-product-description]")!;
    expect(description).not.toBeNull();
    expect(within(description as HTMLElement).getByText(/Warm light for long evenings/)).toBeInTheDocument();
    // Never in the fold below, so it can never be printed twice, and the group
    // that remains is announced as the reference material it is.
    const list = document.querySelector("[data-product-sections]")!;
    expect(list.getAttribute("data-product-sections")).not.toContain("description");
    expect(document.querySelector("[data-product-section='description']")).toBeNull();
    expect(document.querySelector("[data-product-details-heading]")).not.toBeNull();
  });

  it("wears the storefront's font unless the page names its own", () => {
    // Absent: the page is part of the shop, so it reads in the shop's face.
    render(<ProductPageView page={data({ theme: { font: "display" } })} mode="public" />);
    expect(document.querySelector("[data-product-page]")).toHaveClass("font-display");

    // Named: its own face wins, and it dresses the WHOLE page rather than one
    // block of it, so the title, the price and the sections all move together.
    cleanup();
    render(
      <ProductPageView
        page={data({ theme: { font: "display" }, productPage: { font: "hand" } })}
        mode="public"
      />,
    );
    const root = document.querySelector("[data-product-page]")!;
    expect(root).toHaveClass("font-hand");
    expect(root).not.toHaveClass("font-display");
  });

  it("sits on the storefront background with no card of its own", () => {
    render(<ProductPageView page={data()} mode="public" />);
    // The retired card painted a white fill and a shadow over the storefront
    // background. Nothing does that any more, at any setting.
    const root = document.querySelector("[data-product-page]") as HTMLElement;
    expect(root.getAttribute("data-surface")).toBeNull();
    const article = root.querySelector("article") as HTMLElement;
    expect(article.getAttribute("style")).toBeNull();
    expect(article.className).toBe("");
  });

  it("labels every region with the setting behind it, and opts the options out", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const at = (selector: string) =>
      document.querySelector(selector)?.closest("[data-setting-hotspot]")
        ?.getAttribute("data-setting-hotspot");

    // What the editor resolves when a seller clicks each part of their page.
    expect(at("[data-product-page-header]")).toBe("header");
    expect(at("[data-product-cta]")).toBe("cta");
    expect(at("[data-product-price]")).toBe("cta");
    expect(at("[data-product-description]")).toBe("sections");
    expect(at("[data-product-trust]")).toBe("policies");
    expect(at("[data-product-section='returns']")).toBe("policies");
    expect(at("[data-product-section='seller']")).toBe("seller");
    expect(at("[data-product-section='specs']")).toBe("sections");
    // The backdrop is the outermost one, so a click on bare page finds it.
    expect(document.querySelector("[data-product-page]")).toHaveAttribute(
      "data-setting-hotspot",
      "background",
    );

    // The option picker belongs to the PRODUCT, so it opts out entirely
    // rather than resolving to the backdrop it happens to sit on.
    const picker = document.querySelector("[data-product-options]") ?? screen.getByRole("radiogroup");
    expect(picker.closest("[data-setting-skip]")).not.toBeNull();
  });

  it("keeps the description above the price and below the title", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const title = screen.getByRole("heading", { level: 1, name: "Oak lamp" });
    const description = document.querySelector("[data-product-description]")!;
    const price = screen.getAllByText("€129.00")[0]!;
    // Document order is the reading order a buyer gets.
    expect(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("honours the description's own switch", () => {
    const sections = DEFAULT_PRODUCT_PAGE_CONFIG.sections.map((entry) =>
      entry.id === "description" ? { ...entry, show: false } : entry,
    );
    render(<ProductPageView page={data({ productPage: { sections } })} mode="public" />);
    expect(document.querySelector("[data-product-description]")).toBeNull();
    expect(document.querySelector("[data-product-section='description']")).toBeNull();
  });

  it("collapses a long description behind a toggle so the price stays above it", async () => {
    const user = userEvent.setup();
    const long = `${"Turned on a lathe from a single block of oak. ".repeat(12)}`;
    render(<ProductPageView page={data({ product: { description: long } })} mode="public" />);
    const toggle = screen.getByRole("button", { name: "Read more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Read less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("leaves a short description alone: nothing to expand", () => {
    render(<ProductPageView page={data({ product: { description: "A small lamp." } })} mode="public" />);
    expect(document.querySelector("[data-product-description]")).not.toBeNull();
    expect(document.querySelector("[data-product-description-toggle]")).toBeNull();
  });

  it("swaps the photos when an option is chosen and keeps unavailable ones unpickable", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={data()} mode="public" />);
    const group = screen.getByRole("radiogroup", { name: "Colour" });
    const red = within(group).getByRole("radio", { name: "Red" });
    const blue = within(group).getByRole("radio", { name: "Blue" });
    const green = within(group).getByRole("radio", { name: "Green, unavailable" });

    expect(red).toHaveAttribute("aria-checked", "true");
    expect(hero()).toHaveAttribute("src", "https://cdn.test/cover.jpg");

    await user.click(blue);
    expect(blue).toHaveAttribute("aria-checked", "true");
    expect(hero()).toHaveAttribute("src", "https://cdn.test/blue.jpg");

    expect(green).toHaveAttribute("aria-disabled", "true");
    await user.click(green);
    expect(blue).toHaveAttribute("aria-checked", "true");
  });

  it("picks in every group independently, and photos follow whichever axis has them", async () => {
    const user = userEvent.setup();
    render(
      <ProductPageView
        page={data({
          product: {
            optionGroups: [product().optionGroups[0]!, POWER_GROUP_DEF],
            images: [
              { url: "https://cdn.test/cover.jpg", alt: "Oak lamp" },
              { url: "https://cdn.test/blue.jpg", alt: "Blue lamp", optionId: BLUE },
              { url: "https://cdn.test/750.jpg", alt: "750 W lamp", optionId: W750 },
            ],
          },
        })}
        mode="public"
      />,
    );

    // Two axes, two pickers, each labelled by the SELLER's own name for it.
    const colour = screen.getByRole("radiogroup", { name: "Colour" });
    const power = screen.getByRole("radiogroup", { name: "Power output" });
    expect(within(power).getByRole("radio", { name: "500 W" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // A photo tied to a colour shows for that colour whatever the wattage is.
    await user.click(within(colour).getByRole("radio", { name: "Blue" }));
    expect(hero()).toHaveAttribute("src", "https://cdn.test/blue.jpg");

    // Choosing on the OTHER axis brings its own photo in alongside, without
    // disturbing the colour that is still chosen.
    await user.click(within(power).getByRole("radio", { name: "750 W" }));
    expect(within(colour).getByRole("radio", { name: "Blue" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Thumbnails are decorative (alt=""), so they are read off the DOM rather
    // than by role. Both axes' photos are in the strip at once.
    const shown = [...document.querySelectorAll("[data-product-gallery] img")].map((image) =>
      image.getAttribute("src"),
    );
    expect(shown).toContain("https://cdn.test/blue.jpg");
    expect(shown).toContain("https://cdn.test/750.jpg");
  });

  it("names the axis that is unavailable, so a buyer knows what to change", () => {
    render(
      <ProductPageView
        page={data({
          product: {
            optionGroups: [
              {
                ...POWER_GROUP_DEF,
                options: [{ id: W500, name: "500 W", available: false }],
              },
            ],
          },
        })}
        mode="public"
      />,
    );
    expect(screen.getAllByText("Unavailable in this power output").length).toBeGreaterThan(0);
  });

  it("picks an option even when the options arrive after the first paint", () => {
    // The editor's artboard paints from the catalogue row and loads the page
    // facts a moment later. A selection captured on that first render would
    // leave the page with nothing chosen once the real ones arrived.
    const { rerender } = render(
      <ProductPageView page={data({ product: { optionGroups: [] } })} mode="preview" />,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();

    rerender(<ProductPageView page={data()} mode="preview" />);
    const group = screen.getByRole("radiogroup", { name: "Colour" });
    expect(within(group).getByRole("radio", { name: "Red" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Red")).toBeInTheDocument();
  });

  it("attributes the page to Squareshare without implying it is the seller", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const footer = document.querySelector("[data-product-page-footer]")!;
    // A real, navigable link on the public page...
    const link = within(footer as HTMLElement).getByRole("link", { name: /powered by squareshare/i });
    expect(link).toHaveAttribute("href", "https://squareshare.eu");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // ...and never the only "sold by" on the page — the seller's own name
    // still appears, and nowhere does Squareshare claim to be selling this.
    expect(screen.getByText("Sold by Studio Ltd")).toBeInTheDocument();
    expect(screen.queryByText(/guarantee/i, { selector: "[data-product-page-footer] *" })).toBeNull();
  });

  it("never turns the Squareshare attribution into a live link inside the editor preview", () => {
    render(<ProductPageView page={data()} mode="preview" />);
    const footer = document.querySelector("[data-product-page-footer]")!;
    expect(within(footer as HTMLElement).queryByRole("link")).toBeNull();
    expect(within(footer as HTMLElement).getByText("Squareshare")).toBeInTheDocument();
  });

  it("links the buy button to the purchase link and names the destination", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const links = screen.getAllByRole("link", { name: /buy now/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "https://shop.example.com/lamp");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("nofollow");
    }
    expect(screen.getAllByText("shop.example.com").length).toBeGreaterThan(0);
  });

  it("falls back to emailing the seller, and to nothing at all", () => {
    render(<ProductPageView page={data({ product: { purchaseUrl: null } })} mode="public" />);
    const mail = screen.getAllByRole("link", { name: /ask about this product/i })[0]!;
    expect(mail.getAttribute("href")).toMatch(/^mailto:hi@studio\.example\?subject=/);
    cleanup();

    render(
      <ProductPageView
        page={data({ product: { purchaseUrl: null }, seller: { businessName: "Studio Ltd" } })}
        mode="public"
      />,
    );
    expect(document.querySelector("[data-product-cta]")).toBeNull();
    expect(document.querySelector("[data-product-sticky-cta]")).toBeNull();
  });

  it("lists public documents, and hides the section when there are none", () => {
    render(
      <ProductPageView
        page={data({
          product: {
            documents: [
              { url: "https://cdn.test/cert.pdf", label: "CE Certificate", format: "PDF" },
              { url: "https://cdn.test/manual.pdf", label: "User Manual", format: "PDF" },
            ],
          },
          // Documents first, so it is the one section open by default — a
          // closed <details> hides its content, which is not what this test
          // is checking.
          productPage: { sections: [{ id: "documents", show: true }] },
        })}
        mode="public"
      />,
    );
    expect(document.querySelector("[data-product-section='documents']")).toBeVisible();
    const cert = screen.getByRole("link", { name: /CE Certificate/i });
    expect(cert).toHaveAttribute("href", "https://cdn.test/cert.pdf");
    expect(cert).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /User Manual/i })).toBeInTheDocument();
    expect(screen.getAllByText("PDF")).toHaveLength(2);
    cleanup();

    render(<ProductPageView page={data({ product: { documents: [] } })} mode="public" />);
    expect(document.querySelector("[data-product-section='documents']")).toBeNull();
  });

  it("disables the button when sold out, and never navigates in preview mode", () => {
    render(<ProductPageView page={data({ product: { soldOut: true } })} mode="public" />);
    expect(screen.queryAllByRole("link", { name: /buy now/i })).toHaveLength(0);
    expect(screen.getAllByText("Sold out").length).toBeGreaterThan(0);
    cleanup();

    render(<ProductPageView page={data()} mode="preview" />);
    expect(screen.queryAllByRole("link", { name: /buy now/i })).toHaveLength(0);
    expect(document.querySelector("[data-product-page='preview']")).not.toBeNull();
  });

  it("treats a download as not shipped: no shipping note, no shipping section, a format line", () => {
    render(
      <ProductPageView
        page={data({ product: { isDigital: true, digitalFormat: "PDF" } })}
        mode="public"
      />,
    );
    expect(screen.getAllByText("incl. VAT").length).toBeGreaterThan(0);
    expect(screen.queryByText(/plus shipping/)).toBeNull();
    expect(screen.getByText("Digital download (PDF)")).toBeInTheDocument();
    expect(document.querySelector("[data-product-section='shipping']")).toBeNull();
  });
});
