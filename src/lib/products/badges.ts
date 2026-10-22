import type { ActionError } from "@/lib/errors";
import { rankDetailed } from "@/lib/search/rank";
import { prepareQuery } from "@/lib/search/vocabulary";
import { badgeLabelKey, isOnPhoto } from "@/lib/validation/product";
import {
  BADGES_MAX,
  BADGES_ON_PHOTO_MAX,
  type BadgeColor,
  type BadgeIcon,
  type BadgePlacement,
  type ProductBadge,
} from "@/types/product";

// The ready-made badges, and the few pure helpers the form needs around them.
// Client-safe: nothing here touches the server, and every badge a seller ends
// up with still goes through productWriteSchema and the badge check like any
// words they typed.
//
// A PRESET IS A STARTING POINT, NEVER A LIST OF WHAT IS ALLOWED, the same
// bargain as option-presets.ts. Picking one writes its words into the badge,
// in the seller's language, and from then on they are the seller's words: they
// can change "1,000+" to "250+" or "Eco friendly" to "Climate neutral". So the
// stored badge never names its preset, and nothing on the buyer's side knows
// one was used.

/** How the picker files the presets when nothing has been typed yet. */
export const BADGE_PRESET_GROUPS = ["trust", "product"] as const;
export type BadgePresetGroup = (typeof BADGE_PRESET_GROUPS)[number];

/**
 * One ready-made badge. Its words and search keywords are copy
 * (`Products.badges.presets.<id>.label` / `.keywords`); `count` is the number a
 * preset's words are built around ("Loved by {count}+ people"), which the form
 * selects after adding so the seller types their own over it.
 */
export type BadgePreset = {
  id: string;
  icon: BadgeIcon;
  /** The icon's colour when it is added: what the badge is about (green for
   *  the planet, red for love, blue for delivery), changeable like the rest. */
  color: BadgeColor;
  group: BadgePresetGroup;
  count?: number;
};

/** In the order the picker lists them: the most asked-for first in each group. */
export const BADGE_PRESETS = [
  // Trust: why a buyer can take the plunge.
  { id: "lovedBy", icon: "heart", color: "red", group: "trust", count: 1000 },
  { id: "bestseller", icon: "award", color: "amber", group: "trust" },
  { id: "topRated", icon: "star", color: "amber", group: "trust" },
  { id: "freeShipping", icon: "truck", color: "blue", group: "trust" },
  { id: "fastDispatch", icon: "zap", color: "orange", group: "trust", count: 24 },
  { id: "moneyBack", icon: "rotate-ccw", color: "teal", group: "trust", count: 30 },
  { id: "freeReturns", icon: "rotate-ccw", color: "teal", group: "trust" },
  { id: "warranty", icon: "shield-check", color: "blue", group: "trust", count: 2 },
  { id: "securePayment", icon: "lock", color: "green", group: "trust" },
  { id: "satisfaction", icon: "thumbs-up", color: "blue", group: "trust" },
  { id: "giftReady", icon: "gift", color: "pink", group: "trust" },
  { id: "limitedEdition", icon: "gem", color: "purple", group: "trust" },
  { id: "newArrival", icon: "sparkles", color: "purple", group: "trust" },
  { id: "smallBusiness", icon: "store", color: "orange", group: "trust" },
  { id: "awardWinning", icon: "trophy", color: "amber", group: "trust" },
  // About the product: a fact worth seeing before the specifications.
  { id: "ecoFriendly", icon: "leaf", color: "green", group: "product" },
  { id: "handmade", icon: "hand-heart", color: "pink", group: "product" },
  { id: "recycled", icon: "recycle", color: "green", group: "product" },
  { id: "plasticFree", icon: "package", color: "teal", group: "product" },
  { id: "organic", icon: "sprout", color: "green", group: "product" },
  { id: "vegan", icon: "vegan", color: "green", group: "product" },
  { id: "crueltyFree", icon: "rabbit", color: "pink", group: "product" },
  { id: "madeLocally", icon: "map-pin", color: "blue", group: "product" },
  { id: "fairTrade", icon: "handshake", color: "orange", group: "product" },
  { id: "sustainablySourced", icon: "trees", color: "green", group: "product" },
  { id: "glutenFree", icon: "wheat-off", color: "amber", group: "product" },
  { id: "waterproof", icon: "droplets", color: "blue", group: "product" },
  { id: "builtToLast", icon: "hammer", color: "ink", group: "product" },
  { id: "personalised", icon: "pen-tool", color: "purple", group: "product" },
  { id: "petFriendly", icon: "paw-print", color: "orange", group: "product" },
  { id: "qualityChecked", icon: "badge-check", color: "green", group: "product" },
] as const satisfies readonly BadgePreset[];

export type BadgePresetId = (typeof BADGE_PRESETS)[number]["id"];

/** The icon a badge gets when nothing better is known. */
export const DEFAULT_BADGE_ICON: BadgeIcon = "badge-check";
/** The colour a badge gets when nothing better is known: the page's own ink. */
export const DEFAULT_BADGE_COLOR: BadgeColor = "ink";
/** Where a new badge goes: beside the product, under its title. */
export const DEFAULT_BADGE_PLACEMENT: BadgePlacement = "beside";

/** A preset as the form offers it: its words already in the seller's language. */
export type LocalBadgePreset = {
  id: BadgePresetId;
  icon: BadgeIcon;
  color: BadgeColor;
  group: BadgePresetGroup;
  /** The badge's words, with any count already filled in. */
  label: string;
  /** Other words a seller might search for it by. */
  keywords: readonly string[];
  /** The count as printed inside `label` ("1,000"), for selecting it. */
  countText: string | null;
};

/** Split a comma-separated keyword string from the catalogue. */
export function splitKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
}

/** How many presets the picker shows for a query. Enough to scan, not a wall. */
export const BADGE_SEARCH_LIMIT = 8;

/**
 * The presets that answer `query`, best first, through the same ranker the
 * universal search uses (per word, accent- and typo-tolerant). An empty query
 * answers nothing: the picker shows the grouped catalogue instead.
 */
export function searchBadgePresets(
  presets: readonly LocalBadgePreset[],
  query: string,
  limit = BADGE_SEARCH_LIMIT,
): LocalBadgePreset[] {
  return findBadgePresets(presets, query, limit).presets;
}

/**
 * The same search, plus whether the best preset answers EVERY word typed.
 *
 * That is what decides what Enter means. "refund" is a search, and the
 * money-back guarantee answers it; "Hand-poured in Lisbon" is a seller writing
 * their own badge, and "Handmade" answering one word of it is a suggestion, not
 * what they meant. Picking it on Enter would quietly swap their words for ours.
 */
export function findBadgePresets(
  presets: readonly LocalBadgePreset[],
  query: string,
  limit = BADGE_SEARCH_LIMIT,
): { presets: LocalBadgePreset[]; complete: boolean } {
  if (!query.trim()) return { presets: [], complete: false };
  const ranked = rankDetailed(presets, query, presetTerms, limit);
  const required = prepareQuery(query).required;
  return {
    presets: ranked.map((entry) => entry.item),
    complete: ranked.length > 0 && ranked[0]!.coverage >= required,
  };
}

/** What a preset is found by: its own words, then the words people search with. */
function presetTerms(preset: LocalBadgePreset): string[] {
  return [preset.label, ...preset.keywords];
}

/**
 * The icon a badge the seller wrote themselves starts with: the closest
 * preset's, so "Hand-poured in Lisbon" leads with the handmade drawing and
 * "100% cotton" with a plain check. Only a starting point; the row's icon
 * button changes it.
 */
export function guessBadgeStyle(
  presets: readonly LocalBadgePreset[],
  label: string,
): { icon: BadgeIcon; color: BadgeColor } {
  const closest = searchBadgePresets(presets, label, 1)[0];
  return closest
    ? { icon: closest.icon, color: closest.color }
    : { icon: DEFAULT_BADGE_ICON, color: DEFAULT_BADGE_COLOR };
}

/** True when a badge with these words is already on the product. */
export function hasBadgeLabel(badges: readonly Pick<ProductBadge, "label">[], label: string): boolean {
  const key = badgeLabelKey(label);
  return key !== "" && badges.some((badge) => badgeLabelKey(badge.label) === key);
}

/** A label with every number in it reduced to one mark, so "Loved by 250+
 *  people" and "Loved by 1,000+ people" read as the same badge. */
function shapeKey(label: string): string {
  return badgeLabelKey(label).replace(/\d+(?:[.,\s  ]\d+)*/g, "#");
}

/**
 * True when the product already carries this preset: its exact words, or, for
 * a preset built around a number, the same words with the seller's own number.
 * Changing "1,000" to "250" makes the badge the seller's, not a reason to
 * offer the 1,000 one again.
 */
export function hasPresetBadge(
  badges: readonly Pick<ProductBadge, "label">[],
  preset: Pick<LocalBadgePreset, "label" | "countText">,
): boolean {
  if (!preset.countText) return hasBadgeLabel(badges, preset.label);
  const shape = shapeKey(preset.label);
  return badges.some((badge) => shapeKey(badge.label) === shape);
}

/** The two refusals lib/products/badge-moderation.ts builds, by message key. */
const BADGE_REFUSAL_KEYS: readonly string[] = [
  "Errors.products.badgeRefused.message",
  "Errors.products.badgeNotApproved.message",
];

/**
 * The words of the badge a save was refused over, or null when the error is
 * about something else. Lets the form put the seller on that row instead of
 * leaving them to find it from a message at the foot of the page.
 */
export function refusedBadgeLabel(error: ActionError): string | null {
  if (!BADGE_REFUSAL_KEYS.includes(error.message.key)) return null;
  const label = error.message.values?.label;
  return typeof label === "string" ? label : null;
}

/**
 * Whether a badge may go to `placement`. Anywhere beside the product, always;
 * on the photo, while the photo has room or the badge is on it already (moving
 * between corners is not one more).
 */
export function canPlaceBadge(
  badges: readonly Pick<ProductBadge, "placement">[],
  badge: Pick<ProductBadge, "placement">,
  placement: BadgePlacement,
): boolean {
  if (!isOnPhoto({ placement }) || isOnPhoto(badge)) return true;
  return badges.filter(isOnPhoto).length < BADGES_ON_PHOTO_MAX;
}

/** True while the product has room for another badge. */
export function roomForBadge(count: number): boolean {
  return count < BADGES_MAX;
}

/**
 * Where a preset's number sits in its words, so the form can select it and
 * the seller's first keystroke replaces it. Null when there is no number, or
 * the seller's language put it somewhere it cannot be found.
 */
export function countRange(preset: Pick<LocalBadgePreset, "label" | "countText">): [number, number] | null {
  if (!preset.countText) return null;
  const at = preset.label.indexOf(preset.countText);
  return at === -1 ? null : [at, at + preset.countText.length];
}
