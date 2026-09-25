/**
 * The SHORT VERSION of Square Share's Terms of Service: what a seller reads
 * where they agree to them (the welcome flow's terms step, Settings › Legal).
 *
 * A SUMMARY, NEVER A SUBSTITUTE. Every place this renders also links the full
 * Terms (LEGAL_LINKS.terms) and says the full text is what applies. It follows
 * the full document on the marketing site (Home: src/content/legal/terms.ts).
 * When that document changes, update TERMS_LAST_UPDATED and these points, and
 * bump LEGAL_VERSION (lib/settings/constants.ts) so everyone agrees again: an
 * acceptance is only worth something if it names what was accepted.
 *
 * The words live in the catalogue (Settings.legal.termsSummary, English in
 * messages/en/settings.json); this module only fixes their order, and each
 * render site resolves the keys in the reader's language. Every point is legal
 * text, so a translation of one needs qualified review before it ships.
 */

import type { MessageKey } from "@/i18n/types";

/** The full Terms' own "last updated" date, as an ISO calendar date. Render it
 *  with formatLongCalendarDate (lib/format/calendar.ts). */
export const TERMS_LAST_UPDATED = "2026-09-09";

export type TermsSummarySection = {
  heading: MessageKey;
  points: readonly MessageKey[];
};

export const TERMS_SUMMARY: readonly TermsSummarySection[] = [
  {
    heading: "Settings.legal.termsSummary.sections.parties.heading",
    points: [
      "Settings.legal.termsSummary.sections.parties.points.merchantOfRecord",
      "Settings.legal.termsSummary.sections.parties.points.eligibility",
    ],
  },
  {
    heading: "Settings.legal.termsSummary.sections.account.heading",
    points: [
      "Settings.legal.termsSummary.sections.account.points.security",
      "Settings.legal.termsSummary.sections.account.points.traderDetails",
    ],
  },
  {
    heading: "Settings.legal.termsSummary.sections.selling.heading",
    points: [
      "Settings.legal.termsSummary.sections.selling.points.lawfulListings",
      "Settings.legal.termsSummary.sections.selling.points.consumerRights",
      "Settings.legal.termsSummary.sections.selling.points.taxesAndRecords",
    ],
  },
  {
    heading: "Settings.legal.termsSummary.sections.payments.heading",
    points: [
      "Settings.legal.termsSummary.sections.payments.points.stripe",
      "Settings.legal.termsSummary.sections.payments.points.feesAndDisputes",
    ],
  },
  {
    heading: "Settings.legal.termsSummary.sections.notAllowed.heading",
    points: [
      "Settings.legal.termsSummary.sections.notAllowed.points.products",
      "Settings.legal.termsSummary.sections.notAllowed.points.conduct",
      "Settings.legal.termsSummary.sections.notAllowed.points.tampering",
    ],
  },
  {
    heading: "Settings.legal.termsSummary.sections.content.heading",
    points: ["Settings.legal.termsSummary.sections.content.points.ownership"],
  },
  {
    heading: "Settings.legal.termsSummary.sections.liability.heading",
    points: [
      "Settings.legal.termsSummary.sections.liability.points.cap",
      "Settings.legal.termsSummary.sections.liability.points.termination",
      "Settings.legal.termsSummary.sections.liability.points.changesAndLaw",
      "Settings.legal.termsSummary.sections.liability.points.policies",
    ],
  },
];
