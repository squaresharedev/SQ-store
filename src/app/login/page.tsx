import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { SquareShareLogo } from "@/components/ui/square-share-logo";
import { getUser } from "@/lib/auth/session";
import { MARKETPLACE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Square Share creator dashboard.",
};

function sanitizeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

const ERROR_MESSAGES: Record<string, string> = {
  auth_callback: "That link is invalid or has expired. Try signing in again.",
  auth_confirm: "That link is invalid or has expired. Try signing in again.",
  oauth: "Google sign-in could not be started. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  // Already signed in? Skip the form.
  const user = await getUser();
  const sp = await searchParams;
  const next = sanitizeNext(sp.next);
  if (user) redirect(next);

  const linkError = sp.error ? (ERROR_MESSAGES[sp.error] ?? null) : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5f5f5] px-6 py-5">
      {/* Static dot-grid texture (fades at the edges). */}
      <div
        aria-hidden
        className="dot-grid pointer-events-none absolute inset-0"
      />

      {/* Giant faint arrows bleeding off each side (desktop only). Left points
          northeast, right points the opposite (southwest). */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[-6rem] top-1/2 hidden -translate-y-1/2 text-neutral-900 opacity-[0.05] md:block"
      >
        <svg
          width="600"
          height="600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.6"
          strokeLinecap="butt"
          strokeLinejoin="miter"
          style={{ overflow: "visible" }}
        >
          {/* Shaft extended well past the icon's own bounds so it bleeds off
              the screen edge and gets clipped by main's overflow-hidden,
              while the tip (drawn by the second path) stays anchored in place. */}
          <path d="M-13 37 17 7" />
          <path d="M7 7h10v10" />
        </svg>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-6rem] top-1/2 hidden -translate-y-1/2 text-neutral-900 opacity-[0.05] md:block"
      >
        <svg
          width="600"
          height="600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.6"
          strokeLinecap="butt"
          strokeLinejoin="miter"
          style={{ overflow: "visible" }}
        >
          {/* Shaft extended well past the icon's own bounds so it bleeds off
              the screen edge and gets clipped by main's overflow-hidden,
              while the tip (drawn by the second path) stays anchored in place. */}
          <path d="M37 -13 7 17" />
          <path d="M17 17H7V7" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Brand header: pixel mark + Space Grotesk wordmark */}
        <div className="mb-3 flex items-center gap-3">
          <SquareShareLogo className="h-8 w-8 text-neutral-900" />
          <div className="flex flex-col leading-tight">
            <span className="font-display text-lg font-black tracking-tight text-neutral-900">
              Square Share
            </span>
            <span className="text-xs text-neutral-500">Creator dashboard</span>
          </div>
        </div>

        {/* Auth card — hard corners, sits above the grid */}
        <div className="border border-neutral-200 bg-white px-6 pt-7 pb-5 shadow-[0_8px_40px_rgba(0,0,0,0.08)] sm:px-7 sm:pt-8">
          {linkError && (
            <p
              role="alert"
              className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600"
            >
              {linkError}
            </p>
          )}
          <LoginForm next={next} />
        </div>

        {/* Access note — creators onboard via the marketplace waitlist. */}
        <p className="mt-4 text-center text-sm text-neutral-500">
          No account yet?{" "}
          <a
            href={MARKETPLACE_URL}
            className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-500"
          >
            Request access
          </a>
        </p>
      </div>
    </main>
  );
}
