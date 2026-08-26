"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/error/ErrorScreen";
import { Button } from "@/components/ui/button";

/**
 * Root error boundary for every nested segment (the dashboard, settings and
 * storefront layouts all sit below it). Its main job today is the case that
 * used to masquerade as a logout: `requireUser` throwing AuthUnreachableError
 * because Supabase Auth could not be reached. The session cookie is still
 * valid, so the honest offer is "try again", not a bounce to /login.
 *
 * Deliberately message-agnostic: Next.js redacts server-error messages in
 * production (only `digest` survives), so the copy must be right without
 * knowing which error landed here.
 */
export default function ErrorBoundary({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  // Next 16.2 supersedes `reset` with `unstable_retry`, which re-FETCHES before
  // re-rendering. That matters here: the errors this boundary catches are
  // usually a failed server-side call, which a plain state reset would replay
  // straight back into. `reset` stays as the fallback until the API settles.
  unstable_retry?: () => void;
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <ErrorScreen
      code="500"
      readout="err_internal"
      title="Something went wrong"
      description="We couldn't load this page. This is usually a temporary connection problem: your account is fine and you're still signed in."
      action={
        /* Inverted for the same reason as the 404's CTA: see not-found.tsx. */
        <Button
          onClick={() => (unstable_retry ?? reset)()}
          className="bg-foreground text-background hover:bg-foreground/90"
        >
          Try again
        </Button>
      }
      note={
        error.digest ? (
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null
      }
    />
  );
}
