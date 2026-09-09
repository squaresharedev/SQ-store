"use client";

/**
 * THE TWO ACTIONS EVERY BLOCK EDITOR ENDS ON, SIDE BY SIDE.
 *
 * Duplicate and Remove used to be two full-width buttons stacked at the foot of
 * the inspector, which spent two rows of a panel that is short on a desktop and
 * shorter on a phone — and put a destructive action directly under the seller's
 * pointer on its way down the column. They are one row now: a pair of
 * alternatives reads as a pair, and the settings above them get the height back.
 *
 * COMPACT ON PURPOSE. The pair has to hold BOTH labels at the narrowest the
 * design panel can be dragged (260px), so it spends less padding and a step less
 * type than a standalone CTA — and, below 16rem of row, drops the icons. THE
 * WORDS ARE THE PART THAT MATTERS: "Remove from grid" says what a bin can only
 * suggest, and truncating it to "Remove from gr…" to keep a glyph nobody needed
 * is the wrong half to spend. The destructive button is outlined and coloured,
 * so the weight of it lands with or without the bin.
 *
 * Measured as a CONTAINER, not at a breakpoint: this row sits in a panel the
 * seller drags to any width they like, and a phone's sheet is wider than a
 * narrow desktop column. The row's own width is the only thing that answers the
 * question.
 */

import { Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  destructiveButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";

/** Shared by both halves: equal-ish share of the row, allowed to shrink. */
const ACTION_BTN = "flex-1 basis-auto min-w-0 gap-1.5 px-2 text-xs";

/** The icon, present only once the row is wide enough to afford it. */
const ACTION_ICON = "hidden size-4 shrink-0 @3xs/actions:block";

export function BlockActions({
  onDuplicate,
  onRemove,
  duplicateLabel = "Duplicate",
  removeLabel = "Remove from grid",
}: {
  /** Absent for a selection with nothing copyable in it (a product tile is one
   *  per product by design), in which case Remove takes the whole row. */
  onDuplicate?: () => void;
  onRemove?: () => void;
  duplicateLabel?: string;
  removeLabel?: string;
}) {
  if (!onDuplicate && !onRemove) return null;
  return (
    // `pt-4`, not a margin. These editors space their children with
    // `space-y-4`, whose `> * + *` selector outranks a `mt-*` on the child
    // itself, so a margin here would silently do nothing. Padding stacks on
    // top of that 1rem instead, which is the point: this pair is not another
    // setting in the list, it is what happens to the block, and it was sitting
    // one ordinary gap under the last slider as though it were.
    <div className="@container/actions flex items-stretch gap-2 pt-4">
      {/* Copy/paste without a keyboard: one press inserts the copy beside
          this block (Ctrl+C / Ctrl+V do the same from the canvas). */}
      {onDuplicate && (
        <button
          type="button"
          onClick={onDuplicate}
          className={cn(secondaryButtonClass, ACTION_BTN)}
        >
          <Copy className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
          <span className="truncate">{duplicateLabel}</span>
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className={cn(destructiveButtonClass, ACTION_BTN)}
        >
          <Trash2 className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
          <span className="truncate">{removeLabel}</span>
        </button>
      )}
    </div>
  );
}
