import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { LocaleSelect } from "@/components/layout/LocaleSelect";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import { readSignInMethod } from "@/lib/auth/last-method";
import { getSessionState, twoFactorChallengePath } from "@/lib/auth/session";
import { MARKETPLACE_URL } from "@/lib/site";
import { safeInternalPath } from "@/lib/utils/safe-path";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.metadata.login");
  return { title: t("title"), description: t("description") };
}

// force-dynamic: reads session state via getUser() (Supabase server client)
// below to redirect already-signed-in visitors. See (dashboard)/layout.tsx
// for why implicit cookies()-based dynamic detection isn't reliable here.
export const dynamic = "force-dynamic";

function sanitizeNext(value: string | string[] | undefined): string {
  return safeInternalPath(Array.isArray(value) ? value[0] : value);
}

/**
 * The `?error=` values this page will explain, each mapped to its message
 * under Auth.login.linkErrors. Anything else in the param renders nothing.
 */
const ERROR_MESSAGES = {
  auth_callback: "invalidLink",
  auth_confirm: "invalidLink",
  reset_expired: "resetExpired",
  oauth: "oauth",
} as const;

function linkErrorKey(value: string | undefined) {
  return value && Object.hasOwn(ERROR_MESSAGES, value)
    ? ERROR_MESSAGES[value as keyof typeof ERROR_MESSAGES]
    : null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  // Already signed in? Skip the form. Half signed in (password done, 2FA code
  // still owed)? Straight to the challenge rather than asking for the
  // password again.
  const session = await getSessionState();
  const tLocale = await getTranslations("LocaleSwitcher");
  const t = await getTranslations("Auth");
  const sp = await searchParams;
  const next = sanitizeNext(sp.next);
  if (session.kind === "signed_in") redirect(next);
  if (session.kind === "needs_mfa") redirect(twoFactorChallengePath(next));

  const errorKey = linkErrorKey(sp.error);
  const linkError = errorKey ? t(`login.linkErrors.${errorKey}`) : null;

  // Read server-side so the "Last used" pill is in the first paint rather than
  // appearing a beat later. This page is already force-dynamic.
  const lastUsed = await readSignInMethod();

  // The card below clips sideways but NOT vertically (overflow-x-hidden rather
  // than overflow-hidden): the decorative arrows still need clipping, while
  // sign-up mode is now tall enough to exceed a short laptop viewport, and
  // clipping vertically would strand the submit button off-screen unreachable.
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-muted px-6 py-8">
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
          {/* eslint-disable-next-line @next/next/no-img-element -- static public asset; next/image adds no value here. */}
          <img
            src="/img/logo.png"
            alt={t("brand.logoAlt")}
            className="h-8 w-8 shrink-0 object-contain"
          />
          <div className="flex flex-col leading-tight">
            <span className="font-display text-lg font-black tracking-tight text-foreground">
              Square Share
            </span>
            <span className="text-xs text-muted-foreground">{t("brand.tagline")}</span>
          </div>
        </div>

        {/* Auth card — hard corners, sits above the grid */}
        <div className="border border-border bg-background px-6 pt-8 pb-7 shadow-lg sm:px-8 sm:pt-9 sm:pb-8">
          {linkError && (
            <p
              role="alert"
              className="mb-4 border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
            >
              {linkError}
            </p>
          )}
          <LoginForm next={next} lastUsed={lastUsed} />
        </div>

        {/* Access note — creators onboard via the marketplace waitlist. */}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t.rich("login.noAccount", {
            link: (chunks) => (
              <a
                href={MARKETPLACE_URL}
                className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:decoration-foreground motion-reduce:transition-none"
              >
                {chunks}
              </a>
            ),
          })}
        </p>

        {/* The first screen a new seller sees, and signed out, so the account
            menu's language list is out of reach. Writes the cookie only; sign-in
            then saves the choice to the account. */}
        <div className="mt-4 flex items-center justify-center gap-2">
          <label htmlFor="login-language" className="font-inter text-xs text-muted-foreground">
            {tLocale("label")}
          </label>
          <LocaleSelect id="login-language" triggerClassName="h-8 w-40 text-xs" />
        </div>
      </div>
    </main>
  );
}
