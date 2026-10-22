"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  focusRingClass,
  infoTextClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { Popover } from "@/components/ui/Popover";
import { PHOTO_PLACEMENTS } from "@/components/product-page/ProductBadges";
import { BADGES_ON_PHOTO_MAX, type BadgePlacement } from "@/types/product";

/** Where the dot sits in the glyph's 16-unit box for each placement. */
const DOT: Record<BadgePlacement, { cx: number; cy: number }> = {
  beside: { cx: 13, cy: 6 },
  "photo-top-left": { cx: 3.5, cy: 3.5 },
  "photo-top-right": { cx: 7.5, cy: 3.5 },
  "photo-bottom-left": { cx: 3.5, cy: 12.5 },
  "photo-bottom-right": { cx: 7.5, cy: 12.5 },
};

/** A product page in miniature (the photo, and the words beside it) with a
 *  dot where the badge goes. The trigger's whole picture, at a glance. */
export function PlacementGlyph({ placement, className }: { placement: BadgePlacement; className?: string }) {
  const dot = DOT[placement];
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
      <rect x="1" y="1" width="9" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M12 9.5h3M12 12h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx={dot.cx} cy={dot.cy} r="1.9" fill="currentColor" />
    </svg>
  );
}

/** Where the corner buttons sit inside the photo of the diagram. */
const CORNER_SPOT: Record<(typeof PHOTO_PLACEMENTS)[number], string> = {
  "photo-top-left": "left-1 top-1",
  "photo-top-right": "right-1 top-1",
  "photo-bottom-left": "bottom-1 left-1",
  "photo-bottom-right": "bottom-1 right-1",
};

const SPOT_CLASS = cn(
  "flex items-center justify-center rounded-sm border text-xs font-medium",
  "disabled:cursor-not-allowed disabled:opacity-40",
  transitionClass,
  focusRingClass,
);

/**
 * WHERE ONE BADGE GOES, as a picture of the page: the photo with a button in
 * each corner, and the space beside it. The keyboard's and the screen reader's
 * way of moving a badge, beside the drag in the preview above the list, which
 * does the same thing with a pointer. A corner is refused while the photo
 * already holds BADGES_ON_PHOTO_MAX badges (moving between corners is fine).
 */
export function BadgePlacementPicker({
  id,
  value,
  label,
  canPlace,
  onChange,
}: {
  id: string;
  value: BadgePlacement;
  /** The trigger's accessible name ("Where badge 2 goes"). */
  label: string;
  canPlace: (placement: BadgePlacement) => boolean;
  onChange: (placement: BadgePlacement) => void;
}) {
  const t = useTranslations("Products.badgesField");
  const [open, setOpen] = useState(false);
  const photoFull = PHOTO_PLACEMENTS.some((placement) => !canPlace(placement));

  function choose(placement: BadgePlacement) {
    onChange(placement);
    setOpen(false);
  }

  const spot = (placement: BadgePlacement) => ({
    type: "button" as const,
    "aria-label": t(`placements.${placement}`),
    title: t(`placements.${placement}`),
    "aria-pressed": placement === value,
    disabled: !canPlace(placement),
    "data-autofocus": placement === value ? "" : undefined,
    "data-badge-placement-choice": placement,
    onClick: () => choose(placement),
  });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t("placementPicker")}
      rootClassName="w-auto shrink-0"
      panelClassName="sm:w-max"
      trigger={
        <button
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          title={`${label}: ${t(`placements.${value}`)}`}
          onClick={() => setOpen((was) => !was)}
          data-product-badge-placement={value}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            transitionClass,
            focusRingClass,
          )}
        >
          <PlacementGlyph placement={value} className="size-4" />
        </button>
      }
    >
      <div className="mx-auto flex w-max flex-col gap-2">
        <div role="group" aria-label={t("placementPicker")} className="flex gap-2">
          {/* The photo, with a place in each corner. */}
          <div
            className="relative size-28 rounded-sm bg-muted"
            data-badge-placement-photo=""
          >
            <span
              className={cn(infoTextClass, "pointer-events-none absolute inset-0 flex items-center justify-center")}
              aria-hidden="true"
            >
              {t("photo")}
            </span>
            {PHOTO_PLACEMENTS.map((placement) => (
              <button
                key={placement}
                {...spot(placement)}
                className={cn(
                  SPOT_CLASS,
                  "absolute size-9",
                  CORNER_SPOT[placement],
                  placement === value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background hover:border-foreground",
                )}
              >
                <span className="size-2 rounded-full bg-current" aria-hidden="true" />
              </button>
            ))}
          </div>
          {/* Beside the product: the words. */}
          <button
            {...spot("beside")}
            className={cn(
              SPOT_CLASS,
              "h-28 w-24 flex-col gap-1.5 px-2 text-center",
              value === "beside"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground hover:border-foreground",
            )}
          >
            {t("beside")}
          </button>
        </div>
        {photoFull && (
          <p className={cn(infoTextClass, "max-w-[15rem]")} data-badge-photo-full="">
            {t("photoFull", { max: BADGES_ON_PHOTO_MAX })}
          </p>
        )}
      </div>
    </Popover>
  );
}
