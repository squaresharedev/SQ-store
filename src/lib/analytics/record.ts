import { createAdminClient } from "@/lib/supabase/admin";
import type { SignalChannel, SignalKind } from "@/lib/analytics/signals";

// SERVER ONLY. Writes to public.storefront_signals with the SERVICE ROLE, so
// this module must never be imported from a Client Component.
//
// THE ONE WRITE PATH. Every producer of analytics goes through recordSignal:
// the embed route today, the signup and booking block handlers when they ship.
// Keeping it to one function is what makes the seam cheap: a new feature
// instruments itself in a single call and inherits the dedupe, the privacy
// rules and the never-break-the-caller behaviour for free.
//
// WHY SERVICE ROLE. storefront_signals deliberately has no insert policy for
// any client-facing role (see the migration). If `anon` could write its own
// analytics rows, a seller's numbers would be whatever a stranger felt like
// posting. The gate is here, in code that also owns the validation.
//
// BEST EFFORT, ALWAYS. Analytics is never allowed to fail the thing it is
// measuring. Every failure below is logged and swallowed: a buyer must not see
// a storefront fail to load because a counter could not be written.

/** What one signal write needs. `occurredAt` defaults to now in the database. */
export type SignalInput = {
  /** The seller the signal belongs to. */
  accountId: string;
  kind: SignalKind;
  storefrontId?: string | null;
  channel?: SignalChannel;
  /** The storefront block that produced it, when there is one. */
  blockId?: string | null;
  /** Salted digest from visitorHash(), never a raw identifier. */
  visitorHash?: string | null;
  /** Integer cents, for signals that carry money (a paid booking). */
  valueCents?: number | null;
  currency?: string | null;
  /**
   * Idempotency key. A second write with the same (account, key) is dropped by
   * the partial unique index rather than double-counted, which is also how
   * per-visitor deduping is done (see viewDedupeKey below).
   */
  dedupeKey?: string | null;
  /** Bounded, non-personal context. Nothing identifying goes in here. */
  metadata?: Record<string, string | number | boolean> | null;
};

/** Postgres unique_violation. Expected whenever a dedupe key does its job. */
const UNIQUE_VIOLATION = "23505";

/** Hex digest of a UTF-8 string. */
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The salt behind every visitor digest.
 *
 * A dedicated ANALYTICS_VISITOR_SALT is preferred; without one it falls back to
 * the service-role key, which is already the strongest server-only secret this
 * process holds and is never sent to a browser. The fallback exists so
 * instrumenting a new surface never depends on someone remembering to add an
 * env var; a missing salt would otherwise mean unsalted digests, which is
 * exactly the outcome this guards against.
 */
function visitorSalt(): string {
  return (
    process.env.ANALYTICS_VISITOR_SALT ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    ""
  );
}

/**
 * A stable, non-reversible visitor digest for distinct counts.
 *
 * Salted with a server-only secret and bound to the ACCOUNT, so the same
 * person visiting two sellers produces two unrelated digests and no cross-
 * tenant profile can be assembled from this table. The inputs (IP, user agent)
 * never touch the database, only this digest does.
 *
 * Deliberately NOT rotated per day. A daily-rotated digest is better for
 * unlinkability but turns "unique visitors over 30 days" into "visitor-days",
 * and a tile labelled Visitors showing visitor-days is a wrong number rather
 * than a private one. The column is documented, salted and account-bound; the
 * honest metric is the thing being traded for here.
 *
 * Returns null when there is nothing to hash, which is the correct answer for
 * a request with no client identity: the signal is still counted, it just does
 * not contribute to the distinct total.
 */
export async function visitorHash(
  accountId: string,
  parts: (string | null | undefined)[],
): Promise<string | null> {
  const identity = parts.filter(Boolean).join("|");
  if (!identity) return null;
  return sha256Hex(`${visitorSalt()}|${accountId}|${identity}`);
}

/**
 * Dedupe key for a storefront view: one per visitor, per storefront, per hour.
 *
 * A "view" that counted every payload fetch would count a widget re-render, a
 * back button and a tab left open on a polling page. Collapsing to the hour
 * makes the figure a VISIT, which is both the more useful number and the one a
 * refresh loop cannot inflate. Anonymous visitors (no digest) are not deduped,
 * because there is nothing to dedupe them by, and dropping them would
 * undercount.
 */
export async function viewDedupeKey(
  storefrontId: string,
  hash: string | null,
): Promise<string | null> {
  if (!hash) return null;
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return sha256Hex(`view|${storefrontId}|${hash}|${hour}`);
}

/**
 * Dedupe key for a hosted product page view: one per visitor, per product, per
 * hour. Same reasoning as viewDedupeKey, scoped to the product so browsing
 * three products on one storefront is three views, and reloading one is one.
 */
export async function productViewDedupeKey(
  productId: string,
  hash: string | null,
): Promise<string | null> {
  if (!hash) return null;
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return sha256Hex(`product_view|${productId}|${hash}|${hour}`);
}

/**
 * Write one signal. Never throws, never rejects.
 *
 * Returns "written" / "duplicate" / "failed" so a caller that wants to log or
 * test the outcome can, while a caller that does not can ignore it entirely.
 */
export async function recordSignal(
  input: SignalInput,
): Promise<"written" | "duplicate" | "failed"> {
  try {
    const admin = createAdminClient();
    // Built field by field rather than spread: this row is written from
    // untrusted request data on a public route, and a field added to
    // SignalInput later must not reach the database without someone deciding
    // it should. Same discipline as the embed payload builder.
    const { error } = await admin.from("storefront_signals").insert({
      account_id: input.accountId,
      kind: input.kind,
      storefront_id: input.storefrontId ?? null,
      channel: input.channel ?? "embed",
      block_id: input.blockId ?? null,
      visitor_hash: input.visitorHash ?? null,
      value_cents: input.valueCents ?? null,
      currency: input.currency ?? null,
      dedupe_key: input.dedupeKey ?? null,
      metadata: input.metadata ?? {},
    });

    if (!error) return "written";
    if (error.code === UNIQUE_VIOLATION) return "duplicate";
    console.warn(`[signals] ${input.kind} write failed:`, error.message);
    return "failed";
  } catch (err) {
    console.warn(
      `[signals] ${input.kind} threw:`,
      err instanceof Error ? err.message : String(err),
    );
    return "failed";
  }
}
