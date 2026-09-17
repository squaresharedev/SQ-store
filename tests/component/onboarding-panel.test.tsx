/**
 * OnboardingPanel: the setup slot's client half.
 *
 * What these pin: Skip onboarding records the welcome and starts NO tour; every
 * way forward records it and starts the tour carrying the checklist's next
 * step; `?tour=1` starts the tour for someone past the welcome (never over it)
 * and drops the query either way; a welcome that opens ends a tour left
 * running; and the finished card is recorded once and stays up for the visit.
 */

import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, waitFor } from "../setup/render";
import type { OnboardingData } from "@/components/onboarding/OnboardingPanel";
import { buildSetupSteps, type SetupFacts } from "@/lib/onboarding/steps";
import { DEFAULT_PRODUCT_PAGE_CONFIG, type StorefrontConfig } from "@/types/storefront";

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
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const actions = vi.hoisted(() => ({
  completeOnboarding: vi.fn(async () => ({ ok: true })),
  markSetupCelebrated: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/onboarding/actions", () => actions);

vi.mock("@/lib/settings/actions", () => ({
  saveTaxInfo: vi.fn(),
  resendSellerEmailVerification: vi.fn(),
}));

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

const { OnboardingPanel } = await import("@/components/onboarding/OnboardingPanel");
const store = await import("@/lib/onboarding/tour-store");

const NEW_SELLER: SetupFacts = {
  traderMissing: ["businessName", "address", "email"],
  productCount: 0,
  activeProductIds: [],
  existingProductIds: [],
  storefronts: [],
};

const COMPLETE: SetupFacts = {
  traderMissing: [],
  productCount: 1,
  activeProductIds: ["p-1"],
  existingProductIds: ["p-1"],
  storefronts: [
    {
      id: "sf-1",
      config: {
        blocks: [{ type: "product", productId: "p-1" } as StorefrontConfig["blocks"][number]],
        productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: true },
      },
    },
  ],
};

function data(overrides: Partial<OnboardingData> = {}): OnboardingData {
  return {
    setup: buildSetupSteps(NEW_SELLER),
    traderMissing: ["businessName", "address", "email"],
    welcomePending: true,
    celebrationPending: true,
    seller: { businessName: "", address: "", email: "" },
    verificationOn: false,
    livePageUrl: null,
    tourRequested: false,
    ...overrides,
  };
}

/** The tour store, read the way the overlay reads it. */
function TourProbe() {
  const tour = store.useTour();
  return <output data-testid="tour">{JSON.stringify(tour)}</output>;
}
const tourState = () => JSON.parse(screen.getByTestId("tour").textContent ?? "{}");

beforeEach(() => {
  sessionStorage.clear();
  store.__resetTourForTests();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("OnboardingPanel", () => {
  it("records the welcome on Skip onboarding and starts no tour", async () => {
    const user = userEvent.setup();
    render(
      <>
        <OnboardingPanel {...data()} />
        <TourProbe />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Skip onboarding" }));
    await waitFor(() => expect(actions.completeOnboarding).toHaveBeenCalledTimes(1));
    expect(tourState()).toEqual({ status: "idle" });
    expect(screen.queryByRole("dialog", { name: "Welcome to Square Share" })).toBeNull();
  });

  it("records the welcome and starts the tour carrying the next setup step", async () => {
    const user = userEvent.setup();
    const setup = buildSetupSteps(NEW_SELLER);
    render(
      <>
        <OnboardingPanel {...data({ setup })} />
        <TourProbe />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => expect(actions.completeOnboarding).toHaveBeenCalledTimes(1));
    expect(tourState()).toEqual({
      status: "active",
      stepId: "overview-nav",
      arrived: false,
      next: { href: setup.next!.action!.href, label: setup.next!.cta },
    });
  });

  it("starts the tour from ?tour=1 for someone past the welcome, and drops the query", async () => {
    render(
      <>
        <OnboardingPanel {...data({ welcomePending: false, tourRequested: true })} />
        <TourProbe />
      </>,
    );
    await waitFor(() =>
      expect(tourState()).toMatchObject({ status: "active", stepId: "overview-nav" }),
    );
    expect(router.replace).toHaveBeenCalledWith("/dashboard", { scroll: false });
    expect(actions.completeOnboarding).not.toHaveBeenCalled();
  });

  it("never starts the tour over the welcome, but still drops the query", async () => {
    render(
      <>
        <OnboardingPanel {...data({ welcomePending: true, tourRequested: true })} />
        <TourProbe />
      </>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard", { scroll: false }));
    expect(tourState()).toEqual({ status: "idle" });
    expect(screen.getByRole("dialog", { name: "Welcome to Square Share" })).toBeInTheDocument();
  });

  it("ends a tour left running in the tab when the welcome opens", async () => {
    act(() => store.startTour());
    render(
      <>
        <OnboardingPanel {...data({ welcomePending: true })} />
        <TourProbe />
      </>,
    );
    await waitFor(() => expect(tourState()).toEqual({ status: "idle" }));
  });

  it("renders no card for a finished setup whose card was already shown", () => {
    render(
      <OnboardingPanel
        {...data({
          setup: buildSetupSteps(COMPLETE),
          traderMissing: [],
          welcomePending: false,
          celebrationPending: false,
        })}
      />,
    );
    expect(screen.queryByRole("heading", { name: "You're set up" })).toBeNull();
    expect(actions.markSetupCelebrated).not.toHaveBeenCalled();
  });

  // Last on purpose: showing the card marks this TAB as having shown it (a
  // module flag, so Back cannot bring it back), which every later render here
  // would then see.
  it("records the finished card once, and keeps it up for the visit after the write lands", async () => {
    const finished = data({
      setup: buildSetupSteps(COMPLETE),
      traderMissing: [],
      welcomePending: false,
      celebrationPending: true,
      livePageUrl: "https://store.example/s/sf-1/p/p-1",
    });
    const view = render(<OnboardingPanel {...finished} />);
    expect(screen.getByRole("heading", { name: "You're set up" })).toBeInTheDocument();
    await waitFor(() => expect(actions.markSetupCelebrated).toHaveBeenCalledTimes(1));

    // The next render from the server says it is no longer pending.
    view.rerender(<OnboardingPanel {...finished} celebrationPending={false} />);
    expect(screen.getByRole("heading", { name: "You're set up" })).toBeInTheDocument();
    expect(actions.markSetupCelebrated).toHaveBeenCalledTimes(1);
  });
});
