import type { LabPreset } from "./lab-model";

/** The tab that lists the shortlist below instead of a group of its own. */
export const SHORTLIST_GROUP = "shortlist";

/** The lab's tabs, in order. A preset names its tab by id. */
export const LAB_GROUPS: readonly { id: string; label: string }[] = [
  { id: "chosen", label: "Chosen" },
  { id: SHORTLIST_GROUP, label: "Shortlist" },
  { id: "stripe", label: "Like Stripe" },
  { id: "mercury", label: "Like Mercury" },
  { id: "wallet", label: "Like Wise and Revolut" },
  { id: "payday", label: "Payout first" },
  { id: "brand", label: "Square Share" },
  { id: "night", label: "Dark band" },
  { id: "reference", label: "Reference" },
];

/** The picks, best first, each with why it made the cut. */
export const LAB_SHORTLIST: readonly { id: string; why: string }[] = [
  { id: "pulse-blurple", why: "The most familiar payment dashboard: earnings against last month you can scrub, balance and next payout beside it, trend tiles under." },
  { id: "studio-ink", why: "On-brand and far from boring: one big ink figure, an ink chart, and the seller's own product photos supply the colour." },
  { id: "night-polar", why: "A black band with a white line over hatching: premium and calm, and monochrome, so it stays on-brand." },
  { id: "wallet-revolut", why: "The colour-forward end: an indigo to sky balance card with round actions, the bank drawn as a card." },
  { id: "account-blue", why: "Mercury calm: one big figure, money in and out, the chart bled edge to edge in the chart blue the app already has." },
  { id: "payday-ink", why: "Answers 'when do I get paid' first, with every payout as a bar coloured by its status." },
  { id: "studio-purple", why: "Studio with one purple moment: the chart line glows in brand purple, everything else stays ink." },
  { id: "pulse-mesh", why: "Pulse with Stripe's soft colour mesh behind the chart: the prettiest, and the least like Square Share." },
];

export const LAB_PRESETS: readonly LabPreset[] = [
  // Stripe: the dashboard most sellers on Stripe Connect already see.
  {
    id: "pulse-blurple",
    name: "Pulse, blurple",
    group: "stripe",
    note: "Earned this month against last as an area chart, balance and next payout cards, four trend tiles, tinted status pills.",
    fit: "stretch",
    props: { layout: "pulse", accent: "#635bff", accent2: "#a960ee", hero: "plain", page: "grey", cards: "shadow", radius: "soft", chart: "area", compare: true, status: "pill" },
  },
  {
    id: "pulse-mesh",
    name: "Pulse, colour mesh",
    group: "stripe",
    note: "The same page with Stripe's soft colour mesh behind the earnings chart.",
    fit: "off-brand",
    props: { layout: "pulse", accent: "#635bff", accent2: "#f472b6", hero: "mesh", page: "grey", cards: "shadow", radius: "round", chart: "area", compare: true, glow: true },
  },
  {
    id: "pulse-ink",
    name: "Pulse, ink",
    group: "stripe",
    note: "Pulse in black and white on hairline cards, the line drawn in ink with the period before dashed in grey.",
    fit: "on-brand",
    props: { layout: "pulse", accent: "#0a0a0a", accent2: "#404040", hero: "plain", page: "white", cards: "hairline", radius: "soft", chart: "line", compare: true, status: "dot" },
  },
  {
    id: "pulse-lemon",
    name: "Pulse, violet tint",
    group: "stripe",
    note: "Lemon Squeezy's take: a violet-tinted earnings card, rounded corners, violet sparklines on every tile.",
    fit: "stretch",
    props: { layout: "pulse", accent: "#7c3aed", accent2: "#c084fc", hero: "tint", page: "white", cards: "hairline", radius: "round", chart: "area", compare: true },
  },

  // Mercury: a bank account page.
  {
    id: "account-blue",
    name: "Account, chart blue",
    group: "mercury",
    note: "The earnings figure large, money in and out under it, the area chart bled to the card edges, transactions with filter chips.",
    fit: "on-brand",
    props: { layout: "account", accent: "#2a78d6", accent2: "#0b1a4d", hero: "plain", page: "grey", cards: "shadow", radius: "round", chart: "area", compare: true, rows: "grouped" },
  },
  {
    id: "account-balance",
    name: "Account, balance line",
    group: "mercury",
    note: "The balance itself over time, stepping down at each payout, with a dated table and initials instead of photos.",
    fit: "stretch",
    props: { layout: "account", accent: "#4f46e5", accent2: "#0ea5e9", hero: "plain", page: "white", cards: "hairline", radius: "round", chart: "line", metric: "balance", compare: false, rows: "dated", avatars: "initials", status: "dot", bank: "row" },
  },
  {
    id: "account-hatch",
    name: "Account, hatched ink",
    group: "mercury",
    note: "Square corners, an ink line over diagonal hatching, the period before dashed.",
    fit: "on-brand",
    props: { layout: "account", accent: "#0a0a0a", accent2: "#404040", hero: "plain", page: "white", cards: "hairline", radius: "sharp", chart: "hatch", compare: true, status: "mono", figures: "bold" },
  },

  // Wise and Revolut: a balance card you can act on.
  {
    id: "wallet-forest",
    name: "Wallet, forest and lime",
    group: "wallet",
    note: "Wise's greens: a forest-to-lime balance card, heavy figures, money pockets per currency, daily bars.",
    fit: "off-brand",
    props: { layout: "wallet", accent: "#163300", accent2: "#9fe870", hero: "gradient", page: "white", cards: "flat", radius: "round", chart: "bars", figures: "black", avatars: "initials" },
  },
  {
    id: "wallet-revolut",
    name: "Wallet, indigo gradient",
    group: "wallet",
    note: "An indigo to sky gradient card with round actions, the bank as a card, a glowing area chart.",
    fit: "off-brand",
    props: { layout: "wallet", accent: "#4f46e5", accent2: "#0ea5e9", hero: "gradient", page: "grey", cards: "shadow", radius: "round", chart: "area", glow: true },
  },
  {
    id: "wallet-ink",
    name: "Wallet, black card",
    group: "wallet",
    note: "A black balance card with white figures and round actions; the bank drawn as a dark card beside it.",
    fit: "on-brand",
    props: { layout: "wallet", accent: "#0a0a0a", accent2: "#404040", hero: "ink", page: "grey", cards: "shadow", radius: "soft", chart: "bars" },
  },

  // Shopify and Square: when does the money arrive.
  {
    id: "payday-ink",
    name: "Payday, ink",
    group: "payday",
    note: "The next payout as the headline with its arrival day, the bank card beside it, every payout as a status-coloured bar.",
    fit: "on-brand",
    props: { layout: "payday", accent: "#0a0a0a", accent2: "#404040", hero: "plain", page: "white", cards: "hairline", radius: "soft", status: "dot" },
  },
  {
    id: "payday-emerald",
    name: "Payday, emerald tint",
    group: "payday",
    note: "Shopify's green: the payout on a soft green card, an emerald bank card, pills for status.",
    fit: "stretch",
    props: { layout: "payday", accent: "#059669", accent2: "#022c22", hero: "tint", page: "grey", cards: "shadow", radius: "soft", status: "pill" },
  },
  {
    id: "payday-sunset",
    name: "Payday, sunset",
    group: "payday",
    note: "The payout on an orange to rose gradient, rounded, the loudest version of payout-first.",
    fit: "off-brand",
    props: { layout: "payday", accent: "#ea580c", accent2: "#be123c", hero: "gradient", page: "grey", cards: "shadow", radius: "round", figures: "bold" },
  },

  // Square Share's own: the artwork is the colour.
  {
    id: "studio-ink",
    name: "Studio, ink",
    group: "brand",
    note: "Square corners and hairlines, one very large available figure, an ink area chart, a ledger column, best sellers as photos.",
    fit: "on-brand",
    props: { layout: "studio", accent: "#0a0a0a", accent2: "#404040", hero: "plain", page: "white", cards: "hairline", radius: "sharp", chart: "area", compare: true, status: "mono", figures: "bold" },
  },
  {
    id: "studio-purple",
    name: "Studio, one purple moment",
    group: "brand",
    note: "Studio with the chart line in brand purple and a glow under it; the rest stays ink.",
    fit: "stretch",
    props: { layout: "studio", accent: "#9333ea", accent2: "#3b0764", hero: "plain", page: "white", cards: "hairline", radius: "sharp", chart: "line", glow: true, compare: true, status: "dot", figures: "bold" },
  },
  {
    id: "studio-black",
    name: "Studio, black hero",
    group: "brand",
    note: "The Studio hero inverted: white figures and a white chart on black, square corners, grey page under it.",
    fit: "on-brand",
    props: { layout: "studio", accent: "#0a0a0a", accent2: "#404040", hero: "ink", page: "grey", cards: "shadow", radius: "sharp", chart: "area", compare: true, status: "dot", figures: "bold" },
  },

  // Polar and Revolut: a dark band.
  {
    id: "night-polar",
    name: "Night, hatched white",
    group: "night",
    note: "A black band with the title, a white line over hatching and the period before dashed; light lists under it.",
    fit: "on-brand",
    props: { layout: "night", accent: "#0a0a0a", accent2: "#ffffff", hero: "ink", page: "white", cards: "hairline", radius: "soft", chart: "hatch", compare: true, status: "dot" },
  },
  {
    id: "night-purple",
    name: "Night, purple glow",
    group: "night",
    note: "The band with a glowing brand-purple area chart, grey page and soft cards under it.",
    fit: "stretch",
    props: { layout: "night", accent: "#a855f7", accent2: "#3b0764", hero: "ink", page: "grey", cards: "shadow", radius: "soft", chart: "area", glow: true, compare: true },
  },
  {
    id: "night-indigo",
    name: "Night, indigo gradient",
    group: "night",
    note: "The band as an indigo to violet gradient with a white chart; colourful but still one block.",
    fit: "off-brand",
    props: { layout: "night", accent: "#312e81", accent2: "#7c3aed", hero: "gradient", page: "grey", cards: "shadow", radius: "round", chart: "area", glow: true, compare: true },
  },

  {
    id: "current",
    name: "Shipped page",
    group: "chosen",
    note: "What /payments renders now: the round-one balance card, then the two sections picked from Pulse (the earnings chart and the trend tiles) in a darker purple, then activity, payouts and the bank.",
    fit: "on-brand",
    props: { layout: "current" },
  },
  {
    id: "picked-from",
    name: "Where the pick came from",
    group: "chosen",
    note: "Pulse as it was when its earnings chart and trend tiles were picked (2026-11-07); the rest of it was turned down as looking too AI.",
    fit: "stretch",
    props: { layout: "pulse", accent: "#635bff", accent2: "#a960ee", hero: "plain", page: "grey", cards: "shadow", radius: "soft", chart: "area", compare: true, status: "pill" },
  },
];
