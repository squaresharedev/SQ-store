import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { ProductPageData } from "@/types/product-page";
import type { ProductPageProduct } from "@/types/product";
import type { ProductReviews, PublicReview } from "@/types/review";

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
    sale: null,
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
    maxQuantity: 2,
    ...overrides,
  };
}

function data(overrides: {
  product?: Partial<ProductPageProduct>;
  productPage?: Partial<ProductPageData["storefront"]["productPage"]>;
  theme?: Partial<ProductPageData["storefront"]["theme"]>;
  seller?: ProductPageData["storefront"]["seller"];
  shippingPolicy?: ProductPageData["storefront"]["shippingPolicy"];
} = {}): ProductPageData {
  return {
    storefront: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Studio",
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, ...overrides.theme },
      productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, ...overrides.productPage },
      shippingPolicy: overrides.shippingPolicy ?? {
        shippingText: "Ships in 3 days. Tracked.",
        returnsText: "30 days.",
      },
      // vatId included so the default fixture triggers the EU VAT gate in
      // ProductPageView. Tests that want to verify the no-VAT-note path must
      // supply an explicit seller override without vatId.
      seller: overrides.seller ?? { businessName: "Studio Ltd", email: "hi@studio.example", country: "IE", vatId: "IE1234567T" },
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

    it("prints the account's default terms for a product that names no profile", () => {
      render(<ProductPageView page={data({ shippingPolicy: { shippingText: "Ships in 3 days. Tracked.", returnsText: "30 days.", profiles } })} mode="public" />);
      const shipping = document.querySelector("[data-product-section='shipping']")!;
      expect(within(shipping as HTMLElement).getByText(/Ships in 3 days/)).toBeInTheDocument();
      expect(within(shipping as HTMLElement).queryByText(/pallet courier/)).toBeNull();
    });

    it("prints the named profile INSTEAD of the default, never on top of it", () => {
      render(
        <ProductPageView
          page={data({ shippingPolicy: { shippingText: "Ships in 3 days. Tracked.", returnsText: "30 days.", profiles }, product: { shippingProfileId: BULKY } })}
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

    it("falls back to the account default when the id names a profile that is gone", () => {
      // A deleted profile. (Before terms moved to the account there was a
      // second cause — a product placed on a storefront that never had it —
      // which the move removed outright.) It gets the terms the seller DOES
      // offer, because that is the only thing they can honestly promise.
      render(
        <ProductPageView
          page={data({ shippingPolicy: { shippingText: "Ships in 3 days. Tracked.", returnsText: "30 days." }, product: { shippingProfileId: BULKY } })}
          mode="public"
        />,
      );
      const shipping = document.querySelector("[data-product-section='shipping']")!;
      expect(within(shipping as HTMLElement).getByText(/Ships in 3 days/)).toBeInTheDocument();
    });

    it("puts the account's dispatch line at the head of the trust list", () => {
      render(
        <ProductPageView
          page={data({
            shippingPolicy: {
              shippingText: "Ships in 3 days. Tracked.",
              dispatch: "Ships within 24 hours",
            },
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

  it("keeps the seller shown even with its switch off: it is a legal disclosure, not a design choice", () => {
    const sections = DEFAULT_PRODUCT_PAGE_CONFIG.sections.map((entry) =>
      entry.id === "seller" ? { ...entry, show: false } : entry,
    );
    render(<ProductPageView page={data({ productPage: { sections } })} mode="public" />);
    expect(document.querySelector("[data-product-section='seller']")).not.toBeNull();
  });

  it("keeps safety and compliance shown even with its switch off, when there is data to disclose", () => {
    const sections = DEFAULT_PRODUCT_PAGE_CONFIG.sections.map((entry) =>
      entry.id === "safety" ? { ...entry, show: false } : entry,
    );
    render(
      <ProductPageView
        page={data({
          productPage: { sections },
          product: {
            details: {
              materials: "Oak",
              safety: {
                manufacturerName: "Studio Ltd",
                manufacturerAddress: "1 Quay St, Cork",
                manufacturerEmail: "safety@studio.example",
              },
            },
          },
        })}
        mode="public"
      />,
    );
    const block = document.querySelector("[data-product-section='safety']");
    expect(block).not.toBeNull();
    expect(within(block as HTMLElement).getByText("Studio Ltd")).toBeInTheDocument();
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

  it("swaps the measurements with the version, and says which version they describe", async () => {
    const user = userEvent.setup();
    render(
      <ProductPageView
        page={data({
          product: {
            optionGroups: [
              {
                id: COLOUR_GROUP,
                name: "Size",
                display: "chip",
                options: [
                  {
                    id: RED,
                    name: "Small",
                    available: true,
                    details: {
                      dimensions: { length: 120, width: 80, height: 75, unit: "cm" },
                      specs: [{ label: "Seats", value: "4" }],
                    },
                  },
                  {
                    id: BLUE,
                    name: "Large",
                    available: true,
                    details: {
                      dimensions: { length: 180, width: 90, height: 75, unit: "cm" },
                      specs: [{ label: "Seats", value: "6" }],
                    },
                  },
                ],
              },
            ],
            details: { materials: "Oak", specs: [{ label: "Seats", value: "2" }] },
          },
        })}
        mode="public"
      />,
    );
    const specs = () => document.querySelector<HTMLElement>("[data-product-specs]")!;

    // The table names the version it is describing, then measures it.
    expect(within(specs()).getByText("Small")).toBeInTheDocument();
    expect(within(specs()).getByText("120 × 80 × 75 cm")).toBeInTheDocument();
    // The version's row replaces the product's own of the same name.
    expect(within(specs()).getByText("4")).toBeInTheDocument();
    expect(within(specs()).queryByText("2")).toBeNull();
    // What does not vary is still the product's.
    expect(within(specs()).getByText("Oak")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Large" }));
    expect(within(specs()).getByText("180 × 90 × 75 cm")).toBeInTheDocument();
    expect(within(specs()).getByText("6")).toBeInTheDocument();
    expect(within(specs()).queryByText("120 × 80 × 75 cm")).toBeNull();
  });

  it("keeps a specs section for a product whose measurements live only on its versions", () => {
    render(
      <ProductPageView
        page={data({
          product: {
            optionGroups: [
              {
                id: COLOUR_GROUP,
                name: "Size",
                display: "chip",
                options: [
                  {
                    id: RED,
                    name: "Small",
                    available: true,
                    details: { weight: { value: 18, unit: "kg" } },
                  },
                ],
              },
            ],
            // Nothing stated for the product itself: without the versions this
            // section would not exist at all.
            details: {},
          },
        })}
        mode="public"
      />,
    );
    const specs = document.querySelector<HTMLElement>("[data-product-specs]")!;
    expect(within(specs).getByText("18 kg")).toBeInTheDocument();
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
    // The chosen name is printed beside the group's own label. Scoped to that
    // label because the specs table now names the version too (see
    // optionSummaryRows), so "Red" is on the page more than once.
    const label = document.querySelector<HTMLElement>("[data-option-group-label]")!;
    expect(within(label).getByText("Red")).toBeInTheDocument();
  });

  it("attributes the page to Square Share without implying it is the seller", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const footer = document.querySelector("[data-product-page-footer]")!;
    // A real, navigable link on the public page...
    const link = within(footer as HTMLElement).getByRole("link", { name: /powered by square share/i });
    expect(link).toHaveAttribute("href", "https://squareshare.eu");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // ...and never the only "sold by" on the page — the seller's own name
    // still appears, and nowhere does Squareshare claim to be selling this.
    expect(screen.getByText("Sold by Studio Ltd")).toBeInTheDocument();
    expect(screen.queryByText(/guarantee/i, { selector: "[data-product-page-footer] *" })).toBeNull();
  });

  it("keeps the attribution and both policy links live inside the editor preview, unlike everything else on the artboard", () => {
    render(<ProductPageView page={data()} mode="preview" />);
    const footer = document.querySelector("[data-product-page-footer]")! as HTMLElement;
    // This footer is the ONE region where preview does not neutralise links:
    // none of it is design chrome a seller is composing, so there is nothing
    // here for a click to open a setting for.
    const attribution = within(footer).getByRole("link", { name: /powered by square share/i });
    expect(attribution).toHaveAttribute("href", "https://squareshare.eu");
    expect(attribution).toHaveAttribute("target", "_blank");
    const privacy = within(footer).getByRole("link", { name: "Square Share Privacy Policy" });
    expect(privacy).toHaveAttribute("href", "https://squareshare.eu/legal/privacy-policy/");
    expect(privacy).toHaveAttribute("target", "_blank");
    const terms = within(footer).getByRole("link", { name: "Square Share Terms of Use" });
    expect(terms).toHaveAttribute("href", "https://squareshare.eu/terms/");
    expect(terms).toHaveAttribute("target", "_blank");
    // The escape hatch that makes them reachable at all inside the editor:
    // without it, ProductPageArtboard's delegated click handler would
    // preventDefault() the click and reroute it to a settings panel instead
    // of letting the browser follow the link (see PoweredByFooter.tsx). One
    // row, one skip: all three links share it.
    expect(attribution.closest("[data-setting-skip]")).not.toBeNull();
    expect(privacy.closest("[data-setting-skip]")).toBe(attribution.closest("[data-setting-skip]"));
  });

  it("names the seller, not Square Share, as the party responsible for the sale", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const disclosure = document.querySelector("[data-product-sale-disclosure]")! as HTMLElement;
    // The trader is named, and named FIRST, because a buyer must be able to
    // read who they are contracting with without parsing the whole sentence.
    expect(within(disclosure).getByText("Studio Ltd")).toBeInTheDocument();
    expect(disclosure.textContent).toMatch(/is the seller for this order/i);
    expect(disclosure.textContent).toMatch(/returns or refunds/i);
    // ...and Squareshare is disclaimed out of the sale in the same breath.
    expect(disclosure.textContent).toMatch(/not a party to the sale/i);
  });

  it("falls back to the store's name in the disclosure when there is no business name", () => {
    // A hobbyist seller with no registered business still has to be named as
    // the trader; an empty disclosure would be worse than none.
    render(<ProductPageView page={data({ seller: {} })} mode="public" />);
    const disclosure = document.querySelector("[data-product-sale-disclosure]")! as HTMLElement;
    expect(within(disclosure).getByText("Studio")).toBeInTheDocument();
  });

  it("keeps the sale disclosure when the seller hides the 'Sold by' line", () => {
    // showSeller is presentation. Who the buyer is contracting with is not the
    // seller's to switch off, so the footer must survive it.
    render(<ProductPageView page={data({ productPage: { showSeller: false } })} mode="public" />);
    expect(screen.queryByText(/^Sold by/)).toBeNull();
    const disclosure = document.querySelector("[data-product-sale-disclosure]")! as HTMLElement;
    expect(disclosure.textContent).toMatch(/not a party to the sale/i);
    expect(within(disclosure).getByText("Studio Ltd")).toBeInTheDocument();
  });

  it("survives every section and switch a seller can turn off, because none of them is wired to it", () => {
    // There is no config field for this footer to read, so the most hostile
    // config a seller could save (every section off, seller and stock both
    // hidden) is the regression test: if a future edit ever threads a
    // `productPage` value into PoweredByFooter, this is what would catch it.
    const allOff = DEFAULT_PRODUCT_PAGE_CONFIG.sections.map((entry) => ({ ...entry, show: false }));
    render(
      <ProductPageView
        page={data({ productPage: { sections: allOff, showSeller: false, showStock: false } })}
        mode="public"
      />,
    );
    expect(document.querySelector("[data-product-sections]")).toBeNull();
    // Seller is mandatory and the fixture has business details, so it stands
    // regardless of the "off" the hostile config asked for.
    expect(document.querySelector("[data-product-section='seller']")).not.toBeNull();
    const footer = document.querySelector("[data-product-page-footer]")! as HTMLElement;
    expect(within(footer).getByText(/not a party to the sale/i)).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: /powered by square share/i })).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Square Share Privacy Policy" })).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Square Share Terms of Use" })).toBeInTheDocument();
  });

  it("links Square Share's privacy and terms, labelled so they cannot read as the seller's", () => {
    render(<ProductPageView page={data()} mode="public" />);
    const footer = document.querySelector("[data-product-page-footer]")! as HTMLElement;
    // The accessible name carries "Square Share" even though the visible text
    // is one word: an unqualified "Terms" in a shop footer reads as the shop's.
    const privacy = within(footer).getByRole("link", { name: "Square Share Privacy Policy" });
    expect(privacy).toHaveAttribute("href", "https://squareshare.eu/legal/privacy-policy/");
    const terms = within(footer).getByRole("link", { name: "Square Share Terms of Use" });
    // Trailing slash on both: the marketing site is trailingSlash:true, so the
    // slashless form is a 308 and would cost a buyer an extra round trip.
    expect(terms).toHaveAttribute("href", "https://squareshare.eu/terms/");
    for (const link of [privacy, terms]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    }
    // No cookie link: this page stores nothing on the buyer's device. It only
    // appears if checkout ever loads something that does.
    expect(within(footer).queryByRole("link", { name: /cookie/i })).toBeNull();
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

  it("tells the seller which version the buyer was looking at when they wrote", async () => {
    // Until checkout ships this is the ONLY route from a buyer to a seller
    // that we control, so it is the only place the choice can be handed over.
    const user = userEvent.setup();
    render(<ProductPageView page={data({ product: { purchaseUrl: null } })} mode="public" />);
    const mail = () => screen.getAllByRole("link", { name: /ask about this product/i })[0]!;

    const body = () => {
      const href = mail().getAttribute("href") ?? "";
      return decodeURIComponent(new URL(href).searchParams.get("body") ?? "");
    };
    expect(body()).toContain("Oak lamp");
    expect(body()).toContain("Colour: Red");

    // And it follows the picker, so the seller is never told a different
    // version than the buyer had on screen.
    await user.click(screen.getByRole("radio", { name: "Blue" }));
    expect(body()).toContain("Colour: Blue");
    expect(body()).not.toContain("Colour: Red");
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

  // BUY-06: a mail CTA is a contact link, not a purchase button. Sold out
  // means the product can't be bought, not that the seller can't be reached.
  it("keeps a mail CTA live when the product is sold out, only disabling link CTAs", () => {
    // Link CTA + sold out: button is disabled, text says "Sold out".
    render(<ProductPageView page={data({ product: { soldOut: true } })} mode="public" />);
    expect(screen.getAllByText("Sold out").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link", { name: /buy now/i })).toHaveLength(0);
    cleanup();

    // Mail CTA + sold out: button is STILL active as a mailto link.
    render(
      <ProductPageView
        page={data({ product: { purchaseUrl: null, soldOut: true } })}
        mode="public"
      />,
    );
    // "Ask about this product" is the mail label, and it must be a live link.
    const mailLinks = screen.getAllByRole("link", { name: /ask about this product/i });
    expect(mailLinks.length).toBeGreaterThan(0);
    // The mail link must not be aria-disabled.
    for (const link of mailLinks) {
      expect(link.closest("[aria-disabled='true']")).toBeNull();
    }
    // The CTA element itself must NOT show "Sold out" as its text — that would
    // mean the button is disabled. "Sold out" may still appear in StockLine
    // (the stock badge), which is correct and separate from the CTA.
    const ctaEls = document.querySelectorAll("[data-product-cta='mail']");
    expect(ctaEls.length).toBeGreaterThan(0);
    for (const cta of ctaEls) {
      expect(cta.textContent).not.toContain("Sold out");
    }
  });

  // BUY-02: VAT and shipping notes derived from the seller's actual facts.
  describe("VAT and shipping note derivation", () => {
    // combination 1: EU seller with VAT + physical product with shipping terms
    // → both notes shown ("incl. VAT, plus shipping")
    it("shows both notes for a VAT-registered EU seller with a physical product and shipping terms", () => {
      render(
        <ProductPageView
          page={data({
            seller: { businessName: "Studio Ltd", email: "hi@studio.example", country: "IE", vatId: "IE1234567T" },
            shippingPolicy: { shippingText: "Ships in 3 days." },
            product: { isDigital: false },
          })}
          mode="public"
        />,
      );
      // Twice: once in the main buy box, once in the sticky footer bar.
      expect(screen.getAllByText("incl. VAT, plus shipping")).toHaveLength(2);
    });

    // combination 2: EU seller with VAT + digital product
    // → VAT note shown, shipping note suppressed (digital is not shipped)
    it("shows only the VAT note for a digital product, never a shipping note", () => {
      render(
        <ProductPageView
          page={data({
            seller: { businessName: "Studio Ltd", email: "hi@studio.example", country: "IE", vatId: "IE1234567T" },
            product: { isDigital: true, digitalFormat: "PDF" },
          })}
          mode="public"
        />,
      );
      expect(screen.getAllByText("incl. VAT").length).toBeGreaterThan(0);
      expect(screen.queryByText(/plus shipping/)).toBeNull();
    });

    // combination 3: EU seller WITHOUT a VAT id + physical product with shipping terms
    // → no VAT note, shipping note still shown
    it("suppresses the VAT note for an EU seller with no VAT id, but keeps the shipping note", () => {
      render(
        <ProductPageView
          page={data({
            seller: { businessName: "Small Studio", email: "hi@small.example", country: "IE" },
            shippingPolicy: { shippingText: "Ships in 3 days." },
            product: { isDigital: false },
          })}
          mode="public"
        />,
      );
      expect(screen.queryByText(/incl\. VAT/)).toBeNull();
      expect(screen.getAllByText("plus shipping")).toHaveLength(2);
    });

    // combination 4: non-EU seller (no VAT relevance) + physical product with shipping terms
    // → no VAT note, shipping note still shown
    it("suppresses the VAT note for a non-EU seller regardless of VAT id", () => {
      render(
        <ProductPageView
          page={data({
            seller: { businessName: "US Store", email: "hi@us.example", country: "US", vatId: "123456789" },
            shippingPolicy: { shippingText: "Ships in 5 days." },
            product: { isDigital: false },
          })}
          mode="public"
        />,
      );
      expect(screen.queryByText(/incl\. VAT/)).toBeNull();
      expect(screen.getAllByText("plus shipping")).toHaveLength(2);
    });

    // BUY-03: when the seller has no shipping terms, the shipping section is
    // absent rather than showing an apology message.
    it("omits the shipping section entirely when the seller has written no shipping terms", () => {
      render(
        <ProductPageView
          page={data({
            shippingPolicy: {},
            product: { isDigital: false },
          })}
          mode="public"
        />,
      );
      // No section, no apology.
      expect(document.querySelector("[data-product-section='shipping']")).toBeNull();
      expect(screen.queryByText(/seller has not added shipping/)).toBeNull();
      // Shipping note is also suppressed when there are no terms.
      expect(screen.queryByText(/plus shipping/)).toBeNull();
    });
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

describe("ProductPageView: the seller's badges", () => {
  const BADGES = [
    { icon: "heart" as const, label: "Loved by 1,000+ people" },
    { icon: "leaf" as const, label: "Eco friendly" },
    { icon: "hand-heart" as const, label: "Handmade" },
  ];

  it("prints them under the title, in the seller's order, each with its icon", () => {
    render(<ProductPageView page={data({ product: { details: { badges: BADGES } } })} mode="public" />);
    const list = screen.getByRole("list", { name: "Highlights" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(BADGES.map((badge) => badge.label));
    expect(items.map((item) => item.getAttribute("data-product-badge"))).toEqual(["heart", "leaf", "hand-heart"]);
    expect(list.getAttribute("data-product-badges")).toBe("3");
    // Read with the title: after the heading, before the description.
    const title = screen.getByRole("heading", { level: 1 });
    const description = screen.getByText("Warm light for long evenings.");
    expect(title.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The PRODUCT's words: a click on them opens no page setting.
    expect(list.closest("[data-setting-skip]")).not.toBeNull();
  });

  it("draws them in the page's own ink and corners, on a dark page too", () => {
    render(
      <ProductPageView
        page={data({
          product: { details: { badges: BADGES.slice(0, 1) } },
          productPage: { backgroundColor: "#111111" },
          theme: { cornerRadius: 30 },
        })}
        mode="public"
      />,
    );
    const pill = within(screen.getByRole("list", { name: "Highlights" })).getByRole("listitem");
    expect(pill.style.color).toBe("rgb(255, 255, 255)");
    // Corners follow the theme, capped like every other control on the page.
    expect(pill.style.borderRadius).toBe("16px");
  });

  it("prints nothing at all for a product without badges", () => {
    render(<ProductPageView page={data()} mode="public" />);
    expect(screen.queryByRole("list", { name: "Highlights" })).toBeNull();
    expect(document.querySelector("[data-product-badges]")).toBeNull();
  });

  it("shows the same badges in the editor's preview", () => {
    render(<ProductPageView page={data({ product: { details: { badges: BADGES } } })} mode="preview" />);
    expect(within(screen.getByRole("list", { name: "Highlights" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("keeps a long badge's words inside the page", () => {
    const long = { icon: "star" as const, label: "Ausgezeichnet mit dem Bundespreis Handwerk" };
    render(<ProductPageView page={data({ product: { details: { badges: [long] } } })} mode="public" />);
    const label = screen.getByText(long.label);
    expect(label.className).toContain("break-words");
    expect(label.className).toContain("min-w-0");
  });
});

describe("ProductPageView: badge colours and the photo", () => {
  const MIXED = [
    { icon: "leaf" as const, label: "Eco friendly", color: "green" as const },
    { icon: "heart" as const, label: "Loved by 250+ people", color: "red" as const, placement: "photo-top-left" as const },
    { icon: "truck" as const, label: "Free shipping", color: "blue" as const, placement: "photo-bottom-right" as const },
    { icon: "star" as const, label: "Top rated", placement: "photo-bottom-right" as const },
  ];
  const iconColor = (item: Element) => (item.querySelector("svg") as SVGElement).style.color;

  it("lays the photo's badges over the photo, by corner, and keeps the rest under the title", () => {
    render(<ProductPageView page={data({ product: { details: { badges: MIXED } } })} mode="public" />);
    const photo = screen.getByRole("list", { name: "Highlights on the photo" });
    // Inside the main frame, not beside it.
    expect(photo.closest("figure")).not.toBeNull();
    expect(within(photo).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Loved by 250+ people",
      "Free shipping",
      "Top rated",
    ]);
    expect(photo.querySelector('[data-badge-corner="photo-top-left"]')!.textContent).toBe("Loved by 250+ people");
    expect(photo.querySelector('[data-badge-corner="photo-bottom-right"]')!.textContent).toBe("Free shippingTop rated");
    expect(photo.querySelector('[data-badge-corner="photo-top-right"]')).toBeNull();
    // Never in the way of the photo itself.
    expect(photo.className).toContain("pointer-events-none");
    expect(photo.closest("[data-setting-skip]")).not.toBeNull();

    const beside = screen.getByRole("list", { name: "Highlights" });
    expect(within(beside).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Eco friendly"]);
  });

  it("gives each corner the edge to itself, or half of it when the facing corner is used", () => {
    const facing = [
      { icon: "star" as const, label: "Left", placement: "photo-top-left" as const },
      { icon: "star" as const, label: "Right", placement: "photo-top-right" as const },
      { icon: "star" as const, label: "Alone", placement: "photo-bottom-left" as const },
    ];
    render(<ProductPageView page={data({ product: { details: { badges: facing } } })} mode="public" />);
    const corner = (name: string) => document.querySelector(`[data-badge-corner="${name}"]`)!.className;
    expect(corner("photo-top-left")).toContain("max-w-[calc(50%-1rem)]");
    expect(corner("photo-top-right")).toContain("max-w-[calc(50%-1rem)]");
    expect(corner("photo-bottom-left")).toContain("max-w-[calc(100%-1.5rem)]");
  });

  it("prints no empty list beside the product when every badge is on the photo", () => {
    const onPhoto = MIXED.filter((badge) => badge.placement);
    render(<ProductPageView page={data({ product: { details: { badges: onPhoto } } })} mode="public" />);
    expect(screen.queryByRole("list", { name: "Highlights" })).toBeNull();
    expect(document.querySelector("[data-product-badges]")).toBeNull();
    expect(screen.getByRole("list", { name: "Highlights on the photo" })).toBeInTheDocument();
  });

  it("still shows them on a product with no photo yet", () => {
    render(
      <ProductPageView
        page={data({ product: { images: [], details: { badges: MIXED } } })}
        mode="public"
      />,
    );
    const empty = document.querySelector('[data-product-gallery="empty"]')!;
    expect(within(empty as HTMLElement).getByRole("list", { name: "Highlights on the photo" })).toBeInTheDocument();
  });

  it("draws icon colours in the page's shade, and the photo's pills dark on light whatever the page", () => {
    const { unmount } = render(
      <ProductPageView page={data({ product: { details: { badges: MIXED } } })} mode="public" />,
    );
    const light = within(screen.getByRole("list", { name: "Highlights" })).getByRole("listitem");
    expect(iconColor(light)).toBe("rgb(22, 163, 74)"); // green-600 on a light page
    expect(light.getAttribute("data-badge-color")).toBe("green");
    unmount();

    render(
      <ProductPageView
        page={data({ product: { details: { badges: MIXED } }, productPage: { backgroundColor: "#111111" } })}
        mode="public"
      />,
    );
    const dark = within(screen.getByRole("list", { name: "Highlights" })).getByRole("listitem");
    expect(iconColor(dark)).toBe("rgb(74, 222, 128)"); // green-400 on a dark page
    const photo = within(screen.getByRole("list", { name: "Highlights on the photo" })).getAllByRole("listitem");
    // A light pill on any picture: dark words, the light-page shade, "ink" dark too.
    expect((photo[0] as HTMLElement).style.color).toBe("rgb(23, 23, 23)");
    expect(iconColor(photo[0]!)).toBe("rgb(220, 38, 38)");
    expect(iconColor(photo[2]!)).toBe("rgb(23, 23, 23)");
  });
});

// ── Reviews ──────────────────────────────────────────────────────────────
// A section the seller switches on or off like the others, open at the foot
// of the page. On, it shows the product's rating and lets a buyer narrow the
// reviews to one star rating; with no reviews yet it says so; and a failed
// read leaves it out rather than claiming there are none.

function publicReview(id: string, rating: number): PublicReview {
  return {
    id,
    rating,
    title: `Review ${id}`,
    body: "Exactly as described.",
    authorName: "Aoife N.",
    verified: true,
    source: "native",
    reviewedAt: "2026-10-01T10:00:00.000Z",
  };
}

const REVIEWS: ProductReviews = {
  summary: { count: 3, average: 3.67, breakdown: [1, 0, 0, 1, 1] },
  firstPage: {
    rows: [publicReview("r5", 5), publicReview("r4", 4), publicReview("r1", 1)],
    total: 3,
    page: 1,
    pageSize: 10,
  },
};

const NO_REVIEWS: ProductReviews = {
  summary: { count: 0, average: null, breakdown: [0, 0, 0, 0, 0] },
  firstPage: { rows: [], total: 0, page: 1, pageSize: 10 },
};

const reviewsSection = () => document.querySelector('[data-product-section="reviews"]');
const withReviews = (show: boolean) => ({
  productPage: {
    sections: DEFAULT_PRODUCT_PAGE_CONFIG.sections.map((entry) => (entry.id === "reviews" ? { ...entry, show } : entry)),
  },
});

describe("ProductPageView reviews", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the rating and the reviews when the section is on", () => {
    render(<ProductPageView page={data()} mode="public" reviews={REVIEWS} />);
    const section = reviewsSection() as HTMLElement;
    expect(section).not.toBeNull();
    expect(within(section).getByText("3.7")).toBeInTheDocument();
    expect(within(section).getAllByRole("article")).toHaveLength(3);
    // Not folded into "More details": it is read, not looked up.
    expect(section.closest("details")).toBeNull();
  });

  it("is left out when the seller switches it off, reviews or not", () => {
    render(<ProductPageView page={data(withReviews(false))} mode="public" reviews={REVIEWS} />);
    expect(reviewsSection()).toBeNull();
  });

  it("keeps showing for a page saved before the switch existed", () => {
    const legacy = { productPage: { sections: [{ id: "specs" as const, show: true }] } };
    render(<ProductPageView page={data(legacy)} mode="public" reviews={REVIEWS} />);
    expect(reviewsSection()).not.toBeNull();
  });

  it("says plainly when there are no reviews yet, and how one gets written", () => {
    render(<ProductPageView page={data()} mode="public" reviews={NO_REVIEWS} />);
    const section = reviewsSection() as HTMLElement;
    expect(within(section).getByText("No reviews yet")).toBeInTheDocument();
    expect(within(section).getByText(/review it from their order page/)).toBeInTheDocument();
    // Nothing to sort, filter or disclose about checking: there is nothing shown.
    expect(within(section).queryByRole("button")).toBeNull();
    expect(section.querySelector("[data-reviews-about]")).toBeNull();
  });

  it("is left out when the reviews could not be read", () => {
    render(<ProductPageView page={data()} mode="public" reviews={null} />);
    expect(reviewsSection()).toBeNull();
  });

  it("narrows to one star rating from the breakdown, and lets go again", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ ok: true, page: { rows: [publicReview("r1", 1)], total: 1, page: 1, pageSize: 10 } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ProductPageView page={data()} mode="public" reviews={REVIEWS} />);
    const section = reviewsSection() as HTMLElement;

    await user.click(within(section).getByRole("button", { name: "Show 1-star reviews (1)" }));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("rating=1");
    expect(await within(section).findByText("Showing 1-star reviews")).toBeInTheDocument();
    expect(within(section).getAllByRole("article")).toHaveLength(1);
    expect(within(section).getByRole("button", { name: "Show 1-star reviews (1)" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(section).getByRole("button", { name: "Show all reviews" }));
    expect(within(section).queryByText("Showing 1-star reviews")).toBeNull();
    expect(within(section).getAllByRole("article")).toHaveLength(3);
  });

  it("does not offer a star rating nobody gave", () => {
    render(<ProductPageView page={data()} mode="public" reviews={REVIEWS} />);
    expect(screen.getByRole("button", { name: "Show 2-star reviews (0)" })).toBeDisabled();
  });

  it("says so when a filtered read fails, without losing the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const user = userEvent.setup();
    render(<ProductPageView page={data()} mode="public" reviews={REVIEWS} />);
    await user.click(screen.getByRole("button", { name: "Show 5-star reviews (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("More reviews could not be loaded");
  });
});
