import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TwoFactorChallenge } from "@/components/auth/TwoFactorChallenge";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import { AuthUnreachableError, getSessionState } from "@/lib/auth/session";
import { safeInternalPath } from "@/lib/utils/safe-path";

export const metadata: Metadata = {
  title: "Two-factor authentication",
};

// force-dynamic: reads session state (cookies) on every request. See
// (dashboard)/layout.tsx for why implicit detection isn't relied on.
export const dynamic = "force-dynamic";

/** Same rule as the actions: internal only, and never back to a sign-in page. */
function sanitizeNext(value: string | string[] | undefined): string {
  const next = safeInternalPath(Array.isArray(value) ? value[0] : value);
  return next.startsWith("/login") ? "/" : next;
}

/**
 * The second half of signing in, for an account with 2FA on. Reachable ONLY
 * by a session that has passed its first factor (password, Google, an emailed
 * link) and not yet its second: anyone signed out is sent to sign in, anyone
 * already through is sent on.
 */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const [session, sp] = await Promise.all([getSessionState(), searchParams]);
  const next = sanitizeNext(sp.next);

  if (session.kind === "unreachable") {
    throw new AuthUnreachableError(new Error("Supabase Auth unreachable on the 2FA challenge."));
  }
  if (session.kind === "signed_out") {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (session.kind === "signed_in") redirect(next);

  const { user, assurance } = session;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-muted px-6 py-8">
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />
      <BackgroundArrow side="left" />
      <BackgroundArrow side="right" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- static public asset; next/image adds no value here. */}
          <img
            src="/img/logo.png"
            alt="Square Share"
            className="h-8 w-8 shrink-0 object-contain"
          />
          <div className="flex flex-col leading-tight">
            <span className="font-display text-lg font-black tracking-tight text-foreground">
              Square Share
            </span>
            <span className="text-xs text-muted-foreground">Creator dashboard</span>
          </div>
        </div>

        {/* Hard corners, like the sign-in card this continues from. */}
        <div className="border border-border bg-background px-6 pt-7 pb-6 shadow-lg sm:px-8 sm:pt-8 sm:pb-7">
          <TwoFactorChallenge
            next={next}
            email={user.email ?? ""}
            factors={assurance.factors.map(({ id, name }) => ({ id, name }))}
          />
        </div>
      </div>
    </main>
  );
}
