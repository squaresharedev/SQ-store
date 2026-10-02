"use client";

import { useId } from "react";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import { hasContactOrPaymentDetails } from "@/lib/validation/inputs";
import { useSettingTarget } from "@/lib/storefront/setting-context";
import type { CheckoutPagePanelSection } from "@/lib/storefront/setting-ref";
import {
  CHECKOUT_HEADLINE_MAX,
  CHECKOUT_LAYOUTS,
  CHECKOUT_NOTE_MAX,
  CHECKOUT_THANKS_MESSAGE_MAX,
  type CheckoutPageConfig,
  type ProductPageConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import { storefrontBackdropHex } from "@/components/product-page/product-page-maps";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Tooltip } from "@/components/ui/Tooltip";
import { Switch } from "@/components/ui/switch";
import {
  infoTipTriggerClass,
  panelCaptionClass,
} from "@/components/ui/control-styles";
import { OptionCardPicker } from "./OptionCardPicker";
import { ArrangementGlyph } from "./CheckoutGlyphs";
import { PanelField, PanelRow, PanelTextField } from "./PanelField";
import { PagePhotoField } from "./PagePhotoField";
import { PayButtonSwatch } from "./PayButtonSwatch";

type OptionalText = "headline" | "note" | "thanksHeadline" | "thanksMessage";

/** The config without one optional field: emptying a text, or going back to
 *  following the product page, DELETES the key rather than storing "" (which
 *  the schema would refuse) or a value that means "inherit". */
function withoutKey(
  config: CheckoutPageConfig,
  key: OptionalText | "backgroundColor" | "backgroundImage",
): CheckoutPageConfig {
  const next = { ...config };
  delete next[key];
  return next;
}

/**
 * The Checkout group of the design panel: three sections, each a
 * CollapsibleSection so a search hit or a click on the artboard can summon
 * exactly one, each laid out with the panel primitives (PanelField).
 *
 * WHAT IS HERE is what a seller designs about their checkout: how it is laid
 * out, its colour, the words around the form, and the thank-you. WHAT IS NOT
 * is anything a buyer relies on (the fields, the payment, the total, who is
 * selling, the pay button's wording): those are the same for every seller, in
 * that seller's colours. The pay button's paint is the product page's buy
 * button, and this panel links there rather than offering a second copy.
 *
 * Every text is plain words. The rule the server applies to them (no links,
 * email addresses or bank details; see sellerProse) is shown here as the
 * seller types, so a save never fails on something they could have been told.
 */
export function CheckoutPageSection({
  checkoutPage,
  onCheckoutPageChange,
  productPage,
  theme,
  pagePhotoUrls = {},
  onPagePhotoUrl = () => {},
  summoned,
  onPlayCelebration,
}: {
  checkoutPage: CheckoutPageConfig;
  onCheckoutPageChange: (next: CheckoutPageConfig) => void;
  /** What the checkout inherits its backdrop and its pay button from. */
  productPage: ProductPageConfig;
  /** The storefront's background (the backdrop's last fallback), and the
   *  accent and roundness the pay button follows while the product page does. */
  theme: Pick<StorefrontTheme, "background" | "accent" | "cornerRadius">;
  /** Display URLs of the page photos by object key, and a way to add one. */
  pagePhotoUrls?: Record<string, string>;
  onPagePhotoUrl?: (key: string, url: string) => void;
  summoned: CheckoutPagePanelSection | null;
  /** Replay the celebration on the thank-you artboard. */
  onPlayCelebration?: () => void;
}) {
  const fieldId = useId();
  const t = useTranslations("Storefront.checkoutPage");
  const tRoot = useTranslations();
  const setting = useSettingTarget();

  // What following the product page currently gets the checkout: the product
  // page's own colour, else the one colour that stands for the storefront.
  const inherited = productPage.backgroundColor ?? storefrontBackdropHex(theme);

  /** One of the seller's texts: sanitized as typed, dropped when emptied, and
   *  held to the prose rule as it is typed rather than when a save fails. */
  function textField(key: OptionalText, label: string, placeholder: string, max: number, multiline = false) {
    const value = checkoutPage[key];
    return (
      <PanelTextField
        id={`${fieldId}-${key}`}
        label={label}
        value={value ?? ""}
        max={max}
        multiline={multiline}
        placeholder={placeholder}
        problem={value && hasContactOrPaymentDetails(value) ? tRoot("Validation.generic.sellerProse") : null}
        charsLeft={(count) => t("charsLeft", { count })}
        onChange={(raw) => {
          const next = sanitizeHeaderText(raw, multiline);
          onCheckoutPageChange(
            next.trim() === "" ? withoutKey(checkoutPage, key) : { ...checkoutPage, [key]: next },
          );
        }}
      />
    );
  }

  return (
    <>
      <CollapsibleSection title={t("layout.title")} collapsible summon={summoned === "layout"}>
        <div className="space-y-5">
          <PanelField label={t("layout.arrangement.label")}>
            <OptionCardPicker
              ariaLabel={t("layout.arrangement.label")}
              value={checkoutPage.layout}
              options={CHECKOUT_LAYOUTS.map((layout) => ({
                value: layout,
                label: t(`layout.arrangement.${layout}`),
                glyph: <ArrangementGlyph layout={layout} />,
              }))}
              onChange={(layout) => onCheckoutPageChange({ ...checkoutPage, layout })}
            />
          </PanelField>

          <ColorPicker
            label={t("layout.pageColor")}
            labelClassName={panelCaptionClass}
            value={checkoutPage.backgroundColor ?? inherited}
            onChange={(backgroundColor) => onCheckoutPageChange({ ...checkoutPage, backgroundColor })}
            inherit={{
              label: t("layout.followsProductPage"),
              useLabel: t("layout.useProductPage"),
              value: inherited,
              active: checkoutPage.backgroundColor === undefined,
              onSelect: () => onCheckoutPageChange(withoutKey(checkoutPage, "backgroundColor")),
            }}
          />

          {/* The checkout's photo is the thank-you page's too: one design. */}
          <PagePhotoField
            photo={checkoutPage.backgroundImage}
            url={checkoutPage.backgroundImage ? (pagePhotoUrls[checkoutPage.backgroundImage.key] ?? null) : null}
            onUrl={onPagePhotoUrl}
            onChange={(backgroundImage) =>
              onCheckoutPageChange(
                backgroundImage ? { ...checkoutPage, backgroundImage } : withoutKey(checkoutPage, "backgroundImage"),
              )
            }
          />

          {/* THE PAY BUTTON IS THE BUY BUTTON: shown here in miniature, and
              pressing it is how it is styled (the product page's button
              settings), like a colour swatch is the way to its colour. */}
          <div data-checkout-pay-row="">
            <PanelRow
              label={t("layout.payButton")}
              info={{ label: t("layout.payButtonInfoLabel"), content: t("layout.button") }}
            >
              {setting ? (
                <Tooltip label={t("layout.styleButton")}>
                  <PayButtonSwatch
                    productPage={productPage}
                    theme={theme}
                    styleLabel={t("layout.styleButton")}
                    onStyle={() => setting.open({ kind: "productPage", section: "cta" })}
                  />
                </Tooltip>
              ) : (
                <PayButtonSwatch productPage={productPage} theme={theme} />
              )}
            </PanelRow>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t("message.title")}
        collapsible
        defaultOpen={false}
        summon={summoned === "message"}
      >
        <div className="space-y-5">
          {textField("headline", t("message.headline"), tRoot("ProductPage.checkout.headline"), CHECKOUT_HEADLINE_MAX)}
          {textField("note", t("message.note"), t("message.notePlaceholder"), CHECKOUT_NOTE_MAX, true)}
          <PanelRow
            label={t("message.gift.label")}
            htmlFor={`${fieldId}-gift`}
            info={{ label: t("message.gift.infoLabel"), content: t("message.gift.info") }}
          >
            <Switch
              id={`${fieldId}-gift`}
              checked={checkoutPage.giftMessage}
              onCheckedChange={(giftMessage) => onCheckoutPageChange({ ...checkoutPage, giftMessage })}
            />
          </PanelRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t("thanks.title")}
        collapsible
        defaultOpen={false}
        summon={summoned === "thanks"}
      >
        <div className="space-y-5">
          {textField(
            "thanksHeadline",
            t("thanks.headline"),
            tRoot("ProductPage.order.thanksNamed", { name: t("thanks.sampleName") }),
            CHECKOUT_HEADLINE_MAX,
          )}
          {textField("thanksMessage", t("thanks.message"), t("thanks.messagePlaceholder"), CHECKOUT_THANKS_MESSAGE_MAX, true)}
          {/* One switch: confetti or nothing. Play replays it on the thank-you
              artboard, and sits beside the switch because it previews the
              setting rather than being one. */}
          <PanelRow label={t("thanks.celebrate.confetti")} htmlFor={`${fieldId}-confetti`}>
            {onPlayCelebration && checkoutPage.celebrate === "confetti" && (
              <Tooltip label={t("thanks.celebrate.play")}>
                <button
                  type="button"
                  className={infoTipTriggerClass}
                  onClick={onPlayCelebration}
                  aria-label={t("thanks.celebrate.play")}
                  data-checkout-play=""
                >
                  <Play className="size-3.5" strokeWidth={2} aria-hidden="true" />
                </button>
              </Tooltip>
            )}
            <Switch
              id={`${fieldId}-confetti`}
              checked={checkoutPage.celebrate === "confetti"}
              onCheckedChange={(on) => onCheckoutPageChange({ ...checkoutPage, celebrate: on ? "confetti" : "none" })}
            />
          </PanelRow>
        </div>
      </CollapsibleSection>
    </>
  );
}
