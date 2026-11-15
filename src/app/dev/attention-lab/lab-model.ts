import { ATTENTION_VISIBLE_ROWS } from "@/lib/dashboard/attention";
import { changedProps, decodeLabHash, encodeLabHash, pick, toJsx, type LabFit } from "../lab-kit/state";
import { SCENARIO_IDS } from "./scenarios";

/**
 * The attention lab's model: every knob a design of the overview's "Needs
 * attention" card has, and the link state. The defaults ARE the shipped card
 * (components/dashboard/NeedsAttention.tsx), so Copy JSX lists exactly what a
 * pick changes from what is live.
 */

/** How the card's rows are composed. */
export const LAB_LAYOUTS = [
  { id: "list", label: "List", note: "One row per item, under each other: what ships today." },
  { id: "count", label: "Count-led", note: "The number leads in its own column, the words after it; items without a number show their icon there." },
  { id: "tiles", label: "Tiles", note: "A grid of small cards, two across on a phone, three on a wide screen." },
  { id: "lead", label: "Lead + list", note: "The most pressing item as a block with its sentence and a button; the rest as short rows under it." },
] as const;
export type LabLayout = (typeof LAB_LAYOUTS)[number]["id"];

/** Every visual prop of a design, all set. */
export type AttentionDesignProps = {
  layout: LabLayout;
  /** What marks each row: the same alert circle (shipped), an icon per kind, an icon in a box, a dot, nothing. */
  marker: "alert" | "kind" | "boxed" | "dot" | "none";
  /** How much of each row's sentence shows: all of it, one line, only on a wide card, none. */
  detail: "full" | "clamp" | "wide" | "none";
  /**
   * Where the way to fix it sits. `wrap` is shipped (at the end if it fits,
   * else wrapped under the icon); `under` always under the words; `end` always
   * at the end; `responsive` under on a phone, at the end on a wide card;
   * `chevron` no words, the whole row is the link.
   */
  action: "wrap" | "under" | "end" | "responsive" | "chevron";
  /** The whole row is the link (a big tap target), not only its action words. */
  rowLink: boolean;
  /** Rows with a buyer waiting or money owed (to ship, cancellations, hidden products) stand out. */
  urgency: "none" | "ink" | "bar" | "group";
  /** Rows before a "Show N more" button; 0 shows them all. */
  limit: number;
  density: "tight" | "regular" | "roomy";
  /** The dot texture in the card's top-right corner. */
  decoration: "dots" | "none";
  /** The number of items beside the title. */
  titleCount: boolean;
  scenario: string;
};

/** The shipped card: the pick of 2026-11-15, as components/dashboard/NeedsAttention
 *  draws it (its visible-row limit imported, so the lab cannot drift from it). */
export const DESIGN_DEFAULTS: AttentionDesignProps = {
  layout: "list",
  marker: "kind",
  detail: "none",
  action: "chevron",
  rowLink: true,
  urgency: "bar",
  limit: ATTENTION_VISIBLE_ROWS,
  density: "regular",
  decoration: "none",
  titleCount: false,
  scenario: "screenshot",
};

/** The card as it was before the pick: what every preset but the chosen ones
 *  was designed against, so they keep meaning what their notes say. */
export const BEFORE_PICK: AttentionDesignProps = {
  ...DESIGN_DEFAULTS,
  marker: "alert",
  detail: "full",
  action: "wrap",
  rowLink: false,
  urgency: "none",
  limit: 0,
  decoration: "dots",
};

/** The option lists the playground offers, per prop. */
export const LAB_OPTIONS = {
  marker: ["alert", "kind", "boxed", "dot", "none"],
  detail: ["full", "clamp", "wide", "none"],
  action: ["wrap", "under", "end", "responsive", "chevron"],
  urgency: ["none", "ink", "bar", "group"],
  density: ["tight", "regular", "roomy"],
  decoration: ["dots", "none"],
} as const;

export const LAB_LIMITS = [0, 3, 4] as const;

/** Phone widths to try: a small Android, an iPhone, the screenshot's phone. */
export const LAB_PHONES = [
  { id: "360", label: "360", width: 360 },
  { id: "390", label: "390", width: 390 },
  { id: "412", label: "412 (yours)", width: 412 },
] as const;
export type LabPhone = (typeof LAB_PHONES)[number]["id"];

export const LAB_FRAMES = [
  { id: "phone", label: "Phone" },
  { id: "desktop", label: "Desktop" },
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
  props: Partial<AttentionDesignProps>;
  /** Draw the REAL component (components/dashboard/NeedsAttention), not the lab's renderer. */
  real?: boolean;
};

export const withDefaults = (props: Partial<AttentionDesignProps>): AttentionDesignProps => ({ ...DESIGN_DEFAULTS, ...props });

/** The JSX a pick hands back: only what differs from the shipped card, never the scenario. */
export const designJsx = (props: AttentionDesignProps) => {
  const changed = changedProps(DESIGN_DEFAULTS, props);
  delete changed.scenario;
  return toJsx("NeedsAttention", changed);
};

export type LabState = { frame: LabFrame; phone: LabPhone; props: AttentionDesignProps; presetId: string | null };

export function encodeState(state: LabState): string {
  return encodeLabHash({ frame: state.frame, phone: state.phone, props: changedProps(DESIGN_DEFAULTS, state.props), presetId: state.presetId });
}

const isOneOf = <T,>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

/** Back from a link; anything unreadable falls back to the defaults, field by field. */
export function decodeState(hash: string): LabState | null {
  const raw = decodeLabHash(hash);
  if (!raw) return null;
  const given = (raw.props && typeof raw.props === "object" ? raw.props : {}) as Record<string, unknown>;
  const props: Record<string, unknown> = { ...DESIGN_DEFAULTS };
  const lists: Record<string, readonly unknown[]> = {
    ...LAB_OPTIONS,
    layout: LAB_LAYOUTS.map((layout) => layout.id),
    limit: LAB_LIMITS,
    scenario: SCENARIO_IDS,
    rowLink: [true, false],
    titleCount: [true, false],
  };
  for (const [key, value] of Object.entries(given)) {
    if (key in lists && isOneOf(lists[key], value)) props[key] = value;
  }
  return {
    frame: isOneOf(LAB_FRAMES.map((frame) => frame.id), raw.frame) ? raw.frame : "phone",
    phone: isOneOf(LAB_PHONES.map((phone) => phone.id), raw.phone) ? raw.phone : "412",
    props: props as AttentionDesignProps,
    presetId: typeof raw.presetId === "string" ? raw.presetId : null,
  };
}

/** Somewhere new, for when nothing in the presets is quite it. Keeps the store state. */
export function shuffle(current: AttentionDesignProps, random: () => number = Math.random): AttentionDesignProps {
  const option = <K extends keyof typeof LAB_OPTIONS>(key: K) => pick(LAB_OPTIONS[key], random) as AttentionDesignProps[K];
  return {
    ...current,
    layout: pick(LAB_LAYOUTS, random).id,
    marker: option("marker"),
    detail: option("detail"),
    // The shipped wrap is the problem being fixed: a shuffle never lands on it.
    action: pick(LAB_OPTIONS.action.filter((action) => action !== "wrap"), random),
    rowLink: random() < 0.5,
    urgency: option("urgency"),
    limit: pick(LAB_LIMITS, random),
    density: option("density"),
    decoration: option("decoration"),
    titleCount: random() < 0.4,
  };
}
