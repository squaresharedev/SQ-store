import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StepUpProvider } from "@/components/auth/StepUp";
import { PlansPage } from "@/components/billing/PlansPage";
import { pageShellClass } from "@/components/ui/surface-styles";
import { stepUpFreshUntil } from "@/lib/auth/assurance";
import { getAssurance } from "@/lib/auth/session";
import { getPricingContext } from "@/lib/billing/pricing-context";
import { PLANS_SOURCE_PARAM, parsePricingSource } from "@/lib/billing/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Billing.page");
  return { title: t("metaTitle") };
}

/**
 * /plans: every plan, for the ACTIVE store. PROTECTED by (dashboard)/layout.tsx.
 *
 * `?from=<source>` names the entry point that led here (the rail's chip, a
 * plan limit, an email), which is recorded once for the pricing funnel and
 * passed on to checkout. An unknown value is ignored, never stored.
 *
 * The switch and cancel buttons open the Stripe Customer Portal, which asks
 * for a two-factor code first on an account that has 2FA; the step-up
 * provider lets the code box appear right on the card that asked.
 */
export default async function PlansRoutePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const source = parsePricingSource((await searchParams)[PLANS_SOURCE_PARAM]);
  const [result, assurance] = await Promise.all([getPricingContext(source), getAssurance()]);

  if (!result.ok) {
    const t = await getTranslations("Billing.page");
    return (
      <div className={pageShellClass}>
        <p className="font-inter text-sm text-destructive">{t("unavailable")}</p>
      </div>
    );
  }

  return (
    <StepUpProvider
      enrolled={assurance?.enrolled ?? false}
      freshUntil={stepUpFreshUntil(assurance)}
      factors={(assurance?.factors ?? []).map(({ id, name, type }) => ({ id, name, type }))}
    >
      <PlansPage context={result.context} source={source} />
    </StepUpProvider>
  );
}
