// THE REMOVAL GATE. Whether a piece of content may still be served, and the
// words a seller is given when it may not.
//
// PURE ON PURPOSE, exactly like lib/settings/trader-identity.ts and for the
// same reason: the public reads, the dashboard banners and the seller's
// notification all have to agree about what "removed" means, so there is one
// predicate and no second opinion. No imports, nothing server-only, so a
// Client Component can render the banner from the same source the embed route
// gates on.
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
  "moderation_status, moderation_ground, moderation_note, moderated_at, moderation_review_requested_at" as const;

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

/**
 * What the seller reads. Written to be understood by someone who has just lost
 * a listing and is upset about it: plain, specific about what was wrong, and
 * silent about intent, because we do not know theirs.
 */
export const REMOVAL_GROUND_COPY: Record<
  RemovalGround,
  { label: string; sellerExplanation: string }
> = {
  illegal: {
    label: "Illegal goods or activity",
    sellerExplanation:
      "It offered something that cannot be sold legally, or used the listing to arrange it.",
  },
  sexual: {
    label: "Sexual content",
    sellerExplanation: "It contained explicit sexual content.",
  },
  violence: {
    label: "Violence or gore",
    sellerExplanation: "It contained graphic violence.",
  },
  hate: {
    label: "Hate or harassment",
    sellerExplanation: "It attacked a person or group, or carried hate symbolism.",
  },
  counterfeit: {
    label: "Counterfeit or stolen",
    sellerExplanation:
      "It appeared to offer counterfeit goods, or work that belongs to someone else.",
  },
  scam: {
    label: "Scam or fraud",
    sellerExplanation:
      "It appeared designed to take payment without delivering what was promised.",
  },
  spam: {
    label: "Spam",
    sellerExplanation: "It was repetitive or misleading rather than a genuine listing.",
  },
  other: {
    label: "Something else",
    sellerExplanation: "It broke the platform rules.",
  },
};

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
 * The full statement of reasons for one removal.
 *
 * Assembled here rather than in each surface so the seller reads the same
 * sentence in the notification, on the product page banner and in the list.
 * A seller whose content came down is entitled to know why (EU Digital
 * Services Act, Art. 17), and "entitled" means it cannot depend on which
 * screen they happened to open.
 */
export function removalStatement(
  ground: string | null | undefined,
  note?: string | null,
): string {
  const base = isRemovalGround(ground)
    ? REMOVAL_GROUND_COPY[ground].sellerExplanation
    : REMOVAL_GROUND_COPY.other.sellerExplanation;
  const trimmed = (note ?? "").trim();
  return trimmed ? `${base} ${trimmed}` : base;
}

/**
 * Everything a seller-side read needs to describe a takedown, built from the
 * raw columns in one place so the product list, the storefront list and the
 * edit page cannot disagree about which kind it is. Null when the content is
 * visible, which is what lets callers spread it straight into a row.
 */
export function takedownFromRow(row: {
  moderation_status?: string | null;
  moderation_ground?: string | null;
  moderation_note?: string | null;
  moderated_at?: string | null;
  moderation_review_requested_at?: string | null;
}): {
  kind: TakedownKind;
  ground: string | null;
  note: string | null;
  at: string | null;
  reviewRequestedAt: string | null;
} | null {
  const kind = takedownKind(row.moderation_status);
  if (!kind) return null;
  return {
    kind,
    ground: row.moderation_ground ?? null,
    note: row.moderation_note ?? null,
    at: row.moderated_at ?? null,
    // Only meaningful while paused. A removed row should never carry one (every
    // staff decision clears it), but if a stale one survived it must not make a
    // final decision look like it is waiting on someone.
    reviewRequestedAt:
      kind === "paused" ? (row.moderation_review_requested_at ?? null) : null,
  };
}

/** A takedown's dates, as every seller surface prints them. One formatter so
 *  the banner and the "sent for review" line cannot disagree about the day. */
const TAKEDOWN_DATE = new Intl.DateTimeFormat("en-IE", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatTakedownDate(iso: string): string {
  return TAKEDOWN_DATE.format(new Date(iso));
}

/** Where a seller goes to argue. MVP: a real inbox rather than an appeals
 *  workflow. Named here so every surface points at the same place and there is
 *  one line to change when the workflow lands. */
export const REMOVAL_APPEAL_EMAIL = "support@squareshare.eu";

/** The mailto a removal banner offers, pre-addressed so the person on the
 *  other end knows which listing is being argued about. */
export function removalAppealHref(
  kind: "product" | "storefront",
  id: string,
  title: string,
): string {
  const subject = `Appeal: ${kind} removal (${title})`;
  const body = [
    `I would like this ${kind} reviewed again.`,
    "",
    `${kind === "product" ? "Product" : "Storefront"} id: ${id}`,
    `Name: ${title}`,
    "",
    "Why I think this was wrong:",
    "",
  ].join("\n");
  return `mailto:${REMOVAL_APPEAL_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}
