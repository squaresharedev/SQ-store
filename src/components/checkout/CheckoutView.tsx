import { Lock, ShieldCheck, Store, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { isEuSeller } from "@/lib/storefront/product-page";
import { resolveProductShipping, resolveReturns } from "@/lib/storefront/shipping";
import type { ProseResolver } from "@/lib/shipping/policy-prose";
import { shippingCountries } from "@/lib/shipping/rates";
import { regionName } from "@/lib/format/country";
import { SHIPPING_COUNTRY_CODES } from "@/lib/settings/constants";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { orderLookupPath } from "@/lib/storefront/product-page-url";
import {
  photoForSelection,
  previewSelection,
  selectionChips,
  selectionIds,
  strictSelection,
} from "@/lib/checkout/selection";
import type { CheckoutProviderId } from "@/lib/checkout/availability";
import { PageShell } from "@/components/product-page/PageShell";
import { PoweredByFooter } from "@/components/product-page/PoweredByFooter";
import { QuantityProvider } from "@/components/product-page/QuantityContext";
import { SellerBlock } from "@/components/product-page/SellerBlock";
import { StatutoryNotes } from "@/components/product-page/StatutoryNotes";
import { TrustList, buildTrustLines } from "@/components/product-page/TrustList";
import type { CheckoutPageData } from "@/types/checkout";
import { CHECKOUT_NOTE_MAX } from "@/types/storefront";
import { CheckoutForm } from "./CheckoutForm";
import { Disclosure } from "./Disclosure";
import { PaymentSlot } from "./PaymentSlot";
import { CheckoutShowcase, CheckoutSummaryCard, MakerNote, type CheckoutItem } from "./CheckoutShowcase";
import { resolveCheckoutTheme } from "./checkout-theme";

const NO_OPTIONS: readonly string[] = [];

/**
 * The hosted checkout, as a buyer sees it and as the editor previews it.
 *
 * Server-compatible and prop-driven, like ProductPageView: the public route
 * renders it for a buyer (mode "public") and the editor's checkout artboard
 * renders it from the seller's live edits (mode "preview"). The only client
 * part is the form, which holds what the buyer types and the running total.
 *
 * WHAT THE SELLER'S DESIGN DECIDES here is the arrangement (showcase or
 * compact), the surface colour, the headline and the maker's note. What it
 * does NOT decide is everything a buyer relies on: the fields, the payment,
 * the full total, who they are buying from and the pay button's wording. Those
 * render the same for every seller, in that seller's colours.
 *
 * EVERY seller string is a React text node.
 */
export function CheckoutView({
  page,
  mode,
  optionIds = NO_OPTIONS,
  initialQuantity = 1,
  attemptId = null,
  provider = null,
  unwired = false,
  initialCountry,
}: {
  page: CheckoutPageData;
  mode: "public" | "preview";
  /** The version, already checked strictly against the product by the route. */
  optionIds?: readonly string[];
  initialQuantity?: number;
  /** Minted by the route for this render; absent in the editor. */
  attemptId?: string | null;
  /** Who takes the money; null in the editor. */
  provider?: CheckoutProviderId | null;
  /** Editor only: whether buyers cannot reach this checkout yet. */
  unwired?: boolean;
  /** A country to start the delivery picker on (the buyer's, when known). */
  initialCountry?: string | null;
}) {
  const { storefront, product } = page;
  const { productPage, checkoutPage, shippingPolicy, seller } = storefront;
  const preview = mode === "preview";
  const t = useTranslations("ProductPage.checkout");
  const tPage = useTranslations("ProductPage");
  const tAll = useTranslations();
  const locale = useLocale();
  const theme = resolveCheckoutTheme(storefront);

  // THE VERSION. The route has already refused anything but an exact, available
  // choice; the editor has none, so it previews the first available one.
  const groups = product.optionGroups;
  const selection = (!preview && strictSelection(groups, optionIds)) || previewSelection(groups);
  const item: CheckoutItem = {
    title: product.title,
    photo: photoForSelection(product.images, selection),
    chips: selectionChips(groups, selection),
    priceCents: product.priceCents,
    currency: product.currency,
    imageFit: productPage.imageFit,
  };

  const resolveProse: ProseResolver = (ref) => tAll(ref.key, ref.values);
  const shipping = product.isDigital
    ? null
    : resolveProductShipping(product.shippingProfileId, shippingPolicy, resolveProse, locale);
  const isEu = isEuSeller(seller);
  // The EU line is left to the legal rows below, where it opens onto the
  // statutory text itself; beside the pay button it would say it twice.
  const trust = buildTrustLines({
    shipping,
    returnsText: resolveReturns(shippingPolicy, resolveProse, locale),
    isDigital: product.isDigital,
    isEu: false,
    copy: { digitalDelivery: tPage("trust.digitalDelivery"), euRights: tPage("trust.euRights") },
  });
  // "incl. VAT" only where it is true, by the product page's own rule: an EU
  // seller who is VAT registered and has chosen to say so.
  const vatIncluded = Boolean(seller.vatId) && isEu && productPage.priceNote === "incl-vat";

  // WHERE THIS SELLER DELIVERS, named in the buyer's language. A catch-all row
  // ("everywhere else") offers the platform's shipping list on top of the
  // countries the seller named.
  const reach = shippingCountries(shippingPolicy);
  const codes = [...new Set([...reach.codes, ...(reach.anywhere ? SHIPPING_COUNTRY_CODES : [])])];
  const countries = codes
    .map((code) => ({ code, name: regionName(code, locale) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const startCountry =
    [initialCountry, shippingPolicy.shipsFrom].find(
      (code): code is string => Boolean(code) && codes.includes(code!.toUpperCase()),
    )?.toUpperCase() ??
    countries[0]?.code ??
    "";

  const sellerName = seller.businessName || storefront.name;
  const sellerCountry = regionName(seller.country, locale);
  const storeName =
    storefront.header?.show && storefront.header.name ? storefront.header.name : storefront.name;

  const note = (
    <MakerNote
      field="note"
      maxLength={CHECKOUT_NOTE_MAX}
      note={checkoutPage.note}
      signature={sellerName}
      ink={checkoutPage.layout === "showcase" ? theme.panelInk : theme.ink}
      radius={theme.controlRadius}
      preview={preview}
    />
  );

  // WHO THE BUYER IS CONTRACTING WITH, what the law gives them, and who sees
  // their details. Never a hotspot and never optional: the seller designs the
  // page around this, not this.
  //
  // THREE LINES, EACH ONE TAP FROM ITS FULL TEXT. What must be in plain sight
  // stays in plain sight: who the trader is and where (CRD art. 6(1)(b)-(c)),
  // and the gist of the buyer's rights. The statutory wording and the privacy
  // notice are LAYERED behind their line (the layered notice the EDPB's
  // transparency guidelines endorse), and stay in the page, so find-in-page
  // and a screen reader still reach them. The consent box a download needs is
  // not in here: CheckoutForm keeps it open beside the button.
  const legal = (
    <div className="flex flex-col gap-2.5 text-xs" data-checkout-legal="">
      <Disclosure
        icon={Store}
        attributes={{ "data-checkout-legal-row": "seller" }}
        summary={
          <>
            <span className="font-medium">
              {sellerCountry
                ? t("legal.soldByIn", { seller: sellerName, country: sellerCountry })
                : tPage("soldBy", { seller: sellerName })}
            </span>
            <span className="opacity-60"> · </span>
            <span className="underline underline-offset-2 opacity-80">{t("legal.sellerDetails")}</span>
          </>
        }
      >
        <SellerBlock seller={seller} fallbackName={storefront.name} />
      </Disclosure>
      {isEu && (
        <Disclosure
          icon={ShieldCheck}
          attributes={{ "data-checkout-legal-row": "rights" }}
          summary={<span className="opacity-80">{tPage("trust.euRights")}</span>}
        >
          <StatutoryNotes isDigital={product.isDigital} />
        </Disclosure>
      )}
      <Disclosure
        icon={UserRound}
        attributes={{ "data-checkout-legal-row": "privacy" }}
        summary={<span className="opacity-80">{t("legal.privacySummary", { seller: sellerName })}</span>}
      >
        <p className="opacity-70">
          {t("legal.privacy", { seller: sellerName })}{" "}
          <a
            href={LEGAL_LINKS.privacy.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
            data-setting-skip=""
          >
            {t("legal.privacyLink")}
          </a>
        </p>
      </Disclosure>
    </div>
  );

  const form = (
    <CheckoutForm
      preview={preview}
      unwired={unwired}
      storefrontId={storefront.id}
      productId={product.id}
      optionIds={selectionIds(groups, selection)}
      attemptId={attemptId}
      headline={checkoutPage.headline}
      defaultHeadline={t("headline")}
      product={{
        priceCents: product.priceCents,
        currency: product.currency,
        isDigital: product.isDigital,
        digitalFormat: product.digitalFormat,
        shippingProfileId: product.shippingProfileId,
      }}
      shippingPolicy={shippingPolicy}
      countries={countries}
      initialCountry={startCountry}
      giftMessage={checkoutPage.giftMessage}
      vatIncluded={vatIncluded}
      sellerName={sellerName}
      surface={theme.surface}
      ink={theme.ink}
      rule={theme.rule}
      cornerRadius={theme.cornerRadius}
      cta={theme.cta}
      payment={<PaymentSlot provider={provider} ink={theme.ink} radius={theme.controlRadius} />}
      legal={legal}
      trust={<TrustList lines={trust} ruleColor={theme.rule} layout="badges" />}
    />
  );

  return (
    <QuantityProvider limit={product.maxQuantity} initialQuantity={initialQuantity} syncUrl={!preview}>
      <PageShell
        storefront={storefront}
        backgroundColor={theme.surface}
        surfaceLayers={theme.surfaceTexture}
        font={productPage.font}
        ink={theme.ink}
        preview={preview}
        padForStickyBar
        rootAttributes={{
          "data-checkout-page": mode,
          "data-checkout-layout": checkoutPage.layout,
          "data-checkout-texture": checkoutPage.texture ?? "none",
          "data-page-background": checkoutPage.backgroundColor ?? productPage.backgroundColor ?? "storefront",
          "data-page-ink": theme.ink,
        }}
        headerAside={
          <span className="flex shrink-0 items-center gap-1.5 text-xs opacity-70" data-checkout-secure="">
            <Lock className="size-3.5" strokeWidth={2} aria-hidden="true" />
            {t("secure")}
          </span>
        }
        footer={
          <PoweredByFooter
            ruleColor={theme.rule}
            sellerName={sellerName}
            product={{ id: product.id, title: product.title }}
            storefront={{ id: storefront.id, name: storeName }}
            reportScopes={page.reportScopes}
            preview={preview}
            withdrawHref={orderLookupPath(storefront.id)}
          />
        }
      >
        <div className="mx-auto w-full max-w-[76rem] px-4 py-8 @md:px-6 @3xl:px-10 @3xl:py-12">
          {checkoutPage.layout === "showcase" ? (
            <div className="grid items-start gap-8 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @3xl:gap-14">
              <CheckoutShowcase item={item} note={note} theme={theme} />
              {form}
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
              <CheckoutSummaryCard item={item} theme={theme} />
              {note}
              {form}
            </div>
          )}
        </div>
      </PageShell>
    </QuantityProvider>
  );
}
