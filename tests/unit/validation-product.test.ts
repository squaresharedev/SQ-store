import { describe, expect, it } from "vitest";
import {
  DIGITAL_FILE_MAX_BYTES,
  IMAGE_MAX_BYTES,
  PRICE_CENTS_MAX,
  STOCK_QUANTITY_MAX,
  isAllowedContentType,
  maxBytesForKind,
  presignRequestSchema,
  productIdSchema,
  productWriteSchema,
} from "@/lib/validation/product";

function validProduct() {
  return {
    title: "Print",
    description: "",
    priceCents: 1400,
    currency: "EUR" as const,
    status: "active" as const,
  };
}

describe("productWriteSchema — happy path", () => {
  it("accepts a minimal product", () => {
    expect(productWriteSchema.safeParse(validProduct()).success).toBe(true);
  });

  it("trims title and description", () => {
    const r = productWriteSchema.safeParse({ ...validProduct(), title: "  Print  " });
    expect(r.success && r.data.title).toBe("Print");
  });

  it("accepts three-state keys: undefined keep / null clear / string replace", () => {
    expect(productWriteSchema.safeParse(validProduct()).success).toBe(true);
    expect(
      productWriteSchema.safeParse({ ...validProduct(), imageKey: null }).success,
    ).toBe(true);
    expect(
      productWriteSchema.safeParse({ ...validProduct(), imageKey: "images/x" }).success,
    ).toBe(true);
  });

  it("accepts tracked stock with a quantity", () => {
    expect(
      productWriteSchema.safeParse({
        ...validProduct(),
        trackStock: true,
        stockQuantity: 5,
        lowStockThreshold: 2,
      }).success,
    ).toBe(true);
  });
});

describe("productWriteSchema — invalid input", () => {
  it("rejects empty / whitespace / oversized titles", () => {
    for (const title of ["", "   ", "x".repeat(201)]) {
      expect(productWriteSchema.safeParse({ ...validProduct(), title }).success).toBe(false);
    }
  });

  it("rejects zero, negative, fractional, and huge prices", () => {
    for (const priceCents of [0, -1, 0.5, 14.99, PRICE_CENTS_MAX + 1, Number.NaN]) {
      expect(
        productWriteSchema.safeParse({ ...validProduct(), priceCents }).success,
        String(priceCents),
      ).toBe(false);
    }
    expect(
      productWriteSchema.safeParse({ ...validProduct(), priceCents: PRICE_CENTS_MAX }).success,
    ).toBe(true);
    expect(
      productWriteSchema.safeParse({ ...validProduct(), priceCents: 1 }).success,
    ).toBe(true);
  });

  it("rejects unknown currency and status", () => {
    expect(
      productWriteSchema.safeParse({ ...validProduct(), currency: "GBP" }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({ ...validProduct(), status: "published" }).success,
    ).toBe(false);
  });

  it("rejects tracking without a quantity (mirrors the DB constraint)", () => {
    expect(
      productWriteSchema.safeParse({ ...validProduct(), trackStock: true }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({
        ...validProduct(),
        trackStock: true,
        stockQuantity: null,
      }).success,
    ).toBe(false);
  });

  it("rejects negative / fractional / oversized stock", () => {
    for (const stockQuantity of [-1, 2.5, STOCK_QUANTITY_MAX + 1]) {
      expect(
        productWriteSchema.safeParse({
          ...validProduct(),
          trackStock: true,
          stockQuantity,
        }).success,
        String(stockQuantity),
      ).toBe(false);
    }
  });

  it("rejects oversized object keys", () => {
    expect(
      productWriteSchema.safeParse({ ...validProduct(), imageKey: "k".repeat(601) }).success,
    ).toBe(false);
  });

  it("rejects a description over 5000 chars", () => {
    expect(
      productWriteSchema.safeParse({ ...validProduct(), description: "x".repeat(5001) }).success,
    ).toBe(false);
  });
});

describe("presignRequestSchema", () => {
  it("accepts a valid image request", () => {
    expect(
      presignRequestSchema.safeParse({
        kind: "image",
        filename: "photo.png",
        contentType: "image/png",
        size: 1024,
      }).success,
    ).toBe(true);
  });

  it("kind discriminates the allowed content types", () => {
    // zips are not images
    expect(
      presignRequestSchema.safeParse({
        kind: "image",
        filename: "x.zip",
        contentType: "application/zip",
        size: 10,
      }).success,
    ).toBe(false);
    // but are fine as digital files
    expect(
      presignRequestSchema.safeParse({
        kind: "file",
        filename: "x.zip",
        contentType: "application/zip",
        size: 10,
      }).success,
    ).toBe(true);
  });

  it("enforces per-kind size caps at the exact boundary", () => {
    const image = (size: number) =>
      presignRequestSchema.safeParse({
        kind: "image",
        filename: "a.png",
        contentType: "image/png",
        size,
      }).success;
    expect(image(IMAGE_MAX_BYTES)).toBe(true);
    expect(image(IMAGE_MAX_BYTES + 1)).toBe(false);
    expect(image(0)).toBe(false);
    expect(image(-5)).toBe(false);
    expect(image(1.5)).toBe(false);

    const file = (size: number) =>
      presignRequestSchema.safeParse({
        kind: "file",
        filename: "a.zip",
        contentType: "application/zip",
        size,
      }).success;
    expect(file(DIGITAL_FILE_MAX_BYTES)).toBe(true);
    expect(file(DIGITAL_FILE_MAX_BYTES + 1)).toBe(false);
  });

  it("rejects dangerous/dishonest content types", () => {
    for (const contentType of [
      "text/html",
      "application/javascript",
      "image/svg+xml", // scriptable — correctly NOT in the allowlist
      "application/x-msdownload",
      "",
    ]) {
      expect(
        presignRequestSchema.safeParse({
          kind: "image",
          filename: "a.png",
          contentType,
          size: 10,
        }).success,
        contentType,
      ).toBe(false);
    }
  });

  it("rejects unknown kinds", () => {
    expect(
      presignRequestSchema.safeParse({
        kind: "avatar",
        filename: "a.png",
        contentType: "image/png",
        size: 10,
      }).success,
    ).toBe(false);
  });
});

describe("isAllowedContentType", () => {
  it("tolerates charset suffixes and case", () => {
    expect(isAllowedContentType("file", "text/plain; charset=utf-8")).toBe(true);
    expect(isAllowedContentType("image", "IMAGE/PNG")).toBe(true);
  });
  it("rejects nulls and empty", () => {
    expect(isAllowedContentType("image", null)).toBe(false);
    expect(isAllowedContentType("image", "")).toBe(false);
  });
  it("svg and html are never allowed for images", () => {
    expect(isAllowedContentType("image", "image/svg+xml")).toBe(false);
    expect(isAllowedContentType("image", "text/html")).toBe(false);
  });
});

describe("maxBytesForKind", () => {
  it("maps kinds to their caps", () => {
    expect(maxBytesForKind("image")).toBe(IMAGE_MAX_BYTES);
    expect(maxBytesForKind("file")).toBe(DIGITAL_FILE_MAX_BYTES);
  });
});

describe("productIdSchema", () => {
  it("uuid only", () => {
    expect(productIdSchema.safeParse("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee").success).toBe(true);
    expect(productIdSchema.safeParse("1; drop table products;").success).toBe(false);
  });
});
