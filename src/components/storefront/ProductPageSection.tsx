"use client";

import { useId } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EU_COUNTRIES } from "@/lib/settings/constants";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import {
  PRODUCT_PAGE_SECTION_LABELS,
  normalizeSections,
} from "@/lib/storefront/product-page";
import { buildShippingProse, hasShippingPolicy } from "@/lib/shipping/policy-prose";
import { hasSellerDetails } from "@/components/product-page/SellerBlock";
import type { ProductPagePanelSection } from "@/lib/storefront/setting-ref";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import {
  PRODUCT_PAGE_CTA_MAX,
  STOREFRONT_FONTS,
  type ProductPageConfig,
  type StorefrontFont,
  type StorefrontSeller,
} from "@/types/storefront";
import { FONT_LABELS } from "./config-maps";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select, type SelectOption } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  fieldBaseClass,
  helpTextClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";

/**
 * The Product page group of the design panel: five sections, each a
 * CollapsibleSection so a search hit can summon exactly one.
 *
 * Every EDITABLE control here writes `{ ...current, field }` through the
 * designer's mutators, so undo coalesces per field and the saved jsonb only
 * ever holds what the schema admits. Text fields drop their key when emptied
 * rather than storing "".
 *
 * TWO SECTIONS ARE NOT EDITABLE HERE. "Shipping and returns" and "Seller
 * details" both show ACCOUNT-level facts read-only, with a link to the
 * Settings page that owns them. Neither is a property of a storefront, and a
 * storefront save must not be able to reach terms every other storefront is
 * also selling under. See each section's own comment for the full reasoning.
 */

/**
 * The "no choice made" value for the font select.
 *
 * A Select needs a string for every option, and "follows the storefront" is
 * the ABSENCE of a stored font rather than a value it could hold. A sentinel
 * that is not a member of STOREFRONT_FONTS keeps the two apart: picking it
 * deletes the key instead of writing something the schema would have to
 * understand as "inherit".
 */
const INHERIT_FONT = "";

export function ProductPageSection({
  productPage,
  onProductPageChange,
  shippingPolicy,
  sellerIdentity,
  storefrontFont,
  customFontName,
  summoned,
}: {
  productPage: ProductPageConfig;
  onProductPageChange: (next: ProductPageConfig) => void;
  /** The account's shipping and returns terms (Settings › Shipping & returns),
   *  read-only — this panel shows what they produce and links to where they
   *  are set. */
  shippingPolicy: SellerShippingPolicy;
  /** The account's trader identity (Settings › Business & seller details),
   *  read-only — this panel shows it and links to where it is edited. */
  sellerIdentity: StorefrontSeller;
  /** The storefront's own font, named in the inherit option so the seller can
   *  see what following it currently gets them. */
  storefrontFont: StorefrontFont;
  /** The uploaded face's name, when there is one. Without an upload there is
   *  nothing for "custom" to resolve to, so it is not offered. */
  customFontName: string | undefined;
  /** Which section a search hit named, if any. */
  summoned: ProductPagePanelSection | null;
}) {
  const fieldId = useId();

  const fontOptions: SelectOption<string>[] = [
    {
      value: INHERIT_FONT,
      label: `Same as storefront (${
        storefrontFont === "custom" && customFontName
          ? customFontName
          : FONT_LABELS[storefrontFont]
      })`,
    },
    ...STOREFRONT_FONTS.filter(
      // Offered only once there is something to point at, exactly as the
      // storefront's own font picker does it.
      (font) => font !== "custom" || customFontName !== undefined,
    ).map((font) => ({
      value: font as string,
      label: font === "custom" && customFontName ? customFontName : FONT_LABELS[font],
    })),
  ];

  // The switch rows, in the order the page renders them. `normalizeSections`
  // has already put them in that fixed order, so this list needs no arranging
  // of its own; the description sits at the head, which is where it reads.
  const rows = normalizeSections(productPage.sections);

  // The account's shipping and returns terms, read-only in this panel — see
  // the "Shipping and returns" section below for why. Built by the same
  // generator the live page uses, so this summary and what a buyer reads can
  // never be different text.
  const shippingProse = buildShippingProse(shippingPolicy);
  const shippingIsSet = hasShippingPolicy(shippingPolicy);
  const profileCount = shippingPolicy.profiles?.length ?? 0;

  // The account's trader identity, read-only in this panel — see the
  // "Seller details" section below for why. `sellerCountryName` mirrors the
  // exact lookup SellerBlock uses on the live page, so the summary here reads
  // the same as what a buyer sees.
  const sellerCountryName = EU_COUNTRIES.find(
    (entry) => entry.code === sellerIdentity.country,
  )?.name;
  const sellerIsSet = hasSellerDetails(sellerIdentity);

  return (
    <>
      <CollapsibleSection title="Page" collapsible summon={summoned === "layout"}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-enabled`} className={labelClass}>
                Show a product page
              </label>
              <InfoTip label="What this switch does">
                {productPage.enabled
                  ? "Tapping a product tile opens its page."
                  : "Product tiles have no page to open."}
              </InfoTip>
            </div>
            <Switch
              id={`${fieldId}-enabled`}
              checked={productPage.enabled}
              onCheckedChange={(enabled) => onProductPageChange({ ...productPage, enabled })}
            />
          </div>

          <div className="space-y-1.5">
            <span className={labelClass}>Photo fit</span>
            <SegmentedControl
              ariaLabel="Photo fit"
              value={productPage.imageFit}
              options={[
                { value: "contain", label: "Fit" },
                { value: "cover", label: "Fill" },
              ]}
              onChange={(imageFit) => onProductPageChange({ ...productPage, imageFit })}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-font`} className={labelClass}>
                Font
              </label>
              <InfoTip label="How this page's font relates to the storefront's">
                {productPage.font
                  ? "This page reads in its own face, whatever the storefront uses."
                  : "Follows your storefront's font. Change it under Typography."}
              </InfoTip>
            </div>
            <Select
              id={`${fieldId}-font`}
              value={productPage.font ?? INHERIT_FONT}
              options={fontOptions}
              onChange={(value) => {
                if (value === INHERIT_FONT) {
                  const { font, ...rest } = productPage;
                  void font;
                  onProductPageChange(rest);
                  return;
                }
                onProductPageChange({ ...productPage, font: value as StorefrontFont });
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-index`} className={labelClass}>
                Allow search engines
              </label>
              <InfoTip label="What turning this off does">
                Off keeps your product pages out of search results. Anyone with a link can still
                open them.
              </InfoTip>
            </div>
            <Switch
              id={`${fieldId}-index`}
              checked={productPage.allowIndexing}
              onCheckedChange={(allowIndexing) =>
                onProductPageChange({ ...productPage, allowIndexing })
              }
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Buy button"
        collapsible
        defaultOpen={false}
        summon={summoned === "cta"}
        headerAction={
          <InfoTip label="What decides whether a button shows">
            The button follows each product&apos;s purchase link (set on the product). Without
            one it emails your contact address below; with neither, no button is shown.
          </InfoTip>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-cta`} className={labelClass}>
              Button text
            </label>
            <input
              id={`${fieldId}-cta`}
              type="text"
              value={productPage.ctaLabel}
              maxLength={PRODUCT_PAGE_CTA_MAX}
              spellCheck={false}
              onChange={(event) =>
                onProductPageChange({
                  ...productPage,
                  ctaLabel: sanitizeHeaderText(event.target.value, false),
                })
              }
              className={fieldBaseClass}
            />
            <p className={helpTextClass}>
              {PRODUCT_PAGE_CTA_MAX - productPage.ctaLabel.length} characters left
            </p>
          </div>

          <div className="space-y-1.5">
            <span className={labelClass}>Price note</span>
            <SegmentedControl
              ariaLabel="Price note"
              value={productPage.priceNote}
              options={[
                { value: "incl-vat", label: "Incl. VAT" },
                { value: "excl-vat", label: "Excl. tax" },
                { value: "none", label: "None" },
              ]}
              onChange={(priceNote) => onProductPageChange({ ...productPage, priceNote })}
            />
          </div>

          <div className="space-y-1.5">
            <span className={labelClass}>Shipping note</span>
            <SegmentedControl
              ariaLabel="Shipping note"
              value={productPage.shippingNote}
              options={[
                { value: "plus-shipping", label: "Plus shipping" },
                { value: "free-shipping", label: "Free shipping" },
                { value: "none", label: "None" },
              ]}
              onChange={(shippingNote) => onProductPageChange({ ...productPage, shippingNote })}
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Sections"
        collapsible
        defaultOpen={false}
        summon={summoned === "sections"}
        headerAction={
          <InfoTip label="When a section stays hidden">
            A section with nothing to show stays hidden even when it is on. Shipping and safety
            never show for downloads.
          </InfoTip>
        }
      >
        {/* ONE LIST OF SWITCHES, in the order the page renders. The two page
            details that used to trail underneath as loose rows (availability,
            the "Sold by" byline) are the same kind of yes-or-no about the same
            page, so they sit in the same list and the whole panel is scanned
            in a single pass. The fourteen reorder arrows are gone with the
            stored order: the fixed one runs from what a buyer reaches for
            first to what they reach for last. */}
        <div className="space-y-4">
          <ul className="space-y-2" aria-label="What the page shows">
            {rows.map((entry) => {
              const rowId = `${fieldId}-section-${entry.id}`;
              return (
                <li key={entry.id} className="flex items-center justify-between gap-2">
                  {/* The hint sits OUTSIDE the label: inside it, it would
                      become part of the switch's accessible name, and a screen
                      reader would announce a placement as if it were the
                      thing being switched. */}
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <label htmlFor={rowId} className={cn(labelClass, "truncate")}>
                      {PRODUCT_PAGE_SECTION_LABELS[entry.id]}
                    </label>
                    {entry.id === "description" && (
                      <span className={cn(helpTextClass, "truncate")} aria-hidden="true">
                        under the title
                      </span>
                    )}
                  </span>
                  <Switch
                    id={rowId}
                    checked={entry.show}
                    onCheckedChange={(show) =>
                      onProductPageChange({
                        ...productPage,
                        sections: productPage.sections.map((candidate) =>
                          candidate.id === entry.id ? { ...candidate, show } : candidate,
                        ),
                      })
                    }
                  />
                </li>
              );
            })}

            <li className="flex items-center justify-between gap-2">
              <label htmlFor={`${fieldId}-stock`} className={cn(labelClass, "min-w-0 flex-1 truncate")}>
                Availability
              </label>
              <Switch
                id={`${fieldId}-stock`}
                checked={productPage.showStock}
                onCheckedChange={(showStock) => onProductPageChange({ ...productPage, showStock })}
              />
            </li>
            <li className="flex items-center justify-between gap-2">
              <label htmlFor={`${fieldId}-soldby`} className={cn(labelClass, "min-w-0 flex-1 truncate")}>
                &ldquo;Sold by&rdquo; byline
              </label>
              <Switch
                id={`${fieldId}-soldby`}
                checked={productPage.showSeller}
                onCheckedChange={(showSeller) => onProductPageChange({ ...productPage, showSeller })}
              />
            </li>
          </ul>
        </div>
      </CollapsibleSection>

      {/* READ-ONLY, deliberately, and this is the bigger of the two moves on
          this panel. Shipping and returns used to be edited HERE: three
          textareas plus up to eight profile cards of three fields each, which
          made it comfortably the largest thing in the design panel. Two things
          were wrong with that. A storefront is a presentation of one catalogue
          rather than a business, so a seller with two of them retyped the same
          returns policy into both with no second answer to give; and a design
          surface is the wrong place to be writing legal text at all, which is
          why Shopify, Etsy and Squarespace all keep it in settings. So the
          terms are set once for the account and this panel's job is only to
          prove it: what a buyer will read, and where to change it. What stays
          editable on this page is the DISPLAY decision, up in Sections. */}
      <CollapsibleSection
        title="Shipping and returns"
        collapsible
        defaultOpen={false}
        summon={summoned === "policies"}
        headerAction={
          <InfoTip label="Why this lives in Settings, not here">
            Set once for your whole account, so every storefront and every product sells under
            the same terms. For EU sellers the page also states the 14-day cancellation right
            and the 2-year guarantee, whatever you write.
          </InfoTip>
        }
      >
        <div className="space-y-3">
          {shippingIsSet ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
              {shippingPolicy.dispatch && (
                <p className="font-medium text-foreground">{shippingPolicy.dispatch}</p>
              )}
              {shippingProse.shipping && (
                <div>
                  <p className={helpTextClass}>Shipping</p>
                  <p className="whitespace-pre-line text-muted-foreground">
                    {shippingProse.shipping}
                  </p>
                </div>
              )}
              {shippingProse.returns && (
                <div>
                  <p className={helpTextClass}>Returns</p>
                  <p className="whitespace-pre-line text-muted-foreground">
                    {shippingProse.returns}
                  </p>
                </div>
              )}
              {/* The exceptions are named rather than spelled out: which
                  products use which profile is the product form's question,
                  and repeating eight bodies of terms here would put the panel
                  straight back to the size this change removed. */}
              {profileCount > 0 && (
                <p className={helpTextClass}>
                  {profileCount === 1
                    ? "1 shipping profile for products that ship differently."
                    : `${profileCount} shipping profiles for products that ship differently.`}
                </p>
              )}
            </div>
          ) : (
            <p className={helpTextClass}>
              Nothing set yet. Until you add your terms, product pages say the seller has not
              added shipping details.
            </p>
          )}
          {/* New tab, not routed through the leave guard like a real exit from
              the editor: this is a quick side errand, not "I'm done here",
              and it must not risk (or ask about) unsaved storefront work. */}
          <Link
            href="/settings/shipping"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(secondaryButtonClass, "w-full justify-center")}
          >
            {shippingIsSet ? "Edit in Settings" : "Add your shipping terms"}
          </Link>
        </div>
      </CollapsibleSection>

      {/* READ-ONLY, deliberately. Trader identity used to be edited here, per
          storefront — a seller with two storefronts typed the same business
          name twice, and a hired team member (Settings is scoped to the
          signed-in user, never the active account) could not complete it at
          all. It is one fact about the BUSINESS, so it is set once in
          Settings and every storefront just shows it. This panel's job is
          only to prove that: what a buyer will see, and where to change it. */}
      <CollapsibleSection
        title="Seller details"
        collapsible
        defaultOpen={false}
        summon={summoned === "seller"}
        headerAction={
          <InfoTip label="Why this lives in Settings, not here">
            Distance-selling law asks for the seller&apos;s name, address and a way to get in
            touch next to every offer. Set once for your whole account — every storefront and
            every product shows the same details, so there is nothing to repeat per store.
          </InfoTip>
        }
      >
        <div className="space-y-3">
          {sellerIsSet ? (
            <address className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm not-italic">
              {sellerIdentity.businessName && (
                <p className="font-medium text-foreground">{sellerIdentity.businessName}</p>
              )}
              {sellerIdentity.address && (
                <p className="whitespace-pre-line text-muted-foreground">
                  {sellerIdentity.address}
                </p>
              )}
              {sellerCountryName && <p className="text-muted-foreground">{sellerCountryName}</p>}
              {sellerIdentity.email && (
                <p className="text-muted-foreground">{sellerIdentity.email}</p>
              )}
              {sellerIdentity.phone && (
                <p className="text-muted-foreground">{sellerIdentity.phone}</p>
              )}
              {sellerIdentity.vatId && (
                <p className="text-muted-foreground opacity-70">VAT ID {sellerIdentity.vatId}</p>
              )}
            </address>
          ) : (
            <p className={helpTextClass}>
              Nothing set yet. Until you add your business details, buyers only see the
              &ldquo;Sold by&rdquo; line under the title.
            </p>
          )}
          {/* New tab, not routed through the leave guard like a real exit from
              the editor: this is a quick side errand, not "I'm done here",
              and it must not risk (or ask about) unsaved storefront work. */}
          <Link
            href="/settings/tax"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(secondaryButtonClass, "w-full justify-center")}
          >
            {sellerIsSet ? "Edit in Settings" : "Add your business details"}
          </Link>
        </div>
      </CollapsibleSection>
    </>
  );
}
