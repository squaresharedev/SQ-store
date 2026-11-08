import { REVIEW_IMPORT_SOURCES, isReviewImportSource } from "@/lib/reviews/sources";

/**
 * The looks of the review import's beams graphic (components/products/
 * ReviewImportBeams): which platforms send reviews, how they are laid out
 * around the product page, what travels along the beams, and how it is drawn.
 * Pure data, so the dev lab (app/dev/review-import-lab) tunes exactly what ships.
 */

/**
 * The platforms a seller's reviews come from: first the review apps the
 * importer reads (REVIEW_IMPORT_SOURCES, the same ids), then places it does
 * not read yet, which a look only shows once the importer does or the page
 * says otherwise.
 */
export const BEAM_SOURCES = [...REVIEW_IMPORT_SOURCES, "google", "etsy", "facebook", "trustpilot"] as const;
export type BeamSource = (typeof BEAM_SOURCES)[number];

/** Whether the importer reads `source` today. */
export const importsToday = (source: BeamSource) => isReviewImportSource(source);

/** How many platforms a look shows; each sends one batch of reviews. */
export const BEAM_SOURCE_COUNT = { min: 2, max: 4 } as const;

/**
 * Where the platforms sit. `split`: in a column on the left, their beams
 * curving right into the product page. `arc`: the same column bowed towards
 * the page. `sides`: half on each side of it. `stack`: in a row above it, the
 * beams falling in (what every layout becomes where the stage is narrow).
 */
export const BEAM_LAYOUTS = ["split", "arc", "sides", "stack"] as const;
export type BeamLayout = (typeof BEAM_LAYOUTS)[number];

/**
 * What travels along a beam: a pulse of light alone; a badge with how many
 * reviews the platform brings; one of its reviews as a face and stars; one as
 * a small card with its words; or a stream of reviewers' faces, one after another.
 */
export const BEAM_TRAVELLERS = ["pulse", "count", "review", "card", "stream"] as const;
export type BeamTraveller = (typeof BEAM_TRAVELLERS)[number];

/** Where a travelling review ends: fading into the page as its row appears, or gliding on into that row. */
export const BEAM_LANDINGS = ["fade", "dock"] as const;
export type BeamLanding = (typeof BEAM_LANDINGS)[number];

/** How a beam is drawn at rest: a faint line, or a dotted one that flows towards the page. */
export const BEAM_LINES = ["line", "dots"] as const;
export type BeamLine = (typeof BEAM_LINES)[number];

/**
 * How a platform is marked. `plain`: an icon for what kind of place it is
 * (a shop, a map pin, a bag, people, a star) in the app's own ink, with its
 * name in text: no company's logo or anything like it. `lettered`: its
 * initial on a round tile in the colours it is known by, which reads like the
 * company's own logo and so needs its permission before it ships.
 */
export const BEAM_MARKS = ["plain", "lettered"] as const;
export type BeamMark = (typeof BEAM_MARKS)[number];

/** How the platforms send: one after another, or all at once. */
export const BEAM_CARRIES = ["each", "together"] as const;
export type BeamCarry = (typeof BEAM_CARRIES)[number];

/** Lettered marks in the colours their companies are known by, or in the app's own ink. */
export const BEAM_COLOURS = ["brand", "mono"] as const;
export type BeamColour = (typeof BEAM_COLOURS)[number];

/** The light's colour: each platform's own (ink for plain marks), or the app's purple accent (acid) for all of them. */
export const BEAM_GLOWS = ["source", "acid"] as const;
export type BeamGlow = (typeof BEAM_GLOWS)[number];

/** The beat lengths' multiplier: over 1 is slower. */
export const BEAM_PACE = { min: 0.6, max: 1.6 } as const;

export type ReviewImportBeamsLook = {
  layout: BeamLayout;
  /** The platforms drawn, in order (BEAM_SOURCE_COUNT of them). */
  sources: BeamSource[];
  marks: BeamMark;
  /** Each platform's name beside its mark, or the mark alone. */
  labels: boolean;
  traveller: BeamTraveller;
  landing: BeamLanding;
  line: BeamLine;
  carry: BeamCarry;
  colour: BeamColour;
  glow: BeamGlow;
  pace: number;
};

/**
 * What the import page shows (picked 2026-11-08 in the lab, "Docking along
 * flowing dots"): the review apps the importer reads, in plain icons, each
 * sending a review along a dotted beam that docks into the page's list.
 */
export const REVIEW_IMPORT_BEAMS_LOOK: ReviewImportBeamsLook = {
  layout: "split",
  sources: ["judgeme", "loox", "yotpo", "shopify"],
  marks: "plain",
  labels: true,
  traveller: "review",
  landing: "dock",
  line: "dots",
  carry: "each",
  colour: "brand",
  glow: "source",
  pace: 1,
};

/** `sources` as a look can draw them: known ones, each once, at most the most; too few falls back to the default. */
function drawableSources(sources: readonly unknown[]): BeamSource[] {
  const known = sources.filter(
    (source, index): source is BeamSource =>
      (BEAM_SOURCES as readonly unknown[]).includes(source) && sources.indexOf(source) === index,
  );
  return known.length < BEAM_SOURCE_COUNT.min ? REVIEW_IMPORT_BEAMS_LOOK.sources : known.slice(0, BEAM_SOURCE_COUNT.max);
}

/** `look` over the default one, put right where it asks for what cannot be drawn. */
export function beamsLook(look: Partial<ReviewImportBeamsLook> = {}): ReviewImportBeamsLook {
  const full = { ...REVIEW_IMPORT_BEAMS_LOOK, ...look };
  return {
    ...full,
    sources: drawableSources(full.sources),
    pace: Math.min(BEAM_PACE.max, Math.max(BEAM_PACE.min, full.pace)),
  };
}
