import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listStorefrontProducts } from "@/lib/discounts/storefront-preview";
import { getStorefront } from "@/lib/storefront/queries";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getSellerIdentity, getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { storefrontPagePath } from "@/lib/storefront/product-page-url";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { presignGetUrl } from "@/lib/r2";
import { blockKey, type StorefrontConfig } from "@/types/storefront";

export async function generateMetadata() {
  const t = await getTranslations("Storefront.metadata");
  return { title: t("editor.title") };
}

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

/** Display URLs for the photos the hosted pages hold as their backdrop, by key. */
async function signPagePhotoUrls(keys: (string | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  const signed = await Promise.all(unique.map(async (key) => [key, await presignGetUrl(key)] as const));
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?setting=<id>` arrives from a universal-search result picked OUTSIDE the
   *  editor. Inside it, the designer intercepts its own links and never
   *  navigates, so this is only the cold-start path. */
  searchParams: Promise<{ setting?: string | string[] }>;
}) {
  const { id } = await params;
  const { setting } = await searchParams;
  const initialSetting = Array.isArray(setting) ? setting[0] : setting;

  const account = await getActiveAccount();
  if (!can(account?.role, "storefront.write")) redirect("/storefront");

  // Seller identity is the ACCOUNT's, not this storefront's: read-only here,
  // scoped to whichever account is active (the store being edited, which for
  // a team member is not necessarily their own). See
  // lib/settings/seller-identity.ts for why this is a service-role read.
  const [storefront, products, sellerIdentity, shippingPolicy, identity] = await Promise.all([
    getStorefront(id),
    // The catalogue as a storefront draws it: a running sale's price on the
    // tile, exactly as the published page shows it to buyers.
    listStorefrontProducts(),
    account ? getSellerIdentity(account.accountId) : Promise.resolve({}),
    account ? getShippingPolicy(account.accountId) : Promise.resolve({}),
    // Whether the publish gate would let this storefront's page answer.
    account ? getTraderIdentityStatus(account.accountId) : Promise.resolve(null),
  ]);
  if (!storefront) notFound();

  // Uploaded assets store only the R2 object key; sign their display URLs here
  // (server-only credentials) so the client never mints URLs itself.
  const { background, customFont } = storefront.config.theme;
  const { productPage, checkoutPage } = storefront.config;
  const [backgroundImageUrl, customFontUrl, elementUrls, pagePhotoUrls] = await Promise.all([
    background.kind === "image" ? presignGetUrl(background.key) : null,
    customFont ? presignGetUrl(customFont.key) : null,
    signElementUrls(storefront.config.blocks),
    signPagePhotoUrls([
      productPage?.backgroundImage?.key,
      checkoutPage?.backgroundImage?.key,
      checkoutPage?.thanksBackgroundImage?.key,
    ]),
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
      initialPagePhotoUrls={pagePhotoUrls}
      initialSetting={initialSetting ?? null}
      sellerIdentity={sellerIdentity}
      shippingPolicy={shippingPolicy}
      // The designer renders its own universal-search provider (it is outside
      // the dashboard shell), so it needs the role the shell would have given.
      role={account?.role ?? null}
      accountId={account?.accountId ?? null}
      takedown={storefront.removal ?? null}
      initialVersion={storefront.version ?? null}
      publicPagePath={
        // The same three conditions the public page itself asks.
        !storefront.removal && resolveProductPage(storefront.config).enabled && identity?.ok && identity.missing.length === 0
          ? storefrontPagePath(storefront.id)
          : null
      }
    />
  );
}
