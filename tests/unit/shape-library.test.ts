import { describe, expect, it } from "vitest";
import { SHAPE_KINDS } from "@/types/storefront";
import {
  QUICK_SHAPE_KINDS,
  SHAPE_GROUPS,
  SHAPE_SPECS,
} from "@/components/storefront/shape-specs";

/**
 * The browsable shape library.
 *
 * The catalogue lives in two places now — the left panel's grouped view and
 * the toolbar's short list — and neither is derived from SHAPE_KINDS at
 * runtime, so nothing but this file stops a kind added later from being
 * unreachable in the UI while still being perfectly valid in a config.
 */

describe("SHAPE_GROUPS — the panel's view of the library", () => {
  it("covers every shape kind exactly once", () => {
    const grouped = SHAPE_GROUPS.flatMap((group) => group.kinds);
    expect([...grouped].sort()).toEqual([...SHAPE_KINDS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("names every group and leaves none empty", () => {
    for (const group of SHAPE_GROUPS) {
      expect(group.title.trim().length).toBeGreaterThan(0);
      expect(group.kinds.length).toBeGreaterThan(0);
    }
  });

  it("every grouped kind has a label to render", () => {
    for (const group of SHAPE_GROUPS) {
      for (const kind of group.kinds) {
        expect(SHAPE_SPECS[kind]?.label, kind).toBeTruthy();
      }
    }
  });
});

describe("QUICK_SHAPE_KINDS — the toolbar's short list", () => {
  it("is a subset of the real catalogue", () => {
    for (const kind of QUICK_SHAPE_KINDS) {
      expect(SHAPE_KINDS, kind).toContain(kind);
    }
  });

  it("holds no duplicates", () => {
    expect(new Set(QUICK_SHAPE_KINDS).size).toBe(QUICK_SHAPE_KINDS.length);
  });

  it("stays short enough to keep the menu one row tall", () => {
    // The menu is a single row: upload, the library, and these. Growing this
    // list is how it creeps back toward the overflowing strip that moving the
    // library into the panel was meant to end.
    expect(QUICK_SHAPE_KINDS.length).toBeLessThanOrEqual(2);
  });
});
