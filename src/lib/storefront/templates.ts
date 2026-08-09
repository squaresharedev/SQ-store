import type { StorefrontBrief } from "@/types/storefront-brief";
import { themeForVibe } from "@/lib/storefront/presets";
import type { StorefrontTheme } from "@/types/storefront";

// The seam where storefront templates will attach.
//
// TODO(templates): there is no template catalogue yet. When there is, this is
// the one place the lookup goes. Keeping it here rather than inlining it in
// createStorefront or the wizard means the recommendation can grow (ranking,
// a "why this one" explanation, more than one suggestion, re-running it later
// from inside the designer) without any of those callers changing shape.
//
// The brief was designed against how theme marketplaces actually filter, so the
// mapping is already implied:
//
//   brief.category   -> narrows to the industry set
//   brief.fulfilment -> drops templates missing the delivery surface they need
//                       (shipping fields, a download handoff, a booking block)
//   product count    -> read live from the products table, NOT from the brief:
//                       a one-product store and a 300-product store want
//                       structurally different layouts, and a number captured
//                       at creation goes stale within a week
//   brief.vibe       -> final aesthetic filter, and the fallback when the brief
//                       is otherwise empty
//
// An empty brief means the seller skipped the flow. That is a low-confidence
// signal rather than "no preference", so whatever lands here should present its
// suggestions accordingly rather than pretending to know.

/**
 * What we can recommend from a brief today: the starting theme its vibe
 * implies. `createStorefront` already applies this at insert; the function
 * exists so the call site is in place before the catalogue is.
 */
export type StorefrontRecommendation = {
  theme: StorefrontTheme;
  /** False when the brief was empty, i.e. the flow was skipped. */
  confident: boolean;
};

export function recommendForBrief(
  brief: StorefrontBrief,
): StorefrontRecommendation {
  return {
    theme: themeForVibe(brief.vibe),
    confident: brief.vibe !== undefined,
  };
}
