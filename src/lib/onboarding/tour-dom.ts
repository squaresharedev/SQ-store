import { isHorizontallyShown } from "./tour-geometry";
import type { TourStep, TourTarget } from "./tour-steps";

/**
 * Finding a tour step's control in the live page.
 *
 * Deliberately NOT SearchProvider's visibility test (`offsetParent !== null`):
 * offsetParent is always null for a `position: fixed` element, which would rule
 * out the sidebar rail, the one control the first step points at.
 */

/** Rendered, not hidden by CSS, and on screen horizontally (see
 *  isHorizontallyShown for why vertical position does not count). */
export function isShown(element: Element): boolean {
  if (
    typeof element.checkVisibility === "function" &&
    !element.checkVisibility({ visibilityProperty: true })
  ) {
    return false;
  }
  return isHorizontallyShown(element.getBoundingClientRect(), window.innerWidth);
}

export type ResolvedTarget = {
  element: Element;
  target: TourTarget;
  /** Which of the step's candidates matched. */
  index: number;
};

/**
 * Which coordinate space a control's spotlight belongs in.
 *
 * "document": the control scrolls with the page, so its spotlight is placed in
 * page coordinates and the BROWSER scrolls the two together. Anything placed in
 * viewport coordinates and moved from script trails a scrolled page by a frame,
 * because the page scrolls off the main thread; a fast scroll shows that as the
 * hole jittering against the control.
 *
 * "viewport": the control stays put while the page scrolls (inside a fixed
 * container, like the sidebar, or a sticky one that is currently stuck, like the
 * top bars), so its spotlight stays put too.
 */
export type TourAnchor = "document" | "viewport";

type AnchorInfo = { fixed: boolean; sticky: Element[] };
let anchorCache = new WeakMap<Element, AnchorInfo>();

/** Forget cached ancestry, when a breakpoint may have changed positioning. */
export function resetAnchorCache(): void {
  anchorCache = new WeakMap();
}

export function anchorOf(element: Element): TourAnchor {
  let info = anchorCache.get(element);
  if (!info) {
    info = { fixed: false, sticky: [] };
    for (
      let node: Element | null = element;
      node && node !== document.body && node !== document.documentElement;
      node = node.parentElement
    ) {
      const position = getComputedStyle(node).position;
      if (position === "fixed") {
        info.fixed = true;
        break;
      }
      if (position === "sticky") info.sticky.push(node);
    }
    anchorCache.set(element, info);
  }
  if (info.fixed) return "viewport";
  // A sticky container only holds still once it has stuck at its offset.
  for (const node of info.sticky) {
    const offset = Number.parseFloat(getComputedStyle(node).top);
    if (!Number.isNaN(offset) && Math.abs(node.getBoundingClientRect().top - offset) < 1) {
      return "viewport";
    }
  }
  return "document";
}

/** The first candidate, in order, with a match on screen; its first such match. */
export function resolveTarget(
  step: Pick<TourStep, "targets">,
  root: ParentNode = document,
): ResolvedTarget | null {
  for (const [index, target] of step.targets.entries()) {
    let matches: NodeListOf<Element>;
    try {
      matches = root.querySelectorAll(target.selector);
    } catch {
      continue;
    }
    for (const element of matches) {
      if (isShown(element)) return { element, target, index };
    }
  }
  return null;
}
