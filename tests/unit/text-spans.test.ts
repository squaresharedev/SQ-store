import { describe, expect, it } from "vitest";
import {
  applyFormatToRange,
  normalizeSpans,
  rangeColor,
  rangeHasFormat,
  segmentText,
  toggleFormatPatch,
} from "@/lib/storefront/text-spans";
import type { TextBlock, TextSpan } from "@/types/storefront";

/**
 * Part-by-part formatting on a text block. The contract these guard is that
 * the SAME appearance always has ONE representation: runs are sorted,
 * non-overlapping, merged where they agree, and absent where they would only
 * restate what the block already says. Two edit paths that end up looking the
 * same must store the same thing, or undo, save and the embed payload all
 * start disagreeing.
 */

function block(text: string, extra: Partial<TextBlock> = {}): TextBlock {
  return {
    type: "text",
    id: "00000000-0000-4000-8000-000000000001",
    text,
    variant: "body",
    align: "left",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    ...extra,
  };
}

describe("text spans", () => {
  it("colours part of the text and leaves the rest following the block", () => {
    const spans = applyFormatToRange([], 11, { start: 0, end: 5 }, {
      color: "#ff0000",
    });
    expect(spans).toEqual([{ start: 0, end: 5, color: "#ff0000" }]);
    expect(segmentText("Hello world", spans)).toEqual([
      { text: "Hello", style: { color: "#ff0000" } },
      { text: " world", style: {} },
    ]);
  });

  it("carries two colours in one string", () => {
    let spans = applyFormatToRange([], 11, { start: 0, end: 5 }, {
      color: "#ff0000",
    });
    spans = applyFormatToRange(spans, 11, { start: 6, end: 11 }, {
      color: "#0000ff",
    });
    expect(segmentText("Hello world", spans)).toEqual([
      { text: "Hello", style: { color: "#ff0000" } },
      { text: " ", style: {} },
      { text: "world", style: { color: "#0000ff" } },
    ]);
  });

  it("splits a run when a later format lands inside it", () => {
    const red = applyFormatToRange([], 9, { start: 0, end: 9 }, {
      color: "#ff0000",
    });
    const mixed = applyFormatToRange(red, 9, { start: 3, end: 6 }, {
      bold: true,
    });
    expect(mixed).toEqual([
      { start: 0, end: 3, color: "#ff0000" },
      { start: 3, end: 6, color: "#ff0000", bold: true },
      { start: 6, end: 9, color: "#ff0000" },
    ]);
  });

  it("merges neighbours that end up identical, so there is one form", () => {
    const left = applyFormatToRange([], 6, { start: 0, end: 3 }, {
      color: "#ff0000",
    });
    const both = applyFormatToRange(left, 6, { start: 3, end: 6 }, {
      color: "#ff0000",
    });
    expect(both).toEqual([{ start: 0, end: 6, color: "#ff0000" }]);
  });

  it("drops a run that only restates the default", () => {
    const spans = applyFormatToRange([], 6, { start: 0, end: 3 }, {
      color: "#ff0000",
    });
    const cleared = applyFormatToRange(spans, 6, { start: 0, end: 3 }, {
      color: null,
    });
    expect(cleared).toEqual([]);
  });

  it("clamps runs that outlived the characters they named", () => {
    const stale: TextSpan[] = [{ start: 2, end: 40, bold: true }];
    expect(normalizeSpans(stale, 5)).toEqual([{ start: 2, end: 5, bold: true }]);
    // And rendering never reads past the end.
    expect(segmentText("Hello", stale)).toEqual([
      { text: "He", style: {} },
      { text: "llo", style: { bold: true } },
    ]);
  });

  it("toggles a range against what is really rendered, block flags included", () => {
    const plain = block("Hello world");
    expect(rangeHasFormat(plain, { start: 0, end: 5 }, "bold")).toBe(false);
    // Turning it on stores the override...
    const bolded = applyFormatToRange(
      plain.spans,
      plain.text.length,
      { start: 0, end: 5 },
      toggleFormatPatch(plain, { start: 0, end: 5 }, "bold"),
    );
    expect(bolded).toEqual([{ start: 0, end: 5, bold: true }]);

    // ...and on a block that is ALREADY bold everywhere, the same command
    // un-bolds those characters instead.
    const allBold = block("Hello world", { bold: true });
    expect(rangeHasFormat(allBold, { start: 0, end: 5 }, "bold")).toBe(true);
    expect(
      applyFormatToRange(
        allBold.spans,
        allBold.text.length,
        { start: 0, end: 5 },
        toggleFormatPatch(allBold, { start: 0, end: 5 }, "bold"),
      ),
    ).toEqual([{ start: 0, end: 5, bold: false }]);
  });

  it("stores nothing when a toggle lands back on the block's own value", () => {
    const allBold = block("Hello", {
      bold: true,
      spans: [{ start: 0, end: 3, bold: false }],
    });
    // Those three characters are un-bolded; bolding them again agrees with the
    // block, so the override goes away rather than being stored as `true`.
    const patch = toggleFormatPatch(allBold, { start: 0, end: 3 }, "bold");
    expect(patch).toEqual({ bold: null });
    expect(
      applyFormatToRange(allBold.spans, 5, { start: 0, end: 3 }, patch),
    ).toEqual([]);
  });

  it("reports a range's colour only when every character agrees", () => {
    const mixed = block("Hello world", {
      spans: [
        { start: 0, end: 5, color: "#ff0000" },
        { start: 6, end: 11, color: "#0000ff" },
      ],
    });
    expect(rangeColor(mixed, { start: 0, end: 5 })).toBe("#ff0000");
    expect(rangeColor(mixed, { start: 0, end: 11 })).toBeNull();
    // A caret is not a range.
    expect(rangeColor(mixed, { start: 2, end: 2 })).toBeNull();
  });

  it("renders unformatted text as a single plain segment", () => {
    expect(segmentText("Hello", undefined)).toEqual([
      { text: "Hello", style: {} },
    ]);
    expect(segmentText("", [])).toEqual([{ text: "", style: {} }]);
  });
});
