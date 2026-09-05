import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductPageSection } from "@/components/storefront/ProductPageSection";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  PRODUCT_PAGE_CTA_MAX,
  PRODUCT_PAGE_SECTION_IDS,
} from "@/types/storefront";

afterEach(cleanup);

// A summoned section scrolls itself into view; jsdom has no layout, so it has
// no scrollIntoView either. The stub is the whole of what the tests need.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function mount(props: Partial<Parameters<typeof ProductPageSection>[0]> = {}) {
  const onProductPageChange = vi.fn();
  render(
    <ProductPageSection
      productPage={DEFAULT_PRODUCT_PAGE_CONFIG}
      onProductPageChange={onProductPageChange}
      shippingPolicy={{}}
      sellerIdentity={{}}
      storefrontFont="sans"
      customFontName={undefined}
      summoned={null}
      {...props}
    />,
  );
  return {
    onProductPageChange,
  };
}

describe("ProductPageSection", () => {
  it("offers none of the retired decisions", () => {
    mount({ summoned: "cta" });
    // Each of these was a control with one sensible answer, charged to the
    // seller every time they opened the panel. The page has one arrangement,
    // one gallery, one button fill, and an ink derived from the background.
    for (const gone of ["Surface", "Layout", "Photos", "Text colour", "Button style"]) {
      expect(screen.queryByText(gone), gone).toBeNull();
    }
    for (const gone of ["Card", "Photos right", "Stacked", "One after another", "Outline"]) {
      expect(screen.queryByRole("button", { name: gone }), gone).toBeNull();
    }
    // What survives in Page: the photo fit, the font, and indexing.
    expect(screen.getByText("Photo fit")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Font" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Allow search engines" })).toBeInTheDocument();
  });

  it("follows the storefront font by default, names it, and can be given its own", async () => {
    const user = userEvent.setup();
    const { onProductPageChange } = mount({ storefrontFont: "display" });
    // The inherit option names what following currently gets you, so the
    // seller can see the answer without opening Typography.
    const font = screen.getByRole("combobox", { name: "Font" });
    expect(font).toHaveTextContent("Same as storefront (Display)");

    await user.click(font);
    // No upload on this theme, so there is nothing for "custom" to resolve to.
    expect(screen.queryByRole("option", { name: "Uploaded font" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Serif" }));
    expect(onProductPageChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ font: "serif" }),
    );

    // Back to inheriting DROPS the key rather than storing a value meaning
    // "inherit", so an untouched page carries no font at all.
    cleanup();
    const second = mount({
      productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, font: "serif" },
      storefrontFont: "sans",
    });
    await user.click(screen.getByRole("combobox", { name: "Font" }));
    await user.click(screen.getByRole("option", { name: "Same as storefront (Sans)" }));
    expect(second.onProductPageChange.mock.lastCall?.[0]).not.toHaveProperty("font");
  });

  it("offers the uploaded face by name once the storefront has one", async () => {
    const user = userEvent.setup();
    mount({ storefrontFont: "custom", customFontName: "Chapeau Bold" });
    await user.click(screen.getByRole("combobox", { name: "Font" }));
    expect(
      screen.getByRole("option", { name: "Same as storefront (Chapeau Bold)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Chapeau Bold" })).toBeInTheDocument();
  });

  it("switches the page off through the first control", async () => {
    const user = userEvent.setup();
    const { onProductPageChange } = mount();
    await user.click(screen.getByRole("switch", { name: "Show a product page" }));
    expect(onProductPageChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("caps the button text and keeps the price notes", async () => {
    const user = userEvent.setup();
    const { onProductPageChange } = mount({ summoned: "cta" });
    expect(screen.getByLabelText("Button text")).toHaveAttribute(
      "maxlength",
      String(PRODUCT_PAGE_CTA_MAX),
    );
    // The notes stay: what a price includes is a legal statement in the EU,
    // not a style choice.
    await user.click(screen.getByRole("button", { name: "Excl. tax" }));
    expect(onProductPageChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ priceNote: "excl-vat" }),
    );
  });

  it("is one list of switches, with no way left to reorder it", async () => {
    const user = userEvent.setup();
    const { onProductPageChange } = mount({ summoned: "sections" });
    // Not a single arrow anywhere: the order is fixed.
    expect(screen.queryAllByRole("button", { name: /^Move / })).toHaveLength(0);
    // Availability and the byline are the same kind of yes-or-no about the
    // same page, so they read as rows in the same list.
    const list = screen.getByRole("list", { name: "What the page shows" });
    const switches = within(list).getAllByRole("switch");
    expect(switches).toHaveLength(PRODUCT_PAGE_SECTION_IDS.length + 2);
    await user.click(within(list).getByRole("switch", { name: "Availability" }));
    expect(onProductPageChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ showStock: false }),
    );
  });

  it("pins the description: no arrows, but it keeps the switch that hides it", async () => {
    const user = userEvent.setup();
    const { onProductPageChange } = mount({ summoned: "sections" });
    // It reads under the title, so there is nothing down here to move it
    // against and no placement left to choose.
    expect(screen.queryByRole("button", { name: "Move Description up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move Description down" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Beside photos" })).toBeNull();
    expect(screen.queryByRole("button", { name: "In details" })).toBeNull();

    // The switch stays: it is what decides whether the description shows at all.
    await user.click(screen.getByRole("switch", { name: "Description" }));
    expect(onProductPageChange.mock.lastCall?.[0].sections[0]).toEqual({
      id: "description",
      show: false,
    });
  });

  it("shows the account's seller identity read-only, with no field to edit", () => {
    mount({
      sellerIdentity: {
        businessName: "Studio",
        email: "hi@studio.example",
        country: "IE",
      },
      summoned: "seller",
    });
    // The values are on screen...
    expect(screen.getByText("Studio")).toBeInTheDocument();
    expect(screen.getByText("hi@studio.example")).toBeInTheDocument();
    expect(screen.getByText("Ireland")).toBeInTheDocument();
    // ...but nothing here can change them: this panel used to have a
    // business-name input, an address textarea and a country Select, and
    // none of that survives — only the link to where it is now edited.
    expect(screen.queryByLabelText("Business name")).toBeNull();
    expect(screen.queryByLabelText("Contact email")).toBeNull();
    expect(screen.queryByLabelText("Country")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Edit in Settings" }),
    ).toHaveAttribute("href", "/settings/tax");
  });

  it("nudges towards Settings when nothing is set yet", () => {
    mount({ sellerIdentity: {}, summoned: "seller" });
    expect(screen.getByText(/nothing set yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add your business details" }),
    ).toHaveAttribute("href", "/settings/tax");
  });

  it("shows shipping terms but offers no way to edit them here", () => {
    // The point of the move: this panel proves what a buyer will read and
    // sends the seller to Settings to change it. A textarea here would be a
    // second writer for terms every OTHER storefront also sells under.
    mount({
      summoned: "policies",
      shippingPolicy: {
        dispatch: "Ships within 1-3 business days",
        shipsFrom: "IE",
        returnsWindowDays: 30,
        returnsPaidBy: "buyer",
      },
    });
    expect(screen.queryByLabelText("Shipping")).toBeNull();
    expect(screen.getByText("Ships within 1-3 business days")).toBeInTheDocument();
    expect(screen.getByText(/Ships from Ireland/)).toBeInTheDocument();
    expect(screen.getByText(/within 30 days of delivery/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit in Settings" })).toHaveAttribute(
      "href",
      "/settings/shipping",
    );
  });

  it("names the exceptions without reprinting them", () => {
    // Eight profile bodies here would put the panel straight back to the size
    // this change removed; which product uses which is the product form's
    // question, not this one's.
    mount({
      summoned: "policies",
      shippingPolicy: {
        dispatch: "Ships Fridays",
        profiles: [
          { id: "a", name: "Bulky items", body: "Pallet courier." },
          { id: "b", name: "Made to order", body: "Allow 3 weeks." },
        ],
      },
    });
    expect(screen.getByText(/2 shipping profiles/)).toBeInTheDocument();
    expect(screen.queryByText(/Pallet courier/)).toBeNull();
  });

  it("says so, and links out, when no terms are written at all", () => {
    mount({ summoned: "policies" });
    expect(screen.getByText(/until you add your terms/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add your shipping terms" }),
    ).toHaveAttribute("href", "/settings/shipping");
  });
});
