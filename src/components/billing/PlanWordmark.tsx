import type { ComponentType } from "react";
import type { PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

type Glyph = ComponentType<{ className?: string }>;

/**
 * A solid crown: three peaks with a ball on each, on a plain band. Our own
 * drawing rather than the outline icon the owner badge uses (settings/team/
 * MemberRow), so the plan's crown and the owner's never read as the same mark.
 */
function CrownGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path
        d="M3 9l4.6 4.2L12 6l4.4 7.2L21 9l-1.7 9.2H4.7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="3" cy="8" r="1.6" />
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="21" cy="8" r="1.6" />
    </svg>
  );
}

/** A four-point spark with a small one beside it: something just begun. */
function SparkGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M10 3c.6 5 3 7.4 8 8-5 .6-7.4 3-8 8-.6-5-3-7.4-8-8 5-.6 7.4-3 8-8z" />
      <path d="M19 15c.3 2.2 1.3 3.2 3.5 3.5-2.2.3-3.2 1.3-3.5 3.5-.3-2.2-1.3-3.2-3.5-3.5 2.2-.3 3.2-1.3 3.5-3.5z" />
    </svg>
  );
}

/**
 * A mark on a plan's name: the glyph, the letter it sits on (the last such
 * letter with `last`), and `className`, its colour and where it sits over that
 * letter, in em so it follows the name's size. A name is translated, so the
 * letter is a preference: a word without it wears the mark on its last letter.
 */
type PlanMark = { glyph: Glyph; letter: string; last?: boolean; className: string };

/**
 * What each plan's name wears: the top plan a gold crown on its "o", the
 * middle one a spark at the end of its last "r" in the brand accent (the plan
 * a shop starts with), Free nothing. The accent is the palette-aware ink step
 * (acid-ink), so the spark is the brand purple on white and on black alike.
 */
const PLAN_MARKS: Record<PlanId, PlanMark | null> = {
  free: null,
  starter: {
    glyph: SparkGlyph,
    letter: "r",
    last: true,
    className: "left-full size-[0.46em] translate-y-[0.34em] text-acid-ink",
  },
  pro: {
    glyph: CrownGlyph,
    letter: "o",
    // Worn, not floating: centred on the "o" (whose glyph sits a little right
    // of its box), a touch narrower than it, and sunk until the band's corners
    // rest on the letter's curve. The letter's own top stroke hides the middle
    // of the band. Tipped about the band, the way a crown slips on a head.
    className:
      "left-[55%] size-[0.6em] origin-[50%_79%] translate-y-[0.5em] rotate-6 text-plan-gold dark:text-plan-gold-dark",
  },
};

/**
 * A plan's name with its mark on one letter, INLINE: it takes the size and
 * weight of the text around it, so the same crown tops the big wordmark and a
 * "Pro" in the middle of a heading.
 *
 * The mark is BEHIND the name (a negative z-index inside the name's own
 * stacking context), low enough that the letter clips its base: the crown is
 * worn by the "o", instead of floating over the word. The marked letter is set
 * to a line-height of 1 so the mark's place over it does not depend on the
 * line-height of the text it is in.
 *
 * The name is real text (what a screen reader and a search read); only the
 * mark is decorative. Server-compatible.
 */
export function MarkedPlanName({ plan, name }: { plan: PlanId; name: string }) {
  const mark = PLAN_MARKS[plan];
  if (!mark) return name;
  const letters = Array.from(name);
  const matches = letters.flatMap((letter, index) => (letter.toLowerCase() === mark.letter ? [index] : []));
  const markAt = (mark.last ? matches.at(-1) : matches[0]) ?? letters.length - 1;
  const Glyph = mark.glyph;

  return (
    <span data-plan-mark={plan} className="relative isolate inline-block whitespace-nowrap">
      {letters.map((letter, index) =>
        index === markAt ? (
          <span key={index} className="relative inline-block leading-none">
            {letter}
            <Glyph className={cn("absolute bottom-full -z-10 -translate-x-1/2", mark.className)} />
          </span>
        ) : (
          letter
        ),
      )}
    </span>
  );
}

/**
 * A plan, drawn as its own name set large with its mark (MarkedPlanName). The
 * graphic half of Settings > Plan & billing's "Your plan" card, and the head
 * of the cancel dialog. It has no surface of its own: it sits straight on
 * whatever holds it.
 */
export function PlanWordmark({ plan, name, className }: { plan: PlanId; name: string; className?: string }) {
  return (
    <div data-plan-wordmark={plan} className={cn("flex items-center justify-center py-6 text-center", className)}>
      <p className="font-inter text-6xl font-semibold leading-none tracking-tight text-foreground">
        <MarkedPlanName plan={plan} name={name} />
      </p>
    </div>
  );
}
