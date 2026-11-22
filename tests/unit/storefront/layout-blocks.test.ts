import { describe, expect, it } from "vitest";
import {
  defaultButtonLink,
  headerForSave,
  isFreelyArrangedAsDrawn,
  liveHeaderLinks,
  newButtonBlock,
  takesFine,
  withButtonPatch,
  withFine,
  withoutDeadLinks,
} from "@/lib/storefront/layout-blocks";
import { buttonBlockPaint, buttonInk } from "@/lib/storefront/button-paint";
import { contrastRatio } from "@/lib/format/color";
import {
  BUTTON_LABEL_MAX,
  isFreelyArranged,
  type ButtonBlock,
  type StorefrontBand,
  type StorefrontBlock,
} from "@/types/storefront";

const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const BAND = "33333333-3333-4333-8333-333333333333";
const band: StorefrontBand = { id: BAND, y: 0, h: 1, background: { kind: "solid", color: "#000000" } };
const product = (productId: string, x = 0, y = 0): StorefrontBlock => ({ type: "product", productId, x, y, w: 1, h: 1 });
const text = (id: string, x: number, y: number, w = 1, h = 1, fine?: object): StorefrontBlock => ({
  type: "text", id, text: "Hi", variant: "body", align: "left", x, y, w, h, ...(fine ? { fine } : {}),
});
const button = (link: ButtonBlock["link"]): ButtonBlock => ({ type: "button", id: "b", label: "Go", link, x: 0, y: 1, w: 2, h: 1 });

describe("half-cell insets on a block", () => {
  it("are carried by text, shapes and buttons, never by a product card", () => {
    expect(takesFine({ type: "text" })).toBe(true);
    expect(takesFine({ type: "button" })).toBe(true);
    expect(takesFine({ type: "product" })).toBe(false);
    expect(withFine(product(P), { left: true })).toEqual(product(P));
  });

  it("are set side by side, and the key dropped back to nothing on whole cells", () => {
    const placed = withFine(text("t", 0, 0), { right: true, bottom: true });
    expect(placed).toMatchObject({ fine: { right: true, bottom: true } });
    const back = withFine(placed, undefined);
    expect("fine" in back).toBe(false);
    expect(back).toEqual(text("t", 0, 0));
  });
});

describe("a new button", () => {
  it("is two cells wide and half a cell tall, with its words capped", () => {
    const block = newButtonBlock("id", { x: 1, y: 2, w: 2, h: 1 }, "x".repeat(99), { kind: "url", url: "https://e.example" });
    expect(block).toMatchObject({ type: "button", x: 1, y: 2, w: 2, h: 1, fine: { bottom: true } });
    expect(block.label).toHaveLength(BUTTON_LABEL_MAX);
  });

  it("leads to the board's first product, else its first band, else this storefront", () => {
    expect(defaultButtonLink([product(P, 1), product(Q, 0)], [band], "sf")).toEqual({ kind: "product", productId: Q });
    expect(defaultButtonLink([], [band], "sf")).toEqual({ kind: "band", bandId: BAND });
    expect(defaultButtonLink([], [], "sf")).toEqual({ kind: "storefront", storefrontId: "sf" });
  });

  it("drops its look back to absent at solid", () => {
    expect("look" in withButtonPatch({ ...button({ kind: "band", bandId: BAND }), look: "link" }, { look: "solid" })).toBe(false);
    expect(withButtonPatch(button({ kind: "band", bandId: BAND }), { look: "outline" }).look).toBe("outline");
  });
});

describe("links to things that have gone", () => {
  it("take their button with them, and leave every other board untouched", () => {
    const blocks = [product(P), button({ kind: "product", productId: Q }), text("t", 3, 3)];
    expect(withoutDeadLinks(blocks, [band])).toEqual([product(P), text("t", 3, 3)]);
    const fine = [product(P), button({ kind: "product", productId: P })];
    expect(withoutDeadLinks(fine, [])).toBe(fine);
    expect(withoutDeadLinks([button({ kind: "band", bandId: BAND })], [])).toEqual([]);
  });

  it("leave the header's menu at save, the menu key with them once empty", () => {
    const header = { show: true, name: "", bio: "", links: [{ label: "x", link: { kind: "product" as const, productId: Q } }] };
    expect(headerForSave(header, [product(P)], [])).toEqual({ show: true, name: "", bio: "" });
    const kept = { ...header, links: [{ label: "x", link: { kind: "url" as const, url: "https://e.example" } }] };
    expect(headerForSave(kept, [], [])).toBe(kept);
    expect(liveHeaderLinks(undefined, [], [])).toBeUndefined();
  });
});

describe("a board arranged freely, as drawn", () => {
  it("agrees with isFreelyArranged on every board without insets", () => {
    const boards: StorefrontBlock[][] = [
      [text("a", 0, 0, 2), text("b", 2, 0)],
      [text("a", 0, 0, 2), text("b", 1, 0)],
      [{ ...text("a", 0, 0), rotation: 4 }],
    ];
    for (const blocks of boards) expect(isFreelyArrangedAsDrawn(blocks)).toBe(isFreelyArranged(blocks));
  });

  it("does not count two halves of one row as a stack", () => {
    const halves = [text("top", 0, 0, 2, 1, { bottom: true }), text("bottom", 0, 0, 2, 1, { top: true })];
    expect(isFreelyArranged(halves)).toBe(true);
    expect(isFreelyArrangedAsDrawn(halves)).toBe(false);
  });
});

describe("a button's paint", () => {
  const cta = { fill: "#fde68a", text: "#171717", radius: 8, borderWidth: 0, borderColor: "#171717" };

  it("is the storefront's own button when solid", () => {
    expect(buttonBlockPaint("solid", cta, "#ffffff")).toMatchObject({ backgroundColor: "#fde68a", color: "#171717" });
  });

  it("keeps its colour in the words only where they read at AA on what is behind", () => {
    expect(buttonInk("#1c1917", "#ffffff")).toBe("#1c1917");
    const ink = buttonInk("#fde68a", "#ffffff");
    expect(contrastRatio(ink, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(buttonBlockPaint("outline", cta, "#ffffff")).toMatchObject({ color: ink });
    expect(buttonBlockPaint("link", cta, "#1c1917")).toEqual({ color: "#fde68a" });
  });
});
