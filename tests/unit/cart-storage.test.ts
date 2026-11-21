import { afterEach, describe, expect, it } from "vitest";
import { CART_STORAGE_PREFIX, forgetCartHandle, readCartHandle, writeCartHandle } from "@/lib/cart/storage";

/**
 * What the browser keeps about a cart is read back with suspicion: anything
 * that is not exactly one of ours (damaged JSON, another app's value, a forged
 * id or count) is dropped and forgotten, never trusted.
 */

const STOREFRONT = "5a000000-0000-4000-8000-00000000ca27";
const CART = "5a000000-0000-4000-8000-0000000000c1";
const KEY = `${CART_STORAGE_PREFIX}${STOREFRONT}`;

afterEach(() => {
  forgetCartHandle(STOREFRONT);
  window.localStorage.clear();
});

describe("the stored cart", () => {
  it("round-trips a handle", () => {
    writeCartHandle(STOREFRONT, { id: CART, rev: 3, count: 5 });
    expect(readCartHandle(STOREFRONT)).toEqual({ id: CART, rev: 3, count: 5 });
  });

  it("drops and forgets anything that is not one of ours", () => {
    for (const stored of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ id: "forged", rev: 0, count: 1 }),
      JSON.stringify({ id: CART, rev: -1, count: 1 }),
      JSON.stringify({ id: CART, rev: 0, count: 1.5 }),
      JSON.stringify({ id: CART, rev: 0, count: 1_000_000 }),
      JSON.stringify({ id: CART, rev: "1", count: 1 }),
    ]) {
      window.localStorage.setItem(KEY, stored);
      expect(readCartHandle(STOREFRONT), stored).toBeNull();
      expect(window.localStorage.getItem(KEY), stored).toBeNull();
    }
  });
});
