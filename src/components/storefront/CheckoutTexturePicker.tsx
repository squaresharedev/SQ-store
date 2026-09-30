"use client";

import { useTranslations } from "next-intl";
import { readableOn } from "@/components/product-page/product-page-maps";
import { TEXTURE_SWATCH_LOOK, textureLayers } from "@/components/checkout/checkout-textures";
import { CHECKOUT_TEXTURES, type CheckoutTexture } from "@/types/storefront";
import { OptionCardPicker, optionGlyphFrameClass } from "./OptionCardPicker";

/** The picker's own "no texture": a plain page is the ABSENT field, so this
 *  value never reaches the config (see CheckoutPageConfig.texture). */
type TextureChoice = CheckoutTexture | "none";

const CHOICES: readonly TextureChoice[] = ["none", ...CHECKOUT_TEXTURES];

/**
 * A tile of the texture itself, on the checkout's own colour and in the ink
 * that reads on it: the swatch IS the property, drawn by the same function as
 * the page (a little stronger and tighter, so it shows at this size).
 */
function TextureSwatch({ texture, surface }: { texture: TextureChoice; surface: string }) {
  return (
    <span
      aria-hidden="true"
      // The same small landscape page as the arrangement and celebration
      // glyphs above it (CheckoutGlyphs), filled with the checkout itself.
      className={`block h-10 w-14 ${optionGlyphFrameClass}`}
      style={{
        backgroundColor: surface,
        ...textureLayers(texture === "none" ? undefined : texture, readableOn(surface), TEXTURE_SWATCH_LOOK),
      }}
      data-texture-swatch={texture}
    />
  );
}

/**
 * The checkout's texture presets, three to a row, each shown as a swatch of
 * itself over the colour the checkout is actually wearing, so changing the
 * colour above re-tints every choice here.
 */
export function CheckoutTexturePicker({
  value,
  surface,
  onChange,
}: {
  /** Absent = plain. */
  value: CheckoutTexture | undefined;
  /** The checkout's resolved surface colour (its own, or what it inherits). */
  surface: string;
  /** Called with undefined to go back to a plain page. */
  onChange: (texture: CheckoutTexture | undefined) => void;
}) {
  const t = useTranslations("Storefront.checkoutPage.layout.texture");
  return (
    <OptionCardPicker<TextureChoice>
      ariaLabel={t("label")}
      value={value ?? "none"}
      wrap
      options={CHOICES.map((choice) => ({
        value: choice,
        label: t(choice),
        glyph: <TextureSwatch texture={choice} surface={surface} />,
      }))}
      onChange={(choice) => onChange(choice === "none" ? undefined : choice)}
    />
  );
}
