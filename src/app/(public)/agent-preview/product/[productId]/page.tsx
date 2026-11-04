import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewProbe } from "@/components/agent/PreviewProbe";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { agentPreviewEnabled } from "@/lib/agent/access";
import { contextForGrant } from "@/lib/agent/authenticate";
import { runAsAgent } from "@/lib/agent/context";
import { liveGrant } from "@/lib/agent/oauth/grants";
import { productPagePreview } from "@/lib/agent/preview/product-page-preview";
import { verifyPreviewToken } from "@/lib/agent/preview/token";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // The address carries a token: it is not for passing on.
  referrer: "no-referrer",
};

type Params = { productId: string };

/** No tile to measure on a product's page: the probe only says when it is drawn. */
const NO_TARGETS: never[] = [];

/**
 * A product's page AS ITS OWNER'S ASSISTANT PREVIEWS IT, drafts included, in
 * one storefront's look (`s`). The storefront preview's twin
 * (agent-preview/storefront): the same token, the same live-grant check, read
 * as that grant under row level security, drawn by the buyer's own
 * ProductPageView exactly as the public route draws it. Nothing here records a
 * view (that is the public route's, not the renderer's). Every refusal is the
 * same 404.
 */
export default async function AgentProductPagePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!agentPreviewEnabled()) notFound();
  const { productId } = await params;
  const query = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const claims = await verifyPreviewToken(first(query.t));
  if (!claims || claims.kind !== "product" || claims.id !== productId) notFound();
  const storefrontId = first(query.s);
  if (!storefrontId) notFound();

  const grant = await liveGrant(claims.grantId);
  if (!grant || !grant.scopes.includes("store:read")) notFound();
  const context = await contextForGrant(grant);
  if (!context) notFound();
  const preview = await runAsAgent(context, () => productPagePreview(productId, storefrontId));
  if (!preview || preview === "no_storefront") notFound();

  return (
    <>
      <main>
        <ProductPageView page={preview.page} mode="public" reviews={preview.reviews} />
      </main>
      <PreviewProbe targets={NO_TARGETS} />
    </>
  );
}
