import { z } from "zod";
import { optionalSingleLineText } from "@/lib/validation/inputs";
import {
  BRIEF_OTHER_CATEGORY_MAX,
  STOREFRONT_CATEGORIES,
  STOREFRONT_FULFILMENTS,
  STOREFRONT_VIBES,
  type StorefrontBrief,
} from "@/types/storefront-brief";

// The security boundary for the creation-flow brief (types/storefront-brief.ts
// holds the shape). Parsed server-side on the create; the wizard's own state is
// UX only.
//
// Almost everything here is an enum, so the allowlist IS the validation: a
// tampered payload cannot put arbitrary text into the column. The one free-text
// field goes through the shared single-line primitive, which trims and rejects
// control characters like every other prose field in the app.

/**
 * Deliberately `z.object`, not `strictObject` like the config schema. The
 * config is a fixed public contract and has to reject anything it does not
 * know; the brief is a growing set of optional questions, and stripping an
 * unrecognised key is the behaviour that lets an old client keep working after
 * a question is renamed or retired.
 */
export const storefrontBriefSchema = z.object({
  category: z.enum(STOREFRONT_CATEGORIES).optional(),
  otherCategory: optionalSingleLineText({
    label: "The category",
    max: BRIEF_OTHER_CATEGORY_MAX,
  }).optional(),
  fulfilment: z.enum(STOREFRONT_FULFILMENTS).optional(),
  vibe: z.enum(STOREFRONT_VIBES).optional(),
});

/**
 * Parse an untrusted brief, from a client payload or from the stored jsonb.
 *
 * Never throws and never fails the caller: anything unparseable degrades to an
 * empty brief. A malformed brief must not be able to block a seller from
 * creating a storefront, and a legacy row must not be able to break the list,
 * because nothing about this data is load-bearing. It is a hint for a
 * recommender, and the honest representation of a bad hint is no hint.
 */
export function parseStorefrontBrief(value: unknown): StorefrontBrief {
  const parsed = storefrontBriefSchema.safeParse(value ?? {});
  if (!parsed.success) return {};
  // `otherCategory` only means anything alongside category "other"; drop it
  // otherwise so a stale value cannot outlive the answer it belonged to.
  const brief: StorefrontBrief = { ...parsed.data };
  if (brief.category !== "other" || !brief.otherCategory) {
    delete brief.otherCategory;
  }
  return brief;
}
