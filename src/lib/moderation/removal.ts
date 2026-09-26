// THE REMOVAL GATE. Whether a piece of content may still be served, and the
// words a seller is given when it may not.
//
// PURE ON PURPOSE, exactly like lib/settings/trader-identity.ts and for the
// same reason: the public reads, the dashboard banners and the seller's
// notification all have to agree about what "removed" means, so there is one
// predicate and no second opinion. Nothing server-only, so a Client Component
// can render the banner from the same source the embed route gates on. The
// words are message references, resolved in the SELLER'S language where they
// render.

import type { Locale } from "@/i18n/locales";
import { msg, type MessageRef } from "@/i18n/types";
import { dateTimeFormat, intlTag } from "@/lib/format/intl";
import { fixFieldsFor, type FixTarget } from "@/lib/moderation/fix-fields";
//
// MIRROR OF @squaresharedev/moderation. That package is the cross-repo
// contract (the admin panel writes these values, the marketplace reads them);
// this file is SQ-store's copy, kept in step by hand the same way
// types/storefront.ts mirrors the storefront contract. If you change the
// vocabulary here, change it there in the same commit or the admin panel will
// write a ground this app cannot render.
//
// WHY MODERATION IS NOT `status`. `status` is the seller's own field (active,
// draft, archived) and they may set it from the dashboard whenever they like.
// A takedown recorded there would be reversible by the person it was applied
// to. The database enforces the split (guard_moderation_columns refuses any
// write to moderation_* that is not service_role); this module is the reading
// side of it.

/** Exactly the columns a visibility decision needs. Every public read that
 *  gates on removal selects this fragment, so a read cannot accidentally ask
 *  the question without having fetched the answer. */
export const MODERATION_GATE_SELECT = "moderation_status" as const;

/** The same fragment plus what a SELLER is shown about their own content.
 *  Never used on a public read: `moderation_note` is staff prose written for
 *  one person, and that person is not the buyer. */
export const MODERATION_DETAIL_SELECT =
  "moderation_status, moderation_ground, moderation_note, moderated_at, moderation_review_requested_at, moderation_fields, moderation_decision_id" as const;

/**
 * What the platform may do with a piece of content.
 *
 *   ok       served normally.
 *   paused   hidden until the seller fixes what staff pointed at and staff
 *            approve the change. The seller has a way back from here.
 *   removed  hidden for good. The only way back is an appeal.
 *
 * Both non-ok states are hidden by the same gate below; the difference is
 * entirely in what the SELLER is told and offered.
 */
export type ModerationStatus = "ok" | "paused" | "removed";

/** Which kind of takedown a seller is looking at, for the surfaces that word
 *  the two differently. Anything unrecognised that is not `ok` reads as
 *  `removed`: the stricter reading, and the one that offers no button whose
 *  server half would refuse it. */
export type TakedownKind = "paused" | "removed";

export function takedownKind(status: string | null | undefined): TakedownKind | null {
  if (isContentVisible(status)) return null;
  return status === "paused" ? "paused" : "removed";
}

/**
 * May this be served to the public right now?
 *
 * FAILS CLOSED, which is why it takes `string | null | undefined` rather than
 * `ModerationStatus`. Callers hand it whatever the database returned, and that
 * includes the `null` a failed or partial read produces. An unreadable answer
 * is not evidence that content is fine.
 *
 * `undefined` is the one deliberate exception: it means the caller is holding
 * a row shape from before these columns existed (an old cached payload, a test
 * fixture). Reading that as hidden would black out the catalogue the moment
 * the gate deployed ahead of the migration, so it reads as visible. Anything
 * actually selected from a moderation-aware column arrives as a string.
 */
export function isContentVisible(status: string | null | undefined): boolean {
  if (status === undefined) return true;
  return status === "ok";
}

/** Convenience for the common row shape, so call sites read as a sentence. */
export function isRowVisible(
  row: { moderation_status?: string | null } | null | undefined,
): boolean {
  if (!row) return false;
  return isContentVisible(row.moderation_status);
}

/**
 * Why staff removed something. This is the PLATFORM's finding, not the
 * reporter's allegation: a stranger picking "scam" from a dialog does not
 * decide what a seller is told, a person reviewing it does. Kept as a separate
 * list from the report reasons for exactly that reason.
 */
export const REMOVAL_GROUNDS = [
  "illegal",
  "sexual",
  "violence",
  "hate",
  "counterfeit",
  "scam",
  "spam",
  "other",
] as const;

export type RemovalGround = (typeof REMOVAL_GROUNDS)[number];

/** Narrow a value that arrived as a database string or a form field. */
export function isRemovalGround(value: unknown): value is RemovalGround {
  return (
    typeof value === "string" && (REMOVAL_GROUNDS as readonly string[]).includes(value)
  );
}

/** The staff note is shown to the seller verbatim, so it is bounded like any
 *  other published text. Mirrors the moderation_note CHECK. */
export const REMOVAL_NOTE_MAX = 500;

/**
 * The full statement of reasons for one removal: the ground in plain words,
 * what it means, then whatever the reviewer added, verbatim.
 *
 * Assembled here rather than in each surface so the seller reads the same
 * sentence in the notification, on the product page banner and in the list.
 * A seller whose content came down is entitled to know why (EU Digital
 * Services Act, Art. 17), and "entitled" means it cannot depend on which
 * screen they happened to open.
 *
 * The wording (Products.removal.statement) is written to be understood by
 * someone who has just lost a listing and is upset about it: plain, specific
 * about what was wrong, and silent about intent, because we do not know
 * theirs. An unrecognised ground reads as `other`. The staff note is data in
 * whatever language staff wrote it, so it goes in as a value.
 */
export function removalStatement(
  ground: string | null | undefined,
  note?: string | null,
): MessageRef {
  const trimmed = (note ?? "").trim();
  return msg("Products.removal.statement", {
    ground: isRemovalGround(ground) ? ground : "other",
    noted: trimmed ? "yes" : "no",
    note: trimmed,
  });
}

/**
 * The statement as the seller's banner prints it. "Something else" is a picker
 * option for staff, not a finding, and in front of a sentence it reads as
 * noise, so `other` (and anything unknown) is the sentence alone; every other
 * ground is removalStatement. Mirror of groundedStatement in the admin panel.
 */
export function removalFinding(
  ground: string | null | undefined,
  note?: string | null,
): MessageRef {
  if (isRemovalGround(ground) && ground !== "other") return removalStatement(ground, note);
  const trimmed = (note ?? "").trim();
  return msg("Products.removal.statementUnlabelled", {
    noted: trimmed ? "yes" : "no",
    note: trimmed,
  });
}

/**
 * Everything a seller-side read needs to describe a takedown, built from the
 * raw columns in one place so the product list, the storefront list and the
 * edit page cannot disagree about which kind it is. Null when the content is
 * visible, which is what lets callers spread it straight into a row.
 */
export function takedownFromRow(
  row: {
    moderation_status?: string | null;
    moderation_ground?: string | null;
    moderation_note?: string | null;
    moderated_at?: string | null;
    moderation_review_requested_at?: string | null;
    moderation_fields?: readonly string[] | null;
    moderation_decision_id?: string | null;
  },
  target: FixTarget = "product",
): {
  kind: TakedownKind;
  ground: string | null;
  note: string | null;
  at: string | null;
  reviewRequestedAt: string | null;
  fields: string[];
  decisionId: string | null;
} | null {
  const kind = takedownKind(row.moderation_status);
  if (!kind) return null;
  return {
    kind,
    ground: row.moderation_ground ?? null,
    note: row.moderation_note ?? null,
    at: row.moderated_at ?? null,
    // What staff pointed at, in the order the seller meets it. Kept for a
    // removal too: it is part of the reasons, even with nothing left to fix.
    fields: fixFieldsFor(target, row.moderation_fields),
    // Null for a takedown older than the decisions table: it still shows, it
    // just has no statement to download and no decision to appeal against.
    decisionId: row.moderation_decision_id ?? null,
    // Only meaningful while paused. A removed row should never carry one (every
    // staff decision clears it), but if a stale one survived it must not make a
    // final decision look like it is waiting on someone.
    reviewRequestedAt:
      kind === "paused" ? (row.moderation_review_requested_at ?? null) : null,
  };
}

/** A takedown's dates, as every seller surface prints them. One formatter so
 *  the banner and the "sent for review" line cannot disagree about the day. */
const TAKEDOWN_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

/** `"2026-09-23T12:00:00Z"` -> `"23 September 2026"` in English. */
export function formatTakedownDate(iso: string, locale: Locale): string {
  return dateTimeFormat(intlTag(locale, "en-IE"), TAKEDOWN_DATE).format(new Date(iso));
}

/** Where a seller writes when the dashboard is not enough: a question about a
 *  decision, or one the in-app appeal cannot take. The statement of reasons
 *  prints it. Mirror of APPEAL_EMAIL in the admin panel. */
export const REMOVAL_APPEAL_EMAIL = "support@squareshare.eu";

/**
 * A decision's reference, as the statement, the banner and staff all quote
 * it: "MD-" and the first ten hex digits of its id, upper-cased. Derived rather
 * than stored so there is no second identifier to keep in step. Mirror of
 * decisionReference in the admin panel.
 */
export function decisionReference(decisionId: string): string {
  return `MD-${decisionId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}
