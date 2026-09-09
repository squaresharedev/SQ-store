"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scrollIntoPanelCenter } from "@/lib/utils/scroll-into-panel";

/**
 * ASKING FOR ONE CONTROL OF A BLOCK'S INSPECTOR, from outside the panel.
 *
 * The selection toolbar rides directly over the block it edits, which is
 * exactly where a popover must not go: opening a slider there covers the thing
 * whose stroke or roundness is being changed, so the seller cannot see the
 * effect of the number they are dragging. The panel already holds every one of
 * these controls and is docked to the side of the canvas, out of the way — so
 * the bar POINTS AT the control instead of duplicating it.
 *
 * The same three things `CollapsibleSection` does for a summoned settings
 * group (open it, scroll it into view, mark it briefly), minus the opening:
 * a block's inspector is a flat list with nothing to expand. The mark is the
 * part that matters. A panel that silently scrolled leaves a seller hunting
 * for what changed, and this one may not scroll at all — a short inspector has
 * every field on screen already, and then the flash is the ONLY thing that
 * answers "which of these did I just ask for".
 */

export type BlockField = "fill" | "stroke" | "corners" | "opacity";

/**
 * A request for one field. The nonce is what makes a SECOND press of the same
 * toolbar button flash the same field again: the value is otherwise unchanged,
 * and React would see no reason to re-run anything.
 */
export type BlockFieldSummons = { field: BlockField; nonce: number } | null;

/**
 * True for a moment after `nonce` changes to a new number.
 *
 * The nonce IS the event — there is no "stop" to send, and nothing has to
 * remember that a summons happened once it has been seen.
 */
export function useSummonFlash(nonce: number | null): boolean {
  const [flash, setFlash] = useState(false);
  const [seen, setSeen] = useState<number | null>(nonce);

  // During render, not in an effect: the mark is on for the same frame the
  // scroll happens, so the two read as one event rather than two.
  if (nonce !== seen) {
    setSeen(nonce);
    if (nonce !== null) setFlash(true);
  }

  // And it fades on its own, so it never sticks to something the seller has
  // moved on from.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), SUMMON_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  return flash;
}

/** How long the mark stays up. Long enough to catch the eye on a panel that
 *  did not have to scroll, short enough not to read as a state. */
const SUMMON_MS = 1100;

/**
 * WHAT BEING POINTED AT LOOKS LIKE — for a field with no slider in it (just
 * a colour swatch, currently only "fill").
 *
 * A WASH, not a box. The first version drew a hard outline a few pixels
 * outside the control, which on a slider — a wide, short, mostly empty row —
 * framed a big rectangle of nothing and read as an error state on a form
 * field rather than as "here, this one". A tinted panel behind the control
 * covers the same area without drawing a line around it, and the hairline
 * ring inside it does the work the outline was meant to do at a fraction of
 * the weight.
 *
 * It also FADES. The classes are toggled off after a beat and the transition
 * lives on the element permanently (not just while flashing), so the mark
 * arrives quickly and then washes out, which is what makes it read as a
 * pointing gesture rather than as something that has switched on.
 *
 * A SLIDER DOES NOT GET THIS. It already has its own lit look — the accent
 * fill/rail/thumb the `.ss-slider` rules put on `[data-highlighted]` — and
 * washing the row around it on top would be marking the same control twice
 * with two different treatments. `variant="slider"` below skips this class
 * entirely and lets the control speak for itself.
 */
export const SUMMON_FLASH_CLASS = cn(
  "rounded-md transition-[background-color,box-shadow] duration-slow ease-standard",
  "motion-reduce:transition-none",
);

/**
 * The lit half, added while the mark is up.
 *
 * The ring is the same weight the design panel's own summoned sections use
 * (CollapsibleSection) — this is the editor's established "the thing you asked
 * for is here" and it should not be a second dialect. The wash under it is
 * what a ring alone could not do on a slider: fill the row so the mark has a
 * body rather than being a rectangle drawn around mostly empty space.
 *
 * OUTSIDE the box, not inset. An inset ring is painted above the element's own
 * background but below its children's, so on anything that holds an opaque
 * panel it is covered by the first thing inside it and never appears at all.
 */
export const SUMMON_LIT_CLASS = "bg-accent ring-2 ring-ring";

export function SummonedField({
  field,
  summons,
  variant = "box",
  children,
}: {
  field: BlockField;
  summons: BlockFieldSummons;
  /** "box" (default): wash the row per SUMMON_LIT_CLASS. "slider": no wash —
   *  `children` is a render prop instead of a node, handed the flash so it can
   *  forward it as `highlighted` to whichever SliderField(s) it renders. A
   *  field can hold a slider alongside something else (stroke pairs a width
   *  slider with an optional colour swatch below it); only the slider(s) light
   *  up, the rest of the row renders exactly as it would unsummoned. */
  variant?: "box" | "slider";
  children: ReactNode | ((highlighted: boolean) => ReactNode);
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const wanted = summons?.field === field ? summons.nonce : null;
  const flash = useSummonFlash(wanted);

  // CENTRED IN THE PANEL, not merely brought inside it: a field dragged the
  // minimum distance arrives flush against the panel's bottom edge, with none
  // of the group it belongs to visible around it. See scrollIntoPanelCenter.
  useEffect(() => {
    if (wanted === null) return;
    scrollIntoPanelCenter(ref.current);
  }, [wanted]);

  if (variant === "slider") {
    return (
      <div ref={ref} data-block-field={field} className="scroll-mt-4">
        {typeof children === "function" ? children(flash) : children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-block-field={field}
      data-summoned={flash ? "" : undefined}
      className={cn(
        // Bled outward so the wash has room around the control without the
        // padding moving anything when it is not lit.
        "-mx-2 -my-1.5 scroll-mt-4 px-2 py-1.5",
        SUMMON_FLASH_CLASS,
        flash && SUMMON_LIT_CLASS,
      )}
    >
      {typeof children === "function" ? children(flash) : children}
    </div>
  );
}
