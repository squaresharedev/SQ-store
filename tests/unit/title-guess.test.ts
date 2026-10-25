import { describe, expect, it } from "vitest";
import { titleFromFileName } from "@/lib/products/title-guess";

describe("titleFromFileName", () => {
  it.each([
    ["blue-ceramic-mug.jpg", "Blue ceramic mug"],
    ["oak_side_table.webp", "Oak side table"],
    ["linenApron.png", "Linen Apron"],
    ["wool scarf (2).jpeg", "Wool scarf"],
    ["candle-set-03.jpg", "Candle set"],
    ["čokoládový dort.png", "Čokoládový dort"],
  ])("turns %s into a name", (file, title) => {
    expect(titleFromFileName(file)).toBe(title);
  });

  it.each([
    "IMG_2041.JPG",
    "PXL_20260412_101010.jpg",
    "DSC00123.jpg",
    "Screenshot 2026-10-01 at 10.00.00.png",
    "WhatsApp Image 2026-01-01.jpeg",
    "123456.jpg",
    "a1.png",
    "photo.jpg",
  ])("guesses nothing from a made-up name like %s", (file) => {
    expect(titleFromFileName(file)).toBeNull();
  });
});
