"use client";

import { useTranslations } from "next-intl";
import { quietLinkClass } from "@/components/ui/control-styles";
import { startTour } from "@/lib/onboarding/tour-store";

/**
 * Overview's quiet way into the guided tour once the setup checklist, which
 * offers it while setup is under way, is gone: a seller who skipped the tour,
 * or wants it again, finds it on the page they land on, not only in Settings.
 */
export function TourLink() {
  const t = useTranslations("Onboarding.checklist");
  return (
    <div className="flex justify-center">
      <button type="button" onClick={() => startTour()} className={quietLinkClass}>
        {t("showMeAround")}
      </button>
    </div>
  );
}
