/**
 * "Add to your order" on the product page: "Add" takes the product into the
 * order, a taken one with versions shows its choice, the product itself opens
 * its details, and Buy now carries everything taken to the checkout in `?a=`.
 * The storefront decides the heading, the look and the place. Offered only
 * where Buy now IS our checkout; in the editor a product with none says where
 * they are chosen, and what was chosen but is not offered is drawn faded.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { ProductPageData } from "@/types/product-page";
import type { AddOnCard, HiddenAddOn, ProductPageProduct } from "@/types/product";

afterEach(cleanup);

const PRODUCT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MUG = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const COASTERS = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const SET = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const TWO = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const FOUR = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";

function card(id: string, title: string, overrides: Partial<AddOnCard> = {}): AddOnCard {
  return {
    id,
    title,
    description: "",
    pagePath: null,
    priceCents: 1200,
    currency: "EUR",
    sale: null,
    images: [],
    optionGroups: [],
    isDigital: false,
    digitalFormat: null,
    shippingProfileId: null,
    rating: null,
    ...overrides,
  };
}

const CARDS = [
  card(MUG, "Mug"),
  card(COASTERS, "Coasters", {
    description: "Turned from Irish oak.",
    pagePath: "/s/store/p/coasters",
    priceCents: 1800,
    rating: { average: 4.58, count: 12 },
    optionGroups: [
      {
        id: SET,
        name: "Set",
        display: "chip",
        options: [
          { id: TWO, name: "Two", available: true },
          { id: FOUR, name: "Four", available: true },
        ],
      },
    ],
  }),
];

const product: ProductPageProduct = {
  id: PRODUCT,
  title: "Oak lamp",
  description: "",
  priceCents: 12900,
  currency: "EUR",
  sale: null,
  purchaseUrl: null,
  shippingProfileId: null,
  images: [],
  optionGroups: [],
  details: {},
  documents: [],
  isDigital: false,
  digitalFormat: null,
  stock: null,
  soldOut: false,
  maxQuantity: 3,
};

function page(
  overrides: {
    checkout?: boolean;
    addOns?: AddOnCard[];
    hiddenAddOns?: HiddenAddOn[];
    hidden?: boolean;
    reviewsHidden?: boolean;
    design?: Partial<ProductPageData["storefront"]["productPage"]>;
  } = {},
): ProductPageData {
  return {
    storefront: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Studio",
      theme: DEFAULT_STOREFRONT_CONFIG.theme,
      productPage: {
        ...DEFAULT_PRODUCT_PAGE_CONFIG,
        ...overrides.design,
        ...(overrides.hidden || overrides.reviewsHidden
          ? {
              sections: DEFAULT_PRODUCT_PAGE_CONFIG.sections.map((entry) =>
                (overrides.hidden && entry.id === "addOns") || (overrides.reviewsHidden && entry.id === "reviews")
                  ? { ...entry, show: false }
                  : entry,
              ),
            }
          : {}),
      },
      shippingPolicy: {},
      seller: { businessName: "Studio Ltd", email: "hi@studio.example", country: "IE" },
      backgroundImageUrl: null,
      customFontUrl: null,
      checkout: overrides.checkout ?? true,
    },
    product,
    productUrl: "",
    addOns: overrides.addOns ?? CARDS,
    ...(overrides.hiddenAddOns ? { hiddenAddOns: overrides.hiddenAddOns } : {}),
  };
}

const FADED: HiddenAddOn[] = [
  { id: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1", title: "Floor lamp", imageUrl: null, priceCents: 38000, currency: "EUR", reason: "draft" },
  { id: "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2", title: "Bookshelf", imageUrl: null, priceCents: 112000, currency: "EUR", reason: "soldOut" },
];
const faded = () => [...document.querySelectorAll<HTMLElement>("[data-product-add-on-hidden]")];

/** The buy box's own button (the sticky bar carries a copy). */
const buyHref = () =>
  document.querySelector("[data-product-cta='checkout'] a")?.getAttribute("href") ?? "";
const addOnsParam = () => new URL(buyHref(), "https://x.test").searchParams.get("a");
const addButton = (title: string) => screen.getByRole("button", { name: `Add ${title} to your order` });

describe("Add to your order", () => {
  it("adds a product with one tap, and Buy now carries it to the checkout", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={page()} mode="public" />);
    expect(screen.getByRole("heading", { name: "Add to your order" })).toBeInTheDocument();
    const mug = addButton("Mug");
    expect(mug).toHaveAttribute("aria-pressed", "false");
    expect(addOnsParam()).toBeNull();

    await user.click(mug);
    expect(mug).toHaveAttribute("aria-pressed", "true");
    expect(addOnsParam()).toBe(MUG);

    // Tapped again, it comes out.
    await user.click(mug);
    expect(mug).toHaveAttribute("aria-pressed", "false");
    expect(addOnsParam()).toBeNull();
  });

  it("takes a product with versions in its first available one, and the buyer can change it", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={page()} mode="public" />);
    expect(screen.queryByRole("combobox", { name: "Set for Coasters" })).toBeNull();
    await user.click(addButton("Coasters"));
    expect(addOnsParam()).toBe(`${COASTERS}.${TWO}`);

    await user.click(screen.getByRole("combobox", { name: "Set for Coasters" }));
    await user.click(screen.getByRole("option", { name: "Four" }));
    expect(addOnsParam()).toBe(`${COASTERS}.${FOUR}`);
  });

  it("opens on what the link asked for", () => {
    render(
      <ProductPageView page={page()} mode="public" initialAddOns={[{ productId: MUG, optionIds: [] }]} />,
    );
    expect(addButton("Mug")).toHaveAttribute("aria-pressed", "true");
  });

  it("opens a product's details, and adds it from there in the version chosen", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={page()} mode="public" />);
    await user.click(screen.getByRole("button", { name: "See details of Coasters" }));
    const dialog = screen.getByRole("dialog", { name: "Coasters" });
    expect(within(dialog).getByText("Turned from Irish oak.")).toBeInTheDocument();
    // Looking at it adds nothing.
    expect(addOnsParam()).toBeNull();

    await user.click(within(dialog).getByRole("combobox", { name: "Set for Coasters" }));
    await user.click(within(dialog).getByRole("option", { name: "Four" }));
    await user.click(within(dialog).getByRole("button", { name: "Add to your order" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(addOnsParam()).toBe(`${COASTERS}.${FOUR}`);

    // Open again: it says so, and takes it back out.
    await user.click(screen.getByRole("button", { name: "See details of Coasters" }));
    await user.click(screen.getByRole("button", { name: "Remove from your order" }));
    expect(addOnsParam()).toBeNull();
  });

  it("shows a reviewed add-on's stars in its details, where the page shows reviews", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={page()} mode="public" />);
    await user.click(screen.getByRole("button", { name: "See details of Coasters" }));
    const dialog = screen.getByRole("dialog", { name: "Coasters" });
    expect(within(dialog).getByRole("img", { name: "4.6 out of 5 stars, 12 reviews" })).toBeInTheDocument();
    expect(dialog.querySelector("[data-add-on-details-rating]")).toHaveTextContent("4.6(12)");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    // None for one without reviews.
    await user.click(screen.getByRole("button", { name: "See details of Mug" }));
    expect(document.querySelector("[data-add-on-details-rating]")).toBeNull();
    cleanup();

    // Nor anywhere on a page whose storefront hides reviews.
    render(<ProductPageView page={page({ reviewsHidden: true })} mode="public" />);
    await user.click(screen.getByRole("button", { name: "See details of Coasters" }));
    expect(document.querySelector("[data-add-on-details-rating]")).toBeNull();
  });

  it("links to the product's own page only where it has one on this storefront", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={page()} mode="public" />);
    await user.click(screen.getByRole("button", { name: "See details of Coasters" }));
    expect(screen.getByRole("link", { name: "See full page" })).toHaveAttribute("href", "/s/store/p/coasters");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "See details of Mug" }));
    expect(screen.queryByRole("link", { name: "See full page" })).toBeNull();
  });

  it("takes the storefront's heading, look and place", () => {
    render(<ProductPageView page={page()} mode="public" />);
    const section = () => document.querySelector<HTMLElement>("[data-product-add-ons]")!;
    const cta = () => document.querySelector("[data-product-cta='checkout']")!;
    expect(section()).toHaveAttribute("data-product-add-ons-layout", "list");
    expect(section().compareDocumentPosition(cta()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    render(
      <ProductPageView
        page={page({ design: { addOnsTitle: "Goes well with", addOnsLayout: "tiles", addOnsPlacement: "afterButton" } })}
        mode="public"
      />,
    );
    expect(screen.getByRole("heading", { name: "Goes well with" })).toBeInTheDocument();
    expect(section()).toHaveAttribute("data-product-add-ons-layout", "tiles");
    expect(section().compareDocumentPosition(cta()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("is not offered where Buy now is not our checkout, or where the storefront hides it", () => {
    render(<ProductPageView page={page({ checkout: false })} mode="public" />);
    expect(document.querySelector("[data-product-add-ons]")).toBeNull();
    cleanup();
    render(<ProductPageView page={page({ hidden: true })} mode="public" />);
    expect(document.querySelector("[data-product-add-ons]")).toBeNull();
  });

  it("draws what was chosen but is not offered, faded with why, in the seller's preview only", () => {
    render(<ProductPageView page={page({ hiddenAddOns: FADED })} mode="preview" />);
    // Four chosen, four drawn: the two a buyer gets, then the two they do not.
    expect(document.querySelectorAll("[data-product-add-on]")).toHaveLength(2);
    expect(faded().map((item) => [item.textContent, item.dataset.productAddOnHiddenReason])).toEqual([
      ["Floor lampDraftBuyers do not see this one.", "draft"],
      ["BookshelfSold outBuyers do not see this one.", "soldOut"],
    ]);
    // Nothing on it presses; a click on it opens the panel.
    expect(faded()[0]).toHaveAttribute("data-setting-hotspot", "addOns");
    expect(faded()[0]!.closest("[data-setting-skip]")).toBeNull();
    expect(faded()[0]!.querySelector("button, a")).toBeNull();
    // The buyer's own cards are the buyer's to press, in the editor too.
    expect(document.querySelector("[data-product-add-on]")!.closest("[data-setting-skip]")).not.toBeNull();
    cleanup();

    // A buyer's page never draws them.
    render(<ProductPageView page={page({ hiddenAddOns: FADED })} mode="public" />);
    expect(faded()).toHaveLength(0);
  });

  it("draws only the faded ones, not the empty section, when nothing chosen is offered", () => {
    render(<ProductPageView page={page({ addOns: [], hiddenAddOns: FADED })} mode="preview" />);
    expect(document.querySelector("[data-product-add-ons='unset']")).toBeNull();
    expect(screen.getByRole("heading", { name: "Add to your order" })).toBeInTheDocument();
    expect(faded()).toHaveLength(2);
  });

  it("draws the tiles small, as many across as fit, never stretched to fill the row", () => {
    render(<ProductPageView page={page({ design: { addOnsLayout: "tiles" } })} mode="public" />);
    const list = document.querySelector("[data-product-add-ons-layout='tiles'] ul")!;
    expect(list.className).toContain("grid-cols-[repeat(auto-fill,minmax(6rem,1fr))]");
    // A tile's name and price only; the photo is what opens the details.
    expect(within(document.querySelector<HTMLElement>(`[data-product-add-on='${MUG}']`)!).queryByText("Details")).toBeNull();
  });

  it("names a taken tile's version in a line, and changes it in the details", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={page({ design: { addOnsLayout: "tiles" } })} mode="public" />);
    const tile = () => document.querySelector<HTMLElement>(`[data-product-add-on='${COASTERS}']`)!;
    await user.click(addButton("Coasters"));
    // No picker squeezed into the tile.
    expect(within(tile()).queryByRole("combobox")).toBeNull();
    expect(tile().querySelector("[data-product-add-on-version]")).toHaveTextContent("Two");

    await user.click(screen.getByRole("button", { name: "See details of Coasters" }));
    const dialog = screen.getByRole("dialog", { name: "Coasters" });
    await user.click(within(dialog).getByRole("combobox", { name: "Set for Coasters" }));
    await user.click(within(dialog).getByRole("option", { name: "Four" }));
    expect(addOnsParam()).toBe(`${COASTERS}.${FOUR}`);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(tile().querySelector("[data-product-add-on-version]")).toHaveTextContent("Four");
  });

  it("draws the editor's empty section as the way into the panel that chooses them", () => {
    render(<ProductPageView page={page({ addOns: [], checkout: false })} mode="preview" />);
    const unset = document.querySelector("[data-product-add-ons='unset']")!;
    expect(unset).toHaveAttribute("data-setting-hotspot", "addOns");
    expect(unset.closest("[data-setting-skip]")).toBeNull();
    expect(unset.querySelector("[data-setting-skip], a")).toBeNull();
  });
});
