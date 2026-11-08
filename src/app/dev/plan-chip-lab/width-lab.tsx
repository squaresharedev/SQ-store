"use client";

import { useId } from "react";
import { AccountPlanProvider } from "@/components/billing/plan-context";
import { PlanChip } from "@/components/billing/PlanChip";
import { NAV_ITEM_CLASSES } from "@/components/dashboard/Sidebar";
import { ArrowLoopIcon, useArrowLoop } from "@/components/ui/action-icons";
import { Button } from "@/components/ui/button";
import { infoTextClass } from "@/components/ui/control-styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { LabCopyButtons, LabGroup, LabJsx, LabKnob, LabToggle } from "../lab-kit/controls";
import { between, decodeLabHash, pick, toJsx } from "../lab-kit/state";
import { RailFooter } from "./RailFooter";
import { ChipLink, UpgradeWord, type Candidate, type ChipProps } from "./variants";

/**
 * The width playground: the shipped chip (No. 8) at 36px, with where it starts,
 * how wide it is and where its word sits all free to move. Lab only, so the
 * geometry is raw pixels; the pick is turned into the rail's classes when it
 * ships (Sidebar's column is 231px, one wider than the lab's, since its border
 * is on one side only).
 */

/** Where Settings' label starts in the rail's column: the row's 12px padding, its 20px icon, an 8px gap. */
const SETTINGS_WORD_X = 40;
/** The rail's column inside the lab's footer. */
export const ROW_WIDTH = 230;
/** The row's own padding: the word this far in from the pill's edge. */
const INSET_PAD = 12;
/** The least room left between the pill's edge and its word. */
const MIN_PAD = 8;
/** The disc sits this far inside the pill's height, top and bottom together. */
const DISC_INSET = 8;
const MIN_WIDTH = 108;

export type PillGeometry = {
  /** Pixels. */
  height: number;
  /** Pixels from the column's left edge to the pill's. */
  left: number;
  /** Pixels; ignored while `hug` is on. */
  width: number;
  /** As wide as its contents. */
  hug: boolean;
  /** "column": the word starts where Settings' label does; "inset": 12px in from the pill's edge. */
  word: "column" | "inset";
  corners: "round" | "soft";
};

/** The pick, as sent back from the playground (2026-11-07), and where the playground opens. */
export const GEOMETRY_DEFAULTS: PillGeometry = { height: 36, left: 0, width: 202, hug: false, word: "column", corners: "round" };

const WORDS = ["column", "inset"] as const;
const CORNERS = ["round", "soft"] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const maxWidth = (left: number) => ROW_WIDTH - left;

/** The room before the word, so it lands where the geometry says. */
function wordPad({ word, left }: PillGeometry) {
  return word === "column" ? Math.max(SETTINGS_WORD_X - left, MIN_PAD) : INSET_PAD;
}

/** How far the word sits from Settings' label; 0 is lined up. */
export function wordOffset(geometry: PillGeometry) {
  return geometry.left + wordPad(geometry) - SETTINGS_WORD_X;
}

/** Keeps a geometry inside the column, whatever a link or a slider hands over. */
export function fitGeometry(geometry: PillGeometry): PillGeometry {
  const left = clamp(Math.round(geometry.left), 0, ROW_WIDTH - MIN_WIDTH);
  return {
    ...geometry,
    height: clamp(Math.round(geometry.height), 28, 48),
    left,
    width: clamp(Math.round(geometry.width), MIN_WIDTH, maxWidth(left)),
  };
}

/** The playground's state from a link, or the defaults. */
export function readGeometry(): PillGeometry {
  const raw = decodeLabHash(window.location.hash);
  if (!raw) return GEOMETRY_DEFAULTS;
  const num = (key: keyof PillGeometry) => (typeof raw[key] === "number" ? (raw[key] as number) : (GEOMETRY_DEFAULTS[key] as number));
  return fitGeometry({
    height: num("height"),
    left: num("left"),
    width: num("width"),
    hug: typeof raw.hug === "boolean" ? raw.hug : GEOMETRY_DEFAULTS.hug,
    word: WORDS.find((word) => word === raw.word) ?? GEOMETRY_DEFAULTS.word,
    corners: CORNERS.find((corners) => corners === raw.corners) ?? GEOMETRY_DEFAULTS.corners,
  });
}

/** A random but sane geometry, for Shuffle. */
function shuffled(): PillGeometry {
  const left = Math.round(between(0, 44, Math.random));
  return fitGeometry({
    height: GEOMETRY_DEFAULTS.height,
    left,
    width: Math.round(between(140, maxWidth(left), Math.random)),
    hug: Math.random() < 0.25,
    word: pick(WORDS, Math.random),
    corners: pick(CORNERS, Math.random),
  });
}

/** No. 8, light grey, at one geometry. */
export function GeometryPill({ plan, geometry }: { plan: PlanId; geometry: PillGeometry }) {
  const [loopScope, playLoop] = useArrowLoop();
  const disc = geometry.height - DISC_INSET;
  return (
    <ChipLink
      plan={plan}
      onMouseEnter={playLoop}
      className={cn(
        NAV_ITEM_CLASSES,
        "group/btn bg-muted py-0 text-foreground hover:bg-border",
        geometry.corners === "round" ? "rounded-full" : "rounded-md",
      )}
      style={{
        height: geometry.height,
        marginLeft: geometry.left,
        width: geometry.hug ? "fit-content" : geometry.width,
        paddingLeft: wordPad(geometry),
        paddingRight: DISC_INSET / 2,
      }}
    >
      <span data-chip-word>
        <UpgradeWord />
      </span>
      <span
        aria-hidden
        className="ml-auto flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground text-background"
        style={{ width: disc, height: disc }}
      >
        <ArrowLoopIcon scope={loopScope} className="size-1/2" strokeWidth={2.25} />
      </span>
    </ChipLink>
  );
}

/** What the word's position reads as, in words. */
function offsetText(offset: number) {
  if (offset === 0) return "The word lines up with Settings.";
  return `The word sits ${Math.abs(offset)}px ${offset > 0 ? "right" : "left"} of Settings.`;
}

export function WidthPlayground({
  plan,
  guide,
  geometry,
  onChange,
}: {
  plan: PlanId;
  guide: boolean;
  geometry: PillGeometry;
  onChange: (geometry: PillGeometry) => void;
}) {
  const id = useId();
  const set = (patch: Partial<PillGeometry>) => onChange(fitGeometry({ ...geometry, ...patch }));
  const jsx = toJsx("UpgradeChip", geometry);

  return (
    <section className="grid gap-8 border border-border p-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" data-lab-playground>
      <div className="space-y-5">
        <LabGroup title="Width">
          <LabKnob id={`${id}-left`} label="Starts (px from the rail's edge)" value={geometry.left} min={0} max={56} step={1} onChange={(left) => set({ left })} />
          <LabToggle id={`${id}-hug`} label="Hug its contents" checked={geometry.hug} onChange={(hug) => set({ hug })} />
          {!geometry.hug && (
            <LabKnob
              id={`${id}-width`}
              label="Width (px)"
              value={geometry.width}
              min={MIN_WIDTH}
              max={maxWidth(geometry.left)}
              step={1}
              onChange={(width) => set({ width })}
            />
          )}
        </LabGroup>
        <LabGroup title="Inside">
          <SegmentedControl
            ariaLabel="Where the word sits"
            value={geometry.word}
            options={[
              { value: "column", label: "On Settings' column" },
              { value: "inset", label: "12px in" },
            ]}
            onChange={(word) => set({ word })}
          />
          <SegmentedControl
            ariaLabel="Corners"
            value={geometry.corners}
            options={[
              { value: "round", label: "Round" },
              { value: "soft", label: "Soft" },
            ]}
            onChange={(corners) => set({ corners })}
          />
          <LabKnob id={`${id}-height`} label="Height (px)" value={geometry.height} min={28} max={48} step={2} onChange={(height) => set({ height })} />
        </LabGroup>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => onChange(shuffled())}>
            Shuffle
          </Button>
          <Button type="button" variant="secondary" onClick={() => onChange(GEOMETRY_DEFAULTS)}>
            Reset
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        <div data-lab-preview>
          <RailFooter guide={guide}>
            <GeometryPill plan={plan} geometry={geometry} />
          </RailFooter>
        </div>
        <p className={infoTextClass} data-lab-offset>
          {offsetText(wordOffset(geometry))}
        </p>
        <LabCopyButtons jsx={jsx} />
        <LabJsx jsx={jsx} />
      </div>
    </section>
  );
}

/** A width preset: a tile in the lab, and a starting point for the playground. */
export type WidthPreset = Candidate & { geometry: PillGeometry };

function preset(
  id: string,
  name: string,
  note: string,
  geometry: Partial<PillGeometry>,
  fit: Candidate["fit"] = "on-brand",
  group = "Widths",
): WidthPreset {
  const full = fitGeometry({ ...GEOMETRY_DEFAULTS, ...geometry });
  return {
    id,
    name,
    note,
    fit,
    group,
    geometry: full,
    Chip: function WidthChip({ plan }: ChipProps) {
      return <GeometryPill plan={plan} geometry={full} />;
    },
  };
}

const TO_EDGE = (left: number) => ROW_WIDTH - left;

/** The real rail chip, exactly as it ships. */
function Shipped({ plan }: ChipProps) {
  return (
    <AccountPlanProvider plan={plan}>
      <PlanChip className={NAV_ITEM_CLASSES} />
    </AccountPlanProvider>
  );
}

/** What ships beside the pick as it was sent, and its width a step either way. */
export const CHOSEN: readonly (Candidate & { geometry?: PillGeometry })[] = [
  { id: "shipped", group: "Chosen", name: "Shipped", fit: "on-brand", Chip: Shipped, note: "The real rail chip: 36px, from the rail's edge to 28px short of the other, the word on Settings' column." },
  preset("picked", "As you sent it", "The playground's version you picked: 202px from the rail's edge.", {}, "on-brand", "Chosen"),
  preset("picked-shorter", "A little shorter, 190px", "The pick, 12px shorter.", { width: 190 }, "on-brand", "Chosen"),
  preset("picked-longer", "A little longer, 214px", "The pick, 12px longer.", { width: 214 }, "on-brand", "Chosen"),
];

/** Sixteen widths at 36px, numbered W1 to W16 in the lab. */
export const WIDTHS: readonly WidthPreset[] = [
  preset("w-word-edge", "From the word to the edge", "Starts 12px before the word, so the word lines up with no empty grey in front of it; runs to the rail's edge.", { left: 28, width: TO_EDGE(28) }),
  preset("w-word-short", "From the word, stopping short", "The same start, ending 12px before the rail's edge, the way the gear sits 12px in on the left.", { left: 28, width: TO_EDGE(28) - 12 }),
  preset("w-word-180", "From the word, 180px", "The same start at a fixed 180px.", { left: 28, width: 180 }),
  preset("w-word-150", "From the word, 150px", "The same start, shorter: about two thirds of the rail.", { left: 28, width: 150 }),
  preset("w-word-hug", "From the word, hugging", "The same start, only as wide as the word and the disc.", { left: 28, hug: true }),
  preset("w-word-soft", "From the word, soft corners", "From the word to the edge, with rounded corners instead of round ends.", { left: 28, width: TO_EDGE(28), corners: "soft" }),
  preset("w-after-gear", "From just after the gear", "Starts where the gear ends, 8px before the word, soft corners so the word is not crowded by a round end.", { left: 32, width: TO_EDGE(32), corners: "soft" }),
  preset("w-label-edge", "Edge on Settings' column", "The pill's edge lines up with Settings' label instead, and the word sits 12px inside it.", { left: 40, width: TO_EDGE(40), word: "inset" }, "stretch"),
  preset("w-label-hug", "Edge on Settings' column, hugging", "The same, only as wide as its contents.", { left: 40, hug: true, word: "inset" }, "stretch"),
  preset("w-gear-gear", "Gear to gear", "12px in on both sides, the round end starting where the gear starts; the word still on Settings' column.", { left: 12, width: TO_EDGE(12) - 12 }),
  preset("w-gear-hug", "From the gear, hugging", "Starts where the gear starts, only as wide as it needs.", { left: 12, hug: true }),
  preset("w-row-200", "From the rail's edge, 200px", "Starts at the edge like the rows' hover, stops 30px short.", { left: 0, width: 200 }),
  preset("w-row-170", "From the rail's edge, 170px", "The same, shorter.", { left: 0, width: 170 }),
  preset("w-row-hug", "From the rail's edge, hugging", "Starts at the edge, only as wide as it needs.", { left: 0, hug: true }),
  preset("w-centred", "Centred, 160px", "A shorter pill in the middle of the rail, the word 12px in.", { left: (ROW_WIDTH - 160) / 2, width: 160, word: "inset" }, "stretch"),
  preset("w-shipped", "Full width, word 12px in", "What ships today: the whole rail, the word 12px in, so it starts left of Settings.", { left: 0, width: ROW_WIDTH, word: "inset" }),
];
