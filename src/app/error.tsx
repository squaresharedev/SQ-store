"use client";

import { useEffect } from "react";
import { unstable_isUnrecognizedActionError as isOutdatedPage } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorScreen } from "@/components/error/ErrorScreen";
import { Button } from "@/components/ui/button";

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
 *
 * ONE ERROR IS RECOGNISED, because "try again" cannot fix it. A Server Action
 * is addressed by an id the build generates, so a tab left open across a
 * deploy holds ids the new server has never heard of: its next save throws
 * here, and retrying replays the same dead id for as long as the tab lives.
 * Only loading the new build helps, so that case is offered a reload and told
 * why. It happens to every open tab after every deploy.
 */
export default function ErrorBoundary({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  // Next 16.2 supersedes `reset` with `unstable_retry`, which re-FETCHES before
  // re-rendering. That matters here: the errors this boundary catches are
  // usually a failed server-side call, which a plain state reset would replay
  // straight back into. `reset` stays as the fallback until the API settles.
  unstable_retry?: () => void;
  reset: () => void;
}) {
  const t = useTranslations("ErrorPage.boundary");
  const tOutdated = useTranslations("ErrorPage.outdated");
  const tCommon = useTranslations("Common.actions");
  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  // Asked of `unknown`: the guard's type is structurally any Error, so asked of
  // `error` itself it would narrow every other error below to `never`.
  if (isOutdatedPage(error as unknown)) {
    return (
      <ErrorScreen
        code="409"
        readout="err_page_outdated"
        title={tOutdated("title")}
        description={tOutdated("description")}
        action={
          <Button
            onClick={() => window.location.reload()}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {tOutdated("cta")}
          </Button>
        }
      />
    );
  }

  return (
    <ErrorScreen
      code="500"
      readout="err_internal"
      title={t("title")}
      description={t("description")}
      action={
        /* Inverted for the same reason as the 404's CTA: see not-found.tsx. */
        <Button
          onClick={() => (unstable_retry ?? reset)()}
          className="bg-foreground text-background hover:bg-foreground/90"
        >
          {tCommon("tryAgain")}
        </Button>
      }
      note={
        error.digest ? (
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            {t("reference", { digest: error.digest })}
          </p>
        ) : null
      }
    />
  );
}
