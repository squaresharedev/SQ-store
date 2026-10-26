"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useProgressWhile } from "@/lib/hooks/useProgressWhile";

type NavigateOptions = { scroll?: boolean };

/**
 * The router, for a click that navigates from code (a row that opens its
 * target, a button that goes back). Same calls as useRouter, but each runs
 * inside a transition, so:
 *
 *   - `pending` is true until the new page is in, for a button that wants to
 *     show it (`<Button pending={pending}>`), and
 *   - the page-wide progress bar comes up if the wait outlasts the delay, for
 *     a control that has already left the screen.
 *
 * A plain <Link> needs none of this: the bar watches link clicks itself.
 */
export function usePendingRouter() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useProgressWhile(pending);

  return useMemo(
    () => ({
      pending,
      // Options are passed on only when given, so a call is exactly the router's own.
      push: (href: string, options?: NavigateOptions) =>
        startTransition(() => (options ? router.push(href, options) : router.push(href))),
      replace: (href: string, options?: NavigateOptions) =>
        startTransition(() => (options ? router.replace(href, options) : router.replace(href))),
      back: () => startTransition(() => router.back()),
      refresh: () => startTransition(() => router.refresh()),
    }),
    [pending, router],
  );
}
