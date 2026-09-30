import type { Page } from "@playwright/test";

/**
 * "IS THE PAGE'S ONE ACTION EVER HIDDEN?", asked the only way that answers it:
 * scroll the page from top to bottom in small steps, and at every step probe
 * points across each Pay / Buy button that is on screen with
 * `elementFromPoint`. Whatever the browser says is on top at those points has
 * to BE the button. A bar pinned to the bottom of the screen, a footer, an
 * overlay, anything painted over the button, is reported with where it
 * happened.
 *
 * A button counts as on screen by the part of it inside the viewport AND
 * inside the window the page scrolls in (`scroller`, for a page drawn inside a
 * scrolling frame, as the editor shows one on a phone). A button that is not
 * being shown (inside an `inert` subtree, or faded out) is not an action, and
 * is skipped: that is how a sticky bar steps aside.
 *
 * The same probe also holds the other half of the promise: a button that IS
 * shown is never cut off by the edge of the screen it is pinned to.
 */

/** The buttons that ARE the page's action: checkout's Pay and the product
 *  page's Buy, wherever they are drawn (in the page or in a pinned bar). */
export const PAGE_ACTIONS = "[data-checkout-pay], a[data-product-cta], button[data-product-cta]";

export type Coverage = { scrollTop: number; problems: string[] };

export async function probeActions(page: Page, scroller: string | null = null): Promise<string[]> {
  return page.evaluate(
    ({ selector, scrollerSelector }) => {
      const problems: string[] = [];
      const frame = scrollerSelector ? document.querySelector(scrollerSelector) : null;
      const bounds = frame
        ? frame.getBoundingClientRect()
        : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const clip = {
        left: Math.max(0, bounds.left),
        top: Math.max(0, bounds.top),
        right: Math.min(window.innerWidth, bounds.right),
        bottom: Math.min(window.innerHeight, bounds.bottom),
      };
      const describe = (el: Element | null) =>
        el
          ? `${el.tagName.toLowerCase()}${[...el.attributes]
              .filter((a) => a.name.startsWith("data-") || a.name === "class")
              .map((a) => `[${a.name}${a.name === "class" ? "" : `=${a.value}`}]`)
              .join("")
              .slice(0, 120)}`
          : "nothing";
      const shown = (el: Element) => {
        if (el.closest("[inert]")) return false;
        for (let node: Element | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 0.05) return false;
        }
        return true;
      };
      for (const action of document.querySelectorAll(selector)) {
        if (!shown(action)) continue;
        const rect = action.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const pinned = Boolean(action.closest("[data-sticky-bar]"));
        // A pinned bar's button is never allowed to be cut by the edge it sits on.
        if (pinned && (rect.bottom > clip.bottom + 0.5 || rect.top < clip.top - 0.5)) {
          problems.push(`pinned ${describe(action)} cut off: ${Math.round(rect.top)}..${Math.round(rect.bottom)} outside ${Math.round(clip.top)}..${Math.round(clip.bottom)}`);
        }
        // In from the button's own sides by its corner radius: hit testing
        // follows rounded corners, so a point in a corner's cut-away is not
        // on the button, and would read as something covering it.
        const radius = parseFloat(getComputedStyle(action).borderTopLeftRadius) || 0;
        const left = Math.max(rect.left + radius, clip.left) + 2;
        const right = Math.min(rect.right - radius, clip.right) - 2;
        const top = Math.max(rect.top, clip.top) + 2;
        const bottom = Math.min(rect.bottom, clip.bottom) - 2;
        if (right <= left || bottom <= top) continue;
        for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
          for (const fy of [0, 0.5, 1]) {
            const x = left + (right - left) * fx;
            const y = top + (bottom - top) * fy;
            const hit = document.elementFromPoint(x, y);
            if (hit && (hit === action || action.contains(hit))) continue;
            problems.push(
              `${pinned ? "pinned" : "in-page"} ${describe(action)} covered at (${Math.round(x)},${Math.round(y)}) by ${describe(hit)}`,
            );
          }
        }
      }
      return [...new Set(problems)];
    },
    { selector: PAGE_ACTIONS, scrollerSelector: scroller },
  );
}

/**
 * Scroll the page (or `scroller`) from the top to the very bottom in `step`
 * pixel increments, letting anything that animates on scroll settle, and probe
 * at every stop. Returns only the stops where something was wrong.
 */
export async function scrollAndProbe(
  page: Page,
  options: { scroller?: string | null; step?: number; settleMs?: number } = {},
): Promise<Coverage[]> {
  const { scroller = null, step = 90, settleMs = 320 } = options;
  const max = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : document.scrollingElement;
    return el ? el.scrollHeight - el.clientHeight : 0;
  }, scroller);
  const found: Coverage[] = [];
  const stops = [...Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step), max];
  for (const scrollTop of [...new Set(stops)]) {
    await page.evaluate(
      ({ selector, top }) => {
        const el = selector ? document.querySelector(selector) : document.scrollingElement;
        el?.scrollTo({ top, behavior: "instant" });
      },
      { selector: scroller, top: scrollTop },
    );
    await page.waitForTimeout(settleMs);
    const problems = await probeActions(page, scroller);
    if (problems.length > 0) found.push({ scrollTop, problems });
  }
  return found;
}
