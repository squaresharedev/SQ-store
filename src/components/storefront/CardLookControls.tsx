"use client";

import { useTranslations } from "next-intl";
import {
  DEFAULT_WHITE_BLEND,
  PHOTO_SHAPES,
  SHADOW_PRESETS,
  WHITE_BLENDS,
  type CardStyle,
  type CardStyleOverrides,
  type FontRole,
  type PhotoShape,
  type ShadowPreset,
  type StorefrontTheme,
} from "@/types/storefront";
import { cardLookColorField, type CardLookColorKind } from "@/lib/storefront/card-look-fields";
import { cn } from "@/lib/utils";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { infoTextClass, strongLabelClass } from "@/components/ui/control-styles";
import { OptionCardPicker, optionGlyphFrameClass } from "./OptionCardPicker";
import { blendsInto, LEGACY_PHOTO_FRAME } from "./card-look";

/**
 * THE CARD LOOK'S CONTROLS (Photo cards, editor upgrade), for the theme's
 * Product cards section and a product's own Tile style alike (they ride in
 * CardStyleControls, which serves both scopes).
 *
 * Two in the open, because they are the ones that fix a white studio photo on
 * a coloured board: the card's colour and "Blend white background". Everything
 * else (the name strip's colours and face, the photo's outline, the shadow)
 * waits behind "More".
 *
 * Same patch contract as the rest of CardStyleControls: every change emits
 * only its own field. On the THEME, a choice that is the default emits
 * `undefined` so the key is dropped (patchThemeCardStyle) and an untouched
 * storefront stays byte-identical; on a tile, a choice is that tile's own and
 * is kept even when it matches the theme, so the tile stops following it.
 */

/** Which layers the colours are resolved against (CardStyleControls'
 *  colorScope): the theme, and the tile override being edited if any. */
type Scope = {
  theme: StorefrontTheme;
  overrides?: CardStyleOverrides;
  scope: "theme" | "many" | { blockKey: string };
};

/** One of the card look's three colours, as a picker: an inherit dot that
 *  clears the override, and a target so the wheel opens the docked panel. */
function CardLookColor({
  kind,
  scope,
  onChange,
}: {
  kind: CardLookColorKind;
  scope: Scope;
  onChange: (hex: string | undefined) => void;
}) {
  const tKey = useTranslations();
  const field = cardLookColorField(scope.theme, scope.scope === "theme" ? undefined : (scope.overrides ?? {}), kind);
  const inherit = field.inherit!;
  return (
    <ColorPicker
      label={tKey(field.label)}
      labelClassName={strongLabelClass}
      value={field.value}
      onChange={onChange}
      inherit={{
        label: tKey(inherit.label),
        useLabel: tKey(inherit.useLabel),
        value: inherit.value,
        active: inherit.active,
        onSelect: () => onChange(undefined),
      }}
      target={
        scope.scope === "many"
          ? undefined
          : { kind, ...(scope.scope === "theme" ? {} : scope.scope) }
      }
    />
  );
}

/** A tiny card showing one photo outline. */
function ShapeGlyph({ shape }: { shape: PhotoShape }) {
  return (
    <span aria-hidden="true" className={cn("flex h-12 w-10 items-center justify-center bg-background", optionGlyphFrameClass)}>
      <span
        className={cn(
          "bg-foreground/35",
          shape === "rectangle" && "size-full",
          shape === "rounded" && "h-9 w-7 rounded-md",
          shape === "arch" && "h-9 w-7 rounded-t-full",
          shape === "circle" && "size-7 rounded-full",
        )}
      />
    </span>
  );
}

/** A tiny card lifted by one shadow preset. */
function ShadowGlyph({ shadow }: { shadow: ShadowPreset }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-10 w-8 rounded-sm border border-border bg-background",
        shadow === "soft" && "shadow-md",
        shadow === "lifted" && "-translate-y-0.5 shadow-lg",
      )}
    />
  );
}

/** The photo outline picker: shared by a card's "More" and an image block's
 *  own panel, so the two read as one control. */
export function PhotoShapePicker({
  value,
  onChange,
  label,
}: {
  value: PhotoShape;
  onChange: (shape: PhotoShape) => void;
  label: string;
}) {
  const t = useTranslations("EditorCards.panel.photoShape");
  return (
    <div className="space-y-1.5">
      <span className={strongLabelClass}>{label}</span>
      <OptionCardPicker
        value={value}
        options={PHOTO_SHAPES.map((shape) => ({ value: shape, label: t(shape), glyph: <ShapeGlyph shape={shape} /> }))}
        onChange={onChange}
        ariaLabel={label}
      />
    </div>
  );
}

/** The shadow picker: shared by cards, image blocks and shapes. */
export function ShadowPicker({ value, onChange }: { value: ShadowPreset; onChange: (shadow: ShadowPreset) => void }) {
  const t = useTranslations("EditorCards.panel.shadow");
  return (
    <div className="space-y-1.5">
      <span className={strongLabelClass}>{t("label")}</span>
      <OptionCardPicker
        value={value}
        options={SHADOW_PRESETS.map((shadow) => ({ value: shadow, label: t(shadow), glyph: <ShadowGlyph shadow={shadow} /> }))}
        onChange={onChange}
        ariaLabel={t("label")}
      />
    </div>
  );
}

/** The two that stay in the open: the card's colour, and the blend. */
export function CardLookMainControls({
  value,
  onChange,
  colorScope,
}: {
  value: CardStyle;
  onChange: (patch: CardStyleOverrides) => void;
  colorScope?: Scope;
}) {
  const t = useTranslations("EditorCards.panel");
  const onTheme = !colorScope || colorScope.scope === "theme";
  // Blending stops on a dark card (card-look), so say so where it is set.
  const darkCard = value.whiteBlend !== "off" && !blendsInto(value.cardColor ?? LEGACY_PHOTO_FRAME);
  return (
    <>
      {colorScope && (
        <CardLookColor kind="card-color" scope={colorScope} onChange={(cardColor) => onChange({ cardColor })} />
      )}
      <div className="space-y-1.5">
        <span className={strongLabelClass}>{t("blend.label")}</span>
        <SegmentedControl
          value={value.whiteBlend}
          options={WHITE_BLENDS.map((blend) => ({ value: blend, label: t(`blend.${blend}`) }))}
          onChange={(whiteBlend) =>
            onChange({ whiteBlend: onTheme && whiteBlend === DEFAULT_WHITE_BLEND ? undefined : whiteBlend })
          }
          ariaLabel={t("blend.label")}
        />
        <p className={infoTextClass}>{darkCard ? t("blend.darkCard") : t("blend.hint")}</p>
      </div>
    </>
  );
}

/** Everything else, behind "More": the name strip, the name's face, the
 *  photo's outline and the card's shadow. */
export function CardLookMoreControls({
  value,
  onChange,
  colorScope,
}: {
  value: CardStyle;
  onChange: (patch: CardStyleOverrides) => void;
  colorScope?: Scope;
}) {
  const t = useTranslations("EditorCards.panel");
  const onTheme = !colorScope || colorScope.scope === "theme";
  // The strip exists for a bar or an overlay; a `shadow` title has a fade.
  const strip = value.showTitle && value.titleStyle !== "shadow";
  // Without a font pairing there is one face, and the choice says nothing.
  const pairing = colorScope?.theme.fontPairing !== undefined;
  const nameFont: FontRole = value.titleFont ?? "body";
  return (
    <CollapsibleSection title={t("more")} collapsible defaultOpen={false}>
      <div className="space-y-4">
        {colorScope && strip && (
          <CardLookColor
            kind="title-bar-color"
            scope={colorScope}
            onChange={(titleBarColor) => onChange({ titleBarColor })}
          />
        )}
        {colorScope && value.showTitle && (
          <CardLookColor
            kind="title-text-color"
            scope={colorScope}
            onChange={(titleTextColor) => onChange({ titleTextColor })}
          />
        )}
        {value.showTitle && pairing && (
          <div className="space-y-1.5">
            <span className={strongLabelClass}>{t("nameFont.label")}</span>
            <SegmentedControl
              value={nameFont}
              options={(["heading", "body"] as const).map((role) => ({ value: role, label: t(`nameFont.${role}`) }))}
              onChange={(role) => onChange({ titleFont: onTheme && role === "body" ? undefined : role })}
              ariaLabel={t("nameFont.label")}
            />
          </div>
        )}
        <PhotoShapePicker
          label={t("photoShape.label")}
          value={value.photoShape ?? "rectangle"}
          onChange={(shape) => onChange({ photoShape: onTheme && shape === "rectangle" ? undefined : shape })}
        />
        <ShadowPicker
          value={value.shadow}
          onChange={(shadow) => onChange({ shadow: onTheme && shadow === "none" ? undefined : shadow })}
        />
      </div>
    </CollapsibleSection>
  );
}
