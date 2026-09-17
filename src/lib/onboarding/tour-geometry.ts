/**
 * The guided tour's geometry, kept pure so every rule is testable in node: what
 * counts as a control on screen, the padded box around it, where the card goes,
 * and how far to scroll.
 *
 * All inputs are plain rects in viewport pixels (getBoundingClientRect's frame);
 * the overlay (components/onboarding/TourOverlay.tsx) measures and applies them.
 */

export type Box = { left: number; top: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export type CardSide = "bottom" | "top" | "right" | "left";
export type CardPlacement = { left: number; top: number; side: CardSide | "corner" };

/** How much of a control must be on screen, horizontally, to be pointed at. */
export const MIN_SHOWN_PX = 16;

/**
 * Whether a laid-out box is on screen horizontally.
 *
 * Horizontal only, on purpose. A control below the fold is still the right
 * target (the tour scrolls to it), but one translated off the side of the
 * screen is not: the phone's sidebar is the SAME <nav> as the desktop rail,
 * slid -100% out of view, with a perfectly real rect at x -256..0. An
 * "intersects the viewport" test would reject the first and could not tell the
 * second from a control that is merely scrolled away.
 */
export function isHorizontallyShown(
  rect: { left: number; right: number; width: number; height: number },
  viewportWidth: number,
): boolean {
  if (rect.width < 1 || rect.height < 1) return false;
  const shown = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
  return shown >= Math.min(MIN_SHOWN_PX, rect.width / 2);
}

/** Grow a box by `pad` on every side, clipped to the viewport, in whole pixels. */
export function padBox(box: Box, pad: number, viewport: Viewport): Box {
  const left = Math.max(0, Math.floor(box.left - pad));
  const top = Math.max(0, Math.floor(box.top - pad));
  const right = Math.min(viewport.width, Math.ceil(box.left + box.width + pad));
  const bottom = Math.min(viewport.height, Math.ceil(box.top + box.height + pad));
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * Where the desktop card goes beside a target: the preferred side if the card
 * fits there, then the others, then the bottom-right corner as a last resort.
 * Always clamped inside the viewport by `edge`.
 */
export function placeCard(
  target: Box,
  card: { width: number; height: number },
  viewport: Viewport,
  options: { side?: CardSide; gap?: number; edge?: number } = {},
): CardPlacement {
  const gap = options.gap ?? 12;
  const edge = options.edge ?? 16;
  // "left" is only ever tried when asked for: a control docked to the right edge
  // (the designer's settings column) has room nowhere else, and everywhere else
  // the card reads better below, above or after its control.
  const order: CardSide[] =
    options.side === "right"
      ? ["right", "bottom", "top"]
      : options.side === "top"
        ? ["top", "bottom", "right"]
        : options.side === "left"
          ? ["left", "bottom", "top", "right"]
          : ["bottom", "top", "right"];

  const maxLeft = Math.max(edge, viewport.width - card.width - edge);
  const maxTop = Math.max(edge, viewport.height - card.height - edge);
  const clampLeft = (left: number) => Math.round(Math.max(edge, Math.min(left, maxLeft)));
  const clampTop = (top: number) => Math.round(Math.max(edge, Math.min(top, maxTop)));
  const centredLeft = target.left + target.width / 2 - card.width / 2;
  const centredTop = target.top + target.height / 2 - card.height / 2;

  for (const side of order) {
    if (side === "bottom") {
      const top = target.top + target.height + gap;
      if (top + card.height <= viewport.height - edge) {
        return { side, top: Math.round(top), left: clampLeft(centredLeft) };
      }
    } else if (side === "top") {
      const top = target.top - gap - card.height;
      if (top >= edge) return { side, top: Math.round(top), left: clampLeft(centredLeft) };
    } else if (side === "left") {
      const left = target.left - gap - card.width;
      if (left >= edge) return { side, left: Math.round(left), top: clampTop(centredTop) };
    } else {
      const left = target.left + target.width + gap;
      if (left + card.width <= viewport.width - edge) {
        return { side, left: Math.round(left), top: clampTop(centredTop) };
      }
    }
  }
  return { side: "corner", left: maxLeft, top: maxTop };
}

/**
 * How far to scroll the window so a target sits in the band that is actually
 * visible: below the sticky top bar, above whatever covers the bottom (the
 * phone's card). Zero when it already fits. Centred in the band when it can be;
 * a target taller than the band is aligned to the band's top instead.
 */
export function scrollDeltaFor(
  target: Box,
  viewport: Viewport,
  band: { top: number; bottom: number },
): number {
  const bandTop = band.top;
  const bandBottom = viewport.height - band.bottom;
  const bandHeight = bandBottom - bandTop;
  if (bandHeight <= 0) return 0;
  const fits = target.top >= bandTop && target.top + target.height <= bandBottom;
  if (fits) return 0;
  if (target.height <= bandHeight) {
    return Math.round(target.top - (bandTop + (bandHeight - target.height) / 2));
  }
  return Math.round(target.top - bandTop);
}

/**
 * Which edge the phone's card sits on. The bottom, unless the target is down
 * there and could not be scrolled clear of it (the end of a page) while the top
 * has room: then the card moves up rather than covering the one thing it is
 * talking about.
 */
export function phoneCardEdge(
  target: Box,
  cardHeight: number,
  viewport: Viewport,
  headerHeight: number,
): "bottom" | "top" {
  const coveredAtBottom = target.top + target.height > viewport.height - cardHeight;
  const clearAtTop = target.top >= headerHeight + cardHeight;
  return coveredAtBottom && clearAtTop ? "top" : "bottom";
}
