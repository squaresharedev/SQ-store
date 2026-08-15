import { isStrictHexColor } from "@/lib/validation/storefront";

/**
 * The colors this seller picked most recently, newest first.
 *
 * MODULE scope, MEMORY only — never localStorage or sessionStorage. That is a
 * deliberate repo-wide rule, argued in full at lib/search/snapshot-cache.ts:
 * the session model here is HttpOnly on purpose, and the moment an account
 * switch happens on a shared machine, anything left in web storage is another
 * person's store. Module scope survives route hops for the life of the tab,
 * which is the whole span a seller spends designing a storefront, and a refresh
 * starting the list over is the right price.
 *
 * Read through `useSyncExternalStore` (see color-context.tsx) rather than
 * component state: four pickers can be mounted at once and every one of them
 * has to show the same list the moment any of them records a color.
 */

/** Long enough to cover a design session, short enough that the tail is still
 *  recent. The suggested row shows far fewer than this — the rest are held so
 *  that colors falling off the row's cap come back as ones above them are
 *  re-picked. */
const MAX_RECENTS = 10;

/** Frozen so the two snapshot functions can hand out the SAME reference for an
 *  empty list. `useSyncExternalStore` compares snapshots by identity and loops
 *  forever if a getter returns a fresh array each call. */
const EMPTY: readonly string[] = Object.freeze([]);

let recents: readonly string[] = EMPTY;
const listeners = new Set<() => void>();

/** `useSyncExternalStore` subscribe. */
export function subscribeRecentColors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `useSyncExternalStore` client snapshot. Stable between changes. */
export function getRecentColors(): readonly string[] {
  return recents;
}

/** `useSyncExternalStore` server snapshot. There is no history on the server,
 *  and returning the shared frozen empty array keeps SSR and hydration
 *  agreeing on identity as well as content. */
export function getRecentColorsOnServer(): readonly string[] {
  return EMPTY;
}

/**
 * Remember a color the seller COMMITTED to — a swatch tap, a finished hex
 * entry, an eyedropper sample, a closed picker panel. Never call this per
 * frame of a drag: the saturation square emits on every pointer move, and
 * recording those would fill the list with a smear of near-identical hexes and
 * push out everything worth keeping.
 *
 * Re-picking a color moves it to the front rather than adding a second copy, so
 * the list stays a set ordered by recency. Anything that is not strict
 * `#rrggbb` is dropped silently — this list feeds swatches that end up in a
 * style attribute, and it is not the place to find out a value was malformed.
 */
export function recordRecentColor(hex: string): void {
  const lower = hex.toLowerCase();
  if (!isStrictHexColor(lower)) return;
  // Already at the front: nothing changes, so do not notify. Without this,
  // closing a picker on an unchanged color would re-render every mounted one.
  if (recents[0] === lower) return;

  recents = [lower, ...recents.filter((c) => c !== lower)].slice(0, MAX_RECENTS);
  for (const listener of listeners) listener();
}

/** Test-only reset. The store is module scope, so without this the order of
 *  one test's picks leaks into the next. */
export function __resetRecentColors(): void {
  recents = EMPTY;
  for (const listener of listeners) listener();
}
