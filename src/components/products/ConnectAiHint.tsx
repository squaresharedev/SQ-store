"use client";

import { useTranslations } from "next-intl";
import Link from "@/components/ui/AppLink";
import { inlineLinkClass } from "@/components/ui/control-styles";
import { CONNECTED_APPS_PATH } from "@/lib/agent/paths";

/** The one way to publish many drafts at once, said where there are many: an
 *  AI assistant connected in Settings publishes them in a single request. */
export function ConnectAiHint() {
  const t = useTranslations("Products.import");
  return t.rich("connectAiHint", {
    link: (chunks) => (
      <Link href={CONNECTED_APPS_PATH} className={inlineLinkClass}>
        {chunks}
      </Link>
    ),
  });
}
