import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { listAllProducts } from "@/lib/products/queries";
import { getStorefront } from "@/lib/storefront/queries";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { presignGetUrl } from "@/lib/r2";
import { blockKey, type StorefrontConfig } from "@/types/storefront";

export const metadata: Metadata = {
  title: "Edit storefront",
};

/**
 * Display URLs for every uploaded element on the canvas, keyed by blockKey.
 *
 * Signing is pure HMAC with no network call (see presignGetUrl), so doing all
 * of them costs microseconds even on a full board, and the signatures are
 * anchored to the top of the clock hour — so the same block yields the same
 * URL across renders and the browser can actually cache the artwork.
 */
async function signElementUrls(
  blocks: StorefrontConfig["blocks"],
): Promise<Record<string, string>> {
  const images = blocks.filter((block) => block.type === "image");
  const signed = await Promise.all(
    images.map(async (block) => [blockKey(block), await presignGetUrl(block.key)] as const),
  );
  return Object.fromEntries(
    signed.filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
}

// Full-screen editor: NO sidebar (storefront/layout.tsx renders no chrome), so
// the designer gets the whole viewport width. Auth is enforced by the layout;
// RLS scopes the read, and an unknown/other-owner id 404s.
//
// The editor is a write surface with no room for the shell's read-only banner,
// so read-only members of the active store are bounced to the list (where they
// can still view every storefront) rather than dropped into an edit UI whose
// save the server would reject.
export default async function StorefrontEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const account = await getActiveAccount();
  if (!can(account?.role, "storefront.write")) redirect("/storefront");

  const [storefront, products] = await Promise.all([
    getStorefront(id),
    listAllProducts(),
  ]);
  if (!storefront) notFound();

  // Uploaded assets store only the R2 object key; sign their display URLs here
  // (server-only credentials) so the client never mints URLs itself.
  const { background, customFont } = storefront.config.theme;
  const [backgroundImageUrl, customFontUrl, elementUrls] = await Promise.all([
    background.kind === "image" ? presignGetUrl(background.key) : null,
    customFont ? presignGetUrl(customFont.key) : null,
    signElementUrls(storefront.config.blocks),
  ]);

  return (
    <StorefrontDesigner
      storefrontId={storefront.id}
      initialName={storefront.name}
      initialConfig={storefront.config}
      products={products}
      initialBackgroundImageUrl={backgroundImageUrl}
      initialCustomFontUrl={customFontUrl}
      initialElementUrls={elementUrls}
      // The designer renders its own universal-search provider (it is outside
      // the dashboard shell), so it needs the role the shell would have given.
      role={account?.role ?? null}
      accountId={account?.accountId ?? null}
    />
  );
}
