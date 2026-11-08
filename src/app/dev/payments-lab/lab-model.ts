import { PAYMENTS_SCENARIOS, type PaymentsScenario } from "@/lib/payments/scenarios";
import { between, changedProps, decodeLabHash, encodeLabHash, pick, toJsx, type LabFit } from "../lab-kit/state";

/**
 * The payments lab's model: every knob a design of the Payments tab has, the
 * layouts it can take, and the link state. Colours here may be raw hex: the
 * lab is for trying things, and whatever wins is promoted to globals.css
 * tokens before it ships.
 */

/** The page's overall composition, each after the dashboards it learns from. */
export const LAB_LAYOUTS = [
  { id: "current", label: "Current page (live)", note: "What /payments renders today." },
  { id: "pulse", label: "Pulse (Stripe)", note: "Earnings chart first, balance and next payout beside it, small trend tiles under." },
  { id: "account", label: "Account (Mercury)", note: "One big balance with a chart bled under it, money in and out, one clean table." },
  { id: "wallet", label: "Wallet (Wise, Revolut)", note: "A coloured balance card with actions, currency pockets, the bank as a card." },
  { id: "payday", label: "Payday (Shopify, Square)", note: "The next payout is the hero, with every payout as a bar and the bank beside it." },
  { id: "studio", label: "Studio (Square Share)", note: "On-brand: ink, square corners, product photos, one chart in ink." },
  { id: "night", label: "Night band (Polar, Revolut)", note: "A dark band across the top with a glowing chart; the page under it stays light." },
] as const;
export type LabLayout = (typeof LAB_LAYOUTS)[number]["id"];

export const LAB_HEROES = ["plain", "tint", "ink", "gradient", "mesh"] as const;
export type LabHero = (typeof LAB_HEROES)[number];

export const LAB_CHARTS = ["area", "hatch", "line", "step", "bars", "none"] as const;
export type LabChart = (typeof LAB_CHARTS)[number];

export const LAB_RANGES = [7, 30, 90] as const;
export type LabRange = (typeof LAB_RANGES)[number];

/** Every visual prop of a design, all set. */
export type PaymentsDesignProps = {
  layout: LabLayout;
  /** The one colour a design spends: chart, highlights, the hero's tint. */
  accent: string;
  /** A second colour for gradients; empty means a darker step of the accent. */
  accent2: string;
  /** The surface the balance sits on. */
  hero: LabHero;
  /** The page behind the cards: white, or a faint grey that lifts white cards. */
  page: "white" | "grey";
  cards: "hairline" | "shadow" | "flat";
  radius: "sharp" | "soft" | "round";
  chart: LabChart;
  /** What the chart draws: earnings adding up over the range, or the balance day by day. */
  metric: "earned" | "balance";
  /** The previous period, dashed, behind the line. */
  compare: boolean;
  /** A soft glow under the line. */
  glow: boolean;
  range: LabRange;
  cents: "muted" | "inline";
  /** Weight of the big figures. */
  figures: "medium" | "semibold" | "bold" | "black";
  /** What leads an activity row: the product's photo, a type icon, or initials. */
  avatars: "photo" | "icon" | "initials";
  /** Activity under a light heading per day, or as a table with a date column. */
  rows: "grouped" | "dated";
  status: "pill" | "dot" | "mono";
  /** The bank as a drawn card, or a plain row. */
  bank: "card" | "row";
  scenario: PaymentsScenario;
};

/** What a design starts from: the lab's own baseline, not any one preset. */
export const DESIGN_DEFAULTS: PaymentsDesignProps = {
  layout: "pulse",
  accent: "#635bff",
  accent2: "",
  hero: "plain",
  page: "grey",
  cards: "shadow",
  radius: "soft",
  chart: "area",
  metric: "earned",
  compare: true,
  glow: false,
  range: 30,
  cents: "muted",
  figures: "semibold",
  avatars: "photo",
  rows: "grouped",
  status: "pill",
  bank: "card",
  scenario: "busy",
};

/** Accents to start from. `ink` marks the dark ones text sits on in white. */
export const LAB_ACCENTS: readonly { id: string; label: string; accent: string; accent2?: string }[] = [
  { id: "ink", label: "Ink", accent: "#0a0a0a", accent2: "#404040" },
  { id: "blurple", label: "Blurple", accent: "#635bff", accent2: "#a960ee" },
  { id: "indigo", label: "Indigo", accent: "#4f46e5", accent2: "#0ea5e9" },
  { id: "brand", label: "Brand purple", accent: "#9333ea", accent2: "#3b0764" },
  { id: "blue", label: "Chart blue", accent: "#2a78d6", accent2: "#0b1a4d" },
  { id: "emerald", label: "Emerald", accent: "#059669", accent2: "#022c22" },
  { id: "forest", label: "Forest and lime", accent: "#163300", accent2: "#9fe870" },
  { id: "teal", label: "Teal", accent: "#0d9488", accent2: "#164e63" },
  { id: "orange", label: "Orange", accent: "#ea580c", accent2: "#be123c" },
  { id: "pink", label: "Pink", accent: "#db2777", accent2: "#7c3aed" },
];

/** The option lists the playground offers, per prop. */
export const LAB_OPTIONS = {
  hero: LAB_HEROES,
  page: ["white", "grey"],
  cards: ["hairline", "shadow", "flat"],
  radius: ["sharp", "soft", "round"],
  chart: LAB_CHARTS,
  metric: ["earned", "balance"],
  cents: ["muted", "inline"],
  figures: ["medium", "semibold", "bold", "black"],
  avatars: ["photo", "icon", "initials"],
  rows: ["grouped", "dated"],
  status: ["pill", "dot", "mono"],
  bank: ["card", "row"],
} as const;

/** Where a design is previewed: the dashboard's content width, or a phone. */
export const LAB_FRAMES = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
] as const;
export type LabFrame = (typeof LAB_FRAMES)[number]["id"];

/** A variation the lab can load. */
export type LabPreset = {
  id: string;
  name: string;
  /** Which tab it is listed under. */
  group: string;
  /** What it IS, in one sentence. */
  note: string;
  fit: LabFit;
  props: Partial<PaymentsDesignProps>;
};

/** A preset's props over the defaults: everything the design will be given. */
export const withDefaults = (props: Partial<PaymentsDesignProps>): PaymentsDesignProps => ({ ...DESIGN_DEFAULTS, ...props });

/** The design as JSX to paste: only what differs from the defaults. */
export const designJsx = (props: PaymentsDesignProps) => toJsx("PaymentsDesign", changedProps(DESIGN_DEFAULTS, props));

/** The lab's state as it lives in the address bar. */
export type LabState = { frame: LabFrame; props: PaymentsDesignProps; presetId: string | null };

export function encodeState(state: LabState): string {
  return encodeLabHash({ frame: state.frame, props: changedProps(DESIGN_DEFAULTS, state.props), presetId: state.presetId });
}

const isOneOf = <T extends string | number>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value);
const HEX = /^#[0-9a-f]{6}$/i;

/** Back from a link; anything unreadable falls back to the defaults, field by field. */
export function decodeState(hash: string): LabState | null {
  const raw = decodeLabHash(hash);
  if (!raw) return null;
  const given = (raw.props && typeof raw.props === "object" ? raw.props : {}) as Record<string, unknown>;
  const props = { ...DESIGN_DEFAULTS };
  const lists: Record<string, readonly (string | number)[]> = {
    ...LAB_OPTIONS,
    layout: LAB_LAYOUTS.map((layout) => layout.id),
    range: LAB_RANGES,
    scenario: PAYMENTS_SCENARIOS,
  };
  for (const [key, value] of Object.entries(given)) {
    if (key in lists) {
      if (isOneOf(lists[key], value)) (props as Record<string, unknown>)[key] = value;
    } else if (key === "accent" || key === "accent2") {
      if (typeof value === "string" && (HEX.test(value) || (key === "accent2" && value === ""))) props[key] = value;
    } else if (key === "compare" || key === "glow") {
      if (typeof value === "boolean") props[key] = value;
    }
  }
  return {
    frame: isOneOf(LAB_FRAMES.map((frame) => frame.id), raw.frame) ? raw.frame : "desktop",
    props,
    presetId: typeof raw.presetId === "string" ? raw.presetId : null,
  };
}

/** Somewhere new, for when nothing in the presets is quite it. Keeps the story. */
export function shuffle(current: PaymentsDesignProps, random: () => number = Math.random): PaymentsDesignProps {
  const accent = pick(LAB_ACCENTS, random);
  const option = <K extends keyof typeof LAB_OPTIONS>(key: K) => pick(LAB_OPTIONS[key], random) as PaymentsDesignProps[K];
  return {
    ...current,
    layout: pick(LAB_LAYOUTS.filter((layout) => layout.id !== "current"), random).id,
    accent: accent.accent,
    accent2: random() < 0.5 ? (accent.accent2 ?? "") : "",
    hero: option("hero"),
    page: option("page"),
    cards: option("cards"),
    radius: option("radius"),
    chart: random() < 0.9 ? pick(LAB_CHARTS.filter((chart) => chart !== "none"), random) : "none",
    metric: option("metric"),
    compare: random() < 0.6,
    glow: between(0, 1, random) < 0.3,
    cents: option("cents"),
    figures: option("figures"),
    avatars: option("avatars"),
    rows: option("rows"),
    status: option("status"),
    bank: option("bank"),
  };
}
