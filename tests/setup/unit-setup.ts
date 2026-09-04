import "@testing-library/jest-dom/vitest";

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
