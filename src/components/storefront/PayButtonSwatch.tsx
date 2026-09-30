import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";
import { resolveCta } from "@/components/product-page/product-page-maps";
import type { ProductPageConfig, StorefrontTheme } from "@/types/storefront";

/**
 * The checkout's pay button in miniature: its real fill, corners and outline,
 * resolved by the same resolveCta the checkout paints with, with the label
 * drawn as a bar in the ink that reads on the fill. The panel shows the
 * button rather than describing it.
 *
 * With `onStyle` it IS the way to style it (a button named by `styleLabel`,
 * which opens the product page's button settings, where the paint lives), the
 * way a colour swatch is the way to change a colour. Without one (no designer
 * behind the panel) it is a still picture.
 */
export function PayButtonSwatch({
  productPage,
  theme,
  onStyle,
  styleLabel,
}: {
  productPage: Pick<ProductPageConfig, "ctaColor" | "ctaRadius" | "ctaBorderWidth" | "ctaBorderColor">;
  theme: Pick<StorefrontTheme, "accent" | "cornerRadius">;
  onStyle?: () => void;
  /** The accessible name when it is a button. */
  styleLabel?: string;
}) {
  const cta = resolveCta(productPage, theme);
  const style = {
    backgroundColor: cta.fill,
    color: cta.text,
    // Half size, like the button it stands for, and never rounder than a pill.
    borderRadius: `${Math.min(cta.radius / 2, 14)}px`,
    ...(cta.borderWidth > 0
      ? { boxShadow: `inset 0 0 0 ${Math.max(cta.borderWidth / 2, 1)}px ${cta.borderColor}` }
      : {}),
  };
  const face = (
    <>
      <Lock className="size-2.5" strokeWidth={2.5} aria-hidden="true" />
      <span className="h-1 w-7 rounded-full bg-current opacity-90" aria-hidden="true" />
    </>
  );
  const box = "inline-flex h-7 w-20 shrink-0 items-center justify-center gap-1";

  if (!onStyle) {
    return (
      <span aria-hidden="true" className={box} style={style} data-pay-button-swatch={cta.fill}>
        {face}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onStyle}
      aria-label={styleLabel}
      className={cn(box, transitionClass, focusRingClass, "hover:opacity-85")}
      style={style}
      data-pay-button-swatch={cta.fill}
    >
      {face}
    </button>
  );
}
