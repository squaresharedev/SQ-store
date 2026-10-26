"use client";

import type { ComponentProps } from "react";
import Link, { useLinkStatus } from "next/link";
import { useProgressWhile } from "@/lib/hooks/useProgressWhile";

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
 * Everything else is next/link unchanged: same props, same prefetching, same
 * ref. A route with a loading.tsx usually navigates before the bar can show.
 */
export function AppLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <LinkProgress />
    </Link>
  );
}

export default AppLink;
