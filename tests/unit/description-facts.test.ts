import { describe, expect, it } from "vitest";
import { descriptionFacts, type FactLabels } from "@/components/products/description-facts";
import { initialDetailsValues, type BadgeFormValue } from "@/components/products/form-values";
import type { ProductOptionGroup } from "@/types/product";

const LABELS: FactLabels = {
  materials: "Materials",
  madeIn: "Made in",
  care: "Care",
  contents: "Contents",
  dimensions: "Dimensions",
  weight: "Weight",
  badges: "Badges",
  kind: "What are you selling?",
  download: "A download",
};

const SIZES: ProductOptionGroup = {
  id: "g",
  name: "Size",
  display: "chip",
  options: [
    { id: "s", name: "S", available: true },
    { id: "m", name: "M", available: false },
  ],
};

describe("descriptionFacts", () => {
  it("reads what a buyer would read, in the form's own words", () => {
    const details = {
      ...initialDetailsValues(),
      materials: " Linen ",
      origin: "Portugal",
      included: "Shirt\n\nGift box",
      specs: [{ label: "Fit", value: "Relaxed" }, { label: "", value: "orphan" }],
      length: "70",
      width: "50",
      dimensionUnit: "cm" as const,
      weight: "0.3",
      weightUnit: "kg" as const,
      safety: { ...initialDetailsValues().safety, manufacturerName: "Jana Nováková", manufacturerEmail: "jana@example.com" },
    };
    const badges = [{ label: "Made to order" }] as BadgeFormValue[];
    expect(descriptionFacts({ optionGroups: [SIZES], details, badges, isDigital: false }, LABELS)).toEqual([
      { label: "Size", value: "S, M" },
      { label: "Materials", value: "Linen" },
      { label: "Made in", value: "Portugal" },
      { label: "Contents", value: "Shirt, Gift box" },
      { label: "Fit", value: "Relaxed" },
      { label: "Dimensions", value: "70 x 50 cm" },
      { label: "Weight", value: "0.3 kg" },
      { label: "Badges", value: "Made to order" },
    ]);
  });

  it("never passes on the maker's or contact's details", () => {
    const details = {
      ...initialDetailsValues(),
      safety: { ...initialDetailsValues().safety, manufacturerName: "Jana", manufacturerAddress: "Praha 1" },
    };
    const text = JSON.stringify(descriptionFacts({ optionGroups: [], details, badges: [], isDigital: false }, LABELS));
    expect(text).not.toMatch(/Jana|Praha/);
  });

  it("says a download is one, and has nothing for an empty form", () => {
    const empty = { optionGroups: [], details: initialDetailsValues(), badges: [], isDigital: false };
    expect(descriptionFacts(empty, LABELS)).toEqual([]);
    expect(descriptionFacts({ ...empty, isDigital: true }, LABELS)).toEqual([
      { label: "What are you selling?", value: "A download" },
    ]);
  });
});
