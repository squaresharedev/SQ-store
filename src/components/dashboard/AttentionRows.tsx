"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import Link from "@/components/ui/AppLink";
import { focusRingInsetClass, moduleLinkClass, transitionClass } from "@/components/ui/control-styles";
import type { AttentionKey } from "@/lib/dashboard/attention";
import { cn } from "@/lib/utils";
import { ATTENTION_ICONS } from "./attention-icons";

/** One row, its copy already in the reader's language (NeedsAttention resolves it). */
export type AttentionRow = {
  key: AttentionKey;
  label: string;
  description: string;
  href: string;
  urgent: boolean;
};

/** An urgent row's short ink bar on the card's left edge. `-left-4` is
 *  ModuleCard's `p-4`, so the bar sits on the card's inner border. */
const urgentBarClass = "before:absolute before:inset-y-2 before:-left-4 before:w-0.5 before:bg-foreground";

/**
 * The card's rows (picked in /dev/attention-lab, 2026-11-15): each row is ONE
 * link, an icon for the kind of thing, the label and a chevron, at every width.
 * The sentence saying why is not drawn; a screen reader hears it as the link's
 * description. Rows with a buyer waiting carry an ink bar on the card's edge.
 * Past `visible` rows, the rest wait behind "Show N more".
 */
export function AttentionRows({
  rows,
  visible,
  showMoreLabel,
  showFewerLabel,
}: {
  rows: AttentionRow[];
  /** Rows shown before the button; all of them when it is rows.length. */
  visible: number;
  showMoreLabel: string;
  showFewerLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const overflow = rows.length > visible;
  const shown = expanded || !overflow ? rows : rows.slice(0, visible);

  return (
    <div className="space-y-4">
      {/* -my-2.5 takes back the rows' own padding at the top and bottom, so the
          list sits where the card's spacing puts it while every row keeps a
          full-height tap target. */}
      <ul id={listId} className="-my-2.5 divide-y divide-border">
        {shown.map((row) => {
          const Icon = ATTENTION_ICONS[row.key];
          const describedBy = `${listId}-${row.key}`;
          return (
            <li
              key={row.key}
              className={cn("relative", row.urgent && urgentBarClass)}
              data-attention-row={row.key}
              data-urgent={row.urgent || undefined}
            >
              <Link
                href={row.href}
                aria-describedby={describedBy}
                className={cn("group/btn -mx-2 flex items-start gap-2.5 px-2 py-2.5 hover:bg-accent", transitionClass, focusRingInsetClass)}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{row.label}</span>
                <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground" strokeWidth={2} aria-hidden="true" />
              </Link>
              <span id={describedBy} hidden>
                {row.description}
              </span>
            </li>
          );
        })}
      </ul>
      {overflow && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
          className={cn(moduleLinkClass, "mt-1")}
        >
          {expanded ? showFewerLabel : showMoreLabel}
        </button>
      )}
    </div>
  );
}
