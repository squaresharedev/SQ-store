"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import { hasContactOrPaymentDetails } from "@/lib/validation/inputs";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/switch";
import {
  CART_ADD_LABEL_MAX,
  CART_AFTER_ADD,
  CART_MAIN_BUTTONS,
  CART_NOTE_MAX,
  CART_TITLE_MAX,
  type CartPageConfig,
} from "@/types/storefront";
import { PanelField, PanelRow, PanelTextField } from "./PanelField";

type CartText = "addLabel" | "title" | "note";

/** The cart's parts a seller can take away, each on unless switched off. */
type CartOffSwitch = "deliveryBar" | "quickAdd" | "suggestions";

/** A copy of `config` without `key`: an option back at its default is
 *  absent, so an untouched cart stores nothing. */
function withoutKey<K extends keyof CartPageConfig>(config: CartPageConfig, key: K): CartPageConfig {
  const next = { ...config };
  delete next[key];
  return next;
}

/**
 * THE CART, as a seller designs it: on or off, which of the product page's
 * two buttons leads, what follows "Add to cart", whether cards add to it,
 * the cart's own words, and its delivery line and "Goes well with".
 * The cart's colours and corners are the product page's (it opens over it),
 * so there is nothing to colour here. One line per control; what a control
 * does is in its hint, not in a paragraph.
 *
 * Every text is plain words held to the prose rule as it is typed (no links,
 * email addresses or bank details: sellerProse), like the checkout's.
 */
export function CartPageSection({
  cartPage,
  onCartPageChange,
}: {
  cartPage: CartPageConfig;
  onCartPageChange: (next: CartPageConfig) => void;
}) {
  const fieldId = useId();
  const t = useTranslations("Storefront.cartPage");
  const tRoot = useTranslations();
  const tCart = useTranslations("ProductPage.cart");
  const on = cartPage.enabled !== false;

  function textField(key: CartText, label: string, placeholder: string, max: number, multiline = false) {
    const value = cartPage[key];
    return (
      <PanelTextField
        id={`${fieldId}-${key}`}
        label={label}
        value={value ?? ""}
        max={max}
        multiline={multiline}
        placeholder={placeholder}
        problem={value && hasContactOrPaymentDetails(value) ? tRoot("Validation.generic.sellerProse") : null}
        charsLeft={(count) => tRoot("Storefront.checkoutPage.charsLeft", { count })}
        onChange={(raw) => {
          const next = sanitizeHeaderText(raw, multiline);
          onCartPageChange(next.trim() === "" ? withoutKey(cartPage, key) : { ...cartPage, [key]: next });
        }}
      />
    );
  }

  /** A part that is on unless switched off: absent when on. */
  function offSwitch(key: CartOffSwitch, label: string, hint: string) {
    return (
      <PanelRow label={label} htmlFor={`${fieldId}-${key}`} info={{ label, content: hint }}>
        <Switch
          id={`${fieldId}-${key}`}
          checked={cartPage[key] !== false}
          onCheckedChange={(next) => onCartPageChange(next ? withoutKey(cartPage, key) : { ...cartPage, [key]: false })}
        />
      </PanelRow>
    );
  }

  return (
    <div className="space-y-5 px-4 py-4" data-cart-page-section="">
      <PanelRow label={t("on")} htmlFor={`${fieldId}-on`} info={{ label: t("on"), content: t("onHint") }}>
        <Switch
          id={`${fieldId}-on`}
          checked={on}
          onCheckedChange={(next) =>
            onCartPageChange(next ? withoutKey(cartPage, "enabled") : { ...cartPage, enabled: false })
          }
        />
      </PanelRow>

      {on && (
        <>
          <PanelField label={t("mainButton.label")}>
            <SegmentedControl
              ariaLabel={t("mainButton.label")}
              value={cartPage.mainButton ?? "buyNow"}
              options={CART_MAIN_BUTTONS.map((value) => ({ value, label: t(`mainButton.${value}`) }))}
              onChange={(value) =>
                onCartPageChange(value === "buyNow" ? withoutKey(cartPage, "mainButton") : { ...cartPage, mainButton: value })
              }
            />
          </PanelField>
          <PanelField label={t("afterAdd.label")}>
            <SegmentedControl
              ariaLabel={t("afterAdd.label")}
              value={cartPage.afterAdd ?? "openCart"}
              options={CART_AFTER_ADD.map((value) => ({ value, label: t(`afterAdd.${value}`) }))}
              onChange={(value) =>
                onCartPageChange(value === "openCart" ? withoutKey(cartPage, "afterAdd") : { ...cartPage, afterAdd: value })
              }
            />
          </PanelField>
          {offSwitch("quickAdd", t("quickAdd"), t("quickAddHint"))}
          {textField("addLabel", t("addLabel"), tCart("add"), CART_ADD_LABEL_MAX)}
          {textField("title", t("title"), tCart("title"), CART_TITLE_MAX)}
          {textField("note", t("note"), t("notePlaceholder"), CART_NOTE_MAX, true)}
          {offSwitch("deliveryBar", t("deliveryBar"), t("deliveryBarHint"))}
          {offSwitch("suggestions", t("suggestions"), t("suggestionsHint"))}
        </>
      )}
    </div>
  );
}
