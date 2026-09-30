import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { OrderLookupForm } from "@/components/checkout/OrderLookupForm";
import { resolveCheckoutTheme } from "@/components/checkout/checkout-theme";
import { PageShell } from "@/components/product-page/PageShell";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { presignGetUrl } from "@/lib/r2";
import { uuidField } from "@/lib/validation/inputs";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { resolveCheckoutPage } from "@/lib/storefront/checkout-page";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { EMPTY_SHIPPING_POLICY } from "@/types/shipping-policy";
import type { CheckoutStorefront } from "@/types/checkout";

/**
 * /s/[storefrontId]/orders: "Find your order". Where the shop's footer sends a
 * buyer who wants to withdraw from a purchase (or just see it) and no longer
 * has the confirmation email. The form emails them their order link; this page
 * shows no order and confirms no match (see the lookup route).
 *
 * Drawn in the checkout's own colours, like every page of a purchase. Deliberately
 * NOT behind the storefront's moderation state: a buyer's way back to an order
 * they paid for outlives a shop being paused.
 */

type Params = { storefrontId: string };

const idSchema = uuidField();

const getLookupStorefront = cache(async (storefrontId: string): Promise<CheckoutStorefront | null> => {
  if (!idSchema.safeParse(storefrontId).success) return null;
  const key = await clientKey(await headers());
  if (!(await rateLimitKey(key, "checkout_page", RATE_LIMITS.checkoutPage))) return null;
  const { data: row } = await createAdminClient()
    .from("storefronts")
    .select("id, name, owner_id, config")
    .eq("id", storefrontId)
    .maybeSingle();
  if (!row) return null;
  const config = parseStoredStorefrontConfig(row.config);
  if (!config) return null;
  const theme = config.theme;
  const [seller, backgroundImageUrl, customFontUrl] = await Promise.all([
    getSellerIdentity(row.owner_id),
    theme.background.kind === "image" ? presignGetUrl(theme.background.key) : Promise.resolve(null),
    theme.customFont ? presignGetUrl(theme.customFont.key) : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    name: row.name,
    theme,
    ...(config.header ? { header: config.header } : {}),
    productPage: resolveProductPage(config),
    checkoutPage: resolveCheckoutPage(config),
    shippingPolicy: EMPTY_SHIPPING_POLICY,
    seller,
    backgroundImageUrl,
    customFontUrl,
  };
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { storefrontId } = await params;
  const storefront = await getLookupStorefront(storefrontId);
  const base: Metadata = { robots: { index: false, follow: false } };
  if (!storefront) return base;
  const t = await getTranslations("ProductPage.order.lookup.metadata");
  return { ...base, title: { absolute: t("title", { store: storefront.seller.businessName || storefront.name }) } };
}

export default async function OrderLookupPage({ params }: { params: Promise<Params> }) {
  const { storefrontId } = await params;
  const storefront = await getLookupStorefront(storefrontId);
  if (!storefront) notFound();
  const theme = resolveCheckoutTheme(storefront);
  const t = await getTranslations("ProductPage.order.lookup");
  return (
    <main>
      <PageShell
        storefront={storefront}
        backgroundColor={theme.surface}
        font={storefront.productPage.font}
        ink={theme.ink}
        preview={false}
        rootAttributes={{ "data-order-lookup-page": "" }}
        footer={null}
      >
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12 @md:py-20">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold leading-tight">{t("title")}</h1>
            <p className="text-sm opacity-80">{t("body")}</p>
          </div>
          <OrderLookupForm
            storefrontId={storefront.id}
            ink={theme.ink}
            cornerRadius={theme.cornerRadius}
            cta={theme.cta}
          />
        </div>
      </PageShell>
    </main>
  );
}
