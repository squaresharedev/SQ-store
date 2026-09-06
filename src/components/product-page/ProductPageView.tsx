import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, Clock, PackageCheck, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveBackgroundStyle } from "@/components/storefront/background-presets";
import { CustomFontFace } from "@/components/storefront/CustomFontFace";
import { customFontVars, fontPresentation } from "@/lib/theme/storefront-fonts";
import { isEuSeller, PRODUCT_PAGE_SECTION_LABELS } from "@/lib/storefront/product-page";
import { resolveProductShipping, resolveReturns } from "@/lib/storefront/shipping";
import { SECTION_SETTING } from "@/lib/storefront/setting-ref";
import type { ProductPageData } from "@/types/product-page";
import type { ProductPageSectionId } from "@/types/storefront";
import { resolveCtaTarget } from "./cta-target";
import { DocumentsList } from "./DocumentsList";
import { ProductCta } from "./ProductCta";
import { ProductDescription } from "./ProductDescription";
import { ProductGallery } from "./ProductGallery";
import { ProductPrice } from "./ProductPrice";
import { PoweredByFooter } from "./PoweredByFooter";
import { SellerBlock, hasSellerDetails } from "./SellerBlock";
import { SpecsSection } from "./SpecsSection";
import { hasSpecs } from "./SpecsTable";
import { StatutoryNotes } from "./StatutoryNotes";
import { StockLine } from "./StockLine";
import { OptionProvider } from "./OptionContext";
import { OptionPicker } from "./OptionPicker";
import {
  DARK_INK,
  firstSentence,
  paragraphs,
  resolveInk,
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
}: {
  page: ProductPageData;
  mode: "public" | "preview";
  /** Preselected options from the URL, already checked against the product. */
  initialOptionIds?: readonly string[];
}) {
  const { storefront, product } = page;
  const { theme, productPage, shippingPolicy, seller } = storefront;
  const preview = mode === "preview";

  // WHICH SHIPPING TERMS THIS PRODUCT IS SOLD UNDER. Almost always the
  // account's default; a product that names one of the account's shipping
  // profiles gets that instead. Resolved once here and used in both places the
  // page talks about shipping — the line beside the button and the section
  // below — so the two can never quote different terms.
  const shipping = product.isDigital
    ? null
    : resolveProductShipping(product.shippingProfileId, shippingPolicy);
  // Returns do not vary by product, so this is the account's answer, full
  // stop. Generated from the structured settings (or the seller's own words,
  // which the generator prefers) rather than read from a stored paragraph.
  const returnsText = resolveReturns(shippingPolicy);

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
  const effectiveShippingNote = !product.isDigital && shipping !== null ? productPage.shippingNote : "none" as const;

  const ink = resolveInk(theme, productPage);
  const rule = ruleColor(ink);
  const radius = surfaceRadius(theme.cornerRadius);
  // The page's own font falls back to the storefront's, which is what almost
  // every store wants: the product page is part of the shop, not a separate
  // publication. "custom" on either resolves to the same uploaded face, whose
  // family the root declares below.
  const font = fontPresentation(productPage.font ?? theme.font);
  const isEu = isEuSeller(seller);
  const storeName = storefront.header?.show && storefront.header.name ? storefront.header.name : storefront.name;
  const soldBy = seller.businessName || storefront.name;
  const target = resolveCtaTarget(product.purchaseUrl, seller.email, product.title);
  // The editor always shows the button, even with nowhere to send it, so the
  // seller can see the page's one action and be told how to wire it up.
  const hasCta = target.kind !== "none" || preview;

  const rootStyle: CSSProperties = {
    ...resolveBackgroundStyle(theme.background, storefront.backgroundImageUrl),
    ...customFontVars(theme.customFont, storefront.customFontUrl),
    color: ink,
    ...font.style,
  };

  // The three facts a buyer looks for beside the button, drawn from what the
  // seller actually wrote rather than invented: how it gets to them, how it
  // goes back, and (in the EU) that the law is behind them either way.
  const trust: { icon: typeof Truck; text: string }[] = [];
  // The dispatch line LEADS, when there is one: "when does it leave" is the
  // first thing asked of anything being posted, and it is the one fact the
  // shipping paragraph below is worst at answering quickly.
  if (shipping?.dispatch) {
    trust.push({ icon: Clock, text: shipping.dispatch });
  }
  const shippingLine = product.isDigital
    ? "Delivered as a download after purchase."
    : firstSentence(shipping?.body);
  if (shippingLine) {
    trust.push({ icon: product.isDigital ? PackageCheck : Truck, text: shippingLine });
  }
  const returnsLine = firstSentence(returnsText);
  if (returnsLine) trust.push({ icon: RotateCcw, text: returnsLine });
  if (isEu) {
    trust.push({ icon: ShieldCheck, text: "14 days to change your mind, and a 2-year guarantee." });
  }

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
  // open at the foot of the page. Its switch in the Sections panel still
  // decides whether it appears at all.
  const sellerShown =
    (productPage.sections.find((entry) => entry.id === "seller")?.show ?? false) &&
    (hasSellerDetails(seller) || productPage.showSeller);

  // Which sections have anything to say, in the seller's order.
  const sections = productPage.sections
    .filter((entry) => entry.show)
    .filter((entry) => entry.id !== "description" && entry.id !== "seller")
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
              <p className="font-medium">Manufacturer</p>
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
                <p className="font-medium">Responsible person in the EU</p>
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
                <span className="opacity-70">Product identifier: </span>
                {safety.identifier}
              </p>
            )}
            {safety.warnings && (
              <div>
                <p className="font-medium">Warnings</p>
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
      <CustomFontFace customFont={theme.customFont} url={storefront.customFontUrl} />
      <div
        className={cn(
          "@container w-full",
          font.className,
          preview ? "min-h-full" : "min-h-screen",
          hasCta && "pb-24 @3xl:pb-0",
        )}
        style={rootStyle}
        data-product-page={mode}
        // Outermost hotspot, so it is what a click on the page's own backdrop
        // finds. Every region inside names its own and wins by being nearer.
        data-setting-hotspot="background"
      >
        {/* The store's own line above the page. A full-width bar rather than a
            caption: it is the one piece of chrome that says whose shop this
            is, and on a full screen it belongs at the top edge. */}
        <header
          className="w-full border-b"
          style={{ borderColor: rule }}
          data-product-page-header=""
          data-setting-hotspot="header"
        >
          <div className="mx-auto w-full max-w-[76rem] px-4 py-3 @md:px-6 @3xl:px-10">
            <p className="truncate text-sm font-medium">{storeName}</p>
          </div>
        </header>

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
                />
              </div>
              {/* Sticky beside a tall gallery: scrolling the photos must not
                  scroll the price and the button off the screen. */}
              <div className="flex flex-col gap-5 @3xl:sticky @3xl:top-10">
                <div className="flex flex-col gap-1" data-setting-hotspot="sections">
                  <h1 id="product-title" className="text-2xl font-semibold leading-tight @md:text-3xl">
                    {product.title}
                  </h1>
                  {productPage.showSeller && (
                    <p className="text-sm opacity-70" data-product-sold-by="">
                      Sold by {soldBy}
                    </p>
                  )}
                </div>
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
                    priceNote={effectivePriceNote}
                    shippingNote={effectiveShippingNote}
                    isDigital={product.isDigital}
                  />
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
                <div data-setting-hotspot="cta">
                  <ProductCta
                    target={target}
                    label={productPage.ctaLabel}
                    accent={theme.accent}
                    ink={ink}
                    cornerRadius={theme.cornerRadius}
                    soldOut={product.soldOut}
                    preview={preview}
                  />
                </div>
                {trust.length > 0 && (
                  <ul
                    className="flex flex-col gap-2 border-t pt-4 text-xs"
                    style={{ borderColor: rule }}
                    data-product-trust=""
                    // Every line here is the first sentence of a policy the
                    // seller wrote, so the policies are what a click wants.
                    data-setting-hotspot="policies"
                  >
                    {trust.map(({ icon: Icon, text }) => (
                      <li key={text} className="flex items-start gap-2">
                        <Icon
                          className="mt-px size-3.5 shrink-0 opacity-60"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                        <span className="opacity-80">{text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {sections.length > 0 && (
              <div className="mt-10 flex flex-col" data-product-sections={sections.map((s) => s.id).join(" ")}>
                {/* A named region, not loose bars. The description reads up
                    beside the photos, so everything down here is reference
                    material a buyer consults, and it deserves to be announced
                    as one thing rather than to trail off the buy box. */}
                <h2 className="pb-3 text-lg font-semibold" data-product-details-heading="">
                  More details
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
                        {PRODUCT_PAGE_SECTION_LABELS[section.id]}
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
                  {PRODUCT_PAGE_SECTION_LABELS.seller}
                </h2>
                <SellerBlock seller={seller} fallbackName={storefront.name} />
              </section>
            )}
          </article>
        </div>

        {/* `soldBy`, NOT gated on `showSeller`: the switch hides the "Sold by"
            line beside the price, which is presentation, but the footer's
            disclosure of who the buyer is contracting with is not the seller's
            to turn off. See PoweredByFooter's header comment. No `preview`
            prop: unlike everything else on this page, the footer's links are
            identically live in both modes (see PoweredByFooter itself). */}
        <PoweredByFooter ruleColor={rule} sellerName={soldBy} />

        {hasCta && (
          <div
            className={cn(
              "inset-x-0 bottom-0 z-20 flex items-center gap-4 border-t bg-white px-4 py-3 @3xl:hidden",
              preview ? "sticky" : "fixed",
            )}
            // Seller-themed surface, not the dashboard's: fixed white bar with
            // dark ink whatever the storefront background is.
            style={{ color: DARK_INK, borderColor: "rgba(23,23,23,0.12)" }}
            data-product-sticky-cta=""
            data-setting-hotspot="cta"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs opacity-70">{product.title}</p>
              <ProductPrice
                priceCents={product.priceCents}
                currency={product.currency}
                priceNote={effectivePriceNote}
                shippingNote={effectiveShippingNote}
                isDigital={product.isDigital}
                size="sm"
              />
            </div>
            <ProductCta
              target={target}
              label={productPage.ctaLabel}
              accent={theme.accent}
              ink={DARK_INK}
              cornerRadius={theme.cornerRadius}
              soldOut={product.soldOut}
              preview={preview}
              className="w-44 shrink-0"
            />
          </div>
        )}
      </div>
    </OptionProvider>
  );
}
