// THE SIGNAL VOCABULARY: the client-safe half of the analytics contract.
//
// A "signal" is one thing that happened on a seller's storefront that is NOT a
// sale: a view, a click, an email signup, a booking. Sales stay in `orders`
// and keep their own aggregate (see queries.ts); everything else is a row in
// public.storefront_signals tagged with one of the kinds below.
//
// THIS LIST IS MIRRORED IN SQL. The CHECK constraint on
// storefront_signals.kind carries the same strings
// (supabase/migrations/20260830_storefront_signals.sql, extended by
// 20260902_product_page.sql). Adding a kind means editing BOTH, in the same
// change. A kind added only here fails the insert at runtime, and a kind added
// only in SQL is invisible to the page. This is the same two-list hazard the
// notification types have.
//
// No server imports here on purpose: the registry is read by the page shell,
// the chart modules and (eventually) the agent surface, all of which run in
// different places.

/** Every signal kind the stream accepts. Mirrored by the SQL CHECK. */
export const SIGNAL_KINDS = [
  "storefront_view",
  "product_click",
  "email_signup",
  "booking",
  "product_view",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** Where a signal happened. Mirrors orders.channel, plus the hosted storefront. */
export const SIGNAL_CHANNELS = ["embed", "marketplace", "direct"] as const;

export type SignalChannel = (typeof SIGNAL_CHANNELS)[number];

/** Narrow an untrusted string to a known kind. */
export function isSignalKind(value: unknown): value is SignalKind {
  return (
    typeof value === "string" && (SIGNAL_KINDS as readonly string[]).includes(value)
  );
}

/** Narrow an untrusted string to a known channel. */
export function isSignalChannel(value: unknown): value is SignalChannel {
  return (
    typeof value === "string" &&
    (SIGNAL_CHANNELS as readonly string[]).includes(value)
  );
}

/** Display label for a channel, shared by every breakdown that shows one. */
export const CHANNEL_LABELS: Record<SignalChannel, string> = {
  embed: "Embed",
  marketplace: "Marketplace",
  direct: "Direct",
};
