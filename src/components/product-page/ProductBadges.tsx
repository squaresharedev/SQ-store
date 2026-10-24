import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { isOnPhoto } from "@/lib/validation/product";
import {
  BADGE_PLACEMENTS,
  type BadgePhotoPlacement,
  type ProductBadge,
} from "@/types/product";
import { BADGE_ICON_COMPONENTS, badgeIconColor } from "./badge-icons";
import { DARK_INK, chipStyle, photoChipStyle } from "./product-page-maps";

/** One badge's shape, shared by the buyer's page and the seller's preview of
 *  it, so the form shows exactly what the page will draw. */
export const BADGE_PILL_CLASS =
  "inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 text-xs font-medium leading-tight";

/** The corners of the photo, in the order they are laid out. */
export const PHOTO_PLACEMENTS = BADGE_PLACEMENTS.filter(
  (placement): placement is BadgePhotoPlacement => placement !== "beside",
);

/** Where each corner's stack sits, and which way its badges line up. */
export const PHOTO_CORNER_CLASS: Record<BadgePhotoPlacement, string> = {
  "photo-top-left": "left-3 top-3 items-start",
  "photo-top-right": "right-3 top-3 items-end",
  "photo-bottom-left": "bottom-3 left-3 items-start",
  "photo-bottom-right": "bottom-3 right-3 items-end",
};

/** How far a press on a badge must travel before it is a drag rather than a
 *  click, wherever a badge can be dragged (the product form, the editor). */
export const BADGE_DRAG_THRESHOLD_PX = 4;

/** The corner of a photo a point is over, by which quarter of it the point is
 *  in, or null when the point is off the photo. */
export function photoCornerAt(photo: DOMRect, x: number, y: number): BadgePhotoPlacement | null {
  if (x < photo.left || x > photo.right || y < photo.top || y > photo.bottom) return null;
  const top = y < photo.top + photo.height / 2;
  const left = x < photo.left + photo.width / 2;
  return `photo-${top ? "top" : "bottom"}-${left ? "left" : "right"}`;
}

/** The corner across the same edge, which shares that edge's width. */
const FACING_CORNER: Record<BadgePhotoPlacement, BadgePhotoPlacement> = {
  "photo-top-left": "photo-top-right",
  "photo-top-right": "photo-top-left",
  "photo-bottom-left": "photo-bottom-right",
  "photo-bottom-right": "photo-bottom-left",
};

/**
 * How wide one corner's stack may grow: most of the photo when it has the
 * edge to itself, half of it when the facing corner has badges too, so the
 * two never meet in the middle.
 */
export function photoCornerWidth(placement: BadgePhotoPlacement, used: ReadonlySet<string>): string {
  return used.has(FACING_CORNER[placement]) ? "max-w-[calc(50%-1rem)]" : "max-w-[calc(100%-1.5rem)]";
}

/** The badges on the photo, grouped by corner, in the seller's order. */
export function badgesByCorner<T extends Pick<ProductBadge, "placement">>(
  badges: readonly T[],
): Map<BadgePhotoPlacement, T[]> {
  const corners = new Map<BadgePhotoPlacement, T[]>();
  for (const badge of badges) {
    if (!isOnPhoto(badge)) continue;
    const corner = badge.placement as BadgePhotoPlacement;
    corners.set(corner, [...(corners.get(corner) ?? []), badge]);
  }
  return corners;
}

/** One badge: its icon in its colour, then the seller's words. */
export function BadgePill({
  badge,
  ink,
  style,
  className,
  element: Element = "li",
  ...rest
}: {
  badge: ProductBadge;
  /** The text colour of the surface it is drawn on, which decides the shade
   *  of a coloured icon. */
  ink: string;
  style: CSSProperties;
  /** An li inside a real list; a div where the list is a role on a wrapper
   *  (the photo's corners), since an li there is not in a ul. */
  element?: "li" | "div";
} & Omit<HTMLAttributes<HTMLElement>, "style">) {
  const Icon = BADGE_ICON_COMPONENTS[badge.icon];
  return (
    <Element
      className={cn(BADGE_PILL_CLASS, className)}
      style={style}
      data-product-badge={badge.icon}
      data-badge-color={badge.color ?? "ink"}
      // What the editor's drag finds a badge by: its words, unique per product.
      data-badge-label={badge.label}
      {...rest}
    >
      <Icon
        className="size-3.5 shrink-0"
        strokeWidth={2}
        style={{ color: badgeIconColor(badge.color, ink) }}
        aria-hidden="true"
      />
      <span className="min-w-0 break-words">{badge.label}</span>
    </Element>
  );
}

/**
 * The seller's badges that sit beside the product: short pills under the
 * title, in the page's own ink and corners, so they belong to the shop rather
 * than to the platform. Every word is a React text node; there is no markup
 * path.
 *
 * Server-compatible and hook-free: the page and the editor's artboard both
 * render it, and the list's accessible name comes in from the caller.
 */
export function ProductBadges({
  badges,
  label,
  ink,
  cornerRadius,
}: {
  badges: readonly ProductBadge[];
  /** What a screen reader announces the list as ("Highlights"). */
  label: string;
  ink: string;
  cornerRadius: number;
}) {
  const beside = badges.filter((badge) => !isOnPhoto(badge));
  if (beside.length === 0) return null;
  const style = chipStyle(ink, cornerRadius);
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label} data-product-badges={beside.length}>
      {beside.map((badge) => (
        <BadgePill key={badge.label} badge={badge} ink={ink} style={style} />
      ))}
    </ul>
  );
}

/**
 * The badges the seller put ON the photo, laid over the gallery's main frame
 * in its corners. A light pill whatever the page's colours, because a photo is
 * any colour at all. Never catches a click: the photo under it stays the
 * photo.
 *
 * One list for the whole photo, so a screen reader hears them together; the
 * corners are layout only.
 */
export function PhotoBadges({
  badges,
  label,
  cornerRadius,
}: {
  badges: readonly ProductBadge[];
  label: string;
  cornerRadius: number;
}) {
  const corners = badgesByCorner(badges);
  if (corners.size === 0) return null;
  const used = new Set<string>(corners.keys());
  const style = photoChipStyle(cornerRadius);
  return (
    <div
      role="list"
      aria-label={label}
      className="pointer-events-none absolute inset-0"
      data-product-photo-badges={[...corners.values()].flat().length}
    >
      {PHOTO_PLACEMENTS.filter((corner) => corners.has(corner)).map((corner) => (
        <div
          key={corner}
          role="none"
          className={cn("absolute flex flex-col gap-1.5", PHOTO_CORNER_CLASS[corner], photoCornerWidth(corner, used))}
          data-badge-corner={corner}
        >
          {corners.get(corner)!.map((badge) => (
            <BadgePill
              key={badge.label}
              element="div"
              role="listitem"
              badge={badge}
              ink={DARK_INK}
              style={style}
              className="shadow-sm"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
