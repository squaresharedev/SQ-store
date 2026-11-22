import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontTheme } from "@/types/storefront";
import {
  REVEAL_ATTRIBUTE,
  REVEAL_STAGGER_STEPS,
  REVEAL_STEP_PROPERTY,
  boardMotion,
  mayHideForReveal,
  revealSteps,
  withMotion,
} from "@/lib/storefront/motion";
import { startBoardReveal } from "@/lib/storefront/board-reveal";

const THEME: StorefrontTheme = DEFAULT_STOREFRONT_CONFIG.theme;

describe("boardMotion", () => {
  it("stands still when absent or none, so an old storefront renders as it did", () => {
    expect(boardMotion(THEME)).toBeNull();
    expect(boardMotion({ motion: "none" })).toBeNull();
  });
  it("plays the two moving presets", () => {
    expect(boardMotion({ motion: "subtle" })).toBe("subtle");
    expect(boardMotion({ motion: "lively" })).toBe("lively");
  });
});

describe("withMotion", () => {
  it("drops the key when turned off, so an untouched theme stays byte-identical", () => {
    const moving = withMotion(THEME, "lively");
    expect(moving.motion).toBe("lively");
    const still = withMotion(moving, "none");
    expect("motion" in still).toBe(false);
    expect(JSON.stringify(still)).toBe(JSON.stringify(THEME));
  });
  it("returns the same theme when nothing changes, so the editor stays clean", () => {
    expect(withMotion(THEME, "none")).toBe(THEME);
    const moving = withMotion(THEME, "subtle");
    expect(withMotion(moving, "subtle")).toBe(moving);
  });
});

describe("mayHideForReveal", () => {
  const ok = { observer: true, reducedMotion: false, automated: false };
  it("hides only when an observer can bring the block back", () => {
    expect(mayHideForReveal(ok)).toBe(true);
    expect(mayHideForReveal({ ...ok, observer: false })).toBe(false);
  });
  it("never hides under reduced motion or in an automated browser", () => {
    expect(mayHideForReveal({ ...ok, reducedMotion: true })).toBe(false);
    expect(mayHideForReveal({ ...ok, automated: true })).toBe(false);
  });
});

describe("revealSteps", () => {
  const boxes = [
    { top: 300, left: 0 },
    { top: 0, left: 400 },
    { top: 0, left: 0 },
  ];
  it("staggers lively in reading order, whatever order the observer listed them", () => {
    expect(revealSteps(boxes, "lively")).toEqual([2, 1, 0]);
  });
  it("fades a subtle batch in at once", () => {
    expect(revealSteps(boxes, "subtle")).toEqual([0, 0, 0]);
  });
  it("caps the stagger so a long row never keeps its last block waiting", () => {
    const row = Array.from({ length: 10 }, (_, index) => ({ top: 0, left: index * 100 }));
    const steps = revealSteps(row, "lively");
    expect(Math.max(...steps)).toBe(REVEAL_STAGGER_STEPS - 1);
    expect(steps.slice(0, REVEAL_STAGGER_STEPS)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

// ── The DOM side ─────────────────────────────────────────────────────────

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

/** An observer the test drives by hand. */
function fakeObserver() {
  const state: { callback: Callback | null; observed: Element[]; unobserved: Element[]; disconnected: boolean } = {
    callback: null,
    observed: [],
    unobserved: [],
    disconnected: false,
  };
  class Fake {
    constructor(callback: Callback) {
      state.callback = callback;
    }
    observe(target: Element) {
      state.observed.push(target);
    }
    unobserve(target: Element) {
      state.unobserved.push(target);
    }
    disconnect() {
      state.disconnected = true;
    }
  }
  const report = (entries: [Element, boolean][]) =>
    state.callback?.(entries.map(([target, isIntersecting]) => ({ target, isIntersecting })));
  return { Fake, state, report };
}

function board(count: number): { scope: HTMLElement; cells: HTMLElement[] } {
  const scope = document.createElement("main");
  const list = document.createElement("ul");
  scope.append(list);
  const cells = Array.from({ length: count }, (_, index) => {
    const cell = document.createElement("li");
    cell.setAttribute("data-grid-cell", "");
    cell.getBoundingClientRect = () => ({ top: 0, left: index * 10 }) as DOMRect;
    list.append(cell);
    return cell;
  });
  return { scope, cells };
}

function fakeWindow(overrides: { observer?: unknown; reduced?: boolean; webdriver?: boolean }): Window & typeof globalThis {
  return {
    navigator: { webdriver: overrides.webdriver ?? false },
    IntersectionObserver: overrides.observer,
    matchMedia: () => ({ matches: overrides.reduced ?? false }),
  } as unknown as Window & typeof globalThis;
}

const reveal = (cell: Element) => cell.getAttribute(REVEAL_ATTRIBUTE);

afterEach(() => vi.restoreAllMocks());

describe("startBoardReveal", () => {
  it("never touches a block the first report finds on screen, and hides only the ones it finds off it", () => {
    const { Fake, state, report } = fakeObserver();
    const { scope, cells } = board(3);
    startBoardReveal(scope, "subtle", fakeWindow({ observer: Fake }));
    expect(state.observed).toEqual(cells);
    // Nothing hidden before the observer has said a word.
    expect(cells.map(reveal)).toEqual([null, null, null]);

    report([[cells[0], true], [cells[1], false], [cells[2], false]]);
    expect(cells.map(reveal)).toEqual([null, "wait", "wait"]);
    expect(state.unobserved).toEqual([cells[0]]);
  });

  it("plays a hidden block in when it scrolls into view, staggered when lively", () => {
    const { Fake, report } = fakeObserver();
    const { scope, cells } = board(3);
    startBoardReveal(scope, "lively", fakeWindow({ observer: Fake }));
    report([[cells[0], false], [cells[1], false], [cells[2], false]]);
    report([[cells[2], true], [cells[1], true]]);
    expect(cells.map(reveal)).toEqual(["wait", "in", "in"]);
    // By position, left to right: cell 1 sits left of cell 2.
    expect(cells[1].style.getPropertyValue(REVEAL_STEP_PROPERTY)).toBe("0");
    expect(cells[2].style.getPropertyValue(REVEAL_STEP_PROPERTY)).toBe("1");
  });

  it("shows everything again on cleanup", () => {
    const { Fake, state, report } = fakeObserver();
    const { scope, cells } = board(2);
    const stop = startBoardReveal(scope, "lively", fakeWindow({ observer: Fake }));
    report([[cells[0], false], [cells[1], false]]);
    report([[cells[1], true]]);
    stop();
    expect(state.disconnected).toBe(true);
    expect(cells.map(reveal)).toEqual([null, null]);
    expect(cells[1].style.getPropertyValue(REVEAL_STEP_PROPERTY)).toBe("");
  });

  it("hides nothing without an observer, under reduced motion, or with no blocks", () => {
    const { Fake } = fakeObserver();
    const { scope, cells } = board(2);
    startBoardReveal(scope, "subtle", fakeWindow({ observer: undefined }));
    startBoardReveal(scope, "subtle", fakeWindow({ observer: Fake, reduced: true }));
    expect(cells.map(reveal)).toEqual([null, null]);
    expect(() => startBoardReveal(document.createElement("div"), "subtle", fakeWindow({ observer: Fake }))).not.toThrow();
  });

  it("shows every block at rest in an automated browser photographing a preview", () => {
    const { Fake, state } = fakeObserver();
    const { scope, cells } = board(2);
    const stop = startBoardReveal(scope, "lively", fakeWindow({ observer: Fake, webdriver: true }));
    expect(state.observed).toEqual([]);
    expect(cells.map(reveal)).toEqual(["still", "still"]);
    stop();
    expect(cells.map(reveal)).toEqual([null, null]);
  });
});
