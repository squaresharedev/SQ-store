"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** How often the order page asks again while a payment is being confirmed,
 *  and how many times before it hands the asking to the buyer. A minute in
 *  all: a confirmation that has not arrived by then is not about to, and
 *  every ask spends from the order page's rate limit. */
const WATCH_INTERVAL_MS = 4000;
const WATCH_ATTEMPTS = 15;

/**
 * Keeps an order page that says "confirming your payment" honest without the
 * buyer doing anything. A payment provider that confirms afterwards sends the
 * buyer back a moment before it tells us, so the page they land on can be a
 * second behind; this re-reads it until the order is paid.
 *
 * Renders nothing while it watches. Once it stops, a button to ask again, so
 * a slow confirmation is not left to "reload the page" in small print.
 * Mounted only while the payment is pending, so the paid page it turns into
 * unmounts it.
 */
export function PaymentWatch() {
  const router = useRouter();
  const t = useTranslations("ProductPage.order.timeline");
  // Each round of watching; "Check again" starts another.
  const [round, setRound] = useState(0);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts >= WATCH_ATTEMPTS) {
        window.clearInterval(timer);
        setStopped(true);
      }
      // A hidden tab has nobody to show the result to: the attempt still counts,
      // so the page still stops and offers "Check again", but it spends no ask.
      if (!document.hidden) router.refresh();
    }, WATCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [router, round]);

  if (!stopped) return null;
  return (
    <Button
      variant="secondary"
      className="w-fit"
      data-payment-check-again=""
      onClick={() => {
        setStopped(false);
        setRound((value) => value + 1);
        router.refresh();
      }}
    >
      {t("checkAgain")}
    </Button>
  );
}
