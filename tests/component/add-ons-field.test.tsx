/**
 * The product form's "Add to order": one list with a "+" per product. The "+"
 * adds, the check takes it off, and rows never move under the seller's finger.
 * Only products that can share an order with this one are listed, and the
 * preview beside the list is the buyer's real section, holding only what a buyer
 * would be offered.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { AddOnsField } from "@/components/products/AddOnsField";
import type { AddOnChoice } from "@/lib/products/add-on-choices";
import type { AddOnHabits } from "@/lib/predictions";

afterEach(cleanup);

function choice(id: string, title: string, extra: Partial<AddOnChoice> = {}): AddOnChoice {
  return {
    id,
    title,
    priceCents: 1200,
    sale: null,
    currency: "EUR",
    imageUrl: null,
    status: "active",
    isDigital: false,
    soldOut: false,
    takenDown: false,
    ...extra,
  };
}

const SELF = choice("self", "This product");
const MUG = choice("mug", "Mug");
const COASTERS = choice("coasters", "Coasters");
const VASE = choice("vase", "Vase");
const JUG = choice("jug", "Jug");
const BOWL = choice("bowl", "Bowl");
const ZINE = choice("zine", "Zine", { isDigital: true });
const DOLLARS = choice("dollars", "Dollar plate", { currency: "USD" });

function Field({
  choices,
  start = [],
  isDigital = false,
  ownBuyLink = false,
  habits,
  onValue,
}: {
  choices: readonly AddOnChoice[];
  start?: string[];
  isDigital?: boolean;
  ownBuyLink?: boolean;
  habits?: AddOnHabits;
  onValue?: (value: string[]) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <AddOnsField
      inputId="add-ons"
      productId="self"
      isDigital={isDigital}
      currency="EUR"
      ownBuyLink={ownBuyLink}
      choices={choices}
      habits={habits}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

const field = () => document.querySelector<HTMLElement>("[data-product-field='addOns']")!;
const rowTitles = () =>
  [...field().querySelectorAll<HTMLElement>("[data-product-add-on]")].map((row) => row.getAttribute("data-product-add-on"));
const preview = () => document.querySelector<HTMLElement>("[data-add-ons-preview]")!;
const previewRows = () =>
  [...preview().querySelectorAll<HTMLElement>("[data-product-add-on]")].map((row) => row.getAttribute("data-product-add-on"));
const add = (title: string) => screen.getByRole("button", { name: `Add ${title}` });
const remove = (title: string) => screen.getByRole("button", { name: `Remove ${title}` });

describe("Add to order in the product form", () => {
  it("lists only what can share this order, never the product itself", () => {
    render(<Field choices={[SELF, MUG, ZINE, DOLLARS, COASTERS]} />);
    expect(rowTitles()).toEqual(["mug", "coasters"]);
  });

  it("a download lists downloads", () => {
    render(<Field choices={[SELF, MUG, ZINE]} isDigital />);
    expect(rowTitles()).toEqual(["zine"]);
  });

  it("the + adds in the order pressed, the check takes it off, and no row moves", async () => {
    const user = userEvent.setup();
    let saved: string[] = [];
    render(<Field choices={[MUG, COASTERS, VASE]} onValue={(value) => (saved = value)} />);

    await user.click(add("Vase"));
    await user.click(add("Mug"));
    expect(saved).toEqual(["vase", "mug"]);
    expect(field()).toHaveAttribute("data-product-value", "2");
    expect(rowTitles()).toEqual(["mug", "coasters", "vase"]);

    await user.click(remove("Vase"));
    expect(saved).toEqual(["mug"]);
    expect(rowTitles()).toEqual(["mug", "coasters", "vase"]);
    expect(add("Vase")).toBeInTheDocument();
  });

  it("keeps the button focused after a press, so a second press can undo it", async () => {
    const user = userEvent.setup();
    render(<Field choices={[MUG]} />);
    await user.click(add("Mug"));
    expect(remove("Mug")).toHaveFocus();
  });

  it("what was already chosen sits at the top, in its order", () => {
    render(<Field choices={[MUG, COASTERS, VASE]} start={["vase", "coasters"]} />);
    expect(rowTitles()).toEqual(["vase", "coasters", "mug"]);
  });

  it("at the most a product can offer, only taking one off is possible", async () => {
    const user = userEvent.setup();
    render(<Field choices={[MUG, COASTERS, VASE, JUG, BOWL]} start={["mug", "coasters", "vase", "jug"]} />);
    const count = () => document.querySelector("[data-product-add-ons-count]");
    expect(add("Bowl")).toBeDisabled();
    // The label line's count is all a full list says.
    expect(count()).toHaveTextContent("4/4");
    expect(remove("Mug")).toBeEnabled();

    await user.click(remove("Mug"));
    expect(add("Bowl")).toBeEnabled();
    expect(count()).toHaveTextContent("3/4");
  });

  it("a chosen product that no longer fits stays, marked, until it is taken off", async () => {
    const user = userEvent.setup();
    render(<Field choices={[MUG, ZINE, DOLLARS]} start={["zine", "dollars"]} />);
    const marked = () => document.querySelectorAll("[data-product-add-on-other-kind]").length;
    expect(marked()).toBe(2);
    expect(within(field()).getByText("Not offered: it is a download")).toBeInTheDocument();
    expect(within(field()).getByText("Not offered: priced in USD")).toBeInTheDocument();

    await user.click(remove("Zine"));
    await user.click(remove("Dollar plate"));
    expect(rowTitles()).toEqual(["mug"]);
  });

  it("a draft says so", () => {
    render(<Field choices={[choice("draft", "Draft jug", { status: "draft" })]} />);
    expect(document.querySelector("[data-product-add-on-draft]")).not.toBeNull();
  });

  it("gets a search box only once the list is long", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Field choices={[MUG, COASTERS]} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    unmount();

    const many = Array.from({ length: 8 }, (_, index) => choice(`p${index}`, `Print ${index}`));
    render(<Field choices={[MUG, ...many]} />);
    await user.type(screen.getByRole("searchbox"), "mUg");
    expect(rowTitles()).toEqual(["mug"]);

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "nothing like it");
    expect(rowTitles()).toEqual([]);
    expect(document.querySelector("[data-product-add-ons-no-match]")).not.toBeNull();
  });

  it("says why when there is nothing to list", () => {
    const { unmount } = render(<Field choices={[SELF]} />);
    expect(document.querySelector("[data-product-add-ons-none]")).not.toBeNull();
    unmount();

    render(<Field choices={[SELF, ZINE]} />);
    expect(document.querySelector("[data-product-add-ons-none-of-kind]")).not.toBeNull();
  });

  it("the preview starts with grey rows, and each press puts the real section there", async () => {
    const user = userEvent.setup();
    render(<Field choices={[MUG, COASTERS, VASE]} />);
    expect(preview()).toHaveAttribute("data-add-ons-preview", "empty");
    expect(preview().querySelector("[data-add-ons-preview-ghost]")).not.toBeNull();

    await user.click(add("Vase"));
    await user.click(add("Mug"));
    expect(preview()).toHaveAttribute("data-add-ons-preview", "chosen");
    expect(preview().querySelector("[data-add-ons-preview-ghost]")).toBeNull();
    expect(previewRows()).toEqual(["vase", "mug"]);
    // Offered, not yet taken: what a buyer meets on arriving.
    expect(preview().querySelector("[data-product-add-ons]")).toHaveAttribute("data-product-add-ons", "0");

    await user.click(remove("Vase"));
    await user.click(remove("Mug"));
    expect(previewRows()).toEqual([]);
    expect(preview().querySelector("[data-add-ons-preview-ghost]")).not.toBeNull();
  });

  it("the preview cannot be pressed, reached or read out", () => {
    render(<Field choices={[MUG]} start={["mug"]} />);
    const page = preview().querySelector<HTMLElement>("[inert]")!;
    expect(page).toHaveAttribute("aria-hidden", "true");
    expect(page.querySelector("[data-product-add-on='mug']")).not.toBeNull();
    // The only "Add Mug" or "Remove Mug" anyone can get to is the list's.
    expect(screen.getAllByRole("button", { name: /Mug/ })).toHaveLength(1);
  });

  it("the preview draws what a buyer would not be offered faded, with why, after the rest", () => {
    render(
      <Field
        choices={[
          MUG,
          choice("draft", "Draft jug", { status: "draft" }),
          choice("gone", "Sold out jug", { soldOut: true }),
          choice("down", "Taken down jug", { takenDown: true }),
          ZINE,
          DOLLARS,
        ]}
        start={["mug", "draft", "gone", "down", "zine"]}
      />,
    );
    expect(previewRows()).toEqual(["mug"]);
    expect(preview()).toHaveAttribute("data-add-ons-preview-hidden", "4");
    expect(
      [...preview().querySelectorAll<HTMLElement>("[data-product-add-on-hidden]")].map(
        (item) => item.dataset.productAddOnHiddenReason,
      ),
    ).toEqual(["draft", "soldOut", "takenDown", "otherKind"]);
    expect(document.querySelector("[data-product-add-on-sold-out]")).not.toBeNull();
    expect(document.querySelector("[data-product-add-on-taken-down]")).not.toBeNull();
  });

  it("the preview shows the chosen draft faded, not grey rows, when all of the chosen are hidden", () => {
    render(<Field choices={[choice("draft", "Draft jug", { status: "draft" })]} start={["draft"]} />);
    expect(preview()).toHaveAttribute("data-add-ons-preview", "chosen");
    expect(preview()).toHaveAttribute("data-add-ons-preview-hidden", "1");
    expect(preview().querySelector("[data-add-ons-preview-ghost]")).toBeNull();
    expect(preview().querySelector("[data-product-add-on-hidden='draft']")).toHaveTextContent("Draft jug");
  });

  it("the preview shows a running sale as a buyer's page does", () => {
    render(
      <Field
        choices={[
          choice("sale", "Sale mug", {
            priceCents: 900,
            sale: { regularPriceCents: 1200, percentOff: 25, priorPriceCents: null, offerPercent: 25, endsAt: null },
          }),
        ]}
        start={["sale"]}
      />,
    );
    expect(preview().querySelector("[data-product-sale-was='1200']")).not.toBeNull();
    expect(preview().querySelector("[data-product-sale-percent='25']")).not.toBeNull();
  });

  it("the preview is measured afresh when the buy link goes, so it does not stay collapsed", () => {
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(361);
    const { rerender } = render(<Field choices={[MUG]} start={["mug"]} ownBuyLink />);
    rerender(<Field choices={[MUG]} start={["mug"]} />);
    const page = preview().querySelector<HTMLElement>("[inert]")!;
    expect(page.parentElement).not.toHaveClass("invisible");
    width.mockRestore();
  });

  it("with the seller's own buy link, it says the section will not show", () => {
    render(<Field choices={[MUG]} start={["mug"]} ownBuyLink />);
    expect(preview()).toHaveAttribute("data-add-ons-preview", "off");
    expect(preview().querySelector("[data-add-ons-preview-own-link]")).not.toBeNull();
    expect(previewRows()).toEqual([]);
    // The choice is kept for when the link goes.
    expect(field()).toHaveAttribute("data-product-value", "1");
  });
});

describe("the one-tap guess over the list", () => {
  const BOUGHT: AddOnHabits = { boughtWith: { coasters: 3, vase: 2, jug: 1 }, offeredWith: { bowl: 4 } };
  const suggestion = () => document.querySelector<HTMLElement>("[data-product-add-ons-suggestion]");

  it("names what buyers bought with this product, and a tap adds them after what is chosen", async () => {
    const user = userEvent.setup();
    const seen: string[][] = [];
    render(
      <Field
        choices={[SELF, MUG, COASTERS, VASE, JUG, BOWL]}
        start={["mug"]}
        habits={BOUGHT}
        onValue={(value) => seen.push(value)}
      />,
    );
    expect(suggestion()).toHaveAttribute("data-product-add-ons-suggestion", "boughtWith");
    const chip = screen.getByRole("button", { name: "Often bought together: Coasters and Vase" });
    expect(chip).toHaveAccessibleDescription(
      "Buyers who bought this product also bought Coasters and Vase. A tap adds them to this list.",
    );
    await user.click(chip);
    expect(seen.at(-1)).toEqual(["mug", "coasters", "vase"]);
    // The rows stay where they were; only their buttons changed.
    expect(rowTitles()).toEqual(["mug", "coasters", "vase", "jug", "bowl"]);
    expect(remove("Coasters")).toBeInTheDocument();
    expect(previewRows()).toEqual(["mug", "coasters", "vase"]);
  });

  it("the curved arrow puts the list back, until something else is pressed", async () => {
    const user = userEvent.setup();
    const seen: string[][] = [];
    render(<Field choices={[SELF, MUG, COASTERS, VASE, BOWL]} habits={BOUGHT} onValue={(value) => seen.push(value)} />);
    await user.click(screen.getByRole("button", { name: /^Often bought together/ }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(seen.at(-1)).toEqual([]);
    expect(add("Coasters")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Often bought together/ }));
    await user.click(remove("Vase"));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("falls back to what the seller offers with their other products", () => {
    render(<Field choices={[SELF, MUG, BOWL]} habits={BOUGHT} />);
    expect(suggestion()).toHaveAttribute("data-product-add-ons-suggestion", "offeredWith");
    expect(screen.getByRole("button", { name: "You often add: Bowl" })).toHaveAccessibleDescription(
      "You offer Bowl with several of your other products. A tap adds it here too.",
    );
  });

  it("never guesses a product buyers would not be shown here", () => {
    const habits: AddOnHabits = { boughtWith: { coasters: 5, zine: 5, dollars: 5 }, offeredWith: {} };
    render(
      <Field
        choices={[SELF, MUG, choice("coasters", "Coasters", { status: "draft" }), ZINE, DOLLARS]}
        habits={habits}
      />,
    );
    expect(suggestion()).toBeNull();
  });

  it("says nothing once the list is full, or without a history", () => {
    const { unmount } = render(
      <Field
        choices={[SELF, MUG, COASTERS, VASE, JUG, BOWL]}
        start={["mug", "jug", "bowl", "vase"]}
        habits={BOUGHT}
      />,
    );
    expect(suggestion()).toBeNull();
    unmount();
    render(<Field choices={[SELF, MUG, COASTERS]} />);
    expect(suggestion()).toBeNull();
  });
});
