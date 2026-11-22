import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * jsdom has no IntersectionObserver, and a component that uses one to know
 * what is on screen (the product form's section index) throws on mount rather
 * than degrading. Stubbing it here rather than in each test keeps the failure
 * from being rediscovered every time a scroll-spy lands somewhere new.
 *
 * Deliberately inert: it records nothing and never fires. A test that needs to
 * assert scroll-spy behaviour should drive it explicitly rather than rely on a
 * shared fake pretending to observe.
 */
if (!("IntersectionObserver" in globalThis)) {
  class InertIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver =
    InertIntersectionObserver as unknown as typeof IntersectionObserver;
}

/**
 * Same story, same reason it lives here. jsdom has no layout, so it implements
 * no `scrollIntoView`, and calling it throws rather than doing nothing. The
 * product form now calls it on every blocked save (it scrolls to the first
 * invalid control), so ANY test that renders the form and submits it hits this
 * whether or not scrolling is what the test is about.
 *
 * A file that asserts on the call still assigns its own `vi.fn()`, which
 * simply replaces this. Inert here, spyable there.
 *
 * Guarded on `Element` existing at all, not just on the method: this setup
 * file also runs for the specs that opt into the node environment, where
 * there is no DOM and a bare `Element.prototype` throws before any test is
 * collected. Same shape as the IntersectionObserver guard above.
 */
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

/**
 * EDITOR UPGRADE, TYPE AND COLOR. next/font/local only works inside the Next
 * compiler, which turns each call into a stylesheet at build time; called for
 * real it throws. The storefront's font pairing faces are declared with it
 * (src/app/fonts/pairing-faces.ts), and every board imports them, so under
 * test each call answers with the shape the compiler hands back: a `variable`
 * class named the way next/font names it (`__variable…`), after the CSS
 * variable it declares, so a test can tell which faces a board put on its root.
 */
vi.mock("next/font/local", () => ({
  default: (options: { variable?: string }) => ({
    className: "",
    style: { fontFamily: "" },
    variable: options.variable ? `__variable${options.variable}` : "",
  }),
}));
