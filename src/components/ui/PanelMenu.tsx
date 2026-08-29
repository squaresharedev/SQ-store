"use client";

/**
 * PanelMenu — a side panel's top level when it has more settings than fit in
 * one readable column: a list of named rows, each opening a submenu.
 *
 * Renders FLUSH, like CollapsibleSection: the padding lives on the rows so the
 * dividers run edge to edge, and it is dropped on mobile where the surrounding
 * bottom sheet supplies its own.
 *
 * THREE THINGS IT DELIBERATELY DOES NOT HAVE.
 *
 * No icons. The panels carry no navigational icons today, and the groups that
 * need one most ("Canvas", "Product cards") are exactly the ones no honest
 * glyph exists for. A label that has to be decoded by its picture is worse than
 * the label alone.
 *
 * No value hints in the general case. A hint for a group whose value is a
 * solid/gradient/image union has no single thing to show, so the mechanism
 * would need a special case per group to stay truthful. Callers pass `hint`
 * only where one representative value really exists.
 *
 * No Escape handler. The canvas already spends Escape on deselecting blocks;
 * a submenu that took it would either break that or be broken by it. The way
 * back is PanelBackRow, which is always on screen.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  focusRingInsetClass,
  infoTextClass,
  transitionClass,
} from "@/components/ui/control-styles";

export function PanelMenu({ children }: { children: React.ReactNode }) {
  return <div role="list">{children}</div>;
}

export function PanelMenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  /** The current value, when the group HAS a single one worth showing. */
  hint?: string;
  onClick: () => void;
}) {
  return (
    <div role="listitem" className="border-b border-border">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-none py-3 text-left lg:px-4",
          transitionClass,
          focusRingInsetClass,
          "hover:bg-accent",
        )}
      >
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          {hint && (
            <span className={cn(infoTextClass, "min-w-0 truncate")}>{hint}</span>
          )}
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
            aria-hidden="true"
          />
        </span>
      </button>
    </div>
  );
}

/**
 * The way out of a submenu, pinned to the top of the panel.
 *
 * `sticky` is load-bearing rather than polish: on mobile these panels are
 * `max-h-[70vh]` bottom sheets, so a back button that scrolls away with the
 * content strands anyone who has scrolled down a long group.
 */
export function PanelBackRow({
  title,
  path,
  ariaLabel,
  onBack,
}: {
  title: string;
  /** What this group sits inside, shown ahead of the title. A seller who
   *  arrived here from search rather than by walking the menu has no other way
   *  to know where they are. */
  path?: string;
  /** Overrides the spoken label for a row that is NOT backing out to the
   *  settings menu (the layers list backs out to the selected block). The
   *  default names the settings menu, and saying that anywhere else would send
   *  a screen reader user somewhere the button does not go. */
  ariaLabel?: string;
  onBack: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background">
      <button
        type="button"
        onClick={onBack}
        aria-label={ariaLabel ?? `Back to all settings, leaving ${title}`}
        className={cn(
          "flex min-h-11 w-full items-center gap-1.5 rounded-none py-3 text-left lg:px-4",
          transitionClass,
          focusRingInsetClass,
          "hover:bg-accent",
        )}
      >
        <ChevronLeft
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {path && (
            <span className="font-normal text-muted-foreground">{path} / </span>
          )}
          {title}
        </span>
      </button>
    </div>
  );
}
