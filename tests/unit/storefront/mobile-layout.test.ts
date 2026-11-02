// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyDesignOps, boardSummary, phoneSummary, type DesignOp } from "@/lib/storefront/design-ops";
import { phoneLayout } from "@/lib/storefront/mobile-layout";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontBlock, type StorefrontConfig } from "@/types/storefront";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const tile = (productId: string, x: number, y: number, w = 1, h = 1): StorefrontBlock => ({ type: "product", productId, x, y, w, h });
const theme = DEFAULT_STOREFRONT_CONFIG.theme; // 6 x 6

function board(blocks: StorefrontBlock[], mobileColumns?: number): StorefrontConfig {
  return { ...DEFAULT_STOREFRONT_CONFIG, theme: { ...theme, ...(mobileColumns ? { mobileColumns } : {}) }, blocks };
}

const spot = (config: StorefrontConfig, id: string) =>
  phoneLayout(config.theme, config.blocks)?.placed.find((placed) => placed.block.type === "product" && placed.block.productId === id);

describe("the phone board", () => {
  it("does not exist until the board asks for one: nothing changes for a board without it", () => {
    expect(phoneLayout(theme, [tile(A, 0, 0)])).toBeNull();
  });

  it("pins a block with a phone rect, and places the rest around it in reading order", () => {
    const config = board([tile(A, 0, 0, 2, 2), { ...tile(B, 2, 0), mobile: { x: 0, y: 0, w: 2, h: 1 } }, tile(C, 3, 0)], 2);
    expect(spot(config, B)).toMatchObject({ x: 0, y: 0, w: 2, h: 1, pinned: true });
    // A is 2x2 on a 6-wide board: a third of the width, so 1 column of 2, placed below B.
    expect(spot(config, A)).toMatchObject({ pinned: false, y: 1 });
    expect(spot(config, C)?.pinned).toBe(false);
    const cells = phoneLayout(config.theme, config.blocks)!.placed.flatMap((placed) => {
      const out: string[] = [];
      for (let y = placed.y; y < placed.y + placed.h; y += 1) for (let x = placed.x; x < placed.x + placed.w; x += 1) out.push(`${x},${y}`);
      return out;
    });
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("leaves a hidden block off phones only", () => {
    const config = board([tile(A, 0, 0), { ...tile(B, 1, 0), mobile: { x: 0, y: 0, w: 1, h: 1, hidden: true } }], 4);
    const layout = phoneLayout(config.theme, config.blocks)!;
    expect(layout.hidden.map((block) => block.type === "product" && block.productId)).toEqual([B]);
    expect(layout.placed).toHaveLength(1);
    expect(config.blocks).toHaveLength(2);
  });

  it("clamps a rect onto a narrower phone board rather than losing the block", () => {
    const config = board([{ ...tile(A, 0, 0), mobile: { x: 5, y: 0, w: 3, h: 1 } }], 2);
    expect(spot(config, A)).toMatchObject({ x: 0, w: 2 });
  });
});

describe("what a phone shows, in words", () => {
  it("says a board that fits is drawn as it is", () => {
    const config = { ...board([tile(A, 0, 0)]), theme: { ...theme, columns: 3 } };
    expect(phoneSummary(config)).toMatchObject({ layout: "same" });
  });

  it("says a six-column board reflows, and where its blocks land", () => {
    const summary = phoneSummary(board([tile(A, 0, 0, 6, 1), tile(B, 0, 1)]));
    expect(summary).toMatchObject({ layout: "reflow" });
    expect(summary.layout === "reflow" && summary.blocks.map((block) => block.block)).toEqual([A, B]);
  });

  it("says a tilted or stacked board is shrunk whole", () => {
    expect(phoneSummary(board([{ ...tile(A, 0, 0), rotation: 10 }]))).toMatchObject({ layout: "scaled" });
  });

  it("describes a board's own phone layout", () => {
    const summary = boardSummary(board([{ ...tile(A, 0, 0), mobile: { x: 1, y: 2, w: 1, h: 1 } }, tile(B, 1, 0)], 2)).phone;
    expect(summary).toMatchObject({ layout: "own", columns: 2 });
    expect(summary.layout === "own" && summary.blocks.find((block) => block.block === A)).toMatchObject({ x: 1, y: 2 });
    expect(summary.layout === "own" && summary.blocks.find((block) => block.block === B)).toMatchObject({ placedAutomatically: true });
  });
});

describe("editing the phone board", () => {
  const run = (ops: DesignOp[], config: StorefrontConfig) => {
    const result = applyDesignOps(config, ops);
    return { ...result, valid: storefrontConfigSchema.safeParse(result.config).success };
  };
  const found = (config: StorefrontConfig, id: string) =>
    config.blocks.find((block) => block.type === "product" && block.productId === id)!;

  it("a phone move starts a phone layout and leaves the desktop board alone", () => {
    const { config, valid } = run([{ op: "move", block: A, x: 0, y: 3, viewport: "mobile" }], board([tile(A, 4, 0, 2, 2)]));
    expect(valid).toBe(true);
    expect(config.theme.mobileColumns).toBe(4);
    expect(found(config, A)).toMatchObject({ x: 4, y: 0, w: 2, h: 2, mobile: { x: 0, y: 3 } });
  });

  it("a phone resize keeps the block where the phone already had it", () => {
    const { config } = run([{ op: "resize", block: A, w: 3, h: 1, viewport: "mobile" }], board([tile(A, 0, 0)], 4));
    expect(found(config, A).mobile).toEqual({ x: 0, y: 0, w: 3, h: 1 });
  });

  it("a phone remove hides the block on phones and keeps it on the board", () => {
    const { config, valid } = run([{ op: "remove", block: A, viewport: "mobile" }], board([tile(A, 0, 0), tile(B, 1, 0)], 4));
    expect(valid).toBe(true);
    expect(config.blocks).toHaveLength(2);
    expect(found(config, A).mobile?.hidden).toBe(true);
  });

  it("mobile_reset hands a block back to automatic placement", () => {
    const { config } = run([{ op: "mobile_reset", block: A }], board([{ ...tile(A, 0, 0), mobile: { x: 1, y: 1, w: 1, h: 1 } }], 4));
    expect(found(config, A)).not.toHaveProperty("mobile");
  });

  it("a desktop move does not touch the phone rect", () => {
    const { config } = run([{ op: "move", block: A, x: 2, y: 2 }], board([{ ...tile(A, 0, 0), mobile: { x: 1, y: 1, w: 1, h: 1 } }], 4));
    expect(found(config, A)).toMatchObject({ x: 2, y: 2, mobile: { x: 1, y: 1 } });
  });

  it("dropping mobileColumns drops the phone layout and keeps the rects, inert", () => {
    const { config, valid } = run([{ op: "theme", changes: { mobileColumns: null } }], board([{ ...tile(A, 0, 0), mobile: { x: 1, y: 1, w: 1, h: 1 } }], 4));
    expect(valid).toBe(true);
    expect(config.theme).not.toHaveProperty("mobileColumns");
    expect(phoneLayout(config.theme, config.blocks)).toBeNull();
  });
});

describe("the schema holds a phone layout to the same standard", () => {
  const parses = (config: StorefrontConfig) => storefrontConfigSchema.safeParse(config).success;

  it("takes a phone width between 2 and 6 columns only", () => {
    expect(parses(board([], 2))).toBe(true);
    expect(parses(board([], 6))).toBe(true);
    expect(parses({ ...board([]), theme: { ...theme, mobileColumns: 1 } })).toBe(false);
    expect(parses({ ...board([]), theme: { ...theme, mobileColumns: 7 } })).toBe(false);
    expect(parses({ ...board([]), theme: { ...theme, mobileColumns: 2.5 } })).toBe(false);
  });

  it("refuses a phone rect off the phone board, and anything that is not a bounded integer", () => {
    expect(parses(board([{ ...tile(A, 0, 0), mobile: { x: 3, y: 0, w: 2, h: 1 } }], 4))).toBe(false);
    expect(parses(board([{ ...tile(A, 0, 0), mobile: { x: 0, y: 0, w: 1.5, h: 1 } }], 4))).toBe(false);
    expect(parses(board([{ ...tile(A, 0, 0), mobile: { x: 0, y: -1, w: 1, h: 1 } }], 4))).toBe(false);
    const extra = { ...tile(A, 0, 0), mobile: { x: 0, y: 0, w: 1, h: 1, css: "display:none" } } as unknown as StorefrontBlock;
    expect(parses(board([extra], 4))).toBe(false);
  });

  it("parses every board saved before phone layouts existed, untouched", () => {
    const old = board([tile(A, 0, 0), tile(B, 1, 0)]);
    const parsed = storefrontConfigSchema.parse(old);
    expect(parsed.theme).not.toHaveProperty("mobileColumns");
    expect(parsed.blocks.every((block) => !("mobile" in block))).toBe(true);
  });
});
