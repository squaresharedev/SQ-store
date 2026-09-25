import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SecuritySection } from "@/components/settings/security/SecuritySection";
import { accountHasPassword } from "@/lib/auth/has-password";
import { RECENT_SIGN_IN_SECONDS, signedInRecently } from "@/lib/auth/assurance";
import { remainingRecoveryCodes } from "@/lib/auth/mfa";
import { getAssurance, requireUser } from "@/lib/auth/session";
import { SECURITY_EVENT_LABELS, isSecurityEvent } from "@/lib/security/events";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.security");
  return { title: t("title") };
}

/** How many recent security events the activity card lists. */
const ACTIVITY_LIMIT = 10;

/**
 * Settings › Security: two-factor authentication, recovery codes and the
 * account's own security log. Everything here is read for the SIGNED-IN person
 * (never the active store), because a second factor belongs to a person, not
 * to a store they happen to be viewing.
 */
export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ recovered?: string; setup?: string }>;
}) {
  const user = await requireUser("/settings/security");
  const [assurance, hasPassword, params] = await Promise.all([
    getAssurance(),
    accountHasPassword(user.id),
    searchParams,
  ]);
  const enrolled = assurance?.enrolled ?? false;

  const supabase = await createClient();
  const [remaining, activity] = await Promise.all([
    enrolled ? remainingRecoveryCodes(user.id) : Promise.resolve(null),
    // Own rows only, by RLS and by the explicit filter.
    supabase
      .from("security_events")
      .select("id, event, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
  ]);

  return (
    <SecuritySection
      enrolled={enrolled}
      factors={(assurance?.factors ?? []).map(({ id, name, createdAt }) => ({
        id,
        name,
        createdAt,
      }))}
      hasPassword={hasPassword}
      // A sign-in in the last few minutes is proof on its own: setup then asks
      // for no password (and a Google-only account need not sign in again).
      signedInRecently={signedInRecently(assurance, RECENT_SIGN_IN_SECONDS)}
      // From GoTrue's record of the account, so a Google account is offered
      // "Confirm with Google" instead of a password it may never use.
      signsInWithGoogle={
        (user.identities ?? []).some((identity) => identity.provider === "google") ||
        (Array.isArray(user.app_metadata?.providers) &&
          user.app_metadata.providers.includes("google"))
      }
      recoveryCodesRemaining={remaining}
      activity={
        activity.error
          ? null
          : (activity.data ?? []).map((row) => ({
              id: row.id,
              // A kind this build has no words for is shown as its raw slug.
              label: isSecurityEvent(row.event) ? SECURITY_EVENT_LABELS[row.event] : null,
              event: row.event,
              at: row.created_at,
            }))
      }
      // Just signed in with a recovery code: 2FA is off, so say so and put
      // setup straight in front of them.
      recovered={params.recovered === "1"}
      openSetup={params.recovered === "1" || params.setup === "1"}
    />
  );
}
