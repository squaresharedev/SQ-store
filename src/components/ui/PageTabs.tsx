"use client";

import Link from "next/link";
import { attentionCountClass } from "@/components/ui/surface-styles";
import { focusRingInsetClass, transitionClass } from "@/components/ui/control-styles";
import { isModifiedClick } from "@/lib/utils/modified-click";
import { cn } from "@/lib/utils";

export type PageTab = {
  href: string;
  label: string;
  active: boolean;
  /** Something waiting in this tab. Shown as a pill when above zero. */
  count?: number;
  /** What the count means, in a sentence, for screen readers ("3 orders to
   *  ship"). Required with `count`: a bare digit announces nothing useful. */
  countLabel?: string;
};

/**
 * PageTabs: the strip that switches a PAGE between lists (the Orders page's To
 * ship / All orders). Not PanelTabs, which switches a side panel's contents in
 * place: these are links, because each list is its own URL that can be
 * bookmarked, shared and opened in a new tab.
 *
 * `onNavigate` lets the page make a plain click part of its own navigation (a
 * transition with a busy state) while modified clicks keep the browser's
 * behaviour.
 */
export function PageTabs({
  tabs,
  ariaLabel,
  onNavigate,
  className,
}: {
  tabs: readonly PageTab[];
  ariaLabel: string;
  onNavigate?: (href: string) => void;
  className?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={cn("flex gap-1 border-b border-border", className)}>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          onClick={(event) => {
            if (!onNavigate || isModifiedClick(event)) return;
            event.preventDefault();
            if (!tab.active) onNavigate(tab.href);
          }}
          className={cn(
            "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium",
            transitionClass,
            focusRingInsetClass,
            tab.active
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <>
              <span aria-hidden="true" className={attentionCountClass}>
                {tab.count}
              </span>
              {tab.countLabel && <span className="sr-only">{tab.countLabel}</span>}
            </>
          )}
        </Link>
      ))}
    </nav>
  );
}
