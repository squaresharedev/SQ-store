"use client";

import type { MouseEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { NAV_ITEM_CLASSES } from "@/components/dashboard/Sidebar";
import { SETTINGS_LINK } from "@/lib/search/nav-constants";
import { cn } from "@/lib/utils";

/** The lab's chips are links to the plans page; here a click only picks. */
const stayHere = (event: MouseEvent) => event.preventDefault();

/**
 * The rail's footer the way Sidebar draws it: the chip over a Settings row.
 * The guide is a dashed line up from where Settings' label starts, through
 * the chip, to show whether its word lines up.
 */
export function RailFooter({ guide, children }: { guide: boolean; children: ReactNode }) {
  const t = useTranslations();
  return (
    <div className="w-64 max-w-full overflow-hidden border border-border bg-background" onClickCapture={stayHere}>
      <div className="space-y-1 px-3 py-4" data-rail-column>
        {children}
        <div className={cn(NAV_ITEM_CLASSES, "text-muted-foreground")}>
          <SETTINGS_LINK.icon />
          <span data-settings-word className="relative">
            {guide && (
              <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-28 border-l border-dashed border-acid-ink" />
            )}
            {t(SETTINGS_LINK.label)}
          </span>
        </div>
      </div>
    </div>
  );
}
