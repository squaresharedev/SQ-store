import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { OrderStatusView } from "@/components/checkout/OrderStatusView";
import { getOrderPage } from "@/lib/orders/order-page";
import { PLACED_QUERY_PARAM, firstValue, type SearchParams } from "@/lib/storefront/product-page-url";

/**
 * /s/[storefrontId]/order/[orderRef]: a buyer's order page. The thank-you
 * straight after paying, and the order's status page every time after (the
 * confirmation email links here).
 *
 * `orderRef` is the order's credential (lib/orders/order-link.ts), checked in
 * getOrderPage after a rate-limit token is spent; anything that does not prove
 * an order of THIS storefront is the same not-found as a page that never
 * existed.
 *
 * Never indexed, never cached, and no referrer leaves it: the URL is a
 * credential, and a click on the seller's email address or a policy link must
 * not hand it to another origin.
 */

type Params = { storefrontId: string; orderRef: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { storefrontId, orderRef } = await params;
  const page = await getOrderPage(storefrontId, orderRef);
  const base: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
  if (!page) return base;
  const t = await getTranslations("ProductPage.order.metadata");
  const store = page.storefront.seller.businessName || page.storefront.name;
  return { ...base, title: { absolute: t("title", { store }) } };
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ storefrontId, orderRef }, query] = await Promise.all([params, searchParams]);
  const page = await getOrderPage(storefrontId, orderRef);
  if (!page) notFound();
  return (
    <main>
      <OrderStatusView page={page} mode="public" placed={firstValue(query[PLACED_QUERY_PARAM]) === "1"} />
    </main>
  );
}
