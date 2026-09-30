import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { ApproveSignIn } from "@/components/auth/ApproveSignIn";
import { buttonClassName } from "@/components/ui/button";
import { helpTextClass } from "@/components/ui/control-styles";
import type { Locale } from "@/i18n/locales";
import { secondFactorIsFresh } from "@/lib/auth/assurance";
import { approveSignInPath, signInPath } from "@/lib/auth/paths";
import { AuthUnreachableError, getSessionState, twoFactorChallengePath } from "@/lib/auth/session";
import {
  APPROVER_MAX_AGE_SECONDS,
  findApprovalRequest,
  matchChoices,
} from "@/lib/auth/sign-in-approval";
import { reconfirmToApprove } from "@/lib/auth/sign-in-approval-actions";
import { regionName } from "@/lib/format/country";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.metadata.approve");
  return {
    title: t("title"),
    // The token in this URL is half of an approval: never leak it onward.
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * Where a sign-in approval QR code lands, on the phone (lib/auth/
 * sign-in-approval.ts). Only a FULLY signed-in session of the same account may
 * answer: signed out, it asks to sign in first and comes back; still owing
 * its own second factor, it goes through the challenge first; and one whose
 * second factor is older than APPROVER_MAX_AGE_SECONDS signs in again first.
 * Opening the page decides nothing (link previews and prefetchers open pages);
 * only a tap on a number or Deny does.
 */
export default async function ApproveSignInPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, session] = await Promise.all([params, getSessionState()]);
  const here = approveSignInPath(token);

  if (session.kind === "unreachable") {
    throw new AuthUnreachableError(new Error("Supabase Auth unreachable on the approval page."));
  }
  if (session.kind === "needs_mfa") redirect(twoFactorChallengePath(here));

  const t = await getTranslations("Auth.approve");

  if (session.kind === "signed_out") {
    return (
      <AuthPageShell>
        <Notice heading={t("signIn.heading")} body={t("signIn.body")}>
          <Link href={signInPath(here)} className={buttonClassName("primary", "w-full")}>
            {t("signIn.button")}
          </Link>
        </Notice>
      </AuthPageShell>
    );
  }

  const request = await findApprovalRequest(token);
  // No number means a request from before number matching: it cannot be
  // answered safely, so it reads as expired.
  if (!request || !request.open || request.matchCode === null) {
    return (
      <AuthPageShell>
        <Notice heading={t("expired.heading")} body={t("expired.body")} state="expired" />
      </AuthPageShell>
    );
  }
  if (request.userId !== session.user.id) {
    return (
      <AuthPageShell>
        <Notice heading={t("otherAccount.heading")} body={t("otherAccount.body")} state="other-account" />
      </AuthPageShell>
    );
  }

  // Sessions never lapse on their own, so a phone that passed two-factor long
  // ago must prove itself again before it lets anyone else in.
  if (!secondFactorIsFresh(session.assurance, APPROVER_MAX_AGE_SECONDS)) {
    return (
      <AuthPageShell>
        <Notice heading={t("stale.heading")} body={t("stale.body")} state="stale">
          <form action={reconfirmToApprove}>
            <input type="hidden" name="token" value={token} />
            <button type="submit" className={buttonClassName("primary", "w-full")}>
              {t("stale.button")}
            </button>
          </form>
        </Notice>
      </AuthPageShell>
    );
  }

  const locale = (await getLocale()) as Locale;
  return (
    <AuthPageShell>
      <ApproveSignIn
        token={token}
        email={session.user.email ?? ""}
        device={{ browser: request.browser, os: request.os }}
        location={regionName(request.country, locale)}
        choices={matchChoices(request.matchCode)}
      />
    </AuthPageShell>
  );
}

function Notice({
  heading,
  body,
  state,
  children,
}: {
  heading: string;
  body: string;
  state?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5" data-approve-state={state}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{heading}</h1>
        <p className={`${helpTextClass} mt-1`}>{body}</p>
      </div>
      {children}
    </div>
  );
}
