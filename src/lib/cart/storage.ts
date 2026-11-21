import type { CartHandle } from "@/types/cart";

// WHAT THE BROWSER KEEPS ABOUT A CART: one entry per storefront, holding the
// cart's id (the buyer's only key to it), its revision and how many items it
// holds. Written only after the buyer presses "Add to cart": a visit that adds
// nothing stores nothing. Client-safe; every read and write survives storage
// that throws (a private window, a sandboxed frame, a full quota) by falling
// back to memory for the life of the page.
//
// Strictly necessary for a service the buyer asked for (keeping what they put
// in their cart), so no consent is asked; it goes when the cart does (paid,
// emptied, or idle past CART_IDLE_DAYS on the server).

/** One key per storefront. */
export const CART_STORAGE_PREFIX = "ss-cart:";

/** The most items a stored count may claim: far past any cart (20 lines of
 *  at most 100), so anything above it is not a count of ours. */
const STORED_COUNT_MAX = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stored value read back, or null when it is not one of ours. By hand, not
 * with zod: this runs on every buyer page, whose bundle carries no zod (the
 * server checks the id again on every request anyway).
 */
function parseHandle(raw: string): CartHandle | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { id, rev, count } = value as Record<string, unknown>;
  const whole = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
  if (typeof id !== "string" || !UUID.test(id) || !whole(rev, Number.MAX_SAFE_INTEGER) || !whole(count, STORED_COUNT_MAX)) {
    return null;
  }
  return { id, rev, count };
}

/** Where a page keeps handles when storage cannot be used. */
const memory = new Map<string, CartHandle>();

function key(storefrontId: string): string {
  return `${CART_STORAGE_PREFIX}${storefrontId}`;
}

export function readCartHandle(storefrontId: string): CartHandle | null {
  try {
    const raw = window.localStorage.getItem(key(storefrontId));
    if (raw !== null) {
      const parsed = parseHandle(raw);
      if (parsed) return parsed;
      // Not ours, or damaged: forget it rather than trust it.
      window.localStorage.removeItem(key(storefrontId));
      return null;
    }
  } catch {
    // Storage that throws: fall through to the page's memory.
  }
  return memory.get(storefrontId) ?? null;
}

export function writeCartHandle(storefrontId: string, handle: CartHandle): void {
  memory.set(storefrontId, handle);
  try {
    window.localStorage.setItem(key(storefrontId), JSON.stringify(handle));
  } catch {
    // Memory holds it for this page.
  }
}

export function forgetCartHandle(storefrontId: string): void {
  memory.delete(storefrontId);
  try {
    window.localStorage.removeItem(key(storefrontId));
  } catch {
    // Nothing kept to forget.
  }
}

/** Whether a storage event (another tab) is about this storefront's cart. */
export function isCartStorageEvent(event: StorageEvent, storefrontId: string): boolean {
  return event.key === key(storefrontId) || event.key === null;
}
