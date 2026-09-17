/**
 * SetupChecklist: Overview's "Get set up" card.
 *
 * The steps themselves are lib/onboarding/steps.ts's business (and its unit
 * tests'); these pin what the card does with them: progress and per-row
 * datapoints, the links, folding away on this device, and the finished state,
 * which is shown ONCE (recorded as soon as it renders) and can be hidden sooner.
 */

import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, cleanup, within } from "../setup/render";
import { buildSetupSteps, type SetupFacts } from "@/lib/onboarding/steps";
import { SETUP_COLLAPSED_KEY, SetupChecklist } from "@/components/onboarding/SetupChecklist";
import { DEFAULT_PRODUCT_PAGE_CONFIG, type StorefrontConfig } from "@/types/storefront";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
});

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

const LIVE_URL = "https://store.example/s/sf-1/p/p-1";

describe("SetupChecklist", () => {
  it("shows progress and every step, publishing each one's state", () => {
    const { container } = render(
      <SetupChecklist
        setup={buildSetupSteps(NEW_SELLER)}
        livePageUrl={null}
        celebrate
        onCelebrated={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Get set up" })).toBeInTheDocument();
    expect(screen.getByText("0 of 4 done")).toBeInTheDocument();

    const root = container.querySelector("[data-setup-checklist]");
    expect(root).toHaveAttribute("data-setup-done", "0");
    expect(root).toHaveAttribute("data-setup-total", "4");
    expect(root).toHaveAttribute("data-setup-complete", "false");

    const seller = container.querySelector('[data-setup-step="seller-details"]') as HTMLElement;
    expect(seller).toHaveAttribute("data-setup-state", "todo");
    expect(within(seller).getByRole("link", { name: /add details/i })).toHaveAttribute(
      "href",
      "/settings/tax#business-name",
    );
    // Publishing waits on the details, so its row offers no link of its own.
    const publish = container.querySelector('[data-setup-step="publish"]') as HTMLElement;
    expect(within(publish).queryByRole("link")).toBeNull();
  });

  it("no longer carries the tour: that is replayed from Settings", () => {
    render(
      <SetupChecklist
        setup={buildSetupSteps(NEW_SELLER)}
        livePageUrl={null}
        celebrate
        onCelebrated={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /show me around/i })).toBeNull();
  });

  it("folds its steps away on this device, and remembers", async () => {
    const user = userEvent.setup();
    const setup = buildSetupSteps(NEW_SELLER);
    const first = render(
      <SetupChecklist setup={setup} livePageUrl={null} celebrate onCelebrated={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Hide steps" }));
    expect(screen.getByRole("list", { hidden: true })).not.toBeVisible();
    expect(localStorage.getItem(SETUP_COLLAPSED_KEY)).toBe("1");

    first.unmount();
    render(<SetupChecklist setup={setup} livePageUrl={null} celebrate onCelebrated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show steps" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("does not record anything while the setup is unfinished", () => {
    const onCelebrated = vi.fn();
    render(
      <SetupChecklist
        setup={buildSetupSteps(NEW_SELLER)}
        livePageUrl={null}
        celebrate
        onCelebrated={onCelebrated}
      />,
    );
    expect(onCelebrated).not.toHaveBeenCalled();
  });

  it("hands over the live page link once, recording it as shown as soon as it renders", () => {
    const onCelebrated = vi.fn();
    const { rerender } = render(
      <SetupChecklist
        setup={buildSetupSteps(COMPLETE)}
        livePageUrl={LIVE_URL}
        celebrate
        onCelebrated={onCelebrated}
      />,
    );

    expect(screen.getByRole("heading", { name: "You're set up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy product page link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute("href", LIVE_URL);
    // Recorded without waiting for a click, and only once however often it renders.
    expect(onCelebrated).toHaveBeenCalledTimes(1);
    rerender(
      <SetupChecklist
        setup={buildSetupSteps(COMPLETE)}
        livePageUrl={LIVE_URL}
        celebrate
        onCelebrated={onCelebrated}
      />,
    );
    expect(onCelebrated).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it("renders nothing for a finished setup whose card has already been shown", () => {
    const onCelebrated = vi.fn();
    const { container } = render(
      <SetupChecklist
        setup={buildSetupSteps(COMPLETE)}
        livePageUrl={LIVE_URL}
        celebrate={false}
        onCelebrated={onCelebrated}
      />,
    );
    // Not toBeEmptyDOMElement: the render helper mounts the toast region beside it.
    expect(container.querySelector("[data-setup-checklist]")).toBeNull();
    expect(screen.queryByRole("heading", { name: "You're set up" })).toBeNull();
    expect(onCelebrated).not.toHaveBeenCalled();
  });

  it("can be put away sooner with Hide, for this visit", async () => {
    const user = userEvent.setup();
    render(
      <SetupChecklist
        setup={buildSetupSteps(COMPLETE)}
        livePageUrl={LIVE_URL}
        celebrate
        onCelebrated={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("heading", { name: "You're set up" })).toBeNull();
    // Nothing per-device: the profile is what remembers.
    expect(localStorage.length).toBe(0);
  });
});
