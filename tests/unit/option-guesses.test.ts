import { describe, expect, it } from "vitest";
import { guessSizes, nextOptionValues } from "@/lib/products/option-guesses";
import { SIZE_PRESET } from "@/lib/products/option-presets";

describe("guessSizes", () => {
  it.each([
    "Organic cotton T-shirt",
    "t shirt",
    "Tshirt black",
    "Oversized hoodie",
    "Wool sweater",
    "Linen summer dress",
    "Regenjacke",
    "Kapuzenpullover",
    "Sweat-shirt brodé",
    "Camiseta de algodón",
    "Felpa con cappuccio",
    "Spijkerbroek",
    "Koszulka bawełniana",
    "Bavlněné tričko",
    "Pánska mikina",
    "Casaco de lã",
  ])("offers the Size button's sizes for clothes: %s", (title) => {
    expect(guessSizes(title)).toEqual(SIZE_PRESET.values);
  });

  it.each(["Leather boots", "Hausschuhe aus Filz", "Zapatillas de lona", "Baby hoodie", "Kids T-shirt", "Dětské tričko"])(
    "offers an empty Size group where sizes are the seller's own: %s",
    (title) => {
      expect(guessSizes(title)).toEqual([]);
    },
  );

  it.each([
    "",
    "Ceramic mug",
    "Glaze kit",
    "Oak side table",
    "T-shirt sewing pattern",
    "Hoodie SVG download",
    "Coat hanger",
    "Christmas tree skirt",
    "Coat of arms print",
    "Doll dress",
    "Iron-on jeans patch",
    "Grüner Tee",
    "Golf tees",
    "Drawer pull",
    "Kleiderbügel",
    "Jumper cables",
  ])("stays quiet when it is not sure: %s", (title) => {
    expect(guessSizes(title)).toBeNull();
  });
});

describe("nextOptionValues", () => {
  it("offers the next sizes up from a small one", () => {
    expect(nextOptionValues(["Small"])).toEqual(["Medium", "Large", "Extra large"]);
    expect(nextOptionValues(["S"])).toEqual(["XS", "M", "L"]);
  });

  it("fills a gap before going further", () => {
    expect(nextOptionValues(["S", "L"])).toEqual(["XS", "M", "XL"]);
  });

  it("writes them the way the seller does", () => {
    expect(nextOptionValues(["s"])).toEqual(["xs", "m", "l"]);
    expect(nextOptionValues(["SMALL"])).toEqual(["MEDIUM", "LARGE", "EXTRA LARGE"]);
  });

  it("knows sizes in each language, once the language is clear", () => {
    expect(nextOptionValues(["Klein", "Mittel"])).toEqual(["Groß"]);
    expect(nextOptionValues(["Petit"])).toEqual(["Moyen", "Grand"]);
    expect(nextOptionValues(["A4"])).toEqual(["A5", "A3", "A2"]);
    // "Klein" is German and Dutch, "Grande" three languages: not sure, so nothing.
    expect(nextOptionValues(["Klein"])).toEqual([]);
    expect(nextOptionValues(["Grande"])).toEqual([]);
  });

  it("continues an even run of numbers in its unit", () => {
    expect(nextOptionValues(["38", "39"])).toEqual(["40", "41"]);
    expect(nextOptionValues(["250 ml", "500 ml"])).toEqual(["750 ml", "1000 ml"]);
    expect(nextOptionValues(["0.5 l", "1 l"])).toEqual(["1.5 l", "2 l"]);
  });

  it("says nothing it is not sure of", () => {
    expect(nextOptionValues([])).toEqual([]);
    expect(nextOptionValues(["38"])).toEqual([]);
    expect(nextOptionValues(["Red"])).toEqual([]);
    expect(nextOptionValues(["S", "Red"])).toEqual([]);
    expect(nextOptionValues(["10", "20", "25"])).toEqual([]);
    expect(nextOptionValues(["250 ml", "500 g"])).toEqual([]);
    expect(nextOptionValues(["40", "38"])).toEqual([]);
  });

  it("offers nothing once the ladder is full", () => {
    expect(nextOptionValues(["Small", "Medium", "Large", "Extra large"])).toEqual([]);
  });
});
