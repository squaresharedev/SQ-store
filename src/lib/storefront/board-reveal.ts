import {
  GRID_CELL_SELECTOR,
  REVEAL_ATTRIBUTE,
  REVEAL_STEP_PROPERTY,
  mayHideForReveal,
  revealSteps,
  type MovingPreset,
  type RevealState,
} from "./motion";

/**
 * THE BOARD'S SCROLL REVEAL, the DOM side of lib/storefront/motion.
 *
 * Watches every block cell under `scope` and writes REVEAL_ATTRIBUTE on it;
 * the CSS in globals.css does all the moving. Writes nothing React renders, so
 * a re-render never fights it, and a cell React creates afresh simply has no
 * attribute: shown, which is the safe direction.
 *
 * A cell is hidden ONLY on the observer's first report for it, and only when
 * that report says it is off screen: the observer has then proved it runs, and
 * it will report the cell again when it scrolls in. A cell already on screen
 * is never touched, so its first-paint arrival plays out undisturbed and
 * nothing that was visible ever blinks.
 *
 * Returns the cleanup, which shows every cell again.
 */
export function startBoardReveal(
  scope: HTMLElement,
  preset: MovingPreset,
  win: Window & typeof globalThis = window,
): () => void {
  const cells = Array.from(scope.querySelectorAll<HTMLElement>(GRID_CELL_SELECTOR));
  const mark = (cell: HTMLElement, state: RevealState) => cell.setAttribute(REVEAL_ATTRIBUTE, state);
  const showAll = () => {
    for (const cell of cells) {
      cell.removeAttribute(REVEAL_ATTRIBUTE);
      cell.style.removeProperty(REVEAL_STEP_PROPERTY);
    }
  };
  if (cells.length === 0) return () => {};

  const automated = win.navigator.webdriver === true;
  if (automated) {
    // A preview being photographed in full: every block as it rests, at once.
    for (const cell of cells) mark(cell, "still");
    return showAll;
  }
  const env = {
    observer: typeof win.IntersectionObserver === "function",
    reducedMotion: win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    automated,
  };
  if (!mayHideForReveal(env)) return () => {};

  const reported = new WeakSet<Element>();
  const observer = new win.IntersectionObserver((entries) => {
    const arriving: HTMLElement[] = [];
    for (const entry of entries) {
      const cell = entry.target as HTMLElement;
      if (!reported.has(cell)) {
        reported.add(cell);
        // On screen already: its first-paint arrival is playing. Done.
        if (entry.isIntersecting) observer.unobserve(cell);
        else mark(cell, "wait");
        continue;
      }
      if (entry.isIntersecting) {
        arriving.push(cell);
        observer.unobserve(cell);
      }
    }
    const steps = revealSteps(
      arriving.map((cell) => cell.getBoundingClientRect()),
      preset,
    );
    arriving.forEach((cell, index) => {
      cell.style.setProperty(REVEAL_STEP_PROPERTY, String(steps[index]));
      mark(cell, "in");
    });
  });
  for (const cell of cells) observer.observe(cell);

  return () => {
    observer.disconnect();
    showAll();
  };
}
