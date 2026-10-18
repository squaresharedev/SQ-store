"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How far past the end the page waits before asking again, so the server's
 *  own clock has passed it too and the answer is the price after the sale. */
const PAST_THE_END_MS = 1500;
/** The longest wait a browser timer can hold (2^31 - 1 ms, about 24 days). A
 *  longer one would fire at once, so it is left to the listeners below. */
const TIMER_MAX_MS = 2_147_483_647;

/**
 * READS A PAGE'S PRICES AGAIN WHEN THE SALE BEHIND THEM ENDS.
 *
 * A hosted page prints what a product costs at the moment it was served. A tab
 * left open across the end of a sale would go on showing a price that is no
 * longer offered, so the page asks the server again just after that moment
 * (router.refresh: the same route, read afresh, nothing the buyer typed or
 * picked is lost). What is charged never depended on this: the checkout prices
 * every order itself (lib/checkout/quote.ts) and refuses a total the buyer was
 * not shown. This only keeps the page from saying something stale.
 *
 * `inMs` is how long the price has left, measured by the server when it
 * rendered (lib/discounts/public.ts msUntilSaleEnds). A length of time rather
 * than a moment, so it is counted down on the buyer's own clock and a clock
 * that is wrong changes nothing.
 *
 * Renders nothing.
 */
export function PriceRefresh({ inMs }: { inMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const dueAt = Date.now() + Math.max(0, inMs) + PAST_THE_END_MS;
    let asked = false;
    const ask = () => {
      if (asked) return;
      asked = true;
      router.refresh();
    };
    // A tab asleep in the background, or one brought back by the browser's
    // back button, can sleep through its timer: check again when it is seen.
    const askIfDue = () => {
      if (document.visibilityState === "visible" && Date.now() >= dueAt) ask();
    };

    const wait = dueAt - Date.now();
    const timer = wait <= TIMER_MAX_MS ? window.setTimeout(ask, wait) : null;
    document.addEventListener("visibilitychange", askIfDue);
    window.addEventListener("pageshow", askIfDue);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", askIfDue);
      window.removeEventListener("pageshow", askIfDue);
    };
  }, [inMs, router]);

  return null;
}
