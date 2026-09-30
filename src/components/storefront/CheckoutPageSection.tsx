"use client";

import { useId } from "react";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import { hasContactOrPaymentDetails } from "@/lib/validation/inputs";
import { useSettingTarget } from "@/lib/storefront/setting-context";
import type { CheckoutPagePanelSection } from "@/lib/storefront/setting-ref";
import {
  CHECKOUT_CELEBRATIONS,
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
import { InfoTip } from "@/components/ui/InfoTip";
import { Tooltip } from "@/components/ui/Tooltip";
import { Switch } from "@/components/ui/switch";
import {
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  infoTipTriggerClass,
  labelClass,
  stubBadgeClass,
} from "@/components/ui/control-styles";
import { OptionCardPicker } from "./OptionCardPicker";
import { ArrangementGlyph, CelebrationGlyph } from "./CheckoutGlyphs";
import { CheckoutTexturePicker } from "./CheckoutTexturePicker";
import { PayButtonSwatch } from "./PayButtonSwatch";

type OptionalText = "headline" | "note" | "thanksHeadline" | "thanksMessage";

/** The share of a field's limit left at which "N characters left" appears.
 *  Above it the count is noise; the field's maxLength still holds. */
const CHARS_LEFT_SHOWN_BELOW = 0.2;

function nearLimit(length: number, max: number): boolean {
  return max - length <= max * CHARS_LEFT_SHOWN_BELOW;
}

/** The config without one optional field: emptying a text, going back to
 *  following the product page, or back to a plain page, DELETES the key rather
 *  than storing "" (which the schema would refuse) or a value that means
 *  "inherit". */
function withoutKey(
  config: CheckoutPageConfig,
  key: OptionalText | "backgroundColor" | "texture",
): CheckoutPageConfig {
  const next = { ...config };
  delete next[key];
  return next;
}

/**
 * The Checkout group of the design panel: three sections, each a
 * CollapsibleSection so a search hit or a click on the artboard can summon
 * exactly one.
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
  live,
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
  /** Whether buyers can reach checkout yet (a payment provider is connected). */
  live: boolean;
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

  /** One text control: sanitized as typed, dropped when emptied. */
  function setText(key: OptionalText, raw: string, multiline: boolean) {
    const value = sanitizeHeaderText(raw, multiline);
    onCheckoutPageChange(
      value.trim() === "" ? withoutKey(checkoutPage, key) : { ...checkoutPage, [key]: value },
    );
  }

  /** The prose rule, said as the seller types rather than when a save fails. */
  function proseProblem(value: string | undefined): string | null {
    return value && hasContactOrPaymentDetails(value) ? tRoot("Validation.generic.sellerProse") : null;
  }

  function textField(options: {
    key: OptionalText;
    label: string;
    placeholder: string;
    max: number;
    multiline: boolean;
  }) {
    const id = `${fieldId}-${options.key}`;
    const value = checkoutPage[options.key] ?? "";
    const problem = proseProblem(checkoutPage[options.key]);
    const shared = {
      id,
      value,
      maxLength: options.max,
      placeholder: options.placeholder,
      "aria-invalid": problem !== null,
      className: fieldBaseClass,
    };
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className={labelClass}>
          {options.label}
        </label>
        {options.multiline ? (
          <textarea
            {...shared}
            rows={3}
            onChange={(event) => setText(options.key, event.target.value, true)}
          />
        ) : (
          <input
            {...shared}
            type="text"
            spellCheck={false}
            onChange={(event) => setText(options.key, event.target.value, false)}
          />
        )}
        {problem ? (
          <p className={errorTextClass}>{problem}</p>
        ) : (
          nearLimit(value.length, options.max) && (
            <p className={helpTextClass}>{t("charsLeft", { count: options.max - value.length })}</p>
          )
        )}
      </div>
    );
  }

  return (
    <>
      {/* Not reachable by buyers yet: a chip, with the why behind its tip. */}
      {!live && (
        <div className="flex items-center gap-1 px-1 pb-2" data-checkout-unwired="">
          <span className={cn(stubBadgeClass, "ml-0")}>{t("unwiredBadge")}</span>
          <InfoTip label={t("unwiredInfoLabel")}>{t("unwired")}</InfoTip>
        </div>
      )}

      <CollapsibleSection title={t("layout.title")} collapsible summon={summoned === "layout"}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className={labelClass}>{t("layout.arrangement.label")}</span>
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
          </div>

          <ColorPicker
            label={t("layout.pageColor")}
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

          {/* Each choice drawn over the colour just picked above, so the
              swatches re-tint as the colour changes. */}
          <div className="space-y-1.5" data-checkout-texture-row="">
            <span className={labelClass}>{t("layout.texture.label")}</span>
            <CheckoutTexturePicker
              value={checkoutPage.texture}
              surface={checkoutPage.backgroundColor ?? inherited}
              onChange={(texture) =>
                onCheckoutPageChange(
                  texture ? { ...checkoutPage, texture } : withoutKey(checkoutPage, "texture"),
                )
              }
            />
          </div>

          {/* THE PAY BUTTON IS THE BUY BUTTON. Given a row here, with a way to
              it, because a seller looking for "the button" in the checkout's
              own panel should find out where it lives rather than conclude it
              cannot be styled. */}
          <div className="flex items-center justify-between gap-3" data-checkout-pay-row="">
            <div className="flex items-center gap-1.5">
              <span className={labelClass}>{t("layout.payButton")}</span>
              <InfoTip label={t("layout.payButtonInfoLabel")}>{t("layout.button")}</InfoTip>
            </div>
            {/* The button itself, in miniature, and pressing it is how it is
                styled: like a colour swatch, the picture is the control. */}
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
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t("message.title")}
        collapsible
        defaultOpen={false}
        summon={summoned === "message"}
      >
        <div className="space-y-4">
          {textField({
            key: "headline",
            label: t("message.headline"),
            placeholder: tRoot("ProductPage.checkout.headline"),
            max: CHECKOUT_HEADLINE_MAX,
            multiline: false,
          })}
          {textField({
            key: "note",
            label: t("message.note"),
            placeholder: t("message.notePlaceholder"),
            max: CHECKOUT_NOTE_MAX,
            multiline: true,
          })}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-gift`} className={labelClass}>
                {t("message.gift.label")}
              </label>
              <InfoTip label={t("message.gift.infoLabel")}>{t("message.gift.info")}</InfoTip>
            </div>
            <Switch
              id={`${fieldId}-gift`}
              checked={checkoutPage.giftMessage}
              onCheckedChange={(giftMessage) => onCheckoutPageChange({ ...checkoutPage, giftMessage })}
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t("thanks.title")}
        collapsible
        defaultOpen={false}
        summon={summoned === "thanks"}
      >
        <div className="space-y-4">
          {textField({
            key: "thanksHeadline",
            label: t("thanks.headline"),
            placeholder: tRoot("ProductPage.order.thanksNamed", { name: t("thanks.sampleName") }),
            max: CHECKOUT_HEADLINE_MAX,
            multiline: false,
          })}
          {textField({
            key: "thanksMessage",
            label: t("thanks.message"),
            placeholder: t("thanks.messagePlaceholder"),
            max: CHECKOUT_THANKS_MESSAGE_MAX,
            multiline: true,
          })}
          <div className="space-y-1.5">
            <div className="flex min-h-6 items-center justify-between gap-3">
              <span className={labelClass}>{t("thanks.celebrate.label")}</span>
              {/* Replays it on the thank-you artboard. An icon beside the
                  label rather than a row of its own: it is a preview, not a
                  setting. */}
              {onPlayCelebration && checkoutPage.celebrate !== "none" && (
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
            </div>
            <OptionCardPicker
              ariaLabel={t("thanks.celebrate.label")}
              value={checkoutPage.celebrate}
              options={CHECKOUT_CELEBRATIONS.map((kind) => ({
                value: kind,
                label: t(`thanks.celebrate.${kind}`),
                glyph: <CelebrationGlyph kind={kind} />,
              }))}
              onChange={(celebrate) => onCheckoutPageChange({ ...checkoutPage, celebrate })}
            />
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
