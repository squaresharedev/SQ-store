// The buy button dialog's motion graphic: a cursor clicks the seller's own
// button, the product page opens, it clicks Buy there, the checkout opens.
// What is pinned here is the STORY (its order, that it stops by itself, that
// it can be stopped, and that it never starts for someone who asked for less
// motion or for a product with no page), not the pixels.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "../setup/render";

const motionPrefs = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motionPrefs.reduced,
}));

import { BuyButtonStory } from "@/components/products/BuyButtonStory";

const LAMP = { title: "Oak lamp", imageUrl: null, price: 40, currency: "EUR" } as const;

/** When each screen comes up, measured from the start of a pass: the cursor
 *  waits, travels and presses, and then the next screen opens. */
const PAGE_OPENS_MS = 900 + 850 + 280;
const CHECKOUT_OPENS_MS = PAGE_OPENS_MS + 1100 + 850 + 280;
/** One pass of the story: the checkout is left up, then it starts again. */
const ONE_LOOP_MS = CHECKOUT_OPENS_MS + 2400;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  motionPrefs.reduced = false;
});

const flow = () => document.querySelector("[data-buy-button-flow]") as HTMLElement;
const scene = () => flow().getAttribute("data-buy-button-scene");
const control = () => screen.queryByRole("button");
/**
 * Lets `ms` pass in small steps. One beat's timer schedules the next only once
 * React has re-rendered, which happens when `act` returns, so a single long
 * advance would play one beat and stall.
 */
const TICK_MS = 10;
function wait(ms: number) {
  for (let left = ms; left > 0; left -= TICK_MS) {
    act(() => {
      vi.advanceTimersByTime(Math.min(TICK_MS, left));
    });
  }
}

describe("BuyButtonStory", () => {
  it("tells it in order: the seller's button, the product page, then the checkout", () => {
    render(<BuyButtonStory product={LAMP} live />);
    expect(scene()).toBe("site");
    wait(PAGE_OPENS_MS - 1);
    expect(scene()).toBe("site");
    wait(1);
    expect(scene()).toBe("page");
    wait(CHECKOUT_OPENS_MS - PAGE_OPENS_MS);
    expect(scene()).toBe("checkout");
    // ...and round again.
    wait(ONE_LOOP_MS - CHECKOUT_OPENS_MS);
    expect(scene()).toBe("site");
  });

  it("is about the seller's own product, and says so only to the eye", () => {
    render(<BuyButtonStory product={LAMP} live />);
    expect(flow()).toHaveTextContent("Oak lamp");
    expect(flow()).toHaveTextContent("€40.00");
    expect(flow()).toHaveTextContent("Your button");
    expect(flow()).toHaveTextContent("Checkout");
    // Everything drawn is hidden from assistive tech; the one thing announced
    // is the control that stops it.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    for (const mention of screen.getAllByText("Oak lamp")) {
      expect(mention.closest("[aria-hidden='true']")).not.toBeNull();
    }
    expect(control()).toHaveAccessibleName("Pause the animation");
  });

  it("stops by itself after two passes, back on its first frame, and plays again when asked", () => {
    render(<BuyButtonStory product={LAMP} live />);
    wait(ONE_LOOP_MS * 2);
    expect(scene()).toBe("site");
    expect(control()).toHaveAccessibleName("Play the animation");
    // Still: nothing moves however long it is left.
    wait(ONE_LOOP_MS);
    expect(scene()).toBe("site");

    fireEvent.click(control()!);
    expect(control()).toHaveAccessibleName("Pause the animation");
    wait(PAGE_OPENS_MS);
    expect(scene()).toBe("page");
  });

  it("holds the frame it was paused on, and carries on from there", () => {
    render(<BuyButtonStory product={LAMP} live />);
    wait(PAGE_OPENS_MS);
    expect(scene()).toBe("page");
    fireEvent.click(control()!);
    expect(control()).toHaveAccessibleName("Play the animation");
    wait(ONE_LOOP_MS);
    expect(scene()).toBe("page");
    fireEvent.click(control()!);
    wait(CHECKOUT_OPENS_MS - PAGE_OPENS_MS);
    expect(scene()).toBe("checkout");
  });

  it("never starts by itself under reduced motion, but plays if the seller asks", () => {
    motionPrefs.reduced = true;
    render(<BuyButtonStory product={LAMP} live />);
    expect(control()).toHaveAccessibleName("Play the animation");
    wait(ONE_LOOP_MS);
    expect(scene()).toBe("site");
    fireEvent.click(control()!);
    wait(PAGE_OPENS_MS);
    expect(scene()).toBe("page");
  });

  it("does not play for a product with no page to land on: a locked first frame, and nothing to press", () => {
    render(<BuyButtonStory product={LAMP} live={false} />);
    expect(flow()).toHaveAttribute("data-buy-button-flow", "locked");
    expect(control()).toBeNull();
    wait(ONE_LOOP_MS * 2);
    expect(scene()).toBe("site");
  });
});
