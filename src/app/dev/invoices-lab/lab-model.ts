import { between, changedProps, decodeLabHash, encodeLabHash, pick, toJsx, type LabFit } from "../lab-kit/state";

/**
 * The invoices lab's model: every knob a design of Settings › Billing &
 * invoices has, the compositions it can take (each after a billing page sellers
 * already know), and the link state. Colours may be raw hex here: the lab is for
 * trying things, and a winner's values become tokens before it ships.
 */

/** The section's overall composition, each after the billing page it learns from. */
export const LAB_LAYOUTS = [
  { id: "current", label: "Shipped (InvoicesCard)", note: "The real component, as Settings will draw it: the Portal pick rebuilt on tokens and i18n." },
  { id: "portal", label: "Portal (Stripe)", note: "Stripe's customer portal: payment method, billing information and invoice history, stacked, each with its own Update." },
  { id: "panels", label: "Panels (Vercel)", note: "One card per job, each ending on a grey footer bar with a hint and its button." },
  { id: "bill", label: "Upcoming bill (Shopify)", note: "The next bill is the hero with its breakdown; past bills in a table with a year filter and export; the card drawn as a card." },
  { id: "history", label: "Payment history (GitHub)", note: "Payment method and billing information side by side, each with Edit; a payment history table with ID, method and receipt." },
  { id: "compact", label: "Compact (Linear)", note: "One dense card: next payment and the card in one line with Change, then invoices with a description column." },
  { id: "split", label: "Split (Notion, Figma)", note: "A summary column (next payment, the card, billed to) beside the invoice list." },
  { id: "ledger", label: "Ledger (Square Share)", note: "The Payments look: the next payment as one big figure, a ledger beside it, the year's spend as bars, then the table." },
] as const;
export type LabLayout = (typeof LAB_LAYOUTS)[number]["id"];

/** Every visual prop of a design, all set. */
export type InvoicesDesignProps = {
  layout: LabLayout;
  /** The one colour a design spends: links, the card art, the spend bars. */
  accent: string;
  /** How the card on file is drawn. */
  cardMark: "chip" | "art" | "icon" | "text";
  status: "pill" | "dot" | "icon" | "text";
  /** What pressing a row does: the invoice in a dialog, Stripe's invoice page, or nothing. */
  rowOpens: "dialog" | "stripe" | "none";
  download: "icon" | "button" | "link";
  /** Optional columns. */
  showNumber: boolean;
  showPlan: boolean;
  showMethod: boolean;
  /** Year headings inside the list. */
  groupByYear: boolean;
  /** Twelve months of what the store was billed, as bars over the list. */
  spendChart: boolean;
  /** An Export CSV button by the list's heading. */
  exportCsv: boolean;
  radius: "sharp" | "soft" | "round";
  cards: "hairline" | "shadow";
  density: "comfy" | "compact";
  scenario: string;
};

/** What a design starts from: the lab's own baseline, not any one preset. */
export const DESIGN_DEFAULTS: InvoicesDesignProps = {
  layout: "portal",
  accent: "#7e22ce",
  cardMark: "chip",
  status: "pill",
  rowOpens: "dialog",
  download: "icon",
  showNumber: false,
  showPlan: true,
  showMethod: false,
  groupByYear: false,
  spendChart: false,
  exportCsv: false,
  radius: "soft",
  cards: "hairline",
  density: "comfy",
  scenario: "active",
};

export const LAB_ACCENTS: readonly { id: string; label: string; accent: string }[] = [
  { id: "purple", label: "Payments purple", accent: "#7e22ce" },
  { id: "ink", label: "Ink", accent: "#0a0a0a" },
  { id: "blurple", label: "Stripe blurple", accent: "#635bff" },
  { id: "linear", label: "Linear indigo", accent: "#5e6ad2" },
  { id: "blue", label: "Chart blue", accent: "#2a78d6" },
  { id: "shopify", label: "Shopify green", accent: "#008060" },
  { id: "github", label: "GitHub green", accent: "#1f883d" },
  { id: "orange", label: "Orange", accent: "#ea580c" },
];

/** The option lists the playground offers, per prop. */
export const LAB_OPTIONS = {
  cardMark: ["chip", "art", "icon", "text"],
  status: ["pill", "dot", "icon", "text"],
  rowOpens: ["dialog", "stripe", "none"],
  download: ["icon", "button", "link"],
  radius: ["sharp", "soft", "round"],
  cards: ["hairline", "shadow"],
  density: ["comfy", "compact"],
} as const;

export const LAB_TOGGLES = ["showNumber", "showPlan", "showMethod", "groupByYear", "spendChart", "exportCsv"] as const;

export const LAB_FRAMES = [
  { id: "desktop", label: "Settings width" },
  { id: "phone", label: "Phone" },
] as const;
export type LabFrame = (typeof LAB_FRAMES)[number]["id"];

/** A variation the lab can load. */
export type LabPreset = {
  id: string;
  name: string;
  group: string;
  /** What it IS, in one sentence. */
  note: string;
  fit: LabFit;
  props: Partial<InvoicesDesignProps>;
};

export const withDefaults = (props: Partial<InvoicesDesignProps>): InvoicesDesignProps => ({ ...DESIGN_DEFAULTS, ...props });

export const designJsx = (props: InvoicesDesignProps) => toJsx("InvoicesDesign", changedProps(DESIGN_DEFAULTS, props));

export type LabState = { frame: LabFrame; props: InvoicesDesignProps; presetId: string | null };

export function encodeState(state: LabState): string {
  return encodeLabHash({ frame: state.frame, props: changedProps(DESIGN_DEFAULTS, state.props), presetId: state.presetId });
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);
const HEX = /^#[0-9a-f]{6}$/i;

/** Back from a link; anything unreadable falls back to the defaults, field by field. */
export function decodeState(hash: string, scenarios: readonly string[]): LabState | null {
  const raw = decodeLabHash(hash);
  if (!raw) return null;
  const given = (raw.props && typeof raw.props === "object" ? raw.props : {}) as Record<string, unknown>;
  const props: Record<string, unknown> = { ...DESIGN_DEFAULTS };
  const lists: Record<string, readonly string[]> = {
    ...LAB_OPTIONS,
    layout: LAB_LAYOUTS.map((layout) => layout.id),
    scenario: scenarios,
  };
  for (const [key, value] of Object.entries(given)) {
    if (key in lists) {
      if (isOneOf(lists[key], value)) props[key] = value;
    } else if (key === "accent") {
      if (typeof value === "string" && HEX.test(value)) props[key] = value;
    } else if ((LAB_TOGGLES as readonly string[]).includes(key)) {
      if (typeof value === "boolean") props[key] = value;
    }
  }
  return {
    frame: isOneOf(LAB_FRAMES.map((frame) => frame.id), raw.frame) ? raw.frame : "desktop",
    props: props as InvoicesDesignProps,
    presetId: typeof raw.presetId === "string" ? raw.presetId : null,
  };
}

/** Somewhere new, for when nothing in the presets is quite it. Keeps the store state. */
export function shuffle(current: InvoicesDesignProps, random: () => number = Math.random): InvoicesDesignProps {
  const option = <K extends keyof typeof LAB_OPTIONS>(key: K) => pick(LAB_OPTIONS[key], random) as InvoicesDesignProps[K];
  return {
    ...current,
    layout: pick(LAB_LAYOUTS.filter((layout) => layout.id !== "current"), random).id,
    accent: pick(LAB_ACCENTS, random).accent,
    cardMark: option("cardMark"),
    status: option("status"),
    rowOpens: option("rowOpens"),
    download: option("download"),
    showNumber: random() < 0.4,
    showPlan: random() < 0.6,
    showMethod: random() < 0.3,
    groupByYear: random() < 0.3,
    spendChart: between(0, 1, random) < 0.35,
    exportCsv: random() < 0.4,
    radius: option("radius"),
    cards: option("cards"),
    density: option("density"),
  };
}
