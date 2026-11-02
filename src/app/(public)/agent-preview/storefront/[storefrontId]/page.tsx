import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewProbe } from "@/components/agent/PreviewProbe";
import { StorefrontPageView } from "@/components/storefront-page/StorefrontPageView";
import { agentPreviewEnabled } from "@/lib/agent/access";
import { contextForGrant } from "@/lib/agent/authenticate";
import { runAsAgent } from "@/lib/agent/context";
import { liveGrant } from "@/lib/agent/oauth/grants";
import { storefrontPreview } from "@/lib/agent/preview/storefront-preview";
import { verifyPreviewToken } from "@/lib/agent/preview/token";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // The address carries a token: it is not for passing on.
  referrer: "no-referrer",
};

type Params = { storefrontId: string };

/**
 * A storefront AS ITS OWNER'S ASSISTANT PREVIEWS IT, for the headless browser
 * that photographs it (lib/agent/preview/snapshot.ts). Drawn by the buyer's own
 * StorefrontPageView, so the picture is the real renderer.
 *
 * Opened with a two-minute token (lib/agent/preview/token.ts) naming a grant
 * and this storefront. The grant must still be live and able to read the store,
 * and the page then reads AS that grant, under row level security: it can show
 * nothing the assistant could not have read itself. Every refusal is the same
 * 404.
 */
export default async function AgentStorefrontPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!agentPreviewEnabled()) notFound();
  const { storefrontId } = await params;
  const raw = (await searchParams).t;
  const claims = await verifyPreviewToken(Array.isArray(raw) ? raw[0] : raw);
  if (!claims || claims.kind !== "storefront" || claims.id !== storefrontId) notFound();

  const grant = await liveGrant(claims.grantId);
  if (!grant || !grant.scopes.includes("store:read")) notFound();
  const context = await contextForGrant(grant);
  if (!context) notFound();
  const preview = await runAsAgent(context, () => storefrontPreview(storefrontId));
  if (!preview) notFound();

  return (
    <>
      <StorefrontPageView page={preview.page} />
      <PreviewProbe targets={preview.targets} />
    </>
  );
}
