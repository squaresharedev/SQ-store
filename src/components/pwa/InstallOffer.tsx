"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { chipButtonClass, overlayCloseButtonClass } from "@/components/ui/control-styles";
import { cardClass, iconTileClass } from "@/components/ui/surface-styles";
import { useIsTouch } from "@/lib/hooks/useIsTouch";
import { useStoredFlag } from "@/lib/hooks/useStoredFlag";

/** Per-device: the offer was answered (added, declined or closed), so it never
 *  comes back on this browser. */
export const INSTALL_OFFER_DISMISSED_KEY = "sq.pwa.install-dismissed";

/** Chromium's install offer, which the DOM typings do not name: held, then
 *  shown on a tap. */
type InstallPromptEvent = Event & { prompt: () => Promise<unknown> };

/**
 * Overview's one-time offer to put the app on the phone's home screen (the
 * manifest already makes it installable, with shortcuts: app/manifest.ts).
 *
 * Only where the browser says it can install it (`beforeinstallprompt`:
 * Chromium, and not installed yet) and on a touch screen, where "home screen"
 * is the right word. The browser's own small banner is held back in favour of
 * this one. Answered either way, it is remembered on this device.
 */
export function InstallOffer() {
  const t = useTranslations("Onboarding.install");
  const tActions = useTranslations("Common.actions");
  const isTouch = useIsTouch();
  const [dismissed, setDismissed] = useStoredFlag(INSTALL_OFFER_DISMISSED_KEY);
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const hold = (event: Event) => {
      event.preventDefault();
      setOffer(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", hold);
    return () => window.removeEventListener("beforeinstallprompt", hold);
  }, []);

  if (!offer || dismissed || !isTouch) return null;

  // The browser's own question follows; asked once, whatever the answer.
  const install = async () => {
    await offer.prompt();
    setDismissed(true);
  };

  return (
    <div className={cn(cardClass, "flex items-center gap-3 p-4")}>
      <span className={cn(iconTileClass, "size-9")}>
        <Smartphone className="size-4" strokeWidth={2} aria-hidden="true" />
      </span>
      <p className="min-w-0 flex-1 font-inter text-sm font-medium text-foreground">{t("title")}</p>
      <button type="button" onClick={install} className={chipButtonClass}>
        {t("add")}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={tActions("close")}
        className={overlayCloseButtonClass}
      >
        <X className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
