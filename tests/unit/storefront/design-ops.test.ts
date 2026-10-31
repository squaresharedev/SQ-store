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
