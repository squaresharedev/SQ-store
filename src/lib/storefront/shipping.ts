import { SHIPPING_PROFILES_MAX, type ShippingProfile } from "@/types/storefront";
import { buildShippingProse } from "@/lib/shipping/policy-prose";
import type { SellerShippingPolicy } from "@/types/shipping-policy";

/**
 * WHICH SHIPPING TERMS A PRODUCT IS SOLD UNDER — decided here and nowhere
 * else. Pure and client-safe: the public page, the editor's preview and the
 * product form's own "this is what buyers will read" panel all call this, so
 * the three can never disagree about what a product says.
 *
 * The rule, in one sentence: a product uses the account's default terms unless
 * it names a profile the account still has.
 *
 * THE ACCOUNT'S, not the storefront's — since
 * 20260905_shipping_policy_on_profile. This file used to say "shipping terms
 * really are a property of the store doing the shipping", and then read them
 * off a STOREFRONT, which is a presentation of one catalogue rather than a
 * business. That gap is what made the second of the two resolution failures
 * below possible at all: a product placed on a second storefront could name a
 * profile that storefront had never heard of. With one policy per account,
 * that case no longer exists, and the only way a profile id fails to resolve
 * is the honest one: the seller deleted it. It still falls back to the default
 * rather than erroring or blanking, because the default is always a correct
 * thing to print.
 *
 * A profile REPLACES the default, it does not layer over it: picking "Made to
 * order, allow 3 weeks" must not leave "Ships within 1-3 business days" from
 * the default still standing beside it.
 */

export type ResolvedShipping = {
  /** The profile's name, or null when these are the store's default terms.
   *  The page never prints it; the form's picker and preview do. */
  name: string | null;
  /** Plain paragraphs, exactly as the seller typed them. May be "" when the
   *  seller wrote only a dispatch line. */
  body: string;
  /** The one line that belongs beside the buy button, or "" when unset. */
  dispatch: string;
};

/** The profile with this id, or null when the store does not have it. */
export function findShippingProfile(
  profiles: readonly ShippingProfile[] | undefined,
  id: string | null | undefined,
): ShippingProfile | null {
  if (!id || !profiles) return null;
  return profiles.find((profile) => profile.id === id) ?? null;
}

/**
 * The terms to print for one product, or null when the seller has written
 * nothing at all — in which case the page has no shipping section rather than
 * an empty one.
 *
 * A PROFILE IS PROSE, THE DEFAULT IS GENERATED, and that asymmetry is
 * deliberate. The account default comes from structured answers run through
 * `buildShippingProse` (or the seller's own override, which that function
 * already prefers); a profile is one sentence about one exception, which is
 * not worth five fields to say. Both arrive here as the same `body` string, so
 * nothing downstream has to know which it got.
 */
export function resolveProductShipping(
  shippingProfileId: string | null | undefined,
  policy: SellerShippingPolicy | null | undefined,
): ResolvedShipping | null {
  const profile = findShippingProfile(policy?.profiles, shippingProfileId);
  const resolved: ResolvedShipping = profile
    ? { name: profile.name, body: profile.body, dispatch: profile.dispatch ?? "" }
    : {
        name: null,
        body: buildShippingProse(policy).shipping,
        dispatch: policy?.dispatch ?? "",
      };
  return resolved.body.trim() === "" && resolved.dispatch.trim() === "" ? null : resolved;
}

/**
 * The returns paragraph, or "" when there is none to print.
 *
 * Its own function beside the shipping one rather than a second member of
 * `ResolvedShipping`: returns do NOT vary by product. A shipping profile
 * replaces how one product gets to the buyer; it has never had anything to say
 * about how it comes back, and giving it a returns field would invite sellers
 * to write a per-product returns policy that the statutory rights below it
 * would then contradict.
 */
export function resolveReturns(policy: SellerShippingPolicy | null | undefined): string {
  return buildShippingProse(policy).returns;
}

/**
 * What a save should store: every field trimmed, `dispatch` dropped when
 * blank, and any profile without terms left out entirely.
 *
 * The last rule is the schema's, restated: a profile whose body is empty says
 * LESS than the store default it replaced, so it is not a thing to save. The
 * products pointing at a dropped profile fall back to the store default, which
 * is the same answer they get for every other unresolvable id.
 *
 * The mirror of `compactText` for policies and seller details, and here for
 * the same reason: an untouched store must save byte-identical to the one it
 * was before this feature existed.
 */
export function compactShippingProfiles(
  profiles: readonly ShippingProfile[],
): ShippingProfile[] {
  const clean: ShippingProfile[] = [];
  for (const profile of profiles) {
    const body = profile.body.trim();
    if (!body) continue;
    const dispatch = profile.dispatch?.trim();
    clean.push({
      id: profile.id,
      name: profile.name.trim() || "Shipping profile",
      ...(dispatch ? { dispatch } : {}),
      body,
    });
  }
  return clean;
}

/** Whether another profile can be added. The cap is a scannability limit on
 *  the product form's picker as much as a size bound on the config. */
export function canAddShippingProfile(profiles: readonly ShippingProfile[] | undefined): boolean {
  return (profiles?.length ?? 0) < SHIPPING_PROFILES_MAX;
}

/**
 * An id for a new profile.
 *
 * Matches the DB CHECK on products.shipping_profile_id (1-64 chars of
 * [A-Za-z0-9_-]), which a bare crypto.randomUUID() already satisfies. Kept as
 * a named function so the two rules stay written down together.
 */
export function newShippingProfileId(): string {
  return crypto.randomUUID();
}
