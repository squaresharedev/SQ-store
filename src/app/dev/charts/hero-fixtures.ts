// Sample data for the revenue hero specimens at /dev/charts. Deterministic:
// no Date and no random, so the server and the browser render the same thing.

/** Thirty daily buckets shaped by `value(day)`, as the analytics feed sends them. */
export function heroSeries(value: (day: number) => number) {
  return Array.from({ length: 30 }, (_, day) => {
    const revenueCents = Math.max(0, Math.round(value(day)));
    return {
      date: `2026-09-${String(day + 1).padStart(2, "0")}`,
      revenueCents,
      sales: Math.round(revenueCents / 4_000),
      aovCents: 4_000,
    };
  });
}

/** The window the hero specimens cover, as the page resolves a range. */
export const HERO_RANGE = { from: "2026-09-01", to: "2026-09-30" };
