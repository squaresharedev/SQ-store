import { ANALYTICS_LOOK, FRAME_LOOK, PAYMENTS_LOOK } from "@/components/analytics/look";
import type { LabPreset } from "./lab-model";

// The lab's ready-made looks: the Payments tab's charts taken onto the
// analytics page whole, in parts, and one part at a time, each over the real
// page. "Chosen" is IMPORTED from what /analytics renders, "Before" and
// "Payments" from the looks they name, so none can drift from the code.
//
// The presets outside "Chosen" were written against the page as it was
// before the pick, so each spells out its whole look over BEFORE rather than
// over whatever /analytics renders now.

const BEFORE = FRAME_LOOK;

export const SHORTLIST_GROUP = "shortlist";
export const CHOSEN_GROUP = "chosen";

/** The tabs, in viewing order. */
export const LAB_GROUPS = [
  { id: CHOSEN_GROUP, label: "Chosen" },
  { id: SHORTLIST_GROUP, label: "Shortlist" },
  { id: "whole", label: "Whole page" },
  { id: "lead", label: "Revenue + tiles" },
  { id: "charts", label: "Charts" },
  { id: "colour", label: "Colour" },
  { id: "reference", label: "Reference" },
] as const;

export const LAB_PRESETS: LabPreset[] = [
  // Chosen: what shipped, and the three calls made for the user beside it
  {
    id: "chosen",
    group: CHOSEN_GROUP,
    name: "Shipped",
    note: "Card lead and trend tiles, joined, lines adding up, ink figure; every chart keeps full axes and money stays green.",
    fit: "on-brand",
    look: ANALYTICS_LOOK,
  },
  {
    id: "chosen-apart",
    group: CHOSEN_GROUP,
    name: "Shipped, card and tiles apart",
    note: "The same, with the tiles as cards of their own under the revenue card instead of joined to it.",
    fit: "on-brand",
    look: { ...ANALYTICS_LOOK, joined: false },
  },
  {
    id: "chosen-daily",
    group: CHOSEN_GROUP,
    name: "Shipped, each day",
    note: "The same, with the revenue line and the sparklines drawing each day's own figure instead of the total so far.",
    fit: "on-brand",
    look: { ...ANALYTICS_LOOK, line: "daily" },
  },
  {
    id: "chosen-scrub",
    group: CHOSEN_GROUP,
    name: "Shipped, scrub trend cards",
    note: "The same, with average order and each source's trend read by scrubbing, no axes, like the revenue card.",
    fit: "on-brand",
    look: { ...ANALYTICS_LOOK, trends: "scrub" },
  },

  // Whole page
  {
    id: "payments",
    group: "whole",
    name: "Payments, all of it",
    note: "The Payments tab's look on every chart: card lead joined to trend tiles, scrub lines adding up, quiet axes, purple money, ink figure.",
    fit: "on-brand",
    look: PAYMENTS_LOOK,
  },
  {
    id: "payments-green",
    group: "whole",
    name: "Payments, money stays green",
    note: "All of the Payments look, with money still green as the analytics palette has it; the figure in ink.",
    fit: "on-brand",
    look: { ...PAYMENTS_LOOK, money: "green" },
  },
  {
    id: "payments-daily",
    group: "whole",
    name: "Payments, day by day",
    note: "All of the Payments look, but every line draws each day's own figure instead of the running total.",
    fit: "on-brand",
    look: { ...PAYMENTS_LOOK, line: "daily" },
  },
  {
    id: "payments-ink",
    group: "whole",
    name: "Payments in ink",
    note: "All of the Payments look with money drawn in ink: black lines, grey washes, colour only in the chips.",
    fit: "stretch",
    look: { ...PAYMENTS_LOOK, money: "ink" },
  },
  {
    id: "frame-calm",
    group: "whole",
    name: "Frame kept, rest calm",
    note: "The corner-mark revenue hero stays; tiles, trend cards and every other chart take the Payments look.",
    fit: "on-brand",
    look: { ...PAYMENTS_LOOK, lead: "frame", joined: false, money: "green", figure: "green" },
  },

  // Revenue + tiles
  {
    id: "card-joined",
    group: "lead",
    name: "Card and tiles, joined",
    note: "Revenue as the Payments card with the trend tiles sharing its edges; the charts under it as now.",
    fit: "on-brand",
    look: { ...BEFORE, lead: "card", tiles: "trend", joined: true, line: "running", figure: "ink" },
  },
  {
    id: "card-apart",
    group: "lead",
    name: "Card and tiles, apart",
    note: "The same card and trend tiles, each a card of its own with a gap between.",
    fit: "on-brand",
    look: { ...BEFORE, lead: "card", tiles: "trend", joined: false, line: "running", figure: "ink" },
  },
  {
    id: "card-plain",
    group: "lead",
    name: "Card, plain tiles",
    note: "The Payments card for revenue over today's tiles (figure and hint, no chip or sparkline).",
    fit: "on-brand",
    look: { ...BEFORE, lead: "card", tiles: "plain", line: "running", figure: "ink" },
  },
  {
    id: "frame-trend-tiles",
    group: "lead",
    name: "Frame, trend tiles",
    note: "Today's corner-mark hero over tiles that carry their change and a sparkline.",
    fit: "on-brand",
    look: { ...BEFORE, tiles: "trend", line: "running" },
  },
  {
    id: "card-daily",
    group: "lead",
    name: "Card, each day",
    note: "The Payments card and joined tiles drawing each day's revenue, so good and bad days show as peaks.",
    fit: "on-brand",
    look: { ...BEFORE, lead: "card", tiles: "trend", joined: true, line: "daily", figure: "ink" },
  },

  // Charts
  {
    id: "quiet-only",
    group: "charts",
    name: "Quiet axes only",
    note: "Nothing moves but the scale: no value axis, three dates, dotted guides, on every card chart.",
    fit: "on-brand",
    look: { ...BEFORE, axes: "quiet" },
  },
  {
    id: "scrub-running",
    group: "charts",
    name: "Scrub cards, running",
    note: "Average order and each source's trend become a figure over a line adding up, read by scrubbing.",
    fit: "on-brand",
    look: { ...BEFORE, trends: "scrub", line: "running" },
  },
  {
    id: "scrub-daily",
    group: "charts",
    name: "Scrub cards, each day",
    note: "The same scrub cards drawing each day's own figure.",
    fit: "on-brand",
    look: { ...BEFORE, trends: "scrub", line: "daily" },
  },
  {
    id: "scrub-quiet",
    group: "charts",
    name: "Scrub cards and quiet bars",
    note: "Scrub trend cards plus quiet axes on the bars, the hero and tiles as now.",
    fit: "on-brand",
    look: { ...BEFORE, trends: "scrub", line: "running", axes: "quiet" },
  },

  // Colour
  {
    id: "purple",
    group: "colour",
    name: "Purple money",
    note: "Today's page with money in the Payments purple, the figure still green.",
    fit: "stretch",
    look: { ...BEFORE, money: "purple" },
  },
  {
    id: "purple-ink",
    group: "colour",
    name: "Purple money, ink figure",
    note: "Money in purple and the headline figure in ink, as the Payments tab pairs them.",
    fit: "on-brand",
    look: { ...BEFORE, money: "purple", figure: "ink" },
  },
  {
    id: "green-ink",
    group: "colour",
    name: "Green money, ink figure",
    note: "Lines stay green; the headline figure goes to ink so the page has one green thing per chart, not two.",
    fit: "on-brand",
    look: { ...BEFORE, figure: "ink" },
  },
  {
    id: "ink",
    group: "colour",
    name: "Ink money",
    note: "Money in ink: the most monochrome the page can be, colour left to traffic and the chips.",
    fit: "stretch",
    look: { ...BEFORE, money: "ink", figure: "ink" },
  },

  // Reference
  {
    id: "before",
    group: "reference",
    name: "Before the pick",
    note: "The analytics page until 2026-11-08: corner-mark revenue hero, plain tiles.",
    fit: "on-brand",
    look: BEFORE,
  },
];

/** The ranked picks, best first, each with why. */
export const LAB_SHORTLIST: { id: string; why: string }[] = [
  { id: "payments", why: "Exactly what makes Payments read clean, on every chart: the closest match to what you liked." },
  { id: "payments-green", why: "The same, with money staying green so analytics keeps its money/traffic colours." },
  { id: "frame-calm", why: "Keeps the analytics headline's own identity and calms everything under it." },
  { id: "payments-daily", why: "The Payments look for a seller who wants to see good and bad days, not a climbing total." },
  { id: "card-joined", why: "Just the top of the page: revenue card and tiles as Payments has them, charts untouched." },
  { id: "quiet-only", why: "The smallest change: most of the clean comes from dropping the axis text." },
  { id: "scrub-quiet", why: "The cards and bars calmed, the hero left exactly as it is." },
  { id: "purple-ink", why: "Colour only: the Payments pairing of a deep line and an ink figure." },
];
