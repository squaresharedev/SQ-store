import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingClass } from "@/components/ui/control-styles";
import { RadialLightRays } from "@/components/ui/RadialLightRays";

/**
 * The picture at the top of an empty list: an "add" card in the middle, glowing
 * green, with an example of what it makes on EITHER side of it, each tilted away
 * from the card and tucked under its edge.
 *
 * The examples are the promise (this is what you will have) and the card is the
 * way there, so the card always sits ON TOP and the examples only peek out from
 * under it. An example carries no card chrome of its own, just the thing itself:
 * a product cut out of its photo, a storefront's grid.
 *
 * Laid out in flow, not absolutely: each example tucks under the card with a
 * negative margin, so the three are measured and centred as one shape.
 *
 * Motion: the examples slide out from under the card once on arrival
 * (`.showcase-peek-*` in globals.css), and fan out a little further while the
 * card is hovered or focused, as the card lifts. Transform only, instant under
 * reduced motion (styles.md §6.2).
 *
 * The hover signals are spelled against a named group rather than the card's
 * own :hover, so one set of classes serves both shapes of caller:
 *  - the card IS the control (`href` or `onClick`): the showcase is the group,
 *    and focus lands on the card inside it (`group-has-[:focus-visible]`);
 *  - the card is `decorative`, drawn inside a larger control (a whole grid
 *    cell): that control wears `addShowcaseGroupClass` and takes the focus
 *    itself (`group-focus-visible`).
 *
 * The showcase is `pointer-events-none` and only the card opts back in, so an
 * example never fires the hover (and never takes a click) on its own: nothing
 * moves unless the pointer is on something that will actually respond.
 */

/** Hover/focus scope for a showcase whose card is `decorative`: put it on the
 *  control that wraps the showcase. */
export const addShowcaseGroupClass = "group/add";

type CardAction =
  | { href: string; onClick?: never; disabled?: never; decorative?: never }
  | { onClick: () => void; disabled?: boolean; href?: never; decorative?: never }
  | { decorative: true; href?: never; onClick?: never; disabled?: never };

export type AddShowcaseCard = CardAction & {
  /** Words under the plus, and the card's accessible name when it is the
   *  control. */
  label: string;
  /** Size and corner: products are sharp, storefronts rounded, matching the
   *  cards each list fills up with. */
  className?: string;
  "data-tour"?: string;
};

const CARD = [
  "pointer-events-auto relative z-10 flex shrink-0 flex-col items-center justify-center gap-3 border border-border bg-card p-3 text-center shadow-lg",
  "transition-[translate,box-shadow] duration-base ease-standard motion-reduce:transition-none",
  "group-hover/add:-translate-y-1 group-hover/add:shadow-xl",
  "group-focus-visible/add:-translate-y-1 group-focus-visible/add:shadow-xl",
  "group-has-[:focus-visible]/add:-translate-y-1 group-has-[:focus-visible]/add:shadow-xl",
  "disabled:pointer-events-none disabled:opacity-60",
].join(" ");

/** The plus pops like every other add icon (iconPopClass), keyed to the same
 *  group as the rest of the showcase. */
const PLUS_GLYPH = [
  "size-5 transition-[scale] duration-base ease-entrance motion-reduce:transition-none",
  "group-hover/add:scale-110 group-focus-visible/add:scale-110 group-has-[:focus-visible]/add:scale-110",
].join(" ");

/** What both sides share: sits under the card, eases its tilt and offset. */
const SIDE =
  "relative z-0 shrink-0 transition-[translate,rotate] duration-slow ease-entrance motion-reduce:transition-none";

// Mirror images of each other. Each tucks under its own edge of the card, tilts
// away from it, and on hover/focus leans a little further out. How far they
// tuck is `--showcase-tuck` (set on the showcase's className): a cut-out
// product fills less of its box than a rectangular board, so it needs less
// overlap to read as "under the card" without disappearing behind it.
const LEFT = [
  "showcase-peek-left -mr-[var(--showcase-tuck,2rem)] -rotate-8",
  "group-hover/add:-translate-x-3 group-hover/add:-rotate-11",
  "group-focus-visible/add:-translate-x-3 group-focus-visible/add:-rotate-11",
  "group-has-[:focus-visible]/add:-translate-x-3 group-has-[:focus-visible]/add:-rotate-11",
].join(" ");
const RIGHT = [
  "showcase-peek-right -ml-[var(--showcase-tuck,2rem)] rotate-8",
  "group-hover/add:translate-x-3 group-hover/add:rotate-11",
  "group-focus-visible/add:translate-x-3 group-focus-visible/add:rotate-11",
  "group-has-[:focus-visible]/add:translate-x-3 group-has-[:focus-visible]/add:rotate-11",
].join(" ");

/**
 * The glow behind the add card. Green, the one splash of colour on an otherwise
 * greyscale page, and it marks the ACTION, not the examples: they sit in front
 * of it, crisp, while it haloes the card they frame. A decoration, never a
 * surface text is read on, so it carries no contrast duty.
 *
 * Two layers in one square centred on the card: a soft static halo, and light
 * rays radiating from behind the card all the way round and drifting in a
 * circle (RadialLightRays). The halo is also what shows where WebGL does not,
 * so there is always a glow.
 *
 * It paints BELOW the examples: its slot around the card makes no stacking
 * context of its own, so its `-z-10` lands in the showcase's (`isolate`),
 * under the examples' `z-0` and the card's `z-10`. It brightens a step while
 * the card is hovered or focused.
 */
const GLOW = [
  // Sized off the card, but capped, so a wide card's rays still fade out
  // before they reach the frame's edge or the heading under the picture.
  "pointer-events-none absolute left-1/2 top-1/2 -z-10 aspect-square w-[260%] max-w-[360px] -translate-x-1/2 -translate-y-1/2 opacity-80",
  "transition-[opacity,scale] duration-slow ease-standard motion-reduce:transition-none",
  "group-hover/add:scale-105 group-hover/add:opacity-100",
  "group-focus-visible/add:scale-105 group-focus-visible/add:opacity-100",
  "group-has-[:focus-visible]/add:scale-105 group-has-[:focus-visible]/add:opacity-100",
].join(" ");
const GLOW_COLOR = "#4ade80";
const HALO_STYLE: CSSProperties = {
  background:
    "radial-gradient(closest-side, rgba(74, 222, 128, 0.32), rgba(74, 222, 128, 0.1) 50%, rgba(74, 222, 128, 0) 100%)",
};

function Side({
  side,
  className,
  children,
}: {
  side: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div aria-hidden="true" className={cn(SIDE, side === "left" ? LEFT : RIGHT, className)}>
      {children}
    </div>
  );
}

export function AddShowcase({
  left,
  right,
  exampleClassName,
  card,
  className,
}: {
  /** What the card makes, one on each side. Decorative: hidden from
   *  assistive tech. */
  left: ReactNode;
  right: ReactNode;
  /** Size of each example (and any vertical offset). */
  exampleClassName?: string;
  /** The add card. Left out for someone who cannot add anything, who gets the
   *  two examples on their own rather than a plus that does nothing. */
  card?: AddShowcaseCard;
  className?: string;
}) {
  const interactive = card !== undefined && !card.decorative;
  return (
    <div
      aria-hidden={interactive ? undefined : true}
      className={cn(
        "pointer-events-none isolate flex items-center justify-center",
        interactive && addShowcaseGroupClass,
        className,
      )}
    >
      <Side side="left" className={cn(exampleClassName, !card && "mr-2")}>
        {left}
      </Side>
      {card && (
        <div className="relative shrink-0">
          <div aria-hidden="true" data-showcase-glow="" className={GLOW}>
            <div className="absolute inset-0" style={HALO_STYLE} />
            <RadialLightRays color={GLOW_COLOR} intensity={0.55} className="absolute inset-0" />
          </div>
          <AddCard card={card} />
        </div>
      )}
      <Side side="right" className={cn(exampleClassName, !card && "ml-2")}>
        {right}
      </Side>
    </div>
  );
}

function AddCard({ card }: { card: AddShowcaseCard }) {
  const face = (
    <>
      {/* Solid and sharp, like every primary action (control-styles). */}
      <span className="flex size-11 items-center justify-center bg-primary text-primary-foreground">
        <Plus className={PLUS_GLYPH} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold text-foreground">{card.label}</span>
    </>
  );
  const className = cn(CARD, card.className);

  if (card.href !== undefined) {
    return (
      <Link
        href={card.href}
        data-tour={card["data-tour"]}
        className={cn(className, focusRingClass)}
      >
        {face}
      </Link>
    );
  }
  if (card.onClick) {
    return (
      <button
        type="button"
        onClick={card.onClick}
        disabled={card.disabled}
        data-tour={card["data-tour"]}
        className={cn(className, focusRingClass)}
      >
        {face}
      </button>
    );
  }
  return <span className={className}>{face}</span>;
}
