import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelSearchField } from "@/components/storefront/PanelSearchField";
import {
  editorEntries,
  type EditorTarget,
} from "@/components/storefront/editor-search";
import type { Product } from "@/types/product";
import type { ShapeBlock, TextBlock } from "@/types/storefront";

afterEach(cleanup);

const TEXT_BLOCK: TextBlock = {
  type: "text",
  id: "text-1",
  x: 0,
  y: 0,
  w: 2,
  h: 1,
  z: 0,
  text: "Summer sale ends Friday",
  variant: "heading",
  align: "left",
};

const SHAPE_BLOCK: ShapeBlock = {
  type: "shape",
  id: "shape-1",
  x: 2,
  y: 0,
  w: 1,
  h: 1,
  z: 1,
  kind: "star",
  color: "#ff0000",
};

const PRODUCT: Product = {
  id: "p1",
  title: "Riso poster",
  description: "",
  price: 24,
  currency: "EUR",
  status: "active",
  imageUrl: null,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
};

const PRODUCT_BLOCK = {
  type: "product" as const,
  productId: "p1",
  x: 0,
  y: 1,
  w: 1,
  h: 1,
  z: 2,
};

const BLOCKS = [TEXT_BLOCK, SHAPE_BLOCK, PRODUCT_BLOCK];
const PRODUCTS = new Map([["p1", PRODUCT]]);

/** The whole editor index, exactly as the designer builds it. */
const ENTRIES = editorEntries(BLOCKS, PRODUCTS);
/** What the dev gallery gets: no board, and nothing to jump to. */
const SETTINGS_ONLY = ENTRIES.filter((e) => e.payload.kind === "setting");

function setup(entries: readonly (typeof ENTRIES)[number][] = ENTRIES) {
  const onPick = vi.fn<(target: EditorTarget) => void>();
  render(<PanelSearchField entries={entries} onPick={onPick} />);
  return {
    onPick,
    input: screen.getByRole("combobox", { name: "Find a setting or object" }),
  };
}

function optionTitles(): string[] {
  return screen
    .getAllByRole("option")
    .map((row) => within(row).getAllByText(/./)[0]?.textContent ?? "");
}

describe("PanelSearchField — finding a setting you cannot name", () => {
  it("answers a description rather than a label", async () => {
    // "Background" is under Theme and nothing about the words the seller typed
    // says so. That is the entire reason this field exists.
    const { input } = setup();
    await userEvent.type(input, "store bg colour");
    expect(optionTitles()[0]).toBe("Background");
  });

  it("answers through a typo", async () => {
    const { input } = setup();
    await userEvent.type(input, "corner rondness");
    expect(optionTitles()[0]).toBe("Corner roundness");
  });

  it("answers a word we never chose, and says which word it recognised", async () => {
    const { input } = setup();
    await userEvent.type(input, "wallpaper");
    const first = screen.getAllByRole("option")[0]!;
    expect(within(first).getByText("Background")).toBeTruthy();
    // Without this the row reads as a wrong answer rather than a right one.
    expect(within(first).getByText("wallpaper")).toBeTruthy();
  });

  it("never repeats the caption as the reason", async () => {
    // Every one of these matched on the shared subtitle "Storefront / Product
    // cards", which the right-hand caption already shows as "Product cards".
    const { input } = setup();
    await userEvent.type(input, "product cards");
    for (const row of screen.getAllByRole("option")) {
      expect(within(row).queryByText(/^Storefront \//)).toBeNull();
    }
  });

  it("hands back the setting's ref, not a route", async () => {
    const { onPick, input } = setup();
    await userEvent.type(input, "roundness{Enter}");
    expect(onPick).toHaveBeenCalledWith({
      kind: "setting",
      ref: { kind: "cards", section: "cardStyle" },
    });
  });

  it("says so plainly when nothing matches", async () => {
    const { input } = setup();
    await userEvent.type(input, "zzzzqqqq");
    expect(screen.getByText("Nothing in the editor matches that.")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("ranks a setting the way the universal palette does", async () => {
    // Both surfaces describe a setting through settingIndexFields, so the
    // subtitle "Storefront / Theme" is a term here too even though the editor
    // shows only the group. Losing it would drop "store bg colour" to two
    // words out of three and change what leads.
    const { input } = setup();
    await userEvent.type(input, "store bg colour");
    const first = screen.getAllByRole("option")[0]!;
    expect(within(first).getByText("Theme")).toBeTruthy();
  });
});

describe("PanelSearchField — finding what is ON the canvas", () => {
  it("finds a text block by the words in it", async () => {
    const { onPick, input } = setup();
    await userEvent.type(input, "summer sale");
    expect(optionTitles()[0]).toBe("Summer sale ends Friday");
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith({ kind: "block", key: "t_text-1" });
  });

  it("finds a product tile by the product's name", async () => {
    const { onPick, input } = setup();
    await userEvent.type(input, "riso poster{Enter}");
    expect(onPick).toHaveBeenCalledWith({ kind: "block", key: "p_p1" });
  });

  it("finds a shape by its kind", async () => {
    const { input } = setup();
    await userEvent.type(input, "star");
    expect(optionTitles()[0]).toBe("Star");
  });

  it("tolerates a typo in an object's name too", async () => {
    const { input } = setup();
    await userEvent.type(input, "sumer sale");
    expect(optionTitles()[0]).toBe("Summer sale ends Friday");
  });

  it("labels the sections when more than one answered", async () => {
    // "colour" reaches settings only; something matching both has to say
    // which is which.
    const { input } = setup();
    await userEvent.type(input, "product");
    const labels = screen
      .getAllByRole("group")
      .map((group) => group.textContent ?? "");
    expect(labels.some((text) => text.startsWith("On the canvas"))).toBe(true);
  });
});

describe("PanelSearchField — finding the editor's own drawers", () => {
  it("finds Layers by what it is for, not by its name", async () => {
    const { onPick, input } = setup();
    await userEvent.type(input, "what is underneath{Enter}");
    expect(onPick).toHaveBeenCalledWith({ kind: "panel", panel: "layers" });
  });

  it("finds the uploads drawer from the file type someone has", async () => {
    const { onPick, input } = setup();
    await userEvent.type(input, "svg{Enter}");
    expect(onPick).toHaveBeenCalledWith({ kind: "panel", panel: "uploads" });
  });
});

describe("PanelSearchField — a narrowed index", () => {
  it("offers nothing but settings when that is all it was given", async () => {
    // The dev gallery has no board and no owner to jump for it.
    const { input } = setup(SETTINGS_ONLY);
    // Words no setting is described by. ("summer sale" used to serve here,
    // until the Seller details setting arrived and its vocabulary sat within
    // the ranker's typo tolerance of "sale".)
    await userEvent.type(input, "winter jacket");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("drops the section heading when only one section answered", async () => {
    const { input } = setup(SETTINGS_ONLY);
    await userEvent.type(input, "roundness");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(screen.queryByText("Settings")).toBeNull();
  });
});

describe("PanelSearchField — driving it from the keyboard", () => {
  it("opens the first match on Enter without ever leaving the input", async () => {
    // Before this the rows were reachable by Tab alone, so typing a query and
    // pressing Enter did nothing at all.
    const { onPick, input } = setup();
    await userEvent.type(input, "roundness{Enter}");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it("walks the list with the arrows and opens what is highlighted", async () => {
    const { onPick, input } = setup();
    await userEvent.type(input, "colour");
    const before = optionTitles();
    expect(before.length).toBeGreaterThan(1);

    await userEvent.keyboard("{ArrowDown}");
    const active = screen.getByRole("option", { selected: true });
    expect(within(active).getByText(before[1]!)).toBeTruthy();
    expect(input.getAttribute("aria-activedescendant")).toBe(active.id);

    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("wraps around from the first row upwards", async () => {
    const { input } = setup();
    await userEvent.type(input, "colour");
    const titles = optionTitles();
    await userEvent.keyboard("{ArrowUp}");
    const active = screen.getByRole("option", { selected: true });
    expect(within(active).getByText(titles[titles.length - 1]!)).toBeTruthy();
  });

  it("highlights the first row by default, so Enter is never a coin toss", async () => {
    const { input } = setup();
    await userEvent.type(input, "colour");
    const active = screen.getByRole("option", { selected: true });
    expect(within(active).getByText(optionTitles()[0]!)).toBeTruthy();
  });

  it("clears the query on Escape and closes the list", async () => {
    const { input } = setup();
    await userEvent.type(input, "colour");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    await userEvent.keyboard("{Escape}");
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("empties itself once something is picked", async () => {
    const { input } = setup();
    await userEvent.type(input, "roundness{Enter}");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("keeps the combobox wiring honest", async () => {
    const { input } = setup();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBeNull();

    await userEvent.type(input, "roundness");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    // aria-activedescendant must name a row that is actually rendered.
    const active = input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toBeTruthy();
  });
});
