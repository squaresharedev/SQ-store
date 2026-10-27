import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { isEuSeller, isProductPageSectionShown, MANDATORY_PRODUCT_PAGE_SECTION_IDS } from "@/lib/storefront/product-page";
import type { ProseResolver } from "@/lib/shipping/policy-prose";
import { resolveProductShipping, resolveReturns } from "@/lib/storefront/shipping";
import { deliveryPriceRange } from "@/lib/shipping/rates";
import { formatCents, toCurrency } from "@/lib/format/money";
import type { Locale } from "@/i18n/locales";
import { SECTION_SETTING } from "@/lib/storefront/setting-ref";
import type { ProductPageData } from "@/types/product-page";
import type { ProductReviews } from "@/types/review";
import { isOnPhoto } from "@/lib/validation/product";
import type { ProductPageSectionId } from "@/types/storefront";
import { resolveCtaTarget } from "./cta-target";
import { DocumentsList } from "./DocumentsList";
import { BadgeDropZone } from "./BadgeDrag";
import { PhotoBadges, ProductBadges } from "./ProductBadges";
import { ProductCta } from "./ProductCta";
import { ProductDescription } from "./ProductDescription";
import { ProductGallery } from "./ProductGallery";
import { ProductPrice } from "./ProductPrice";
import { ReviewsLink } from "./ReviewsLink";
import { ReviewsSection } from "./ReviewsSection";
import { PoweredByFooter } from "./PoweredByFooter";
import { SellerBlock, hasSellerDetails } from "./SellerBlock";
import { SpecsSection } from "./SpecsSection";
import { hasSpecs } from "./SpecsTable";
import { StatutoryNotes } from "./StatutoryNotes";
import { StockLine } from "./StockLine";
import { OptionProvider } from "./OptionContext";
import { OptionPicker } from "./OptionPicker";
import { QuantityProvider } from "./QuantityContext";
import { QuantityPicker } from "./QuantityPicker";
import { PageShell } from "./PageShell";
import { orderLookupPath, storefrontPagePath, type LinkChannel } from "@/lib/storefront/product-page-url";
import { StickyBar } from "./StickyBar";
import { TrustList, buildTrustLines } from "./TrustList";
import {
  DARK_INK,
  controlRadius,
  paragraphs,
  resolveCta,
  resolveInk,
  storefrontBackdropHex,
  ruleColor,
  surfaceRadius,
} from "./product-page-maps";

/**
 * The product page, as a buyer sees it and as the editor previews it.
 *
 * Server-compatible and prop-driven: the same component renders on the public
 * route (mode "public") and inside the editor's client tree (mode "preview").
 * The only client state is the chosen version, held in OptionProvider so the
 * gallery, the picker and the button can share it while everything else stays
 * static markup.
 *
 * EVERY seller string is a React text node. Descriptions and policies are
 * split into paragraphs and nothing else; there is no markup path here.
 */
const NO_OPTIONS: readonly string[] = [];

export function ProductPageView({
  page,
  mode,
  initialOptionIds = NO_OPTIONS,
  initialQuantity = 1,
  via = null,
  reviews = null,
}: {
  page: ProductPageData;
  mode: "public" | "preview";
  /** How the buyer arrived (`?via=`), already allowlisted. Handed on to the
   *  checkout link so the order is filed where the visit was. */
  via?: LinkChannel | null;
  /** Preselected options from the URL, already checked against the product. */
  initialOptionIds?: readonly string[];
  /** From `?q=`, already clamped against this product's own limit by the
   *  server. The provider re-clamps anyway; neither is what authorizes a sale. */
  initialQuantity?: number;
  /** The product's reviews (lib/reviews/queries.ts on the public page; the
   *  editor's preview reads the same through the reviews API). Null while
   *  unknown or unreadable, which leaves the section out rather than showing
   *  an empty state that might not be true. */
  reviews?: ProductReviews | null;
}) {
  const { storefront, product } = page;
  const { theme, productPage, shippingPolicy, seller } = storefront;
  const preview = mode === "preview";
  const t = useTranslations("ProductPage");
  const tAll = useTranslations();
  const locale = useLocale();

  // The generated shipping and returns paragraphs, in the BUYER's language.
  // Seller-typed terms (an override, a profile's body) come out untouched.
  const resolveProse: ProseResolver = (ref) => tAll(ref.key, ref.values);

  // WHICH SHIPPING TERMS THIS PRODUCT IS SOLD UNDER. Almost always the
  // account's default; a product that names one of the account's shipping
  // profiles gets that instead. Resolved once here and used in both places the
  // page talks about shipping — the line beside the button and the section
  // below — so the two can never quote different terms.
  const shipping = product.isDigital
    ? null
    : resolveProductShipping(product.shippingProfileId, shippingPolicy, resolveProse, locale);
  // Returns do not vary by product, so this is the account's answer, full
  // stop. Generated from the structured settings (or the seller's own words,
  // which the generator prefers) rather than read from a stored paragraph.
  const returnsText = resolveReturns(shippingPolicy, resolveProse, locale);

  // BUY-02: Derive the price and shipping notes from the seller's actual facts
  // rather than blindly forwarding the stored config defaults.
  //
  // `incl. VAT` is only truthful for a VAT-registered EU seller; a sole trader
  // below the registration threshold, or any seller outside the EU, must not
  // claim their price is inclusive of VAT they do not collect.
  //
  // `plus shipping` is only meaningful for a physical product whose seller has
  // configured shipping terms. A digital download is not shipped (ProductPrice
  // already suppresses the shipping note for isDigital, but the effective note
  // should be "none" at the source so the logic is not split across two files).
  // A physical product with no terms configured has nothing to say about
  // shipping cost, so we suppress it rather than printing a note that may be
  // wrong.
  const effectivePriceNote = seller.vatId && isEuSeller(seller) ? productPage.priceNote : "none" as const;
  // WHAT DELIVERY COSTS, where checkout will charge it: the number itself
  // rather than "plus shipping", so the total is no surprise on the next page
  // (EU CRD art. 6(1)(e)). Only where this product can be bought through
  // checkout; anywhere else nobody here charges for delivery, and the seller's
  // own note stands.
  const delivery =
    storefront.checkout && !product.isDigital
      ? deliveryPriceRange(shippingPolicy, {
          profileId: product.shippingProfileId,
          subtotalCents: product.priceCents,
          currency: toCurrency(product.currency),
        })
      : null;
  const deliveryLine = !delivery
    ? null
    : delivery.fromCents === 0 && delivery.uniform
      ? t("delivery.free")
      : t(delivery.uniform ? "delivery.flat" : "delivery.from", {
          amount: formatCents(delivery.fromCents, product.currency, locale as Locale),
        });
  const effectiveShippingNote =
    !product.isDigital && shipping !== null && !deliveryLine ? productPage.shippingNote : ("none" as const);

  // The seller's badges, split by where they asked for each: under the
  // title, or on the photo.
  const badges = product.details.badges ?? [];
  const besideBadges = badges.filter((badge) => !isOnPhoto(badge));
  const photoBadges = badges.filter(isOnPhoto);
  // In the editor each of the two places is also where a dragged badge can
  // land (BadgeDrag); a buyer's page draws the badges and nothing else.
  const movable = (kind: "photo" | "beside", node: ReactNode) =>
    preview ? <BadgeDropZone kind={kind}>{node || null}</BadgeDropZone> : node;

  const ink = resolveInk(theme, productPage);
  // The buy button's fill, roundness and outline, resolved ONCE for both the
  // button in the buy box and the one in the sticky bar below it.
  const cta = resolveCta(productPage, theme);
  const rule = ruleColor(ink);
  const radius = surfaceRadius(theme.cornerRadius);
  const isEu = isEuSeller(seller);
  const storeName = storefront.header?.show && storefront.header.name ? storefront.header.name : storefront.name;
  const soldBy = seller.businessName || storefront.name;
  const target = resolveCtaTarget(
    product.purchaseUrl,
    seller.email,
    product.title,
    t("cta.mailSubject", { title: product.title }),
    storefront.checkout ? { storefrontId: storefront.id, productId: product.id, via } : null,
  );
  // The editor always shows the button, even with nowhere to send it, so the
  // seller can see the page's one action and be told how to wire it up.
  const hasCta = target.kind !== "none" || preview;

  // The facts a buyer looks for beside the button, from the seller's own terms
  // (see buildTrustLines, which the checkout shares).
  const trust = buildTrustLines({
    shipping,
    returnsText,
    isDigital: product.isDigital,
    isEu,
    copy: { digitalDelivery: t("trust.digitalDelivery"), euRights: t("trust.euRights") },
  });

  // THE DESCRIPTION READS UNDER THE TITLE, always: with the title and the
  // price, beside the photos, where a buyer looks for it. The fold below is
  // left to the reference material a buyer consults rather than reads. Its
  // section switch still decides whether it appears at all, and because it is
  // dropped from the section list it can never be printed twice.
  const descriptionShown =
    productPage.sections.find((entry) => entry.id === "description")?.show ?? false;
  const descriptionInInfo = descriptionShown && product.description.trim() !== "";

  // WHO IS SELLING IS NEVER BEHIND A DISCLOSURE. It is the one block on the
  // page a buyer must be able to read without asking for it — the trader
  // identity distance-selling law puts next to the offer — and a shut
  // <details> is exactly asking for it. So it leaves the accordion and stands
  // open at the foot of the page. Its switch in the Sections panel cannot
  // turn it off (see MANDATORY_PRODUCT_PAGE_SECTION_IDS); this reads only
  // whether there is anything to disclose, never the stored show flag, so a
  // stale or hand-built config gets no more say over it than the panel does.
  const sellerShown = hasSellerDetails(seller) || productPage.showSeller;

  // REVIEWS ARE THE SELLER'S CALL, and open at the foot of the page rather
  // than folded into "More details" (see ReviewsSection). Shown with no
  // reviews yet too: the seller chose to show them, and the section says how
  // the first one gets written.
  // Normalised here, not trusted: the editor hands over its stored config,
  // which may predate the switch and so not name it (it then reads as on).
  const reviewsShown = isProductPageSectionShown(productPage, "reviews");
  // The rating under the title, for a product with reviews to go to.
  const average = reviewsShown ? reviews?.summary.average : null;
  const reviewCount = reviews?.summary.count ?? 0;

  // Which sections have anything to say, in the seller's order. `safety` is
  // also mandatory (GPSR), so it is let through here whatever its stored show
  // flag says; its own case below is what decides whether there is anything
  // to actually disclose (no data yet, or a digital product GPSR does not
  // reach, both print nothing, same as always).
  const sections = productPage.sections
    .filter((entry) => entry.show || MANDATORY_PRODUCT_PAGE_SECTION_IDS.includes(entry.id))
    .filter((entry) => entry.id !== "description" && entry.id !== "seller" && entry.id !== "reviews")
    .map((entry) => ({ id: entry.id, body: sectionBody(entry.id) }))
    .filter((entry): entry is { id: ProductPageSectionId; body: ReactNode } => entry.body !== null);

  function sectionBody(id: ProductPageSectionId): ReactNode | null {
    switch (id) {
      // Filtered out above: the description reads under the title, never down
      // here. The id stays in the section list because its switch is what
      // shows and hides the description.
      case "description":
        return null;
      // Filtered out above too, and for a stronger reason: it is printed open
      // at the foot of the page (see `sellerShown`).
      case "seller":
        return null;
      // And this one: it stands open below the accordion (see `reviewsShown`).
      case "reviews":
        return null;
      case "specs":
        return hasSpecs(product.details, product.optionGroups) ? (
          <SpecsSection details={product.details} ruleColor={rule} />
        ) : null;
      case "documents":
        return product.documents.length > 0 ? (
          <DocumentsList documents={product.documents} ruleColor={rule} />
        ) : null;
      case "shipping":
        if (product.isDigital) return null;
        // BUY-03: when the seller has written nothing about shipping yet,
        // omit the section entirely rather than printing an apology. A
        // heading with "The seller has not added shipping details yet"
        // under it tells a buyer less than nothing and signals an
        // incomplete storefront. The section reappears the moment the
        // seller adds their terms.
        if (!shipping) return null;
        return (
          <div className="flex flex-col gap-3 text-sm leading-relaxed">
            {/* The dispatch line repeats up beside the button, deliberately:
                there it is a glance, here it is the first sentence of the
                terms, and a buyer reading the section should not have to
                scroll back for it. */}
            {shipping.dispatch && <p className="font-medium">{shipping.dispatch}</p>}
            {paragraphs(shipping.body).map((text, index) => (
              <p key={index} className="whitespace-pre-line">
                {text}
              </p>
            ))}
          </div>
        );
      case "returns":
        if (!returnsText && !isEu) return null;
        return (
          <div className="flex flex-col gap-3 text-sm leading-relaxed">
            {returnsText &&
              paragraphs(returnsText).map((text, index) => (
                <p key={index} className="whitespace-pre-line">
                  {text}
                </p>
              ))}
            {isEu && <StatutoryNotes isDigital={product.isDigital} />}
          </div>
        );
      case "safety": {
        const safety = product.details.safety;
        if (product.isDigital || !safety) return null;
        return (
          <div className="flex flex-col gap-3 text-sm leading-relaxed">
            <div>
              <p className="font-medium">{t("safety.manufacturer")}</p>
              <p>{safety.manufacturerName}</p>
              <p className="whitespace-pre-line">{safety.manufacturerAddress}</p>
              <p>
                <a href={`mailto:${safety.manufacturerEmail}`} className="underline underline-offset-2">
                  {safety.manufacturerEmail}
                </a>
              </p>
            </div>
            {(safety.responsibleName || safety.responsibleAddress || safety.responsibleEmail) && (
              <div>
                <p className="font-medium">{t("safety.responsiblePerson")}</p>
                {safety.responsibleName && <p>{safety.responsibleName}</p>}
                {safety.responsibleAddress && (
                  <p className="whitespace-pre-line">{safety.responsibleAddress}</p>
                )}
                {safety.responsibleEmail && (
                  <p>
                    <a href={`mailto:${safety.responsibleEmail}`} className="underline underline-offset-2">
                      {safety.responsibleEmail}
                    </a>
                  </p>
                )}
              </div>
            )}
            {safety.identifier && (
              <p>
                <span className="opacity-70">{t("safety.identifier")} </span>
                {safety.identifier}
              </p>
            )}
            {safety.warnings && (
              <div>
                <p className="font-medium">{t("safety.warnings")}</p>
                <p className="whitespace-pre-line">{safety.warnings}</p>
              </div>
            )}
          </div>
        );
      }
    }
  }

  return (
    <OptionProvider
      groups={product.optionGroups}
      initialOptionIds={initialOptionIds}
      syncUrl={!preview}
    >
      <QuantityProvider
        limit={product.maxQuantity}
        initialQuantity={initialQuantity}
        syncUrl={!preview}
      >
        <PageShell
          storefront={storefront}
          shopHref={preview ? undefined : storefrontPagePath(storefront.id)}
          // The page's own backdrop when it has one, otherwise the storefront's
          // whole background. The page's font falls back to the storefront's
          // too: the product page is part of the shop, not a publication of its
          // own.
          backgroundColor={productPage.backgroundColor}
          // Its own photo, overlaid in the colour its ink was derived from.
          photo={
            storefront.pagePhoto
              ? { ...storefront.pagePhoto, tint: productPage.backgroundColor ?? storefrontBackdropHex(theme) }
              : null
          }
          font={productPage.font}
          ink={ink}
          preview={preview}
          padForStickyBar={hasCta}
          rootAttributes={{
            "data-product-page": mode,
            // The backdrop as DATA, alongside the button's (see ProductCta): the
            // resolved colour, and whether it is the page's own or the
            // storefront's. A reader must never have to parse a style
            // attribute and re-derive the inheritance to answer "what colour is
            // this page".
            "data-page-background": productPage.backgroundColor ?? "storefront",
            "data-page-ink": ink,
          }}
          footer={
            <>
              {/* `soldBy`, NOT gated on `showSeller`: the switch hides the "Sold
                  by" line beside the price, which is presentation, but the
                  footer's disclosure of who the buyer is contracting with is not
                  the seller's to turn off. See PoweredByFooter's header comment. */}
              <PoweredByFooter
                ruleColor={rule}
                sellerName={soldBy}
                product={{ id: product.id, title: product.title }}
                storefront={{ id: storefront.id, name: storeName }}
                reportScopes={page.reportScopes}
                preview={preview}
                withdrawHref={storefront.checkout ? orderLookupPath(storefront.id) : undefined}
              />
              {hasCta && (
                <StickyBar
                  preview={preview}
                  hotspot="cta"
                  // The buy box's own button: the bar steps aside while it is
                  // on screen (the bar's copy is excluded from the lookup).
                  watch="[data-product-cta]"
                  attributes={{ "data-product-sticky-cta": "" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs opacity-70">{product.title}</p>
                    <ProductPrice
                      priceCents={product.priceCents}
                      currency={product.currency}
                      sale={product.sale}
                      saleStyle={productPage.saleStyle}
                      priceNote={effectivePriceNote}
                      shippingNote={effectiveShippingNote}
                      isDigital={product.isDigital}
                      ink={DARK_INK}
                      size="sm"
                    />
                  </div>
                  {/* The SAME resolved appearance as the button above it: the
                      sticky bar is a second place to press the one button, not a
                      second button. Only `ink` differs, because that belongs to
                      the white bar this one sits on rather than to the button. */}
                  <ProductCta
                    target={target}
                    label={productPage.ctaLabel}
                    cta={cta}
                    ink={DARK_INK}
                    soldOut={product.soldOut}
                    preview={preview}
                    className="w-44 shrink-0"
                  />
                </StickyBar>
              )}
            </>
          }
        >
          <div className="mx-auto w-full max-w-[76rem] px-4 py-8 @md:px-6 @3xl:px-10 @3xl:py-12">
            <article aria-labelledby="product-title">
              {/* ONE arrangement: photos on the left, the buy box on the right,
                  stacking on a narrow container. The mirrored and stacked
                  variants were three ways of saying the same thing, and a narrow
                  screen already stacks on its own. */}
              <div className="grid items-start gap-8 @3xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] @3xl:gap-14">
                <div data-setting-hotspot="layout">
                  <ProductGallery
                    images={product.images}
                    title={product.title}
                    fit={productPage.imageFit}
                    radius={radius}
                    ink={ink}
                    overlay={
                      // In the editor the photo is also a place to drop a
                      // badge, so it is there whenever the product has any.
                      (photoBadges.length > 0 || (preview && badges.length > 0)) && (
                        // The PRODUCT's words, not a page setting: a click on
                        // them in the editor opens nothing.
                        <div data-setting-skip="" className="contents">
                          {movable(
                            "photo",
                            photoBadges.length > 0 && (
                              <PhotoBadges
                                badges={photoBadges}
                                label={t("badgesOnPhoto")}
                                cornerRadius={theme.cornerRadius}
                              />
                            ),
                          )}
                        </div>
                      )
                    }
                  />
                </div>
                {/* Sticky beside a tall gallery: scrolling the photos must not
                    scroll the price and the button off the screen. */}
                <div className="flex flex-col gap-5 @3xl:sticky @3xl:top-10">
                  <div className="flex flex-col gap-1" data-setting-hotspot="sections">
                    <h1 id="product-title" className="text-2xl font-semibold leading-tight @md:text-3xl">
                      {product.title}
                    </h1>
                    {average != null && <ReviewsLink average={average} count={reviewCount} preview={preview} />}
                    {productPage.showSeller && (
                      <p className="text-sm opacity-70" data-product-sold-by="">
                        {t("soldBy", { seller: soldBy })}
                      </p>
                    )}
                  </div>
                  {/* The seller's highlights, read with the title. Opted out of
                      the hotspots like the version picker: badges are the
                      PRODUCT's words, set on its form, not a page setting. */}
                  {(besideBadges.length > 0 || (preview && badges.length > 0)) && (
                    // `contents` in the editor: the drop zone inside is the
                    // column's item, so an empty one takes no gap.
                    <div data-setting-skip="" className={preview ? "contents" : undefined}>
                      {movable(
                        "beside",
                        besideBadges.length > 0 && (
                          <ProductBadges
                            badges={besideBadges}
                            label={t("badges")}
                            ink={ink}
                            cornerRadius={theme.cornerRadius}
                          />
                        ),
                      )}
                    </div>
                  )}
                  {descriptionInInfo && (
                    <div data-setting-hotspot="sections">
                      <ProductDescription text={product.description} />
                    </div>
                  )}
                  {/* The price NOTES ("incl. VAT, plus shipping") are set beside
                      the button's own wording, so the number leads there too. */}
                  <div data-setting-hotspot="cta">
                    <ProductPrice
                      priceCents={product.priceCents}
                      currency={product.currency}
                      sale={product.sale}
                      saleStyle={productPage.saleStyle}
                      priceNote={effectivePriceNote}
                      shippingNote={effectiveShippingNote}
                      isDigital={product.isDigital}
                      ink={ink}
                      radius={controlRadius(theme.cornerRadius)}
                    />
                    {deliveryLine && (
                      <p className="mt-1 text-sm opacity-70" data-product-delivery={delivery?.fromCents}>
                        {deliveryLine}
                      </p>
                    )}
                  </div>
                  {productPage.showStock && (
                    <div data-setting-hotspot="sections">
                      <StockLine
                        stock={product.stock}
                        soldOut={product.soldOut}
                        isDigital={product.isDigital}
                        digitalFormat={product.digitalFormat}
                      />
                    </div>
                  )}
                  {/* Opted OUT of the hotspots: the options are the PRODUCT's,
                      not the page's, so a click here has no page setting to
                      open and must stay nothing but a version choice. */}
                  <div data-setting-skip="">
                    <OptionPicker radius={radius} ink={ink} />
                  </div>
                  {/* Opted out of the hotspots for the same reason the version
                      picker is: how many a buyer wants is the ORDER's business,
                      not a page setting the seller could open and change. The
                      ceiling behind it is a product field, set on the product
                      form beside the stock it relates to.
                      Gone entirely when the product is sold out — the button
                      already says so, and asking how many of nothing is a
                      question with no answer. */}
                  {!product.soldOut && (
                    <div data-setting-skip="">
                      <QuantityPicker
                        priceCents={product.priceCents}
                        currency={product.currency}
                        radius={radius}
                        ink={ink}
                      />
                    </div>
                  )}
                  <div data-setting-hotspot="cta">
                    <ProductCta
                      target={target}
                      label={productPage.ctaLabel}
                      cta={cta}
                      ink={ink}
                      soldOut={product.soldOut}
                      preview={preview}
                    />
                  </div>
                  <TrustList lines={trust} ruleColor={rule} />
                </div>
              </div>

              {sections.length > 0 && (
                <div className="mt-10 flex flex-col" data-product-sections={sections.map((s) => s.id).join(" ")}>
                  {/* A named region, not loose bars. The description reads up
                      beside the photos, so everything down here is reference
                      material a buyer consults, and it deserves to be announced
                      as one thing rather than to trail off the buy box. */}
                  <h2 className="pb-3 text-lg font-semibold" data-product-details-heading="">
                    {t("moreDetails")}
                  </h2>
                  {sections.map((section, index) => (
                    <details
                      key={section.id}
                      open={index === 0}
                      className="group border-t py-4 last:border-b"
                      style={{ borderColor: rule }}
                      data-product-section={section.id}
                      data-setting-hotspot={SECTION_SETTING[section.id]}
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left [&::-webkit-details-marker]:hidden">
                        <h3 className="text-base font-semibold">
                          {t(`sections.${section.id}`)}
                        </h3>
                        <ChevronDown
                          aria-hidden="true"
                          className="size-4 shrink-0 opacity-60 transition-transform duration-base ease-standard group-open:rotate-180"
                          strokeWidth={2}
                        />
                      </summary>
                      <div className="pt-3">{section.body}</div>
                    </details>
                  ))}
                </div>
              )}

              {reviewsShown && reviews && (
                <ReviewsSection
                  productId={product.id}
                  reviews={reviews}
                  ink={ink}
                  rule={rule}
                  cta={cta}
                  cornerRadius={theme.cornerRadius}
                />
              )}

              {/* THE FOOT OF THE PAGE, open. Not a section in the accordion
                  above: who you are buying from is the last thing a page should
                  make someone click for. */}
              {sellerShown && (
                <section
                  className="mt-10 border-t pt-6"
                  style={{ borderColor: rule }}
                  data-product-section="seller"
                  data-setting-hotspot="seller"
                >
                  <h2 className="pb-3 text-lg font-semibold">
                    {t("sections.seller")}
                  </h2>
                  <SellerBlock seller={seller} fallbackName={storefront.name} />
                </section>
              )}
            </article>
          </div>
        </PageShell>
      </QuantityProvider>
    </OptionProvider>
  );
}
