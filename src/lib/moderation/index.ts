/**
 * CONTENT MODERATION SEAM.
 *
 * Nothing moderates anything yet. What this module guarantees is that when a
 * real moderation service arrives, it has exactly ONE place to be wired in and
 * every piece of user-supplied media already flows through it.
 *
 * WHY THIS SHAPE
 *
 * Moderation is only possible where the platform can see the bytes. Product
 * images used to go browser -> R2 directly (presigned PUT), so the server never
 * held the image and there was no point at which anything could be inspected,
 * held, or refused — a moderation system could only ever have run after the
 * image was already public. Images now upload THROUGH the server
 * (app/api/uploads/image), and that route calls {@link moderateUpload} before
 * a single byte reaches storage.
 *
 * The presign path is deliberately restricted to digital FILES, so there is no
 * second route by which an image could reach a product without passing here.
 * That restriction is the moderation guarantee — remove it and moderation
 * becomes bypassable by a crafted client.
 *
 * CONNECTING A REAL PROVIDER
 *
 * Replace the body of {@link moderateUpload}. It is async and receives the
 * bytes, so a network call to a classifier is a drop-in. Callers already
 * handle all three verdicts, so no call site needs to change:
 *
 *   allow  -> stored and usable immediately
 *   reject -> never stored; the uploader is told why
 *   review -> stored under the quarantine prefix and NOT usable; it is not
 *             linked to a product, so it cannot be displayed while it waits
 *
 * If the provider is slow or down, decide deliberately: returning `review`
 * fails safe (nothing publishes until a human agrees), returning `allow` fails
 * open (uploads keep working, nothing is held). Today's no-op returns `allow`
 * because there is no provider to be down.
 */

/** What the platform may do with a piece of uploaded media. */
export type ModerationVerdict =
  | { decision: "allow" }
  /** Refuse outright. `reason` is shown to the uploader, so keep it human. */
  | { decision: "reject"; reason: string }
  /** Hold for a human. `reason` is internal, for the review queue. */
  | { decision: "review"; reason: string };

/**
 * What is being moderated. `kind` exists so a future provider can apply
 * different policy per surface (a product photo and an avatar are not judged
 * the same way) without changing this signature again.
 */
export type ModerationSubject = {
  kind: "product-image";
  /** The real bytes, after magic-byte sniffing — not the client's claim. */
  bytes: Uint8Array;
  /** The sniffed content type, likewise. */
  contentType: string;
  /** Who uploaded it, and which store account it is destined for. */
  uploaderId: string;
  accountId: string;
};

/**
 * Decide what may happen to an upload. Currently a no-op that allows
 * everything — the seam, not the system.
 *
 * Deliberately async and byte-taking so that swapping in a real classifier is
 * a change to this function alone.
 */
export async function moderateUpload(
  subject: ModerationSubject,
): Promise<ModerationVerdict> {
  // Nothing to consult yet. The subject is deliberately named rather than
  // underscored: a provider replaces the body below, and it needs all of this.
  void subject;
  return { decision: "allow" };
}

/**
 * Key prefix for media held pending human review. Kept separate from the live
 * prefixes so that a quarantined object can never satisfy
 * `isOwnedObjectKey(..., "image", ...)` and therefore can never be attached to
 * a product, whatever else goes wrong.
 */
export const QUARANTINE_PREFIX = "quarantine";
