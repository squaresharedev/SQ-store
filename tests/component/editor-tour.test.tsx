/**
 * EditorTour: the storefront designer's first-visit tour, as the sample mounts it.
 *
 * What these pin: it starts by itself only when asked, records the start once,
 * never restarts in the same tab, uses the page it is on (so the overlay never
 * navigates), leaves the dashboard's tour alone, and ends when the designer
 * goes away rather than resuming mid-way next visit.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen } from "../setup/render";
import {
  __resetEditorTourLatchForTests,
  EditorTour,
  startEditorTour,
} from "@/components/onboarding/EditorTour";
import { __resetTourForTests, dashboardTour, editorTour } from "@/lib/onboarding/tour-store";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  // Not the sample's own path: the tour must take the page it is shown on.
  usePathname: () => "/dev/sample-storefront",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/search/SearchProvider", () => ({
  useSearch: () => null,
}));

const actions = vi.hoisted(() => ({
  markEditorTourSeen: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/onboarding/actions", () => actions);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  __resetTourForTests();
  __resetEditorTourLatchForTests();
});
afterEach(cleanup);

describe("EditorTour", () => {
  it("starts by itself on the page it is on, records it once, and never navigates", async () => {
    render(<EditorTour autoStart />);
    const card = await screen.findByRole("dialog", { name: "Add to your grid" });
    expect(card).toHaveTextContent("1 of 4");
    expect(actions.markEditorTourSeen).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(document.querySelector("[data-tour-step]")).toHaveAttribute("data-tour-step", "editor-add");
  });

  it("stays idle without autoStart, and replays from the sample's button", async () => {
    render(<EditorTour autoStart={false} />);
    expect(document.querySelector("[data-tour-step]")).toBeNull();
    expect(actions.markEditorTourSeen).not.toHaveBeenCalled();

    act(() => startEditorTour());
    expect(await screen.findByRole("dialog", { name: "Add to your grid" })).toBeInTheDocument();
    // A replay is not a first visit: nothing is recorded.
    expect(actions.markEditorTourSeen).not.toHaveBeenCalled();
  });

  it("does not start again in the same tab after it was dismissed", async () => {
    const user = userEvent.setup();
    const first = render(<EditorTour autoStart />);
    await screen.findByRole("dialog", { name: "Add to your grid" });
    await user.keyboard("{Escape}");
    expect(document.querySelector("[data-tour-step]")).toBeNull();
    first.unmount();

    render(<EditorTour autoStart />);
    await act(async () => {});
    expect(document.querySelector("[data-tour-step]")).toBeNull();
    expect(actions.markEditorTourSeen).toHaveBeenCalledTimes(1);
  });

  it("leaves a running dashboard tour exactly where it was", async () => {
    act(() => dashboardTour.start());
    render(<EditorTour autoStart />);
    await screen.findByRole("dialog", { name: "Add to your grid" });
    expect(dashboardTour.getSnapshot()).toMatchObject({ status: "active", stepId: "overview-nav" });
  });

  it("ends when the designer goes away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const view = render(<EditorTour autoStart />);
      await screen.findByRole("dialog", { name: "Add to your grid" });
      view.unmount();
      await act(async () => {
        vi.runAllTimers();
      });
      expect(editorTour.getSnapshot()).toEqual({ status: "idle" });
    } finally {
      vi.useRealTimers();
    }
  });
});
