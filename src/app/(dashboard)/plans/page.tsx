import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlansPage } from "@/components/billing/PlansPage";
import { pageShellClass } from "@/components/ui/surface-styles";
import { requireUser } from "@/lib/auth/session";
import { getPricingContext } from "@/lib/billing/pricing-context";
import { PLANS_SOURCE_PARAM, parsePricingSource, PLANS_PATH } from "@/lib/billing/paths";

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
 * for a two-factor code first on an account that has 2FA; the layout's step-up
 * provider lets the code box appear right on the card that asked.
 */
export default async function PlansRoutePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout's session gate does not run again on a move between sections
  // (see ../layout.tsx, or ../../layout.tsx from a nested page): a page asks.
  await requireUser(PLANS_PATH);
  const source = parsePricingSource((await searchParams)[PLANS_SOURCE_PARAM]);
  const result = await getPricingContext(source);

  if (!result.ok) {
    const t = await getTranslations("Billing.page");
    return (
      <div className={pageShellClass}>
        <p className="font-inter text-sm text-destructive">{t("unavailable")}</p>
      </div>
    );
  }

  return <PlansPage context={result.context} source={source} />;
}
