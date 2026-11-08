import { ANALYTICS_LOOK, type AnalyticsLook } from "@/components/analytics/look";
import { changedProps, decodeLabHash, encodeLabHash, pick, toJsx, type LabFit } from "../lab-kit/state";
import { LAB_SCENARIOS, type LabScenario } from "./fixtures";

/**
 * The analytics lab's model: every field of an AnalyticsLook as a control, the
 * sample store it is drawn over, and the link state. Defaults come from
 * ANALYTICS_LOOK (what /analytics renders), never a copy, so the lab tunes the
 * look that ships.
 */

/** One choice of a look field, as the playground offers it. */
type LookOption<K extends keyof AnalyticsLook> = {
  key: K;
  label: string;
  /** What the choice is about, in a sentence. */
  hint: string;
  options: readonly { value: AnalyticsLook[K]; label: string }[];
};

/** Every look field the playground sets, in the order the controls run. */
export const LOOK_CONTROLS = [
  {
    key: "lead",
    label: "Revenue lead",
    hint: "Corner marks with the figure over a bled chart, or the Payments card with the figure above.",
    options: [
      { value: "frame", label: "Frame (now)" },
      { value: "card", label: "Card" },
    ],
  },
  {
    key: "tiles",
    label: "Tiles",
    hint: "Figure and hint, or a change chip, the figure before and a sparkline.",
    options: [
      { value: "plain", label: "Plain (now)" },
      { value: "trend", label: "Trend" },
    ],
  },
  {
    key: "trends",
    label: "Trend cards",
    hint: "Average order and every source's trend: axes and a tooltip, or a figure read by scrubbing.",
    options: [
      { value: "axes", label: "Axes (now)" },
      { value: "scrub", label: "Scrub" },
    ],
  },
  {
    key: "line",
    label: "Scrub line",
    hint: "What the scrub lines and sparklines draw: each day's own, or the total so far.",
    options: [
      { value: "daily", label: "Each day" },
      { value: "running", label: "Running" },
    ],
  },
  {
    key: "axes",
    label: "Other charts",
    hint: "Bars and remaining lines: a value axis and many dates, or none and three dates.",
    options: [
      { value: "full", label: "Full (now)" },
      { value: "quiet", label: "Quiet" },
    ],
  },
  {
    key: "money",
    label: "Money colour",
    hint: "Revenue, order value and paid, wherever they are drawn.",
    options: [
      { value: "green", label: "Green (now)" },
      { value: "purple", label: "Purple" },
      { value: "ink", label: "Ink" },
    ],
  },
  {
    key: "figure",
    label: "Headline figure",
    hint: "The revenue figure in green, or in ink with the line carrying the colour.",
    options: [
      { value: "green", label: "Green (now)" },
      { value: "ink", label: "Ink" },
    ],
  },
] as const satisfies readonly LookOption<keyof AnalyticsLook>[];

export type LabState = {
  look: AnalyticsLook;
  scenario: LabScenario;
  /** The preset the playground was last set from, for the tab tiles' ring. */
  presetId: string | null;
};

export type LabPreset = {
  id: string;
  group: string;
  name: string;
  /** What it IS, in one sentence. */
  note: string;
  fit: LabFit;
  look: Partial<AnalyticsLook>;
};

/** A preset's partial look over what /analytics renders. */
export const withDefaults = (look: Partial<AnalyticsLook>): AnalyticsLook => ({ ...ANALYTICS_LOOK, ...look });

/** The look as the JSX to paste: only what differs from ANALYTICS_LOOK. */
export const lookJsx = (look: AnalyticsLook) => toJsx("AnalyticsLook", changedProps(ANALYTICS_LOOK, look));

export const encodeState = (state: LabState) =>
  encodeLabHash({ look: changedProps(ANALYTICS_LOOK, state.look), scenario: state.scenario, presetId: state.presetId });

/** Back from a link. Every field is checked against the options it may take. */
export function decodeState(hash: string): LabState | null {
  const raw = decodeLabHash(hash);
  if (!raw) return null;
  const look = { ...ANALYTICS_LOOK };
  const given = raw.look && typeof raw.look === "object" ? (raw.look as Record<string, unknown>) : {};
  for (const control of LOOK_CONTROLS) {
    const value = given[control.key];
    if (control.options.some((option) => option.value === value)) Object.assign(look, { [control.key]: value });
  }
  if (typeof given.joined === "boolean") look.joined = given.joined;
  const scenario = LAB_SCENARIOS.find((s) => s.id === raw.scenario)?.id ?? "growing";
  return { look, scenario, presetId: typeof raw.presetId === "string" ? raw.presetId : null };
}

/** A random look from the options. */
export function shuffle(random: () => number): AnalyticsLook {
  const look = { ...ANALYTICS_LOOK };
  for (const control of LOOK_CONTROLS) {
    const options: readonly { value: string }[] = control.options;
    Object.assign(look, { [control.key]: pick(options, random).value });
  }
  look.joined = random() > 0.4;
  return look;
}
