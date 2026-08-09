"use client";

import { useEffect } from "react";
import { buttonClassName } from "@/components/ui/button";

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
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-6 py-5">
      <div className="w-full max-w-md border border-border bg-background px-6 py-7 shadow-lg sm:px-7">
        <h1 className="font-display text-lg font-black tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load this page. This is usually a temporary
          connection problem — your account is fine and you&apos;re still signed
          in.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className={buttonClassName("primary", "py-2")}
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:decoration-foreground motion-reduce:transition-none"
          >
            Back to dashboard
          </a>
        </div>
        {error.digest && (
          <p className="mt-5 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
