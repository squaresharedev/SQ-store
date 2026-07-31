"use client";

import { useEffect } from "react";

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
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-6 py-5">
      <div className="w-full max-w-md border border-neutral-200 bg-white px-6 py-7 shadow-[0_8px_40px_rgba(0,0,0,0.08)] sm:px-7">
        <h1 className="font-display text-lg font-black tracking-tight text-neutral-900">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          We couldn&apos;t load this page. This is usually a temporary
          connection problem — your account is fine and you&apos;re still signed
          in.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="text-sm font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-500"
          >
            Back to dashboard
          </a>
        </div>
        {error.digest && (
          <p className="mt-5 font-mono text-xs text-neutral-400">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
