import { describe, expect, it } from "vitest";
import { formatOrderSelection, parseOrderSelection } from "@/lib/orders/selection";
import {
  ORDER_SELECTION_LABEL_MAX,
  ORDER_SELECTION_MAX,
  ORDER_SELECTION_VALUE_MAX,
} from "@/types/order-view";

/**
 * Reading which version an order was for.
 *
 * Orders are written by the service role (a seed today, a checkout webhook
 * tomorrow), so nothing upstream of this parser is a Zod boundary. What a
 * seller is shown therefore has to be bounded here, and a blob that makes no
 * sense has to cost the order its version line rather than the whole page.
 */

describe("parseOrderSelection", () => {
  it("reads the pairs a sale recorded", () => {
    expect(
      parseOrderSelection([
        { label: "Size", value: "Six seater" },
        { label: "Finish", value: "Walnut" },
      ]),
    ).toEqual([
      { label: "Size", value: "Six seater" },
      { label: "Finish", value: "Walnut" },
    ]);
  });

  it("treats anything that is not a list of pairs as no version at all", () => {
    for (const raw of [null, undefined, {}, "Size: Large", 42, [null], [["Size", "L"]]]) {
      expect(parseOrderSelection(raw)).toEqual([]);
    }
  });

  it("drops a half-written pair rather than printing a dangling label", () => {
    expect(
      parseOrderSelection([
        { label: "Size", value: "" },
        { label: "   ", value: "Large" },
        { label: "Colour", value: 7 },
        { label: "Finish", value: " Oak " },
      ]),
    ).toEqual([{ label: "Finish", value: "Oak" }]);
  });

  it("bounds what a seller renders, whatever reached the column", () => {
    const many = Array.from({ length: ORDER_SELECTION_MAX + 5 }, (_, i) => ({
      label: `Axis ${i}`,
      value: `Value ${i}`,
    }));
    expect(parseOrderSelection(many)).toHaveLength(ORDER_SELECTION_MAX);

    const [long] = parseOrderSelection([
      { label: "L".repeat(ORDER_SELECTION_LABEL_MAX + 20), value: "V".repeat(ORDER_SELECTION_VALUE_MAX + 20) },
    ]);
    expect(long?.label).toHaveLength(ORDER_SELECTION_LABEL_MAX);
    expect(long?.value).toHaveLength(ORDER_SELECTION_VALUE_MAX);
  });
});

describe("formatOrderSelection", () => {
  it("reads as one line a seller can scan or paste", () => {
    expect(
      formatOrderSelection([
        { label: "Size", value: "Six seater" },
        { label: "Finish", value: "Walnut" },
      ]),
    ).toBe("Size: Six seater · Finish: Walnut");
  });

  it("is empty for a product sold in one version", () => {
    expect(formatOrderSelection([])).toBe("");
  });
});
