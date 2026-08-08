"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";
import { useSearch } from "@/components/search/SearchProvider";
import { useIsMacPlatform } from "@/lib/hooks/useIsMacPlatform";

/**
 * The MINIMIZED state of universal search, desktop: a quiet field-shaped button
 * filling the top bar's left half. It looks like an input and is a button,
 * because clicking it opens the palette whose input is the real one — two live
 * text fields would mean two places for the caret to be.
 */
export function SearchTrigger() {
  const search = useSearch();
  const isMac = useIsMacPlatform();

  // Announce this button as the palette's anchor: the maximized state opens
  // attached under it, so the bar reads as expanding rather than a popup.
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const registerAnchor = search?.registerAnchor;
  React.useEffect(
    () => registerAnchor?.(buttonRef.current),
    [registerAnchor],
  );

  // No provider above (a surface without search): render nothing rather than a
  // button that does nothing when clicked.
  if (!search) return null;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={search.open}
      aria-haspopup="dialog"
      aria-expanded={search.isOpen}
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        // SHARP, like every button (control-styles.ts brand rule) — only
        // nav/menu items keep a radius, and this reads as a control, not nav.
        "group/search flex h-9 w-full max-w-xs items-center gap-2 rounded-none border border-input",
        "bg-background px-3 text-left text-sm text-muted-foreground",
        "hover:border-border hover:bg-accent hover:text-foreground",
        // The bar centers this vertically (h-14 around this h-9), leaving a
        // measured ~10.5px gap below it — smaller than the ~24px the bar's
        // own px-6 gives it on the left. This margin closes that mismatch so
        // the trigger sits the same distance from the bar's left edge as from
        // its bottom edge. On the BUTTON itself, not a wrapper: a wrapper div
        // around a `w-full` flex child breaks its width:100% resolution (the
        // wrapper has no definite width of its own to be 100% of), which
        // shrank it to fit-content the one time this was tried.
        "-ml-[13.5px]",
        transitionClass,
        focusRingClass,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Search</span>
      {isMac !== null && (
        <kbd
          aria-hidden
          className="shrink-0 rounded-none border border-border bg-muted px-1.5 py-0.5 font-inter text-[0.6875rem] leading-none text-muted-foreground"
        >
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      )}
    </button>
  );
}
