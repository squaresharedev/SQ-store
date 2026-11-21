// SERVER ONLY. A fingerprint of an order's lines: which products, which
// versions, how many, in order. Stored on the order (orders.lines_digest) so a
// REPEATED attempt (Pay pressed twice, a retried request) is answered with its
// order only when it asks for exactly the same lines. An attempt id lives in
// one buyer's page and nowhere else, but an order link is a credential: a
// request that merely copied an attempt id, with a different basket, must not
// be handed someone else's order.
//
// Versions are named by their option IDS, never their labels: a seller renaming
// "Colour" between a paid attempt and its retry must not turn the retry away.

import type { QuotedLine } from "@/lib/checkout/quote";

/** Lowercase hex SHA-256, 64 characters (the column's CHECK). */
export async function linesDigest(
  lines: readonly Pick<QuotedLine, "productId" | "quantity" | "optionIds">[],
): Promise<string> {
  const canonical = JSON.stringify(lines.map((line) => [line.productId, line.quantity, line.optionIds]));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
