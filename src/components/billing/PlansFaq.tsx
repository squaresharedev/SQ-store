"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cardClass, eyebrowClass } from "@/components/ui/surface-styles";
import { focusRingInsetClass, helpTextClass, transitionClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

/** The questions, in the order a seller about to pay tends to ask them. */
const FAQ = ["cancel", "downgrade", "vat", "fee", "switch"] as const;

/**
 * The questions that stand between a seller and the Upgrade button, answered
 * where they are asked. Native <details>, so every answer is in the page for
 * search and screen readers, and opening one needs no script.
 */
export function PlansFaq() {
  const t = useTranslations("Billing.faq");
  return (
    <section aria-labelledby="plans-faq-title" className={cn(cardClass, "p-6 sm:p-8")}>
      <p className={eyebrowClass}>{t("eyebrow")}</p>
      <h2 id="plans-faq-title" className="mt-1 text-xl font-semibold text-foreground">
        {t("title")}
      </h2>
      <div className="mt-4 divide-y divide-border">
        {FAQ.map((key) => (
          <details key={key} className="group" data-faq={key}>
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden",
                transitionClass,
                focusRingInsetClass,
              )}
            >
              {t(`items.${key}.q`)}
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-standard group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <p className={cn(helpTextClass, "pb-4")}>{t(`items.${key}.a`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
