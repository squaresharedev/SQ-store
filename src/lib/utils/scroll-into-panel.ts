/**
 * PUTTING A SUMMONED CONTROL IN THE MIDDLE OF ITS PANEL.
 *
 * The editor points at its own controls from outside them: the selection
 * toolbar asks the inspector for "opacity", the search field asks the design
 * panel for a section. Both used to land on `scrollIntoView({ block: "nearest" })`,
 * which does the least it can get away with — a field one pixel below the fold
 * scrolls one pixel, arriving hard against the bottom edge of the panel with
 * nothing of its own group visible around it. On a phone, where the panel is a
 * short bottom sheet, that is most of what a summons ever did.
 *
 * Centring instead gives the control the room either side of it that says which
 * group it belongs to, and puts it where the eye is already looking after a
 * press.
 *
 * WHY NOT `scrollIntoView({ block: "center" })`: it centres the element in
 * EVERY scrollable ancestor, the document included. The panels here are nested
 * inside a page that must not move (the designer pins the canvas to the
 * viewport), and on a phone the sheet's own scroller sits inside a body that
 * would happily scroll the whole editor to satisfy the request. Scrolling ONE
 * container by hand is the only version of this that stays local.
 */

/** How far from the container's own edge a control has to be before centring
 *  it is worth a scroll at all. Below this it is already where it should be,
 *  and moving would read as the panel twitching. */
const DEAD_ZONE_PX = 2;

/** The nearest ancestor that actually scrolls vertically, or null when the
 *  element sits in a panel short enough to show everything at once. */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  if (typeof getComputedStyle !== "function") return null;
  let node = element.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Scroll `element`'s own panel so the element sits in the middle of it.
 *
 * A no-op when there is nothing to scroll — a panel that shows every field at
 * once has already answered the request, and that is exactly when the summons
 * flash is the only thing left to say "this one" (see SummonedField).
 */
export function scrollIntoPanelCenter(element: HTMLElement | null): void {
  if (!element) return;
  const container = scrollParentOf(element);
  if (!container) return;

  const box = element.getBoundingClientRect();
  const view = container.getBoundingClientRect();
  // Positive means the element sits below the container's midline.
  const delta = box.top + box.height / 2 - (view.top + view.height / 2);
  if (Math.abs(delta) < DEAD_ZONE_PX) return;

  const top = container.scrollTop + delta;
  // jsdom gives elements no scrollTo at all, and a browser asked to animate
  // while the user prefers reduced motion should simply arrive.
  const smooth =
    typeof matchMedia === "function" &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  } else {
    container.scrollTop = top;
  }
}
