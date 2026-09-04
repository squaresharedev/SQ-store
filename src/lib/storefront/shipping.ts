import {
  SHIPPING_PROFILES_MAX,
  type ShippingProfile,
  type StorefrontPolicies,
} from "@/types/storefront";

/**
 * WHICH SHIPPING TERMS A PRODUCT IS SOLD UNDER — decided here and nowhere
 * else. Pure and client-safe: the public page, the editor's preview and the
 * product form's own "this is what buyers will read" panel all call this, so
 * the three can never disagree about what a product says.
 *
 * The rule, in one sentence: a product uses the store's default terms unless
 * it names a profile the store still has.
 *
 * That "still has" is doing real work. A profile id can fail to resolve two
 * honest ways — the seller deleted the profile, or the product is placed on a
 * SECOND storefront that never had it — and both get the same answer rather
 * than an error or a blank: the store whose page is being rendered falls back
 * to its own default. Shipping terms really are a property of the store doing
 * the shipping, so a store's default is always a correct thing to print.
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
 * The terms to print for one product on one storefront, or null when the
 * seller has written nothing at all — in which case the page has no shipping
 * section rather than an empty one.
 */
export function resolveProductShipping(
  shippingProfileId: string | null | undefined,
  profiles: readonly ShippingProfile[] | undefined,
  policies: StorefrontPolicies,
): ResolvedShipping | null {
  const profile = findShippingProfile(profiles, shippingProfileId);
  const resolved: ResolvedShipping = profile
    ? { name: profile.name, body: profile.body, dispatch: profile.dispatch ?? "" }
    : { name: null, body: policies.shipping ?? "", dispatch: policies.dispatch ?? "" };
  return resolved.body.trim() === "" && resolved.dispatch.trim() === "" ? null : resolved;
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
