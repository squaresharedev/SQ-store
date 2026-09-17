// @vitest-environment node
import { describe, expect, it } from "vitest";
import { storefrontReturnPath } from "@/lib/products/return-path";

/**
 * `?next=` on /products/new sends a seller back to the storefront designer they
 * left to create a product. It arrives in a URL, so these pin both fences: it
 * stays on this origin, and it can only ever be a designer route.
 */

const ID = "0b7a4f5e-3c2d-4e1f-9a8b-7c6d5e4f3a2b";

describe("storefrontReturnPath", () => {
  it("accepts a storefront designer path", () => {
    expect(storefrontReturnPath(`/storefront/${ID}`)).toBe(`/storefront/${ID}`);
  });

  it("reads the first value of a repeated parameter", () => {
    expect(storefrontReturnPath([`/storefront/${ID}`, "/settings/danger"])).toBe(
      `/storefront/${ID}`,
    );
  });

  it("refuses anything that is not exactly a designer route on this origin", () => {
    for (const raw of [
      "/settings/danger",
      "/storefront",
      `/storefront/${ID}/extra`,
      `/storefront/${ID}?panel=theme`,
      `https://evil.example/storefront/${ID}`,
      `//evil.example/storefront/${ID}`,
      `/\\evil.example/storefront/${ID}`,
      "/storefront/not-a-uuid",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(storefrontReturnPath(raw), String(raw)).toBeNull();
    }
  });
});
