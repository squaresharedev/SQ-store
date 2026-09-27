import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";

/**
 * The frame of the sign-in steps that follow the sign-in form (the two-factor
 * challenge, approving a sign-in from a phone): the dotted ground, the two
 * faint arrows, the wordmark, and a hard-cornered card, like the sign-in card
 * they continue from.
 */
export async function AuthPageShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("Auth.brand");
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
            alt={t("logoAlt")}
            className="h-8 w-8 shrink-0 object-contain"
          />
          <div className="flex flex-col leading-tight">
            <span className="font-display text-lg font-black tracking-tight text-foreground">
              Square Share
            </span>
            <span className="text-xs text-muted-foreground">{t("tagline")}</span>
          </div>
        </div>

        <div className="border border-border bg-background px-6 pt-7 pb-6 shadow-lg sm:px-8 sm:pt-8 sm:pb-7">
          {children}
        </div>
      </div>
    </main>
  );
}
