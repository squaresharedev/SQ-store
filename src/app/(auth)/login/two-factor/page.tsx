import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { TwoFactorChallenge } from "@/components/auth/TwoFactorChallenge";
import { afterChallenge } from "@/lib/auth/challenge";
import { deviceFromUserAgent } from "@/lib/auth/device-label";
import { passkeysConfigured } from "@/lib/auth/passkeys";
import { AuthUnreachableError, getSessionState } from "@/lib/auth/session";
import { approvalsConfigured, approvalsEnabled } from "@/lib/auth/sign-in-approval";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.metadata.twoFactor");
  return { title: t("title") };
}

// force-dynamic: reads session state (cookies) on every request. See
// (dashboard)/layout.tsx for why implicit detection isn't relied on.
export const dynamic = "force-dynamic";

/**
 * The second half of signing in, for an account with 2FA on. Reachable ONLY
 * by a session that has passed its first factor (password, Google, an emailed
 * link) and not yet its second: anyone signed out is sent to sign in, anyone
 * already through is shown a moment of success and sent on.
 */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const [session, sp] = await Promise.all([getSessionState(), searchParams]);
  // Same rule as the actions: internal only, and never back to a sign-in page.
  const next = afterChallenge(sp.next);

  if (session.kind === "unreachable") {
    throw new AuthUnreachableError(new Error("Supabase Auth unreachable on the 2FA challenge."));
  }
  if (session.kind === "signed_out") {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  // Already through. Most often this render IS the refresh that follows the
  // challenge's own success (an action that sets cookies re-renders the page),
  // and redirecting from here would cut its success mark off mid-play. The
  // page shows the mark and then goes on to the same sanitised `next`.
  const through = session.kind === "signed_in";
  const { user, assurance } = session;
  const [approvalReady, approvalOn, passkeysAvailable, head] = await Promise.all([
    approvalsConfigured(),
    approvalsEnabled(user.id),
    passkeysConfigured(),
    headers(),
  ]);

  return (
    <AuthPageShell>
      <TwoFactorChallenge
        next={next}
        email={user.email ?? ""}
        factors={assurance.factors.map(({ id, name, type }) => ({ id, name, type }))}
        through={through}
        approval={approvalReady && approvalOn === true}
        device={deviceFromUserAgent(head.get("user-agent"))}
        passkeysAvailable={passkeysAvailable}
      />
    </AuthPageShell>
  );
}
