"use client";

import { useId } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EU_COUNTRIES } from "@/lib/settings/constants";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import {
  PRODUCT_PAGE_SECTION_LABELS,
  normalizeSections,
} from "@/lib/storefront/product-page";
import {
  canAddShippingProfile,
  newShippingProfileId,
} from "@/lib/storefront/shipping";
import type { ProductPagePanelSection } from "@/lib/storefront/setting-ref";
import {
  POLICY_TEXT_MAX,
  PRODUCT_PAGE_CTA_MAX,
  SELLER_FIELD_MAX,
  SHIPPING_DISPATCH_MAX,
  SHIPPING_PROFILES_MAX,
  SHIPPING_PROFILE_NAME_MAX,
  STOREFRONT_FONTS,
  type ProductPageConfig,
  type ShippingProfile,
  type StorefrontFont,
  type StorefrontPolicies,
  type StorefrontSeller,
} from "@/types/storefront";
import { FONT_LABELS } from "./config-maps";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select, type SelectOption } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  fieldBaseClass,
  helpTextClass,
  iconButtonClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";

/**
 * The Product page group of the design panel: five sections, each a
 * CollapsibleSection so a search hit can summon exactly one.
 *
 * Every control writes `{ ...current, field }` through the designer's
 * mutators, so undo coalesces per field and the saved jsonb only ever holds
 * what the schema admits. Text fields drop their key when emptied (rather than
 * storing ""), which is what lets the email gate stay strict and lets an
 * untouched store carry no `policies` or `seller` member at all.
 */

const COUNTRY_OPTIONS = [
  { value: "", label: "Not in the EU" },
  ...EU_COUNTRIES.map((country) => ({ value: country.code, label: country.name })),
] as const;

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
  policies,
  onPoliciesChange,
  shippingProfiles,
  onShippingProfilesChange,
  seller,
  onSellerChange,
  storefrontFont,
  customFontName,
  summoned,
}: {
  productPage: ProductPageConfig;
  onProductPageChange: (next: ProductPageConfig) => void;
  policies: StorefrontPolicies;
  onPoliciesChange: (next: StorefrontPolicies) => void;
  shippingProfiles: ShippingProfile[];
  onShippingProfilesChange: (next: ShippingProfile[], coalesceKey?: string) => void;
  seller: StorefrontSeller;
  onSellerChange: (next: StorefrontSeller) => void;
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

  /** `allowNewlines` false for the dispatch line: it is one line by contract
   *  (the schema's singleLineText refuses more), and a pasted paragraph must
   *  be flattened here rather than rejected at save. */
  function setPolicy(key: keyof StorefrontPolicies, raw: string, allowNewlines = true) {
    const value = sanitizeHeaderText(raw, allowNewlines);
    const next = { ...policies };
    if (value === "") delete next[key];
    else next[key] = value;
    onPoliciesChange(next);
  }

  /** One field of one profile. The coalesce key names the profile AND the
   *  field, so typing into two profiles is two undo steps, not one. */
  function setProfile(index: number, patch: Partial<ShippingProfile>) {
    const current = shippingProfiles[index];
    if (!current) return;
    const next = shippingProfiles.map((profile, position) =>
      position === index ? { ...profile, ...patch } : profile,
    );
    onShippingProfilesChange(next, `${current.id}:${Object.keys(patch)[0] ?? "field"}`);
  }

  function addProfile() {
    if (!canAddShippingProfile(shippingProfiles)) return;
    onShippingProfilesChange([
      ...shippingProfiles,
      { id: newShippingProfileId(), name: "", body: "" },
    ]);
  }

  function removeProfile(index: number) {
    onShippingProfilesChange(shippingProfiles.filter((_, position) => position !== index));
  }

  function setSeller(key: keyof StorefrontSeller, raw: string, allowNewlines = false) {
    const value = sanitizeHeaderText(raw, allowNewlines);
    const next = { ...seller };
    if (value === "") delete next[key];
    else next[key] = value;
    onSellerChange(next);
  }

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

      <CollapsibleSection
        title="Shipping and returns"
        collapsible
        defaultOpen={false}
        summon={summoned === "policies"}
        headerAction={
          <InfoTip label="Where this text appears, and what EU sellers add">
            Shown on every product page of this storefront. For EU sellers the page also states
            the 14-day cancellation right and the 2-year guarantee.
          </InfoTip>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-shipping`} className={labelClass}>
              Shipping
            </label>
            <textarea
              id={`${fieldId}-shipping`}
              value={policies.shipping ?? ""}
              maxLength={POLICY_TEXT_MAX}
              rows={4}
              placeholder="Where you ship, how long it takes, what it costs"
              onChange={(event) => setPolicy("shipping", event.target.value)}
              className={fieldBaseClass}
            />
            <p className={helpTextClass}>
              Every product uses this unless it points at a profile below.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-dispatch`} className={labelClass}>
                Dispatch time
              </label>
              <InfoTip label="Why this is its own field">
                One line, printed beside the buy button. &ldquo;When does it leave?&rdquo; is the
                first thing buyers ask, and it should not need reading a paragraph to answer.
              </InfoTip>
            </div>
            <input
              id={`${fieldId}-dispatch`}
              type="text"
              value={policies.dispatch ?? ""}
              maxLength={SHIPPING_DISPATCH_MAX}
              placeholder="Ships within 1-3 business days"
              onChange={(event) => setPolicy("dispatch", event.target.value, false)}
              className={fieldBaseClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-returns`} className={labelClass}>
              Returns
            </label>
            <textarea
              id={`${fieldId}-returns`}
              value={policies.returns ?? ""}
              maxLength={POLICY_TEXT_MAX}
              rows={4}
              placeholder="How returns work, who pays for them, any exceptions"
              onChange={(event) => setPolicy("returns", event.target.value)}
              className={fieldBaseClass}
            />
            <p className={helpTextClass}>
              {POLICY_TEXT_MAX - (policies.returns?.length ?? 0)} characters left
            </p>
          </div>

          {/* THE EXCEPTIONS, and only the exceptions.
              Shipping reads the same for nearly everything a seller lists, so
              the terms above are the answer for nearly every product and no
              product form should ask again. What a catalogue does need is
              somewhere to put the handful that ship differently — the bulky
              one, the made-to-order one — and that is a NAMED set of terms a
              product points at, never prose retyped on the product. It is what
              Shopify and Etsy both call a shipping profile, and it is why
              editing one here changes every product using it. */}
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center gap-1.5">
              <span className={labelClass}>Shipping profiles</span>
              <InfoTip label="What a shipping profile is for">
                For the few products that ship differently from the terms above. Pick one on the
                product itself, under Shipping. Editing a profile changes every product using it;
                removing one sends those products back to your default terms.
              </InfoTip>
            </div>

            {shippingProfiles.length === 0 ? (
              <p className={helpTextClass}>
                None yet. Add one only if some products ship differently.
              </p>
            ) : (
              <ul className="space-y-3">
                {shippingProfiles.map((profile, index) => (
                  <li
                    key={profile.id}
                    className="space-y-2 rounded-md border border-border p-3"
                    data-shipping-profile={profile.id}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <label
                          htmlFor={`${fieldId}-profile-name-${profile.id}`}
                          className={labelClass}
                        >
                          Name
                        </label>
                        <input
                          id={`${fieldId}-profile-name-${profile.id}`}
                          type="text"
                          value={profile.name}
                          maxLength={SHIPPING_PROFILE_NAME_MAX}
                          placeholder="Bulky items"
                          onChange={(event) =>
                            setProfile(index, {
                              name: sanitizeHeaderText(event.target.value, false),
                            })
                          }
                          className={fieldBaseClass}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeProfile(index)}
                        aria-label={
                          profile.name.trim()
                            ? `Remove the ${profile.name.trim()} shipping profile`
                            : "Remove this shipping profile"
                        }
                        title="Remove this profile"
                        className={cn(iconButtonClass, "mt-6 shrink-0")}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`${fieldId}-profile-dispatch-${profile.id}`}
                        className={labelClass}
                      >
                        Dispatch time
                      </label>
                      <input
                        id={`${fieldId}-profile-dispatch-${profile.id}`}
                        type="text"
                        value={profile.dispatch ?? ""}
                        maxLength={SHIPPING_DISPATCH_MAX}
                        placeholder="Made to order, allow 3 weeks"
                        onChange={(event) =>
                          setProfile(index, {
                            dispatch: sanitizeHeaderText(event.target.value, false),
                          })
                        }
                        className={fieldBaseClass}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`${fieldId}-profile-body-${profile.id}`}
                        className={labelClass}
                      >
                        Shipping
                      </label>
                      <textarea
                        id={`${fieldId}-profile-body-${profile.id}`}
                        value={profile.body}
                        maxLength={POLICY_TEXT_MAX}
                        rows={4}
                        placeholder="How these products ship, and what it costs"
                        onChange={(event) =>
                          setProfile(index, {
                            body: sanitizeHeaderText(event.target.value, true),
                          })
                        }
                        className={fieldBaseClass}
                      />
                      {/* A profile with no terms is dropped on save rather
                          than stored as a name pointing at nothing, so this
                          says so before the seller finds out by saving. */}
                      {profile.body.trim() === "" && (
                        <p className={helpTextClass}>
                          Add terms, or this profile is dropped when you save.
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {canAddShippingProfile(shippingProfiles) ? (
              <button type="button" onClick={addProfile} className={secondaryButtonClass}>
                <Plus className="size-4" aria-hidden="true" />
                Add a profile
              </button>
            ) : (
              <p className={helpTextClass}>
                That is all {SHIPPING_PROFILES_MAX} profiles. Remove one to add another.
              </p>
            )}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Seller details"
        collapsible
        defaultOpen={false}
        summon={summoned === "seller"}
        headerAction={
          <InfoTip label="Why this section exists">
            Distance-selling law asks for the seller&apos;s name, address and a way to get in
            touch next to every offer. Shown in the page&apos;s Seller section.
          </InfoTip>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-business`} className={labelClass}>
              Business name
            </label>
            <input
              id={`${fieldId}-business`}
              type="text"
              value={seller.businessName ?? ""}
              maxLength={SELLER_FIELD_MAX.businessName}
              onChange={(event) => setSeller("businessName", event.target.value)}
              className={fieldBaseClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-address`} className={labelClass}>
              Address
            </label>
            <textarea
              id={`${fieldId}-address`}
              value={seller.address ?? ""}
              maxLength={SELLER_FIELD_MAX.address}
              rows={3}
              onChange={(event) => setSeller("address", event.target.value, true)}
              className={fieldBaseClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-country`} className={labelClass}>
              Country
            </label>
            <Select
              id={`${fieldId}-country`}
              value={seller.country ?? ""}
              options={COUNTRY_OPTIONS}
              onChange={(country) => {
                const next = { ...seller };
                if (country === "") delete next.country;
                else next.country = country;
                onSellerChange(next);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-email`} className={labelClass}>
              Contact email
            </label>
            <input
              id={`${fieldId}-email`}
              type="email"
              value={seller.email ?? ""}
              maxLength={254}
              autoComplete="email"
              onChange={(event) => setSeller("email", event.target.value)}
              className={fieldBaseClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-phone`} className={labelClass}>
              Phone
            </label>
            <input
              id={`${fieldId}-phone`}
              type="tel"
              value={seller.phone ?? ""}
              maxLength={SELLER_FIELD_MAX.phone}
              autoComplete="tel"
              onChange={(event) => setSeller("phone", event.target.value)}
              className={fieldBaseClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-vat`} className={labelClass}>
              VAT ID
            </label>
            <input
              id={`${fieldId}-vat`}
              type="text"
              value={seller.vatId ?? ""}
              maxLength={SELLER_FIELD_MAX.vatId}
              spellCheck={false}
              onChange={(event) => setSeller("vatId", event.target.value)}
              className={fieldBaseClass}
            />
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
