import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { presignGetUrl } from "@/lib/r2";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { gatePurchasableLines } from "@/lib/products/purchasable";
import { PAGE_BUSY } from "@/lib/public/busy";
import { cartFor } from "@/lib/cart/availability";
import { storefrontPagePath } from "@/lib/storefront/product-page-url";
import { BuyerBusy } from "@/components/product-page/BuyerNotice";
import { PageShell } from "@/components/product-page/PageShell";
import { PoweredByFooter } from "@/components/product-page/PoweredByFooter";
import { resolveCta, resolveInk, ruleColor } from "@/components/product-page/product-page-maps";
import { StorefrontCart } from "@/components/cart/StorefrontCart";
import { CartPageBody } from "@/components/cart/CartPageBody";

/**
 * /s/[storefrontId]/cart: a storefront's cart as a page of its own. The
 * embedded shop links here (its frame grows with its content, so no panel can
 * open inside it), a checkout whose cart has a problem line sends the buyer
 * back here, and it is the cart for anyone without the panel.
 *
 * The page knows no cart id: the buyer's browser holds it (or a link from the
 * embedded shop carries it as `?cart=`, which the cart picks up and drops from
 * the address). Behind the storefront's own gate, and only where the
 * storefront has a cart at all; never indexed or cached (next.config.ts).
 */

type Params = { storefrontId: string };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ProductPage.cart");
  return { title: { absolute: t("title") }, robots: { index: false, follow: false } };
}

export default async function CartPage({ params }: { params: Promise<Params> }) {
  const { storefrontId } = await params;
  const gate = await gatePurchasableLines(storefrontId, [], {
    action: "storefront_page",
    budget: RATE_LIMITS.storefrontPage,
  });
  if (gate === PAGE_BUSY) return <BuyerBusy />;
  if (!gate) notFound();
  const { store } = gate;
  const cart = await cartFor(store);
  if (!cart) notFound();

  const { config, productPage, seller } = store;
  const theme = config.theme;
  const [backgroundImageUrl, customFontUrl] = await Promise.all([
    theme.background.kind === "image" ? presignGetUrl(theme.background.key) : Promise.resolve(null),
    theme.customFont ? presignGetUrl(theme.customFont.key) : Promise.resolve(null),
  ]);
  const ink = resolveInk(theme, productPage);
  const cartTheme = { ink, cornerRadius: theme.cornerRadius, cta: resolveCta(productPage, theme) };
  const shopHref = storefrontPagePath(store.storefront.id);
  const storeName = config.header?.show && config.header.name ? config.header.name : store.storefront.name;

  return (
    <main>
      <StorefrontCart storefrontId={store.storefront.id} cart={cart} theme={cartTheme}>
        <PageShell
          storefront={{
            name: store.storefront.name,
            ...(config.header ? { header: config.header } : {}),
            theme,
            backgroundImageUrl,
            customFontUrl,
          }}
          backgroundColor={productPage.backgroundColor}
          font={productPage.font}
          ink={ink}
          preview={false}
          shopHref={shopHref}
          rootAttributes={{ "data-cart-page-root": "" }}
          footer={
            <PoweredByFooter
              ruleColor={ruleColor(ink)}
              sellerName={seller.businessName || store.storefront.name}
              storefront={{ id: store.storefront.id, name: storeName }}
            />
          }
        >
          <CartPageBody theme={cartTheme} shopHref={shopHref} />
        </PageShell>
      </StorefrontCart>
    </main>
  );
}
