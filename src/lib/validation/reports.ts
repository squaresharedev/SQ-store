import { z } from "zod";
import {
  emailAddress,
  multiLineText,
  uuidField,
} from "@/lib/validation/inputs";
import {
  REPORT_DETAILS_MAX,
  REPORT_ISSUE_KEYS,
  REPORT_REASON_COPY,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/validation/report-constants";

/**
 * THE REPORT SCHEMA. What a buyer may tell us is wrong with a listing.
 *
 * Constants and types (REPORT_REASONS, REPORT_REASON_COPY, REPORT_DETAILS_MAX,
 * REPORT_ISSUE_KEYS, REPORT_TARGET_TYPES) live in report-constants.ts so the
 * dialog body can import them without pulling zod into the buyer page bundle.
 * Everything is re-exported below so server callers keep their import path.
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

// Re-export so server callers keep their existing import paths unchanged.
export {
  REPORT_DETAILS_MAX,
  REPORT_ISSUE_KEYS,
  REPORT_REASON_COPY,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  type ReportReason,
  type ReportTargetType,
};

/**
 * The wire shape the endpoint parses.
 *
 * `strictObject`, so an unknown key is refused rather than dropped: a client
 * sending a field we ignore is a bug worth surfacing at the boundary instead
 * of discovering later when someone asks why it never arrived.
 */
export const reportSchema = z.strictObject({
  targetType: z.enum(REPORT_TARGET_TYPES, { error: REPORT_ISSUE_KEYS.targetType }),
  targetId: uuidField("reportTarget"),
  reason: z.enum(REPORT_REASONS, { error: REPORT_ISSUE_KEYS.reason }),
  details: multiLineText({ field: "reportDetails", max: REPORT_DETAILS_MAX }).default(""),
  // Empty means "not given", which is the common case and not an error. The
  // union rather than `.optional()` keeps the parsed type a plain string, so
  // no call site has to decide what `undefined` means.
  reporterEmail: z
    .union([z.literal(""), emailAddress("reporter")])
    .default(""),
});

export type ReportInput = z.infer<typeof reportSchema>;
