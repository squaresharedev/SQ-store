// Zod-free constants for the report feature.
//
// Split from reports.ts so ReportDialogPanel (the lazy-loaded dialog body)
// can import REPORT_REASONS and REPORT_REASON_COPY without dragging zod into
// the buyer page's initial bundle. reports.ts re-exports everything from here,
// so server callers keep their existing import path unchanged.

import { msg, type MessageRef } from "@/i18n/types";
import type { MessageKey } from "@/i18n/types";

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
 *  which is what makes the resulting counts comparable. The words are in the
 *  catalogue (ProductPage.report.reasons), shown in the REPORTER'S language. */
export const REPORT_REASON_COPY: Record<
  ReportReason,
  { label: MessageRef; hint: MessageRef }
> = {
  illegal: {
    label: msg("ProductPage.report.reasons.illegal.label"),
    hint: msg("ProductPage.report.reasons.illegal.hint"),
  },
  sexual: {
    label: msg("ProductPage.report.reasons.sexual.label"),
    hint: msg("ProductPage.report.reasons.sexual.hint"),
  },
  violence: {
    label: msg("ProductPage.report.reasons.violence.label"),
    hint: msg("ProductPage.report.reasons.violence.hint"),
  },
  hate: {
    label: msg("ProductPage.report.reasons.hate.label"),
    hint: msg("ProductPage.report.reasons.hate.hint"),
  },
  counterfeit: {
    label: msg("ProductPage.report.reasons.counterfeit.label"),
    hint: msg("ProductPage.report.reasons.counterfeit.hint"),
  },
  scam: {
    label: msg("ProductPage.report.reasons.scam.label"),
    hint: msg("ProductPage.report.reasons.scam.hint"),
  },
  spam: {
    label: msg("ProductPage.report.reasons.spam.label"),
    hint: msg("ProductPage.report.reasons.spam.hint"),
  },
  other: {
    label: msg("ProductPage.report.reasons.other.label"),
    hint: msg("ProductPage.report.reasons.other.hint"),
  },
};

/**
 * What SQ-store's own surfaces can report. `seller` arrives with the id of the
 * STOREFRONT the buyer was looking at, never an account id (the page does not
 * have one to give), and the endpoint files it against the account behind
 * that storefront as the shared table's `profile` target. `artifact` reports
 * arrive from the marketplace, which is why that is absent here rather than
 * accepted and ignored.
 */
export const REPORT_TARGET_TYPES = ["product", "storefront", "seller"] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** Long enough for a real explanation, short enough that the column is never
 *  somewhere to paste a payload. Mirrors REPORT_DETAILS_MAX. */
export const REPORT_DETAILS_MAX = 1000;

/**
 * The two refusals only this schema words. Message keys, like every other
 * schema's, but kept with the report's own copy rather than in the shared
 * Validation namespace; the endpoint resolves them in the reporter's language.
 */
export const REPORT_ISSUE_KEYS = {
  targetType: "ProductPage.report.api.targetType",
  reason: "ProductPage.report.api.reason",
} as const satisfies Record<string, MessageKey>;
