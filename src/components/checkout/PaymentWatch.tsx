"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How often the order page asks again while a payment is being confirmed,
 *  and how many times before it leaves the buyer to reload it themselves.
 *  A minute in all: a confirmation that has not arrived by then is not about
 *  to, and every ask spends from the order page's rate limit. */
const WATCH_INTERVAL_MS = 4000;
const WATCH_ATTEMPTS = 15;

/**
 * Keeps an order page that says "confirming your payment" honest without the
 * buyer doing anything. A payment provider that confirms afterwards sends the
 * buyer back a moment before it tells us, so the page they land on can be a
 * second behind; this re-reads it until the order is paid.
 *
 * Renders nothing. Mounted only while the payment is pending, so the paid
 * page it turns into unmounts it.
 */
export function PaymentWatch() {
  const router = useRouter();
  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts >= WATCH_ATTEMPTS) window.clearInterval(timer);
      router.refresh();
    }, WATCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}
