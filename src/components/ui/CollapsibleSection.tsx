"use client";

/**
 * CollapsibleSection — reusable side-panel section. Renders FLUSH: no card
 * chrome, so the content spans the panel's full width and neighbouring
 * sections are told apart by a divider line alone. Carries an optional
 * collapsible toggle (ChevronDown) and an optional header action slot; when
 * `collapsible` is false the section is always open and the header is a plain
 * <h2>.
 *
 * The horizontal padding lives HERE rather than on the panel, so the dividers
 * run edge to edge. On mobile the padding is dropped: there these sections sit
 * inside a bottom sheet that already provides its own.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollIntoPanelCenter } from "@/lib/utils/scroll-into-panel";

export function CollapsibleSection({
  title,
  children,
  headerAction,
  collapsible = false,
  defaultOpen = true,
  summon = false,
}: {
  title: string;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /**
   * Something outside asked for THIS section by name: open it, scroll it into
   * view and flash it once. Opt-in and false by default, so every existing call
   * site behaves exactly as it did.
   */
  summon?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [flash, setFlash] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const isOpen = !collapsible || open;
  // The disclosure pattern wants the trigger to NAME what it expands, not just
  // report that it did. Only the collapsible variant has a trigger to wire.
  const contentId = `${useId()}-content`;

  // Being summoned is three things at once: open, on screen, and briefly
  // marked. The mark matters most, because a panel that silently scrolled
  // leaves a seller hunting for what changed.
  //
  // Opening happens during RENDER rather than in an effect, so the section is
  // already open on the frame it scrolls into view, and so it STAYS open after
  // the summons clears. The summons is an instruction, not a mode.
  // Seeded FALSE, not from `summon`. A section can mount already summoned (the
  // group it lives in was closed when the request arrived, or the editor was
  // opened straight from a link), and seeding from the current value would
  // treat that as "no change" and leave the section shut.
  const [lastSummon, setLastSummon] = useState(false);
  if (summon !== lastSummon) {
    setLastSummon(summon);
    if (summon) {
      setOpen(true);
      setFlash(true);
    }
  }

  // Scrolling is a real DOM side effect, which is what an effect is for. It
  // aims for the MIDDLE of the panel rather than the nearest edge: a section
  // dragged the minimum distance arrives flush against the bottom of the
  // scroller with none of its own content in sight.
  useEffect(() => {
    if (summon) scrollIntoPanelCenter(sectionRef.current);
  }, [summon]);

  // And the mark fades on its own, so it never sticks to a section the seller
  // has moved on from.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(timer);
  }, [flash]);

  return (
    <section
      ref={sectionRef}
      className={cn(
        "border-b border-border",
        // Inset so the ring is not clipped by the panel's own edge.
        flash &&
          "ring-2 ring-inset ring-ring transition-shadow duration-slow ease-standard motion-reduce:transition-none",
      )}
    >
      <div className="flex items-center justify-between gap-2 py-3 lg:px-4">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={isOpen}
            aria-controls={contentId}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-sm font-semibold text-foreground"
          >
            {title}
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-base ease-standard motion-reduce:transition-none",
                isOpen && "rotate-180",
              )}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        ) : (
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        )}
        {headerAction}
      </div>
      {isOpen && (
        <div id={contentId} className="pb-4 lg:px-4">
          {children}
        </div>
      )}
    </section>
  );
}
