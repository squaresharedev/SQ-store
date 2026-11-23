// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DesignOpRefused, applyDesignOps, boardSummary, designOpSchema, type DesignOp } from "@/lib/storefront/design-ops";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontBlock, type StorefrontConfig } from "@/types/storefront";

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHAPE = "33333333-3333-4333-8333-333333333333";
const TEXT = "44444444-4444-4444-8444-444444444444";

const shape: StorefrontBlock = { type: "shape", id: SHAPE, kind: "square", color: "#111111", x: 0, y: 0, w: 1, h: 1 };
const text: StorefrontBlock = { type: "text", id: TEXT, text: "Hello", variant: "heading", align: "left", x: 1, y: 0, w: 2, h: 1 };
const tile: StorefrontBlock = { type: "product", productId: PRODUCT, x: 3, y: 0, w: 1, h: 1 };

function board(blocks: StorefrontBlock[] = [shape, text, tile]): StorefrontConfig {
  return { ...DEFAULT_STOREFRONT_CONFIG, blocks };
}

let minted = 0;
const mint = () => `55555555-5555-4555-8555-${String((minted += 1)).padStart(12, "0")}`;

function run(ops: DesignOp[], config = board()) {
  const result = applyDesignOps(config, ops, mint);
  // Whatever comes out has to be something the real save would take.
  const parsed = storefrontConfigSchema.safeParse(result.config);
  return { ...result, valid: parsed.success };
}

const found = (config: StorefrontConfig, id: string) =>
  config.blocks.find((block) => (block.type === "product" ? block.productId : block.id) === id)!;

describe("changing what is on a board", () => {
  it("moves a product and an element, touching nothing else", () => {
    const { config, valid } = run([
      { op: "move", block: PRODUCT, x: 5, y: 2 },
      { op: "move", block: SHAPE, x: 2, y: 3 },
    ]);
    expect(valid).toBe(true);
    expect(found(config, PRODUCT)).toEqual({ ...tile, x: 5, y: 2 });
    expect(found(config, SHAPE)).toEqual({ ...shape, x: 2, y: 3 });
    expect(found(config, TEXT)).toBe(text);
  });

  it("changes a shape's kind and color, and null clears a field", () => {
    const { config, valid } = run([
      { op: "style", block: SHAPE, changes: { kind: "star", color: "#ff0000", points: 7, opacity: 50 } },
      { op: "style", block: SHAPE, changes: { opacity: null } },
    ]);
    expect(valid).toBe(true);
    expect(found(config, SHAPE)).toEqual({ ...shape, kind: "star", color: "#ff0000", points: 7 });
  });

  it("restyles text", () => {
    const { config } = run([{ op: "style", block: TEXT, changes: { text: "Sale", color: "#00ff00", fontSize: 40, bold: true } }]);
    expect(found(config, TEXT)).toMatchObject({ text: "Sale", color: "#00ff00", fontSize: 40, bold: true });
  });

  it("keeps a product tile's look as an override of the theme, and drops it when emptied", () => {
    const styled = run([{ op: "style", block: PRODUCT, changes: { cornerRadius: 24, priceTagColor: "#123456" } }]);
    expect(styled.valid).toBe(true);
    expect(found(styled.config, PRODUCT)).toMatchObject({ style: { cornerRadius: 24, priceTagColor: "#123456" } });

    const cleared = run(
      [{ op: "style", block: PRODUCT, changes: { cornerRadius: null, priceTagColor: null } }],
      styled.config,
    );
    expect(found(cleared.config, PRODUCT)).toEqual(tile);
  });

  it("frames a product tile's photo beside its look, not inside it", () => {
    const placement = { x: 10, y: 20, scale: 150 };
    const { config, valid } = run([{ op: "style", block: PRODUCT, changes: { imagePlacement: placement } }]);
    expect(valid).toBe(true);
    expect(found(config, PRODUCT)).toEqual({ ...tile, imagePlacement: placement });
  });

  it("resizes and turns, and level means no rotation key at all", () => {
    const { config, valid } = run([
      { op: "resize", block: SHAPE, w: 2, h: 3 },
      { op: "rotate", block: TEXT, degrees: 15 },
    ]);
    expect(valid).toBe(true);
    expect(found(config, SHAPE)).toMatchObject({ w: 2, h: 3, x: 0, y: 0 });
    expect(found(config, TEXT)).toMatchObject({ rotation: 15 });
    const level = run([{ op: "rotate", block: TEXT, degrees: 0 }], config);
    expect(found(level.config, TEXT)).not.toHaveProperty("rotation");
  });

  it("layers through the same rules as the designer", () => {
    const { config } = run([{ op: "layer", block: SHAPE, to: "front" }]);
    const order = boardSummary(config).blocks.map((block) => block.block);
    expect(order[order.length - 1]).toBe(SHAPE);
  });

  it("removes", () => {
    const { config } = run([{ op: "remove", block: SHAPE }]);
    expect(config.blocks.map((block) => block.type)).toEqual(["text", "product"]);
  });

  it("changes the board's colours and size, and the masthead", () => {
    const { config, valid } = run([
      { op: "theme", changes: { accent: "#ff00ff", background: { kind: "gradient", from: "#000000", to: "#ffffff", angle: 90 }, rows: 8 } },
      { op: "header", changes: { name: "My shop", nameColor: "#222222" } },
    ]);
    expect(valid).toBe(true);
    expect(config.theme).toMatchObject({ accent: "#ff00ff", rows: 8, background: { kind: "gradient" } });
    expect(config.header).toMatchObject({ name: "My shop", nameColor: "#222222" });
  });
});

describe("adding to a board", () => {
  it("takes the next free cells unless told where, and says what it added", () => {
    const { config, added, valid } = run([
      { op: "add_shape", kind: "circle" },
      { op: "add_text", text: "New", x: 4, y: 4, w: 2, h: 1 },
      { op: "add_product", productId: OTHER },
    ]);
    expect(valid).toBe(true);
    expect(added).toHaveLength(3);
    expect(found(config, added[0])).toMatchObject({ kind: "circle", x: 4, y: 0, color: DEFAULT_STOREFRONT_CONFIG.theme.accent });
    expect(found(config, added[1])).toMatchObject({ text: "New", x: 4, y: 4, variant: "heading", align: "left" });
    expect(found(config, added[2])).toMatchObject({ productId: OTHER, x: 5, y: 0 });
  });

  it("lets a later step in the list work on what an earlier one placed", () => {
    const first = run([{ op: "add_shape", kind: "circle" }]);
    const next = run([{ op: "move", block: first.added[0], x: 2, y: 2 }], first.config);
    expect(found(next.config, first.added[0])).toMatchObject({ x: 2, y: 2 });
  });

  it("grows the board by a row rather than stacking on a full one", () => {
    const full = { ...board([]), theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, columns: 3, rows: 2 } };
    const filled = run(Array.from({ length: 6 }, (): DesignOp => ({ op: "add_shape", kind: "square" })), full);
    expect(filled.config.theme.rows).toBe(2);
    const { config, added, valid } = run([{ op: "add_shape", kind: "circle" }], filled.config);
    expect(valid).toBe(true);
    expect(config.theme.rows).toBe(3);
    expect(found(config, added[0])).toMatchObject({ x: 0, y: 2 });
  });

  it("puts a new block on top of a board that is already layered, with a dense z", () => {
    const layered = run([{ op: "layer", block: SHAPE, to: "front" }]).config;
    const { config, added, valid } = run([{ op: "add_shape", kind: "circle", x: 0, y: 0 }], layered);
    expect(valid).toBe(true);
    const order = boardSummary(config).blocks.map((block) => block.block);
    expect(order[order.length - 1]).toBe(added[0]);
    expect(config.blocks.map((block) => block.z).sort()).toEqual([0, 1, 2, 3]);
  });

  it("places artwork by the file it was given", () => {
    const { config, added } = run([{ op: "add_image", file: "elements/some-key.svg", alt: "Logo" }]);
    expect(found(config, added[0])).toMatchObject({ type: "image", key: "elements/some-key.svg", alt: "Logo" });
  });
});

describe("what it refuses", () => {
  it("a block that is not there, with the way to find one", () => {
    expect(() => run([{ op: "move", block: "nope", x: 0, y: 0 }])).toThrow(DesignOpRefused);
  });

  it("a product already on the board", () => {
    expect(() => run([{ op: "add_product", productId: PRODUCT }])).toThrow(/already on this storefront/);
  });

  it.each(["x", "w", "rotation", "z", "type", "id", "productId", "key"])("%s through a style change", (field) => {
    expect(() => run([{ op: "style", block: SHAPE, changes: { [field]: 1 } }])).toThrow(DesignOpRefused);
  });

  it("leaves the config it was given alone, so a refused list changes nothing", () => {
    const config = board();
    const before = JSON.stringify(config);
    expect(() =>
      run([{ op: "move", block: SHAPE, x: 5, y: 5 }, { op: "move", block: "nope", x: 0, y: 0 }], config),
    ).toThrow(DesignOpRefused);
    expect(JSON.stringify(config)).toBe(before);
  });

  it("leaves the limits to the real schema: off the board, a bad colour, a field that does not exist", () => {
    expect(run([{ op: "move", block: SHAPE, x: 40, y: 0 }]).valid).toBe(false);
    expect(run([{ op: "style", block: SHAPE, changes: { color: "red" } }]).valid).toBe(false);
    expect(run([{ op: "style", block: SHAPE, changes: { html: "<b>" } }]).valid).toBe(false);
    expect(run([{ op: "style", block: PRODUCT, changes: { soldOut: true } }]).valid).toBe(false);
    expect(run([{ op: "theme", changes: { accent: null } }]).valid).toBe(false);
  });
});

describe("the operations as an assistant sends them", () => {
  it("are refused when they carry anything unknown", () => {
    expect(designOpSchema.safeParse({ op: "move", block: SHAPE, x: 1, y: 1, extra: true }).success).toBe(false);
    expect(designOpSchema.safeParse({ op: "teleport", block: SHAPE }).success).toBe(false);
    expect(designOpSchema.safeParse({ op: "add_shape", kind: "blob" }).success).toBe(false);
  });
});

describe("the summary it answers with", () => {
  it("names files by nothing at all", () => {
    const image: StorefrontBlock = { type: "image", id: TEXT, key: "elements/secret-key.svg", alt: "", x: 0, y: 0, w: 1, h: 1 };
    expect(JSON.stringify(boardSummary(board([image])))).not.toContain("secret-key");
  });
});

// ── The editor upgrade's operations (EDITOR UPGRADE CONTRACT) ─────────────

const BAND = "66666666-6666-4666-8666-666666666666";
const PHOTO = `images/${PRODUCT}/${OTHER}-hills.jpg`;
const ARTWORK = `elements/${PRODUCT}/${OTHER}-logo.svg`;

const bandOf = (config: StorefrontConfig, id: string) => config.bands?.find((band) => band.id === id);

describe("buttons, scrolling text and carousels", () => {
  it("adds a button that leads to a product on the board, and drops the default look", () => {
    const { config, added, valid } = run([
      { op: "add_button", label: "Shop the lamp", link: { kind: "product", productId: PRODUCT }, x: 0, y: 2 },
      { op: "add_button", label: "Read more", link: { kind: "url", url: "https://example.com/story" }, look: "outline" },
    ]);
    expect(valid).toBe(true);
    expect(found(config, added[0])).toEqual({
      type: "button",
      id: added[0],
      label: "Shop the lamp",
      link: { kind: "product", productId: PRODUCT },
      x: 0,
      y: 2,
      w: 2,
      h: 1,
    });
    expect(found(config, added[1])).toMatchObject({ look: "outline", w: 2, h: 1 });
  });

  it("refuses a link to a product the board does not show, saying which button and how to fix it", () => {
    expect(() => run([{ op: "add_button", label: "Go", link: { kind: "product", productId: OTHER } }])).toThrow(
      /The button "Go".*not on this storefront/,
    );
    // Putting the product on the board in the same list is the fix: as a
    // tile, or in a carousel.
    const fixed = run([
      { op: "add_product", productId: OTHER },
      { op: "add_button", label: "Go", link: { kind: "product", productId: OTHER } },
    ]);
    expect(fixed.valid).toBe(true);
    const inCarousel = run([
      { op: "add_carousel", productIds: [OTHER] },
      { op: "add_button", label: "Go", link: { kind: "product", productId: OTHER } },
    ]);
    expect(inCarousel.valid).toBe(true);
  });

  it("refuses removing the product a button leads to, naming the button", () => {
    const linked = run([{ op: "add_button", label: "Buy", link: { kind: "product", productId: PRODUCT } }]).config;
    expect(() => run([{ op: "remove", block: PRODUCT }], linked)).toThrow(/The button "Buy"/);
  });

  it("lays scrolling text across the board's full width", () => {
    const { config, added, valid } = run([{ op: "add_marquee", text: "Free delivery this week", speed: "normal" }]);
    expect(valid).toBe(true);
    expect(found(config, added[0])).toEqual({ type: "marquee", id: added[0], text: "Free delivery this week", x: 0, y: 1, w: 6, h: 1 });
  });

  it("lays a carousel across the board's full width, two rows tall, in the order given", () => {
    const { config, added, valid } = run([{ op: "add_carousel", productIds: [OTHER, PRODUCT] }]);
    expect(valid).toBe(true);
    expect(found(config, added[0])).toEqual({ type: "carousel", id: added[0], productIds: [OTHER, PRODUCT], x: 0, y: 1, w: 6, h: 2 });
    expect(boardSummary(config).blocks.find((block) => block.block === added[0])).toMatchObject({ productIds: [OTHER, PRODUCT] });
    // A size of its own is kept.
    const narrow = run([{ op: "add_carousel", productIds: [PRODUCT], x: 1, y: 3, w: 4, h: 1 }]);
    expect(found(narrow.config, narrow.added[0])).toMatchObject({ x: 1, y: 3, w: 4, h: 1 });
  });

  it("changes a carousel's products with style, and refuses none, a repeat or too many in words", () => {
    const first = run([{ op: "add_carousel", productIds: [PRODUCT] }]);
    const id = first.added[0];
    const changed = run([{ op: "style", block: id, changes: { productIds: [OTHER, PRODUCT] } }], first.config);
    expect(changed.valid).toBe(true);
    expect(found(changed.config, id)).toMatchObject({ productIds: [OTHER, PRODUCT] });
    expect(() => run([{ op: "style", block: id, changes: { productIds: [] } }], first.config)).toThrow(/needs a list/);
    expect(() => run([{ op: "style", block: id, changes: { productIds: [PRODUCT, PRODUCT] } }], first.config)).toThrow(/each product once/);
    expect(() => run([{ op: "add_carousel", productIds: [PRODUCT, PRODUCT] }])).toThrow(/each product once/);
    const many = Array.from({ length: 13 }, (_, n) => `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`);
    expect(designOpSchema.safeParse({ op: "add_carousel", productIds: many }).success).toBe(false);
    expect(() => run([{ op: "style", block: id, changes: { productIds: many } }], first.config)).toThrow(/at most 12/);
  });

  it("refuses taking a product out of a carousel while a button still leads to it", () => {
    const linked = run([
      { op: "add_carousel", productIds: [OTHER, PRODUCT] },
      { op: "add_button", label: "Buy", link: { kind: "product", productId: OTHER } },
    ]);
    const id = linked.added[0];
    expect(() => run([{ op: "style", block: id, changes: { productIds: [PRODUCT] } }], linked.config)).toThrow(/The button "Buy"/);
  });

  it("restyles the new kinds through style, like any block", () => {
    const first = run([{ op: "add_button", label: "Go", link: { kind: "url", url: "https://example.com" } }]);
    const { config, valid } = run(
      [{ op: "style", block: first.added[0], changes: { label: "Visit", look: "link", link: { kind: "url", url: "https://example.org" } } }],
      first.config,
    );
    expect(valid).toBe(true);
    expect(found(config, first.added[0])).toMatchObject({ label: "Visit", look: "link", link: { url: "https://example.org" } });
  });
});

describe("bands", () => {
  it("adds one behind rows in the palette's muted colour, and says so in the summary", () => {
    const { config, added, valid } = run([{ op: "add_band", y: 1, h: 2 }]);
    expect(valid).toBe(true);
    const band = bandOf(config, added[0])!;
    expect(band).toMatchObject({ y: 1, h: 2, background: { kind: "solid" } });
    expect(boardSummary(config).bands).toEqual([{ band: added[0], y: 1, h: 2, background: band.background }]);
  });

  it("takes the assistant's own id, so a button in the same list can lead to it", () => {
    const { config, valid } = run([
      { op: "add_band", id: BAND, y: 3, h: 2, background: { from: "#112233", to: "#445566" } },
      { op: "add_button", label: "See the story", link: { kind: "band", bandId: BAND } },
    ]);
    expect(valid).toBe(true);
    expect(bandOf(config, BAND)?.background).toEqual({ kind: "gradient", from: "#112233", to: "#445566", angle: 180 });
  });

  it("edits a photo band in place: a change without a kind lays over what it had", () => {
    const photo = run([{ op: "add_band", id: BAND, y: 0, h: 2, background: { file: PHOTO } }]);
    expect(photo.valid).toBe(true);
    expect(bandOf(photo.config, BAND)?.background).toEqual({ kind: "image", key: PHOTO, x: 50, y: 50, scale: 100 });
    const dimmed = run([{ op: "edit_band", band: BAND, h: 3, background: { dim: "dark", y: 30 } }], photo.config);
    expect(dimmed.valid).toBe(true);
    expect(bandOf(dimmed.config, BAND)).toEqual({
      id: BAND,
      y: 0,
      h: 3,
      background: { kind: "image", key: PHOTO, x: 50, y: 30, scale: 100, dim: "dark" },
    });
    // The summary never names the photo's key.
    expect(JSON.stringify(boardSummary(dimmed.config))).not.toContain(PHOTO);
    const plain = run([{ op: "edit_band", band: BAND, background: { kind: "solid", color: "#abcdef" } }], dimmed.config);
    expect(bandOf(plain.config, BAND)?.background).toEqual({ kind: "solid", color: "#abcdef" });
  });

  it("refuses artwork as a band photo, and a photo band with no photo", () => {
    expect(() => run([{ op: "add_band", y: 0, h: 1, background: { file: ARTWORK } }])).toThrow(/uploaded as artwork/);
    expect(() => run([{ op: "add_band", y: 0, h: 1, background: { kind: "image" } }])).toThrow(DesignOpRefused);
  });

  it("removes one, and a storefront left with none has no bands member at all", () => {
    const one = run([{ op: "add_band", id: BAND, y: 0, h: 1 }]).config;
    const none = run([{ op: "remove_band", band: BAND }], one).config;
    expect(none).not.toHaveProperty("bands");
    expect(() => run([{ op: "edit_band", band: BAND, h: 2 }], none)).toThrow(/no band/);
  });

  it("refuses removing a band a button leads to", () => {
    const linked = run([
      { op: "add_band", id: BAND, y: 0, h: 1 },
      { op: "add_button", label: "Down", link: { kind: "band", bandId: BAND } },
    ]).config;
    expect(() => run([{ op: "remove_band", band: BAND }], linked)).toThrow(/The button "Down" .*band/);
  });

  it("leaves a band off the board to the real schema", () => {
    expect(run([{ op: "add_band", y: 5, h: 3 }]).valid).toBe(false);
  });
});

describe("the palette", () => {
  /** A board whose accent is its own colour (on the default board the accent
   *  and the derived text colour are one hex, which recolourPalette leaves be). */
  const accented = (blocks: StorefrontBlock[]): StorefrontConfig => ({
    ...board(blocks),
    theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, accent: "#c2410c" },
  });

  it("recolours everything painted in a colour, and stores the palette", () => {
    const painted = accented([{ ...shape, color: "#c2410c" }, text, tile]);
    const { config, valid } = run([{ op: "palette", colors: { accent: "#b45309" } }], painted);
    expect(valid).toBe(true);
    expect(found(config, SHAPE)).toMatchObject({ color: "#b45309" });
    expect(config.theme.accent).toBe("#b45309");
    expect(config.theme.palette).toMatchObject({ accent: "#b45309" });
    expect(boardSummary(config)).not.toHaveProperty("paletteDerived");
  });

  it("turns a light board dark without merging the two colours", () => {
    const light: StorefrontConfig = {
      ...board([
        { ...shape, color: "#111111" },
        { ...text, color: "#fafafa" },
      ]),
      theme: {
        ...DEFAULT_STOREFRONT_CONFIG.theme,
        background: { kind: "solid", color: "#fafafa" },
        palette: { background: "#fafafa", text: "#111111", accent: "#c2410c", surface: "#ffffff", muted: "#e5e5e5" },
      },
    };
    const { config, valid } = run([{ op: "palette", colors: { background: "#111111", text: "#fafafa" } }], light);
    expect(valid).toBe(true);
    expect(config.theme.background).toEqual({ kind: "solid", color: "#111111" });
    expect(found(config, SHAPE)).toMatchObject({ color: "#fafafa" });
    expect(found(config, TEXT)).toMatchObject({ color: "#111111" });
    expect(config.theme.palette).toMatchObject({ background: "#111111", text: "#fafafa" });
  });

  it("recolours a palette given as a theme change, the same way", () => {
    const painted = accented([{ ...shape, color: "#c2410c" }]);
    const { config } = run([{ op: "theme", changes: { palette: { accent: "#0e7490" }, gridGap: 12 } }], painted);
    expect(found(config, SHAPE)).toMatchObject({ color: "#0e7490" });
    expect(config.theme).toMatchObject({ gridGap: 12, palette: { accent: "#0e7490" } });
  });

  it("says when a board's palette is still derived from what it wears", () => {
    expect(boardSummary(board())).toMatchObject({ paletteDerived: true, palette: { accent: DEFAULT_STOREFRONT_CONFIG.theme.accent } });
  });

  it("refuses a colour that is not one, and a slot that does not exist", () => {
    expect(() => run([{ op: "palette", colors: { accent: "orange" } }])).toThrow(/must be a colour/);
    expect(() => run([{ op: "theme", changes: { palette: { primary: "#000000" } } }])).toThrow(/no "primary"/);
  });
});

describe("half cells", () => {
  it("places small text between cells as insets of whole ones", () => {
    const { config, added, valid } = run([{ op: "add_text", text: "New", x: 2.5, y: 3, w: 1, h: 0.5 }]);
    expect(valid).toBe(true);
    expect(found(config, added[0])).toMatchObject({ x: 2, y: 3, w: 2, h: 1, fine: { left: true, right: true, bottom: true } });
    // And reads back where it is drawn.
    expect(boardSummary(config).blocks.find((block) => block.block === added[0])).toMatchObject({ x: 2.5, y: 3, w: 1, h: 0.5 });
  });

  it("moves a block on half cells and keeps its drawn size, back to no insets on whole cells", () => {
    const half = run([{ op: "move", block: SHAPE, x: 0.5, y: 1 }]);
    expect(half.valid).toBe(true);
    expect(found(half.config, SHAPE)).toMatchObject({ x: 0, y: 1, w: 2, h: 1, fine: { left: true, right: true } });
    const whole = run([{ op: "move", block: SHAPE, x: 3, y: 2 }], half.config);
    expect(found(whole.config, SHAPE)).toEqual({ ...shape, x: 3, y: 2 });
  });

  it("resizes to half a cell, from where the block is drawn", () => {
    const { config, valid } = run([{ op: "resize", block: TEXT, w: 1.5, h: 1 }]);
    expect(valid).toBe(true);
    expect(found(config, TEXT)).toMatchObject({ x: 1, w: 2, fine: { right: true } });
  });

  it("refuses half cells for a product, on the phone, and insets through a style change", () => {
    expect(() => run([{ op: "move", block: PRODUCT, x: 1.5, y: 0 }])).toThrow(/whole cells/);
    expect(() => run([{ op: "add_product", productId: OTHER, x: 0.5, y: 2 }])).toThrow(/whole cells/);
    expect(() => run([{ op: "move", block: TEXT, x: 1.5, y: 0, viewport: "mobile" }])).toThrow(/phone board/);
    expect(() => run([{ op: "style", block: TEXT, changes: { fine: { left: true } } }])).toThrow(DesignOpRefused);
    expect(() => run([{ op: "move", block: TEXT, x: 1.3, y: 0 }])).toThrow(/whole or half cells/);
    expect(() => run([{ op: "resize", block: TEXT, w: 0, h: 1 }])).toThrow(/cannot be that small/);
  });
});

describe("presets a new block wears from the start", () => {
  it("gives a new image its outline and shadow, and a new shape its gradient", () => {
    const { config, added, valid } = run([
      { op: "add_image", file: ARTWORK, shape: "arch", shadow: "soft" },
      { op: "add_shape", kind: "circle", gradient: { from: "#112233", to: "#445566", angle: 90 }, shadow: "lifted" },
    ]);
    expect(valid).toBe(true);
    expect(found(config, added[0])).toMatchObject({ shape: "arch", shadow: "soft" });
    expect(found(config, added[1])).toMatchObject({ gradient: { from: "#112233", to: "#445566", angle: 90 }, shadow: "lifted" });
  });
});

describe("text that starts from a saved style", () => {
  it("is a headline on a few words and body on a sentence, unless named", () => {
    const { config, added } = run([
      { op: "add_text", text: "Autumn" },
      { op: "add_text", text: "Every piece is turned by hand in our workshop and finished with oil." },
      { op: "add_text", text: "Small print", variant: "label", valign: "bottom" },
    ]);
    expect(found(config, added[0])).toMatchObject({ variant: "heading" });
    expect(found(config, added[1])).toMatchObject({ variant: "body" });
    expect(found(config, added[2])).toMatchObject({ variant: "label", valign: "bottom" });
    expect(found(config, added[0])).not.toHaveProperty("fontSize");
  });

  it("sets where the words sit through style", () => {
    const { config, valid } = run([{ op: "style", block: TEXT, changes: { valign: "top" } }]);
    expect(valid).toBe(true);
    expect(found(config, TEXT)).toMatchObject({ valign: "top" });
  });
});

describe("the header's logo and menu", () => {
  it("takes the logo by its file, and checks where the menu leads", () => {
    const { config, valid } = run([
      {
        op: "header",
        changes: { logo: { file: ARTWORK, size: "small" }, links: [{ label: "Lamp", link: { kind: "product", productId: PRODUCT } }] },
      },
    ]);
    expect(valid).toBe(true);
    expect(config.header).toMatchObject({ logo: { key: ARTWORK, size: "small" } });
    expect(() =>
      run([{ op: "header", changes: { links: [{ label: "About", link: { kind: "band", bandId: BAND } }] } }]),
    ).toThrow(/The header link "About"/);
    expect(() => run([{ op: "header", changes: { logo: { file: PHOTO } } }])).toThrow(/uploaded as a photo/);
  });
});

describe("a storefront the upgrade's operations never touch", () => {
  it("keeps exactly the members it had: no bands, no palette, no insets", () => {
    const legacy = board();
    const { config } = run([{ op: "move", block: PRODUCT, x: 4, y: 1 }], legacy);
    expect(Object.keys(config).sort()).toEqual(Object.keys(legacy).sort());
    expect(config.theme).toBe(legacy.theme);
    expect(found(config, TEXT)).toBe(text);
  });
});
