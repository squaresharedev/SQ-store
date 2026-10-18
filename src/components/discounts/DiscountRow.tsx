"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { FitText } from "@/components/ui/FitText";
import { cardClass, eyebrowClass } from "@/components/ui/surface-styles";
import {
  DISCOUNT_FACT_ICONS,
  DISCOUNT_KIND_ICONS,
  DiscountFact,
  DiscountOrders,
  DiscountProductsPanel,
  DiscountRevenue,
  DiscountRowActions,
  DiscountRunMeter,
  DiscountSchedule,
  DiscountScope,
  DiscountStatusBadge,
  DiscountTitle,
  DiscountUsage,
  type DiscountRowProps,
  useDiscountRowFacts,
} from "./DiscountRowParts";

// THE STUB AND ITS TEAR LINE. On a wide row the stub stands at the left and the
// ticket tears down a vertical line; on a narrow one it lies across the top (a
// tall black strip beside a stacked body is all stub and no ticket) and tears
// along a horizontal line. STUB sets where that line is and the two NOTCH
// constants sit on it, so the three are one measurement: change them together.

/** The stub: a `h-14` band across the top, a `w-36` column from `@5xl` up
 *  (the width of the longest status chip in any language, plus its padding). */
const STUB =
  "h-14 flex-row gap-3 rounded-t-md border-b px-4 @5xl:h-auto @5xl:w-36 @5xl:flex-col @5xl:justify-center @5xl:gap-2 @5xl:rounded-t-none @5xl:rounded-l-md @5xl:border-b-0 @5xl:border-r @5xl:px-3 @5xl:py-4";

/**
 * One of the two half-circles punched out where the stub tears off: a circle
 * in the page's colour, centred on the card's edge and clipped to the half
 * that lies inside the card (a pixel past half, so it also covers the card's
 * own hairline, which would otherwise run straight across the hole).
 */
const NOTCH =
  "pointer-events-none absolute size-4 rounded-full border border-border bg-background";
/** Left end of the band's tear line; the top of the column's. */
const NOTCH_START =
  "-left-2 top-14 -translate-y-1/2 [clip-path:inset(0_0_0_calc(50%_-_1px))] @5xl:-top-2 @5xl:left-36 @5xl:-translate-x-1/2 @5xl:translate-y-0 @5xl:[clip-path:inset(calc(50%_-_1px)_0_0_0)]";
/** Right end of the band's tear line; the bottom of the column's. */
const NOTCH_END =
  "-right-2 top-14 -translate-y-1/2 [clip-path:inset(0_calc(50%_-_1px)_0_0)] @5xl:-bottom-2 @5xl:left-36 @5xl:right-auto @5xl:top-auto @5xl:-translate-x-1/2 @5xl:translate-y-0 @5xl:[clip-path:inset(0_0_calc(50%_-_1px)_0)]";

/**
 * ONE DISCOUNT IN THE LIST, drawn as the coupon it is: what it takes off and
 * where it stands on the stub, then what it is, when it runs, what it sold,
 * and (for owners and editors) the controls.
 *
 * The stub is ink while the discount is live and grey once it is not, so a
 * list sorts itself at a glance. The body says the rest as glyph-led facts;
 * the one about products opens, and the list unfolds inside the ticket.
 *
 * The item is the size container, so the row answers to the room IT has
 * (`@5xl:`), not the window: the dashboard's rail and the page gutters take a
 * different share at every width. That is also why the product list unfolds in
 * place rather than in a popover, whose phone sheet a size container would
 * capture.
 */
export function DiscountRow({ item, products, canWrite, ...controls }: DiscountRowProps) {
  const facts = useDiscountRowFacts(item);
  const KindIcon = DISCOUNT_KIND_ICONS[item.discount.kind];
  const [productsOpen, setProductsOpen] = useState(false);
  const productsId = useId();

  return (
    <li
      className="@container"
      data-discount-row={item.discount.id}
      data-discount-kind={item.discount.kind}
      data-discount-status={item.status}
    >
      <div className={cn(cardClass, "relative flex flex-col @5xl:flex-row")}>
        <div
          className={cn(
            "flex shrink-0 items-center border-dashed",
            STUB,
            facts.live
              ? "border-background/50 bg-foreground text-background"
              : "border-border bg-secondary text-muted-foreground",
          )}
        >
          <KindIcon className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
          {/* Decorative: the body says the same figure in words. */}
          <span
            aria-hidden="true"
            className="min-w-0 flex-1 text-2xl font-bold leading-none tracking-tight tabular-nums @5xl:w-full @5xl:flex-none @5xl:text-center @5xl:text-3xl"
          >
            <FitText measure={facts.figure}>{facts.figure}</FitText>
          </span>
          <DiscountStatusBadge status={item.status} />
        </div>
        <span aria-hidden="true" className={cn(NOTCH, NOTCH_START)} />
        <span aria-hidden="true" className={cn(NOTCH, NOTCH_END)} />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* One column on a phone; from `@2xl` the title beside the controls,
              over the dates and the results side by side; from `@5xl` a single
              line. The controls' track is a fixed width, not `auto`, so the
              two columns under it start at the same place whatever a row's
              controls are. */}
          <div className="grid min-w-0 flex-1 gap-4 p-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem] @2xl:gap-x-6 @5xl:flex @5xl:items-center">
            <div className="flex min-w-0 flex-col gap-2 @2xl:col-span-2 @5xl:flex-1">
              <span className={eyebrowClass}>{facts.kind}</span>
              <DiscountTitle item={item} facts={facts} />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {facts.isCode && <DiscountFact icon={DISCOUNT_FACT_ICONS.value}>{facts.value}</DiscountFact>}
                <DiscountScope
                  facts={facts}
                  count={products.length}
                  open={productsOpen}
                  onOpenChange={setProductsOpen}
                  panelId={productsId}
                />
                {facts.channel && <DiscountFact icon={DISCOUNT_FACT_ICONS.channel}>{facts.channel}</DiscountFact>}
              </div>
            </div>

            {/* Fixed widths from here on, so the columns line up down the list. */}
            <div className="flex min-w-0 flex-col gap-2 @2xl:col-start-1 @2xl:row-start-2 @5xl:w-56 @5xl:shrink-0">
              <DiscountSchedule item={item} facts={facts} />
              <DiscountRunMeter facts={facts} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 @2xl:col-span-2 @2xl:col-start-2 @2xl:row-start-2 @5xl:w-40 @5xl:shrink-0">
              <DiscountOrders item={item} facts={facts} />
              <DiscountRevenue facts={facts} />
              <DiscountUsage facts={facts} />
            </div>
            {canWrite && (
              <DiscountRowActions
                item={item}
                {...controls}
                className="@2xl:col-start-3 @2xl:row-start-1 @2xl:self-start @2xl:justify-end @5xl:w-36 @5xl:self-auto"
              />
            )}
          </div>

          {productsOpen && products.length > 0 && (
            <div className="border-t border-border px-4 py-3">
              <DiscountProductsPanel id={productsId} products={products} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
