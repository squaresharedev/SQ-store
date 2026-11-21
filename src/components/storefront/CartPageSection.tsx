"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ShoppingBag } from "lucide-react";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import { hasContactOrPaymentDetails } from "@/lib/validation/inputs";
import { suggestCartLead } from "@/lib/predictions";
import type { CartPagePanelSection } from "@/lib/storefront/setting-ref";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SuggestionChip } from "@/components/ui/SuggestionChip";
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
 * THE CART, as a seller designs it, in two short sections that a click on the
 * product page artboard opens: "Adding to cart" (on or off, which of the
 * page's two buttons leads, what follows a press, whether cards add, the
 * button's words) and "Inside the cart" (its heading and note, which are also
 * typed straight onto the cart where it opens, and its two optional parts).
 * The cart's colours and corners are the product page's (it opens over it),
 * so there is nothing to colour here. One line per control; what a control
 * does is in its hint, not in a paragraph.
 *
 * `addable` is how many products the board's cards put straight in the cart:
 * with enough of them, "Add to cart" as the leading button is offered behind
 * one tap (lib/predictions.ts suggestCartLead), and taken back with one.
 *
 * Every text is plain words held to the prose rule as it is typed (no links,
 * email addresses or bank details: sellerProse), like the checkout's.
 */
export function CartPageSection({
  cartPage,
  onCartPageChange,
  summoned = null,
  addable = 0,
}: {
  cartPage: CartPageConfig;
  onCartPageChange: (next: CartPageConfig) => void;
  summoned?: CartPagePanelSection | null;
  addable?: number;
}) {
  const fieldId = useId();
  const t = useTranslations("Storefront.cartPage");
  const tRoot = useTranslations();
  const tCart = useTranslations("ProductPage.cart");
  const on = cartPage.enabled !== false;
  // The guess as the tap left it: offered back only while it still is.
  const [lead, setLead] = useState<{ before: CartPageConfig; after: CartPageConfig } | null>(null);
  const leadDone = lead !== null && lead.after === cartPage;

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
    <div data-cart-page-section="">
      <CollapsibleSection title={t("sections.buttons")} collapsible summon={summoned === "buttons"}>
        <div className="space-y-5">
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
                    onCartPageChange(
                      value === "buyNow" ? withoutKey(cartPage, "mainButton") : { ...cartPage, mainButton: value },
                    )
                  }
                />
              </PanelField>
              {(leadDone || suggestCartLead(cartPage, addable)) && (
                <div data-cart-lead-suggestion="">
                  <SuggestionChip
                    icon={ShoppingBag}
                    label={t("leadGuess.label")}
                    hint={t("leadGuess.hint", { count: addable })}
                    done={leadDone}
                    onApply={() => {
                      const after: CartPageConfig = { ...cartPage, mainButton: "addToCart" };
                      setLead({ before: cartPage, after });
                      onCartPageChange(after);
                    }}
                    onUndo={() => {
                      if (!lead) return;
                      onCartPageChange(lead.before);
                      setLead(null);
                    }}
                  />
                </div>
              )}
              <PanelField label={t("afterAdd.label")}>
                <SegmentedControl
                  ariaLabel={t("afterAdd.label")}
                  value={cartPage.afterAdd ?? "openCart"}
                  options={CART_AFTER_ADD.map((value) => ({ value, label: t(`afterAdd.${value}`) }))}
                  onChange={(value) =>
                    onCartPageChange(
                      value === "openCart" ? withoutKey(cartPage, "afterAdd") : { ...cartPage, afterAdd: value },
                    )
                  }
                />
              </PanelField>
              {offSwitch("quickAdd", t("quickAdd"), t("quickAddHint"))}
              {textField("addLabel", t("addLabel"), tCart("add"), CART_ADD_LABEL_MAX)}
            </>
          )}
        </div>
      </CollapsibleSection>

      {on && (
        <CollapsibleSection
          title={t("sections.cart")}
          collapsible
          defaultOpen={false}
          summon={summoned === "cart"}
        >
          <div className="space-y-5">
            {textField("title", t("title"), tCart("title"), CART_TITLE_MAX)}
            {textField("note", t("note"), t("notePlaceholder"), CART_NOTE_MAX, true)}
            {offSwitch("deliveryBar", t("deliveryBar"), t("deliveryBarHint"))}
            {offSwitch("suggestions", t("suggestions"), t("suggestionsHint"))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
