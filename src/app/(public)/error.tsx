"use client";

import { useEffect } from "react";
import { unstable_isUnrecognizedActionError as isOutdatedPage } from "next/navigation";
import { useTranslations } from "next-intl";
import { BuyerNotice } from "@/components/product-page/BuyerNotice";

/**
 * The error boundary for the buyer's pages. Without it a crash on a product,
 * checkout or order page reached the app's root boundary, which tells the
 * reader their account is fine and they are still signed in: true of a
 * seller, nonsense to a buyer.
 *
 * Message-agnostic, like the root one: Next.js redacts server-error messages
 * in production, so the copy has to be right without knowing what failed. It
 * is the same "could not load this just now" a loader shows when it knows the
 * failure is temporary (lib/public/busy.ts).
 */
export default function BuyerErrorBoundary({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  // `unstable_retry` re-fetches before re-rendering, which is what a failed
  // server read needs; `reset` is the fallback (see app/error.tsx).
  unstable_retry?: () => void;
  reset: () => void;
}) {
  const t = useTranslations("ProductPage.unavailable");
  const tOutdated = useTranslations("ErrorPage.outdated");
  const tCommon = useTranslations("Common.actions");
  useEffect(() => {
    console.error("[buyer error boundary]", error);
  }, [error]);

  // A page left open across a deploy: only the new build can act on what was
  // asked, so this one is a reload, not a retry (see app/error.tsx).
  // Asked of `unknown`: the guard's type is structurally any Error, so asked of
  // `error` itself it would narrow every other error below to `never`.
  if (isOutdatedPage(error as unknown)) {
    return (
      <BuyerNotice
        title={tOutdated("title")}
        body={tOutdated("description")}
        actionLabel={tOutdated("cta")}
        onAction={() => window.location.reload()}
      />
    );
  }

  return (
    <BuyerNotice
      title={t("title")}
      body={t("body")}
      actionLabel={tCommon("tryAgain")}
      onAction={() => (unstable_retry ?? reset)()}
    />
  );
}
