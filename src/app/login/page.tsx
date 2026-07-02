import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
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

      {/* Giant faint arrows bleeding off each side (desktop only) — shared
          decorative motif, also used across /settings. */}
      <BackgroundArrow side="left" />
      <BackgroundArrow side="right" />

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
