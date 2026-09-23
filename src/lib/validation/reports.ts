import { z } from "zod";
import {
  emailAddress,
  multiLineText,
  uuidField,
} from "@/lib/validation/inputs";

/**
 * THE REPORT SCHEMA. What a buyer may tell us is wrong with a listing.
 *
 * This is the only unauthenticated WRITE surface in the app, so the gates are
 * the point. Everything user-typed goes through a primitive from inputs.ts;
 * the two enums are closed lists, not free text, because the report reason is
 * what the staff queue sorts on and the ranking penalty counts.
 *
 * MIRROR of reportSchema in @squaresharedev/moderation. The marketplace posts
 * the same shape to its own endpoint and both land in one `reports` table, so
 * the vocabularies have to match: a reason accepted here and unknown there is
 * a row the admin queue cannot label.
 *
 * WHAT IS DELIBERATELY OPTIONAL. Only the category is required. The free text
 * and the contact address are both asked for and neither is a gate:
 *
 *   - Details, because a person who has spotted something illegal should not
 *     have to compose a paragraph before they can tell anyone. A bare category
 *     from a stranger is still a report worth having.
 *   - Email, because under the EU Digital Services Act (Art. 16) a notice with
 *     contact details is the form that gives a platform actual knowledge, and
 *     Art. 16(5) expects us to confirm receipt. Requiring it would also stop
 *     most people reporting anything at all, which is the worse failure.
 */

/**
 * What a reporter says is wrong. Ordered by how fast staff must look, not
 * alphabetically: the admin queue sorts on this order, so moving an entry
 * changes triage.
 *
 * `illegal` is first and is deliberately broad. Someone who knows a listing
 * breaks the law rarely knows which law, and making them choose would push
 * genuinely urgent notices into `other`.
 */
export const REPORT_REASONS = [
  "illegal",
  "sexual",
  "violence",
  "hate",
  "counterfeit",
  "scam",
  "spam",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/** The label and helper line the dialog shows per reason. Shared with the
 *  marketplace so both surfaces ask the same question in the same words,
 *  which is what makes the resulting counts comparable. */
export const REPORT_REASON_COPY: Record<
  ReportReason,
  { label: string; hint: string }
> = {
  illegal: {
    label: "Illegal goods or activity",
    hint: "Selling something that is against the law, or using the listing to arrange it.",
  },
  sexual: {
    label: "Sexual content",
    hint: "Explicit imagery, or anything sexualising a minor.",
  },
  violence: {
    label: "Violence or gore",
    hint: "Graphic injury, threats, or content glorifying violence.",
  },
  hate: {
    label: "Hate or harassment",
    hint: "Attacks on a person or group, or hate symbolism.",
  },
  counterfeit: {
    label: "Counterfeit or stolen",
    hint: "Fake branded goods, or someone else's work sold as their own.",
  },
  scam: {
    label: "Scam or fraud",
    hint: "The listing looks designed to take money without delivering.",
  },
  spam: {
    label: "Spam",
    hint: "Repetitive, misleading, or not a real product at all.",
  },
  other: {
    label: "Something else",
    hint: "Tell us below and a person will read it.",
  },
};

/** What SQ-store's own surfaces can report. The shared table also carries
 *  `artifact` and `profile`; those arrive from the marketplace, which is why
 *  they are absent here rather than accepted and ignored. */
export const REPORT_TARGET_TYPES = ["product", "storefront"] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** Long enough for a real explanation, short enough that the column is never
 *  somewhere to paste a payload. Mirrors REPORT_DETAILS_MAX. */
export const REPORT_DETAILS_MAX = 1000;

/**
 * The wire shape the endpoint parses.
 *
 * `strictObject`, so an unknown key is refused rather than dropped: a client
 * sending a field we ignore is a bug worth surfacing at the boundary instead
 * of discovering later when someone asks why it never arrived.
 */
export const reportSchema = z.strictObject({
  targetType: z.enum(REPORT_TARGET_TYPES, {
    error: "That is not something you can report here.",
  }),
  targetId: uuidField("That item"),
  reason: z.enum(REPORT_REASONS, { error: "Pick what is wrong with it." }),
  details: multiLineText({ label: "Your description", max: REPORT_DETAILS_MAX }).default(""),
  // Empty means "not given", which is the common case and not an error. The
  // union rather than `.optional()` keeps the parsed type a plain string, so
  // no call site has to decide what `undefined` means.
  reporterEmail: z
    .union([z.literal(""), emailAddress("Your email")])
    .default(""),
});

export type ReportInput = z.infer<typeof reportSchema>;
