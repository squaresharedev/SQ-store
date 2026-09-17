/**
 * TourOverlay: the guided tour's layer.
 *
 * Driven with injected steps, pathname and navigate, so each rule is pinned
 * without a router: arriving and spotlighting, moving along a page without
 * navigating, navigating ONCE to another page and picking up on arrival, going
 * back, every way out (Esc, Skip tour, leaving the page, opening search), the
 * fallback when a control is missing, the last step's offer going only to a
 * safe internal path, and focus staying on the card.
 *
 * jsdom has no layout: frames are timers, and target elements are given a rect.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, waitFor, within } from "../setup/render";
import type { TourStep } from "@/lib/onboarding/tour-steps";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/a",
}));

const search = vi.hoisted(() => ({ isOpen: false }));
vi.mock("@/components/search/SearchProvider", () => ({
  useSearch: () => ({
    isOpen: search.isOpen,
    open: () => {},
    close: () => {},
    registerAnchor: () => () => {},
  }),
}));

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

const { TourOverlay } = await import("@/components/onboarding/TourOverlay");
const store = await import("@/lib/onboarding/tour-store");

const STEPS: TourStep[] = [
  {
    id: "overview-nav",
    path: "/a",
    pageLabel: "Page A",
    title: "Step one",
    body: "First body.",
    targets: [{ selector: '[data-fixture="one"]', body: "One is here." }],
    scroll: false,
  },
  {
    id: "search",
    path: "/a",
    pageLabel: "Page A",
    title: "Step two",
    body: "Second body.",
    targets: [{ selector: '[data-fixture="two"]' }],
    fallbackBody: "Two is missing.",
    scroll: false,
  },
  {
    id: "products-add",
    path: "/b",
    pageLabel: "Page B",
    title: "Step three",
    body: "Third body.",
    targets: [{ selector: '[data-fixture="three"]' }],
    scroll: false,
  },
];

const fixtures: HTMLElement[] = [];

/** A control on the page, with the layout jsdom does not compute. */
function addTarget(name: string) {
  const element = document.createElement("button");
  element.dataset.fixture = name;
  element.textContent = name;
  element.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 100,
      width: 80,
      height: 40,
      right: 180,
      bottom: 140,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(element);
  fixtures.push(element);
}

function renderTour(pathname = "/a") {
  const navigate = vi.fn();
  const view = render(
    <TourOverlay role="owner" steps={STEPS} pathname={pathname} navigate={navigate} />,
  );
  const setPath = (next: string) =>
    view.rerender(<TourOverlay role="owner" steps={STEPS} pathname={next} navigate={navigate} />);
  return { navigate, setPath };
}

const layer = () => document.querySelector("[data-tour-step]");

beforeAll(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
});

beforeEach(() => {
  sessionStorage.clear();
  store.__resetTourForTests();
  search.isOpen = false;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  for (const element of fixtures.splice(0)) element.remove();
});

describe("TourOverlay", () => {
  it("renders nothing while no tour is running", () => {
    renderTour();
    expect(layer()).toBeNull();
  });

  it("arrives on the step's page, spotlights its control, and focuses the card", async () => {
    addTarget("one");
    renderTour("/a");
    act(() => store.startTour());

    const dialog = await screen.findByRole("dialog", { name: "Step one" });
    expect(within(dialog).getByText("1 of 3")).toBeInTheDocument();
    expect(within(dialog).getByText("One is here.")).toBeInTheDocument();
    expect(layer()).toHaveAttribute("data-tour-state", "anchored");
    expect(layer()).toHaveAttribute("data-tour-total", "3");
    await waitFor(() => expect(dialog).toHaveFocus());
    // The first step has nowhere to go back to.
    expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("moves along the same page without navigating", async () => {
    const user = userEvent.setup();
    addTarget("one");
    addTarget("two");
    const { navigate } = renderTour("/a");
    act(() => store.startTour());

    await screen.findByRole("dialog", { name: "Step one" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("dialog", { name: "Step two" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates once to the next page, says where it is going, and picks up on arrival", async () => {
    const user = userEvent.setup();
    addTarget("two");
    addTarget("three");
    const { navigate, setPath } = renderTour("/a");
    act(() => {
      store.startTour();
      store.goToStep("search", { arrived: true });
    });

    await screen.findByRole("dialog", { name: "Step two" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/b"));
    expect(screen.getByRole("status")).toHaveTextContent("Opening Page B");
    expect(layer()).toHaveAttribute("data-tour-state", "navigating");

    setPath("/b");
    await screen.findByRole("dialog", { name: "Step three" });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("goes back a step", async () => {
    const user = userEvent.setup();
    addTarget("one");
    addTarget("two");
    renderTour("/a");
    act(() => {
      store.startTour();
      store.goToStep("search", { arrived: true });
    });

    await screen.findByRole("dialog", { name: "Step two" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("dialog", { name: "Step one" });
  });

  it("ends on Esc, and on Skip tour", async () => {
    const user = userEvent.setup();
    addTarget("one");
    renderTour("/a");

    act(() => store.startTour());
    await screen.findByRole("dialog", { name: "Step one" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(layer()).toBeNull());

    act(() => store.startTour());
    await screen.findByRole("dialog", { name: "Step one" });
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(layer()).toBeNull());
    expect(sessionStorage.getItem("sq.dashboard.tour")).toBeNull();
  });

  it("ends when the person goes somewhere the tour did not send them", async () => {
    addTarget("one");
    const { setPath } = renderTour("/a");
    act(() => store.startTour());
    await screen.findByRole("dialog", { name: "Step one" });

    setPath("/elsewhere");
    await waitFor(() => expect(layer()).toBeNull());
  });

  it("gets out of the way when search opens", async () => {
    addTarget("one");
    const { setPath } = renderTour("/a");
    act(() => store.startTour());
    await screen.findByRole("dialog", { name: "Step one" });

    search.isOpen = true;
    setPath("/a");
    await waitFor(() => expect(layer()).toBeNull());
  });

  it("shows the fallback copy, with nothing spotlit, when the control is not there", async () => {
    addTarget("one");
    renderTour("/a");
    act(() => {
      store.startTour();
      store.goToStep("search", { arrived: true });
    });

    const dialog = await screen.findByRole("dialog", { name: "Step two" });
    expect(within(dialog).getByText("Two is missing.")).toBeInTheDocument();
    expect(layer()).toHaveAttribute("data-tour-state", "fallback");
  });

  it("offers the next setup action on the last step, and only as an internal path", async () => {
    const user = userEvent.setup();
    addTarget("three");
    const { navigate } = renderTour("/b");

    act(() => {
      store.startTour({ next: { href: "/products/new", label: "Add your first product" } });
      store.goToStep("products-add", { arrived: true });
    });
    let dialog = await screen.findByRole("dialog", { name: "Step three" });
    // Done already says it; a second way out on the last card is noise.
    expect(within(dialog).queryByRole("button", { name: "Skip tour" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Add your first product" }));
    expect(navigate).toHaveBeenCalledWith("/products/new");
    await waitFor(() => expect(layer()).toBeNull());

    navigate.mockClear();
    act(() => {
      store.startTour({ next: { href: "//evil.example/steal", label: "Go on" } });
      store.goToStep("products-add", { arrived: true });
    });
    dialog = await screen.findByRole("dialog", { name: "Step three" });
    await user.click(within(dialog).getByRole("button", { name: "Go on" }));
    expect(navigate).toHaveBeenCalledWith("/dashboard");
  });

  it("offers just Done on the last step when there is nothing next", async () => {
    const user = userEvent.setup();
    addTarget("three");
    renderTour("/b");
    act(() => {
      store.startTour();
      store.goToStep("products-add", { arrived: true });
    });
    const dialog = await screen.findByRole("dialog", { name: "Step three" });
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(layer()).toBeNull());
  });

  it("ends a stored step this tour does not have", async () => {
    renderTour("/a");
    act(() => {
      store.startTour();
      store.goToStep("finish");
    });
    await waitFor(() => expect(sessionStorage.getItem("sq.dashboard.tour")).toBeNull());
    expect(layer()).toBeNull();
  });

  it("keeps Tab inside the card", async () => {
    const user = userEvent.setup();
    addTarget("one");
    addTarget("two");
    renderTour("/a");
    act(() => {
      store.startTour();
      store.goToStep("search", { arrived: true });
    });
    const dialog = await screen.findByRole("dialog", { name: "Step two" });
    await waitFor(() => expect(dialog).toHaveFocus());

    const skip = within(dialog).getByRole("button", { name: "Skip tour" });
    const back = within(dialog).getByRole("button", { name: "Back" });
    const next = within(dialog).getByRole("button", { name: "Next" });
    await user.tab();
    expect(skip).toHaveFocus();
    await user.tab();
    expect(back).toHaveFocus();
    await user.tab();
    expect(next).toHaveFocus();
    await user.tab();
    expect(skip).toHaveFocus();
    await user.tab({ shift: true });
    expect(next).toHaveFocus();
  });
});
