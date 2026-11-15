import { BEFORE_PICK, type AttentionDesignProps, type LabPreset } from "./lab-model";

/** A preset designed against the card as it was before the pick (BEFORE_PICK). */
const before = (props: Partial<AttentionDesignProps>): AttentionDesignProps => ({ ...BEFORE_PICK, ...props });

/** The tab the lab opens on: what shipped, beside the pick it came from. */
export const CHOSEN_GROUP = "chosen";

/** The tab that lists the shortlist below instead of a group of its own. */
export const SHORTLIST_GROUP = "shortlist";

/** The lab's tabs, in order. A preset names its tab by id. */
export const LAB_GROUPS: readonly { id: string; label: string }[] = [
  { id: CHOSEN_GROUP, label: "Chosen" },
  { id: SHORTLIST_GROUP, label: "Shortlist" },
  { id: "tidy", label: "Today's card, tidied" },
  { id: "rows", label: "Tap rows" },
  { id: "count", label: "Count-led" },
  { id: "grouped", label: "Grouped" },
  { id: "lead", label: "Lead + list" },
  { id: "tiles", label: "Tiles" },
  { id: "reference", label: "Reference" },
];

/** The picks, best first, each with why it made the cut. */
export const LAB_SHORTLIST: readonly { id: string; why: string }[] = [
  {
    id: "rows-chevron",
    why: "Fixes both complaints at once: on a phone each row is one line of words and a chevron, the whole row is the button, and nothing wraps. The sentence comes back on a wide screen.",
  },
  {
    id: "rows-chevron-clamp",
    why: "The same rows, keeping one grey line of the sentence on a phone for anyone who wants the why. Still never more than two lines a row.",
  },
  {
    id: "count-chevron",
    why: "The numbers lead in a column, so 25 / 3 / 1 / 124 / 4 can be read without reading a word. The busiest-looking store reads calmest.",
  },
  {
    id: "tidy-responsive",
    why: "The smallest change from today: same look and words, but the action always sits under the text on a phone and at the end on a wide screen, never one then the other.",
  },
  {
    id: "rows-boxed",
    why: "Reads like a phone's settings list: an icon in a square per kind, the label, one line, a chevron. Familiar, roomy, very tappable.",
  },
  {
    id: "grouped-rows",
    why: "Splits buyers waiting (to ship, cancellations, hidden products) from setup chores, so the first thing read is the thing that is costing sales.",
  },
  {
    id: "lead-limit",
    why: "The most pressing item gets its sentence and a real button; the rest are one-line rows, three at most until you ask for more.",
  },
  {
    id: "tiles-chevron-ink",
    why: "A grid of small cards, two across on a phone; urgent ones get an ink border. Compact on a busy store, though long labels run to three lines.",
  },
];

export const LAB_PRESETS: readonly LabPreset[] = [
  // Picked 2026-11-15 as the JSX below; shipped as components/dashboard/NeedsAttention
  // (rows in AttentionRows, icons in attention-icons.ts, the urgent flag and the
  // four-row limit in lib/dashboard/attention.ts).
  {
    id: "shipped",
    name: "Shipped",
    group: CHOSEN_GROUP,
    note: "The real NeedsAttention: tap rows with an icon per kind and a chevron, no sentence at any width (a screen reader still hears it), an ink bar on rows with a buyer waiting, four rows then Show more.",
    fit: "on-brand",
    props: {},
    real: true,
  },
  {
    id: "pick",
    name: "Your pick, as pasted",
    group: CHOSEN_GROUP,
    note: '<NeedsAttention marker="kind" detail="none" action="chevron" rowLink urgency="bar" limit={4} decoration="none" />, drawn by the lab over the card as it was.',
    fit: "on-brand",
    props: before({ marker: "kind", detail: "none", action: "chevron", rowLink: true, urgency: "bar", limit: 4, decoration: "none" }),
  },

  // Reference --------------------------------------------------------------
  {
    id: "before",
    name: "Before the pick",
    group: "reference",
    note: "The card until 2026-11-15: the same alert circle on every row, the whole sentence, and the action at the end when it fits or wrapped under the icon when it does not.",
    fit: "on-brand",
    props: before({}),
  },
  {
    id: "shipped-no-dots",
    name: "Shipped, no texture",
    group: "reference",
    note: "Today's card without the dot texture fading in behind the first rows' words.",
    fit: "on-brand",
    props: before({ decoration: "none" }),
  },

  // Today's card, tidied -----------------------------------------------------
  {
    id: "tidy-under",
    name: "Action always under",
    group: "tidy",
    note: "Today's rows with the action always under the words, lined up with the label, at every width.",
    fit: "on-brand",
    props: before({ action: "under" }),
  },
  {
    id: "tidy-under-clamp",
    name: "Under, one line",
    group: "tidy",
    note: "Action under the words, the sentence cut to one line, no texture behind the text.",
    fit: "on-brand",
    props: before({ action: "under", detail: "clamp", decoration: "none" }),
  },
  {
    id: "tidy-responsive",
    name: "Under on a phone, end on wide",
    group: "tidy",
    note: "Today's look with an icon per kind; the action sits under the words on a phone and at the row's end on a wide card.",
    fit: "on-brand",
    props: before({ action: "responsive", marker: "kind", decoration: "none" }),
  },
  {
    id: "tidy-end",
    name: "Action always at the end",
    group: "tidy",
    note: "The action pinned to the right of every row, the sentence cut to one line so the words column stays readable.",
    fit: "stretch",
    props: before({ action: "end", detail: "clamp", decoration: "none" }),
  },

  // Tap rows -----------------------------------------------------------------
  {
    id: "rows-chevron",
    name: "Tap rows",
    group: "rows",
    note: "Each row is one link: icon per kind, the label, a chevron. The sentence shows only on a wide card.",
    fit: "on-brand",
    props: before({ action: "chevron", marker: "kind", detail: "wide", decoration: "none" }),
  },
  {
    id: "rows-chevron-clamp",
    name: "Tap rows, one line",
    group: "rows",
    note: "Tap rows that keep one grey line of the sentence on a phone.",
    fit: "on-brand",
    props: before({ action: "chevron", marker: "kind", detail: "clamp", decoration: "none" }),
  },
  {
    id: "rows-boxed",
    name: "Settings list",
    group: "rows",
    note: "Icon in a square, label, one line of the sentence, chevron, a little roomier: a phone's settings list.",
    fit: "on-brand",
    props: before({ action: "chevron", marker: "boxed", detail: "clamp", density: "roomy", decoration: "none" }),
  },
  {
    id: "rows-words-under",
    name: "Tap rows, words under",
    group: "rows",
    note: "The whole row is the link, and the action's words still sit under the label so it says what tapping does.",
    fit: "on-brand",
    props: before({ rowLink: true, action: "under", marker: "kind", detail: "none", decoration: "none" }),
  },
  {
    id: "rows-inbox",
    name: "Inbox",
    group: "rows",
    note: "Tight one-liners with a dot, urgent ones in ink, a count beside the title: like an unread list.",
    fit: "stretch",
    props: before({ action: "chevron", marker: "dot", detail: "none", urgency: "ink", density: "tight", decoration: "none", titleCount: true }),
  },
  {
    id: "rows-bar",
    name: "Flagged rows",
    group: "rows",
    note: "Tap rows where anything with a buyer waiting carries a short ink bar on the card's left edge.",
    fit: "on-brand",
    props: before({ action: "chevron", marker: "kind", detail: "wide", urgency: "bar", decoration: "none" }),
  },

  // Count-led ----------------------------------------------------------------
  {
    id: "count-chevron",
    name: "Numbers first",
    group: "count",
    note: "The count in its own column, then the words without it, then a chevron; rows with no number show their icon.",
    fit: "on-brand",
    props: before({ layout: "count", action: "chevron", detail: "none", decoration: "none" }),
  },
  {
    id: "count-clamp",
    name: "Numbers first, one line",
    group: "count",
    note: "Count column with one line of the sentence under each label, urgent numbers in ink and the rest grey.",
    fit: "on-brand",
    props: before({ layout: "count", action: "chevron", detail: "clamp", urgency: "ink", decoration: "none" }),
  },
  {
    id: "count-words",
    name: "Numbers first, with actions",
    group: "count",
    note: "Count column, the action's words under the label on a phone and at the end on a wide card.",
    fit: "on-brand",
    props: before({ layout: "count", action: "responsive", detail: "wide", decoration: "none" }),
  },

  // Grouped ------------------------------------------------------------------
  {
    id: "grouped-rows",
    name: "Waiting on you / when you can",
    group: "grouped",
    note: "Two small headings: rows with buyers waiting first, setup chores second; tap rows with one line each.",
    fit: "on-brand",
    props: before({ urgency: "group", action: "chevron", marker: "kind", detail: "clamp", decoration: "none" }),
  },
  {
    id: "grouped-count",
    name: "Grouped numbers",
    group: "grouped",
    note: "The same two groups as count-led rows with no sentence at all.",
    fit: "on-brand",
    props: before({ layout: "count", urgency: "group", action: "chevron", detail: "none", decoration: "none" }),
  },

  // Lead + list ----------------------------------------------------------------
  {
    id: "lead-chevron",
    name: "One first",
    group: "lead",
    note: "The top item in a grey block with its sentence and a black button; everything else as one-line tap rows.",
    fit: "on-brand",
    props: before({ layout: "lead", action: "chevron", marker: "kind", detail: "none", decoration: "none" }),
  },
  {
    id: "lead-limit",
    name: "One first, three more",
    group: "lead",
    note: "The lead block, then at most three rows and a Show more, with the item count beside the title.",
    fit: "on-brand",
    props: before({ layout: "lead", action: "chevron", marker: "kind", detail: "none", limit: 3, titleCount: true, decoration: "none" }),
  },

  // Tiles --------------------------------------------------------------------
  {
    id: "tiles-plain",
    name: "Tiles",
    group: "tiles",
    note: "Two small cards across on a phone, three on a wide card: icon, label, the action's words at the foot.",
    fit: "stretch",
    props: before({ layout: "tiles", marker: "kind", detail: "none", action: "under", decoration: "none" }),
  },
  {
    id: "tiles-chevron-ink",
    name: "Tiles, urgent in ink",
    group: "tiles",
    note: "Tiles with a chevron at the foot; anything with a buyer waiting gets an ink border.",
    fit: "stretch",
    props: before({ layout: "tiles", marker: "kind", detail: "none", action: "chevron", urgency: "ink", decoration: "none" }),
  },
  {
    id: "tiles-boxed",
    name: "Tiles with a line",
    group: "tiles",
    note: "Tiles with the icon in a square and two lines of the sentence.",
    fit: "off-brand",
    props: before({ layout: "tiles", marker: "boxed", detail: "clamp", action: "under", decoration: "none" }),
  },
];
