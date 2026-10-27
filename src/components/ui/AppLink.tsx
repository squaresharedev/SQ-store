"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import Link, { useLinkStatus } from "next/link";
import { useProgressWhile } from "@/lib/hooks/useProgressWhile";

/**
 * How long the pointer (or keyboard focus) rests on a link before its page is
 * fetched ahead. Long enough that sweeping across the sidebar fetches nothing,
 * short enough that a deliberate click still finds the page on its way.
 */
export const PREFETCH_INTENT_MS = 100;

/**
 * Reports a link's page change to the page-wide progress bar. Lives inside the
 * <Link> because that is the only place useLinkStatus can read from: it is
 * pending exactly while THIS link's navigation is under way, and never for a
 * click that was handled elsewhere (an unsaved-changes prompt, a link that
 * opens a panel), which is what a click listener cannot tell apart.
 */
function LinkProgress() {
  const { pending } = useLinkStatus();
  useProgressWhile(pending);
  return null;
}

/**
 * THE link for in-app navigation: next/link, plus an answer for a slow page
 * change (the bar across the top, once the wait outlasts PENDING_DELAY_MS).
 * Import it wherever you would import `Link` from "next/link" (ESLint refuses
 * the latter), so the answer cannot be forgotten on a new link.
 *
 * Prefetching waits for intent. next/link on its own fetches every link on
 * screen ahead, and each of those is a server render on the Worker: a dozen
 * at once on every dashboard page load, which is what ran the Worker out of
 * its CPU allowance (Cloudflare Error 1102) and took the real page down with
 * it. So a link fetches its page ahead only once the pointer or focus rests
 * on it for PREFETCH_INTENT_MS. A `prefetch` prop passed in still wins.
 *
 * Everything else is next/link unchanged: same props, same ref. A route with
 * a loading.tsx usually navigates before the bar can show.
 */
export function AppLink({
  children,
  prefetch,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const lean = () => {
    if (intent || prefetch !== undefined) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIntent(true), PREFETCH_INTENT_MS);
  };
  const leave = () => clearTimeout(timer.current);

  return (
    <Link
      {...props}
      // false keeps next/link from fetching on sight AND on hover; null is
      // its own default, which fetches as soon as the link is (still) on screen.
      prefetch={prefetch !== undefined ? prefetch : intent ? null : false}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        lean();
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        leave();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        lean();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        leave();
      }}
    >
      {children}
      <LinkProgress />
    </Link>
  );
}

export default AppLink;
