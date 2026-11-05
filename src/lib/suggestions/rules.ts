// The rule half of suggestions: what someone would probably choose anyway,
// read from their own earlier choices. Domain-free on purpose (no product,
// storefront or plan in here): each app writes its own rules on top of these
// (the Store's are in lib/predictions.ts). See ./index.ts for the module's
// boundary.

/** How many of the newest records have to agree before a default follows them. */
export const AGREEMENT_WINDOW = 3;

/** The value the newest records all share, or null when they differ or there
 *  are fewer than `minimum`. A choice with money behind it asks for at least 2,
 *  so one one-off is not mistaken for a habit. */
export function agreed<T>(values: readonly T[], minimum = 1): T | null {
  const newest = values.slice(0, AGREEMENT_WINDOW);
  return newest.length >= minimum && newest.every((value) => value === newest[0]) ? newest[0] : null;
}

/** Distinct values, most used first and the newest first among equals.
 *  `values` is newest first; `key` decides which ones are the same. */
export function mostUsed<T>(values: readonly T[], key: (value: T) => string, max: number): T[] {
  const counted = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    const id = key(value);
    if (!id) continue;
    const seen = counted.get(id);
    if (seen) seen.count += 1;
    else counted.set(id, { value, count: 1 });
  }
  // Map keeps first-seen order, and sort is stable, so ties stay newest first.
  return [...counted.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map(({ value }) => value);
}

/** Something an earlier record holds, offered behind one tap as "Same as
 *  {from}" and never filled in by itself: each is a claim made to buyers. */
export type SameAs<T> = { from: string; value: T };
