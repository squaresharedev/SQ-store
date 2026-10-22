/**
 * iPhone photos (lib/uploads/heic.ts): the photo pickers name the format and
 * the way round it instead of listing the formats they take.
 */
import { describe, expect, it } from "vitest";
import { isHeicPhoto } from "@/lib/uploads/heic";

describe("an iPhone photo", () => {
  it("is known by its type, whatever the case", () => {
    expect(isHeicPhoto({ type: "image/heic", name: "IMG_0001.HEIC" })).toBe(true);
    expect(isHeicPhoto({ type: "image/HEIF", name: "photo" })).toBe(true);
    expect(isHeicPhoto({ type: "image/heic-sequence", name: "burst" })).toBe(true);
  });

  it("is known by its name when the system hands it over with no type", () => {
    expect(isHeicPhoto({ type: "", name: "IMG_0001.HEIC" })).toBe(true);
    expect(isHeicPhoto({ type: "application/octet-stream", name: "holiday.heif" })).toBe(true);
  });

  it("is not every other picture", () => {
    expect(isHeicPhoto({ type: "image/jpeg", name: "IMG_0001.jpg" })).toBe(false);
    expect(isHeicPhoto({ type: "image/avif", name: "photo.avif" })).toBe(false);
    expect(isHeicPhoto({ type: "", name: "heic-notes.txt" })).toBe(false);
  });
});
