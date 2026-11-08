import type { LabPreset } from "./lab-model";

/** The tab that lists the shortlist below instead of a group of its own. */
export const SHORTLIST_GROUP = "shortlist";

/** The tab the lab opens on: what shipped, beside the pick it came from. */
export const CHOSEN_GROUP = "chosen";

/** The lab's tabs, in order. A preset names its tab by id. */
export const LAB_GROUPS: readonly { id: string; label: string }[] = [
  { id: CHOSEN_GROUP, label: "Chosen" },
  { id: SHORTLIST_GROUP, label: "Shortlist" },
  { id: "stripe", label: "Like Stripe" },
  { id: "vercel", label: "Like Vercel" },
  { id: "shopify", label: "Like Shopify" },
  { id: "github", label: "Like GitHub" },
  { id: "linear", label: "Like Linear" },
  { id: "split", label: "Summary beside the list" },
  { id: "brand", label: "Square Share" },
];

/** The picks, best first, each with why it made the cut. */
export const LAB_SHORTLIST: readonly { id: string; why: string }[] = [
  { id: "ledger-purple", why: "Matches the Payments tab you picked: the next payment as one big figure, card and billed-to as a ledger with their own Update, the year's spend in bars." },
  { id: "portal-classic", why: "The page every Stripe seller has seen: card, billing information and invoice history, each with Update, and every invoice opens in full." },
  { id: "bill-hero", why: "Answers 'what will I pay next and why' first, with the breakdown, then past bills you can export." },
  { id: "panels-vercel", why: "Each job in its own card with one button in a footer: nothing to hunt for, very calm." },
  { id: "history-github", why: "The most complete table: invoice number, how it was paid, a status icon and a receipt on every row." },
  { id: "split-art", why: "Summary and list side by side, with the card drawn as a card: the friendliest of the lot." },
  { id: "compact-linear", why: "Everything in one card with small Change and Edit buttons on each fact: dense but usable." },
  { id: "ledger-ink", why: "The Square Share one in black and white, square corners, statuses as plain words." },
];

export const LAB_PRESETS: readonly LabPreset[] = [
  // Picked 2026-11-08 as the JSX below; shipped as components/billing/invoices/InvoicesCard.
  {
    id: "shipped",
    name: "Shipped",
    group: CHOSEN_GROUP,
    note: "What InvoicesCard draws now: your pick on the app's tokens. Update links in ink (styles.md keeps purple off links), the brand chip, square tags, years as headings.",
    fit: "on-brand",
    props: { layout: "current" },
  },
  {
    id: "pick",
    name: "Your pick, as pasted",
    group: CHOSEN_GROUP,
    note: "<InvoicesDesign cardMark=\"art\" groupByYear radius=\"sharp\" />: the Stripe portal composition, square, invoices under a heading per year.",
    fit: "on-brand",
    props: { layout: "portal", cardMark: "art", groupByYear: true, radius: "sharp" },
  },

  // Stripe's customer portal.
  {
    id: "portal-classic",
    name: "Portal",
    group: "stripe",
    note: "Three stacked sections under small caps headings, a card chip with an accent Update, invoice rows with pills that open the full invoice.",
    fit: "on-brand",
    props: { layout: "portal", accent: "#7e22ce", cardMark: "chip", status: "pill", rowOpens: "dialog", download: "icon", showPlan: true, radius: "soft", cards: "hairline" },
  },
  {
    id: "portal-blurple",
    name: "Portal, Stripe blurple",
    group: "stripe",
    note: "Stripe's own colour and rounder corners, a soft shadow, rows that open Stripe's invoice page.",
    fit: "stretch",
    props: { layout: "portal", accent: "#635bff", cardMark: "chip", status: "pill", rowOpens: "stripe", download: "icon", showPlan: true, radius: "round", cards: "shadow" },
  },
  {
    id: "portal-spend",
    name: "Portal with the year's spend",
    group: "stripe",
    note: "The portal with twelve months of billing as bars above the invoice history, and an Export CSV.",
    fit: "on-brand",
    props: { layout: "portal", cardMark: "chip", status: "dot", rowOpens: "dialog", spendChart: true, exportCsv: true },
  },

  // Vercel.
  {
    id: "panels-vercel",
    name: "Panels",
    group: "vercel",
    note: "Payment method, invoices and billing details as three cards, each ending on a grey footer with a hint and one button.",
    fit: "on-brand",
    props: { layout: "panels", accent: "#0a0a0a", cardMark: "chip", status: "dot", rowOpens: "dialog", download: "button", showPlan: true, radius: "soft", cards: "hairline" },
  },
  {
    id: "panels-sharp",
    name: "Panels, square",
    group: "vercel",
    note: "The same three panels with square corners and the invoice number column, statuses as icons.",
    fit: "on-brand",
    props: { layout: "panels", accent: "#7e22ce", cardMark: "icon", status: "icon", rowOpens: "dialog", download: "icon", showNumber: true, showPlan: true, radius: "sharp", cards: "hairline" },
  },

  // Shopify.
  {
    id: "bill-hero",
    name: "Upcoming bill",
    group: "shopify",
    note: "The next bill large with its breakdown beside it, past bills grouped by year with Export, and the card drawn as a card.",
    fit: "on-brand",
    props: { layout: "bill", accent: "#7e22ce", cardMark: "art", status: "pill", rowOpens: "dialog", download: "icon", showNumber: true, showPlan: false, groupByYear: true, exportCsv: true, radius: "soft", cards: "hairline" },
  },
  {
    id: "bill-shopify",
    name: "Upcoming bill, Shopify green",
    group: "shopify",
    note: "Shopify's green, rounder corners and soft shadows, the card art in green.",
    fit: "off-brand",
    props: { layout: "bill", accent: "#008060", cardMark: "art", status: "pill", rowOpens: "dialog", download: "link", showNumber: true, exportCsv: true, radius: "round", cards: "shadow" },
  },
  {
    id: "bill-spend",
    name: "Upcoming bill with bars",
    group: "shopify",
    note: "The upcoming bill with the year's spend as bars over the past bills.",
    fit: "on-brand",
    props: { layout: "bill", accent: "#2a78d6", cardMark: "art", status: "dot", rowOpens: "dialog", spendChart: true, exportCsv: true, radius: "soft" },
  },

  // GitHub.
  {
    id: "history-github",
    name: "Payment history",
    group: "github",
    note: "Payment method and billing information as two boxes with Edit, then a table with ID, method, amount, an icon status and a receipt.",
    fit: "on-brand",
    props: { layout: "history", accent: "#1f883d", cardMark: "chip", status: "icon", rowOpens: "stripe", download: "icon", showNumber: true, showPlan: false, showMethod: true, radius: "soft", cards: "hairline", density: "compact" },
  },
  {
    id: "history-ink",
    name: "Payment history, ink",
    group: "github",
    note: "The same in ink with square corners, rows that open the invoice in a dialog.",
    fit: "on-brand",
    props: { layout: "history", accent: "#0a0a0a", cardMark: "chip", status: "text", rowOpens: "dialog", download: "button", showNumber: true, showMethod: true, radius: "sharp", density: "compact" },
  },

  // Linear.
  {
    id: "compact-linear",
    name: "Compact",
    group: "linear",
    note: "One dense card: next payment, card and billed-to as rows with Change and Edit, then invoices with a description column.",
    fit: "on-brand",
    props: { layout: "compact", accent: "#5e6ad2", cardMark: "chip", status: "dot", rowOpens: "dialog", download: "icon", showPlan: true, radius: "soft", cards: "shadow", density: "compact" },
  },
  {
    id: "compact-year",
    name: "Compact, by year",
    group: "linear",
    note: "The compact card with invoices under a heading per year and pills for status.",
    fit: "on-brand",
    props: { layout: "compact", accent: "#7e22ce", cardMark: "icon", status: "pill", rowOpens: "dialog", download: "link", showPlan: true, groupByYear: true, radius: "soft", density: "compact" },
  },

  // Notion and Figma.
  {
    id: "split-art",
    name: "Split, card art",
    group: "split",
    note: "Next payment, the card drawn as a card and billed-to in a column beside the invoice list.",
    fit: "stretch",
    props: { layout: "split", accent: "#7e22ce", cardMark: "art", status: "pill", rowOpens: "dialog", download: "icon", showPlan: true, radius: "round", cards: "shadow" },
  },
  {
    id: "split-plain",
    name: "Split, plain",
    group: "split",
    note: "The split with a card chip instead of art, square corners and statuses as words.",
    fit: "on-brand",
    props: { layout: "split", accent: "#0a0a0a", cardMark: "chip", status: "text", rowOpens: "dialog", download: "link", showPlan: true, radius: "sharp" },
  },

  // Square Share.
  {
    id: "ledger-purple",
    name: "Ledger",
    group: "brand",
    note: "The Payments tab's look: square card, the next payment as one big figure with the year's spend in purple bars, a ledger beside it, the table under.",
    fit: "on-brand",
    props: { layout: "ledger", accent: "#7e22ce", cardMark: "chip", status: "pill", rowOpens: "dialog", download: "icon", showPlan: true, spendChart: true, exportCsv: true, radius: "sharp", cards: "hairline" },
  },
  {
    id: "ledger-ink",
    name: "Ledger, ink",
    group: "brand",
    note: "The ledger in black and white with statuses as plain words and the invoice number shown.",
    fit: "on-brand",
    props: { layout: "ledger", accent: "#0a0a0a", cardMark: "chip", status: "text", rowOpens: "dialog", download: "link", showNumber: true, showPlan: true, spendChart: true, radius: "sharp" },
  },
  {
    id: "ledger-no-chart",
    name: "Ledger, no chart",
    group: "brand",
    note: "The ledger without the bars: the figure, the ledger and the table.",
    fit: "on-brand",
    props: { layout: "ledger", accent: "#7e22ce", cardMark: "icon", status: "dot", rowOpens: "dialog", download: "icon", showPlan: true, radius: "sharp" },
  },

];
