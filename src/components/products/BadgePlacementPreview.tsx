"use client";

import { useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { infoTextClass, panelEyebrowClass } from "@/components/ui/control-styles";
import {
  BadgePill,
  PHOTO_CORNER_CLASS,
  PHOTO_PLACEMENTS,
  badgesByCorner,
  photoCornerWidth,
} from "@/components/product-page/ProductBadges";
import { DARK_INK, chipStyle, photoChipStyle } from "@/components/product-page/product-page-maps";
import { isOnPhoto } from "@/lib/validation/product";
import { BADGES_ON_PHOTO_MAX, type BadgePlacement } from "@/types/product";
import type { BadgeFormValue } from "./form-values";

/** The corners of the preview, drawn at a middling roundness: the form does
 *  not know which storefront's theme the page will wear. */
const PREVIEW_RADIUS = 8;

/** How far a press must travel before it is a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

type Drag = {
  localId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Where in the pill it was grabbed, so the pill does not jump to the pointer. */
  offsetX: number;
  offsetY: number;
  width: number;
  moved: boolean;
  /** Where it would land if let go now, or null over neither place. */
  target: BadgePlacement | null;
};

/**
 * THE PRODUCT PAGE IN MINIATURE, where the badges can be moved.
 *
 * The photo (the product's own cover when it has one) and the space beside it,
 * with every badge drawn where the buyer will see it, in the same pills the
 * page draws. Grabbing a badge and letting go on the photo puts it in the
 * nearest corner; letting go beside the product puts it there. Pointer events,
 * so a finger works as well as a mouse.
 *
 * Hidden from assistive technology on purpose: the same move is the "Where it
 * goes" control on each badge's row, which a keyboard and a screen reader can
 * use, and a second, pointer-only copy of the list would only be noise.
 */
export function BadgePlacementPreview({
  badges,
  imageUrl,
  title,
  canPlace,
  onPlace,
}: {
  badges: readonly BadgeFormValue[];
  /** The cover photo as the form currently holds it, or null for none. */
  imageUrl: string | null;
  title: string;
  canPlace: (badge: BadgeFormValue, placement: BadgePlacement) => boolean;
  onPlace: (localId: string, placement: BadgePlacement) => void;
}) {
  const t = useTranslations("Products.badgesField");
  const photoZone = useRef<HTMLDivElement>(null);
  const besideZone = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [refused, setRefused] = useState(false);

  /** The place under a point: a corner of the photo (by which quarter of it the
   *  point is in), beside the product, or nowhere. */
  function placeAt(x: number, y: number): BadgePlacement | null {
    const photo = photoZone.current?.getBoundingClientRect();
    if (photo && x >= photo.left && x <= photo.right && y >= photo.top && y <= photo.bottom) {
      const top = y < photo.top + photo.height / 2;
      const left = x < photo.left + photo.width / 2;
      return `photo-${top ? "top" : "bottom"}-${left ? "left" : "right"}`;
    }
    const beside = besideZone.current?.getBoundingClientRect();
    if (beside && x >= beside.left && x <= beside.right && y >= beside.top && y <= beside.bottom) {
      return "beside";
    }
    return null;
  }

  function onPointerDown(event: PointerEvent<HTMLElement>, badge: BadgeFormValue) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    setRefused(false);
    setDrag({
      localId: badge.localId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      moved: false,
      target: null,
    });
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!drag) return;
    const moved =
      drag.moved ||
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > DRAG_THRESHOLD_PX;
    setDrag({ ...drag, x: event.clientX, y: event.clientY, moved, target: moved ? placeAt(event.clientX, event.clientY) : null });
  }

  function onPointerUp(event: PointerEvent<HTMLElement>, badge: BadgeFormValue) {
    if (!drag) return;
    const target = drag.moved ? placeAt(event.clientX, event.clientY) : null;
    setDrag(null);
    if (!target || target === badge.placement) return;
    if (!canPlace(badge, target)) {
      setRefused(true);
      return;
    }
    onPlace(badge.localId, target);
  }

  const dragged = drag?.moved ? badges.find((badge) => badge.localId === drag.localId) : undefined;
  const allowed = dragged && drag?.target ? canPlace(dragged, drag.target) : true;
  const corners = badgesByCorner(badges);
  const used = new Set<string>(corners.keys());
  const beside = badges.filter((badge) => !isOnPhoto(badge) && badge.label.trim());
  const photoStyle = photoChipStyle(PREVIEW_RADIUS);
  const besideStyle = chipStyle(DARK_INK, PREVIEW_RADIUS);

  const pill = (badge: BadgeFormValue, onPhoto: boolean) => (
    <BadgePill
      key={badge.localId}
      element="div"
      badge={{ ...badge, label: badge.label.trim() }}
      ink={DARK_INK}
      style={onPhoto ? photoStyle : besideStyle}
      className={cn(
        "cursor-grab touch-none select-none active:cursor-grabbing",
        onPhoto && "shadow-sm",
        drag?.moved && drag.localId === badge.localId && "opacity-30",
      )}
      data-badge-preview-pill={badge.label.trim()}
      onPointerDown={(event) => onPointerDown(event, badge)}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerUp(event, badge)}
      onPointerCancel={() => setDrag(null)}
    />
  );

  return (
    <div className="space-y-2">
      <div
        aria-hidden="true"
        className="rounded-md border border-border bg-background p-3"
        data-badge-preview=""
      >
        <p className={panelEyebrowClass}>{t("preview.label")}</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div
            ref={photoZone}
            className="relative aspect-square overflow-hidden rounded-sm bg-muted"
            data-badge-zone="photo"
          >
            {imageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- a signed URL or a local preview */
              <img src={imageUrl} alt="" className="size-full object-cover" draggable={false} />
            )}
            {/* While dragging: the four quarters, the one under the pointer lit. */}
            {drag?.moved && (
              <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
                {PHOTO_PLACEMENTS.map((corner) => (
                  <div
                    key={corner}
                    className={cn(
                      "border border-dashed border-foreground/20",
                      drag.target === corner && (allowed ? "bg-foreground/10" : "bg-destructive/10"),
                    )}
                    data-badge-drop={corner}
                    data-badge-drop-active={drag.target === corner ? (allowed ? "yes" : "refused") : undefined}
                  />
                ))}
              </div>
            )}
            {PHOTO_PLACEMENTS.filter((corner) => corners.has(corner)).map((corner) => (
              <div
                key={corner}
                className={cn(
                  "absolute flex flex-col gap-1",
                  PHOTO_CORNER_CLASS[corner],
                  photoCornerWidth(corner, used),
                )}
                data-badge-preview-corner={corner}
              >
                {corners.get(corner)!.filter((badge) => badge.label.trim()).map((badge) => pill(badge, true))}
              </div>
            ))}
          </div>
          <div
            ref={besideZone}
            className={cn(
              "flex flex-col gap-2 rounded-sm border border-dashed p-2",
              drag?.moved && drag.target === "beside" ? "border-foreground bg-foreground/5" : "border-transparent",
            )}
            data-badge-zone="beside"
          >
            <p className="truncate font-sans text-sm font-semibold text-foreground">
              {title.trim() || t("preview.titlePlaceholder")}
            </p>
            <div className="flex flex-wrap gap-1.5" data-badge-preview-beside="">
              {beside.map((badge) => pill(badge, false))}
            </div>
            <div className="mt-auto h-2 w-16 rounded-full bg-muted" />
          </div>
        </div>
      </div>
      {/* Pointer-only copy above, so its one message is said here. */}
      <p className={cn(infoTextClass, refused && "text-destructive")} aria-live="polite" data-badge-preview-hint="">
        {refused ? t("photoFull", { max: BADGES_ON_PHOTO_MAX }) : t("preview.hint")}
      </p>
      {/* The badge being dragged, following the pointer. */}
      {dragged && drag && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50"
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
          data-badge-ghost=""
        >
          <BadgePill
            element="div"
            badge={{ ...dragged, label: dragged.label.trim() }}
            ink={DARK_INK}
            style={isOnPhoto({ placement: drag.target ?? dragged.placement }) ? photoStyle : besideStyle}
            className="shadow-md"
          />
        </div>
      )}
    </div>
  );
}
