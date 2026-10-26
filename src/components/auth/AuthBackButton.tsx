"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { OVERVIEW_PATH } from "@/lib/dashboard/paths";
import { usePendingRouter } from "@/lib/hooks/usePendingRouter";

/** True when the page before this one is another page of this app. */
function cameFromHere(): boolean {
  try {
    return !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * The way out of a dead end (an expired or answered sign-in request): back to
 * the page the person was on, or to the dashboard when they arrived from
 * outside the app (a camera scanning the QR code, a mail link), where there is
 * no "before" to return to.
 */
export function AuthBackButton() {
  const t = useTranslations("Common.actions");
  const router = usePendingRouter();
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      data-auth-back
      pending={router.pending}
      onClick={() => (cameFromHere() ? router.back() : router.push(OVERVIEW_PATH))}
    >
      <ArrowLeft aria-hidden className="size-4" />
      {t("back")}
    </Button>
  );
}
