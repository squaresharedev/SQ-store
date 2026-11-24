"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  MARQUEE_SPEEDS,
  MARQUEE_TEXT_MAX,
  TEXT_VARIANTS,
  type MarqueeBlock,
  type MarqueeSpeed,
  type StorefrontTheme,
  type TextVariant,
} from "@/types/storefront";
import { resolveTextStyle } from "@/lib/storefront/text-styles";
import { derivePalette } from "@/lib/storefront/palette";
import { fieldBaseClass, labelClass } from "@/components/ui/control-styles";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Disclosure } from "@/components/ui/Disclosure";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { BlockActions } from "./BlockActions";
import { TEXT_VARIANT_LABELS } from "./config-maps";

export type MarqueeBlockPatch = Partial<Pick<MarqueeBlock, "text" | "speed" | "variant" | "color">>;

/**
 * Inspector for a SCROLLING TEXT STRIP: its words, its speed and the saved
 * text style it wears, with its own colour behind "More" (absent, the words
 * pick an ink that reads on what they sit on). A value back at its default
 * is written as absent (normal speed, the Small label style), so a strip
 * stores only what the seller changed.
 */
export function MarqueeBlockEditor({
  block,
  theme,
  onUpdate,
  onDuplicate,
  onRemove,
}: {
  block: MarqueeBlock;
  theme: StorefrontTheme;
  onUpdate: (patch: MarqueeBlockPatch) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const fieldId = useId();
  const t = useTranslations("EditorFinish.panel");
  const tRoot = useTranslations();
  // The words being typed. An empty strip cannot be saved, so a cleared field
  // keeps the last words on the board until something is typed (or the field
  // is left, which puts them back in it).
  const [draft, setDraft] = useState(block.text);
  const [shown, setShown] = useState(block.text);
  if (block.text !== shown) {
    setShown(block.text);
    setDraft(block.text);
  }
  // "More" opens with the panel when it holds the strip's own colour.
  const [moreOpen] = useState(block.color !== undefined);
  const variant = block.variant ?? "label";
  const styleInk = resolveTextStyle(theme, variant).color ?? derivePalette(theme).text;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-text`} className={labelClass}>
          {t("marquee.textLabel")}
        </label>
        <input
          id={`${fieldId}-text`}
          type="text"
          className={fieldBaseClass}
          value={draft}
          maxLength={MARQUEE_TEXT_MAX}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (next.trim()) onUpdate({ text: next });
          }}
          onBlur={() => setDraft(block.text)}
        />
      </div>

      <div className="space-y-1.5">
        <span className={labelClass}>{t("marquee.speedLabel")}</span>
        <SegmentedControl
          value={block.speed ?? "normal"}
          options={MARQUEE_SPEEDS.map((value) => ({ value, label: t(`marquee.speeds.${value}`) }))}
          onChange={(speed: MarqueeSpeed) => onUpdate({ speed: speed === "normal" ? undefined : speed })}
          ariaLabel={t("marquee.speedLabel")}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-style`} className={labelClass}>
          {tRoot("Storefront.textBlock.style.label")}
        </label>
        <Select
          id={`${fieldId}-style`}
          value={variant}
          options={TEXT_VARIANTS.map((value) => ({ value, label: tRoot(TEXT_VARIANT_LABELS[value]) }))}
          onChange={(next: TextVariant) => onUpdate({ variant: next === "label" ? undefined : next })}
        />
      </div>

      <Disclosure open={moreOpen} summary={<span className={labelClass}>{t("more")}</span>}>
        <ColorPicker
          id={`${fieldId}-color`}
          label={t("marquee.colorLabel")}
          value={block.color ?? styleInk}
          onChange={(color) => onUpdate({ color })}
          inherit={{
            label: t("marquee.autoColor"),
            useLabel: t("marquee.useAutoColor"),
            value: styleInk,
            active: block.color === undefined,
            onSelect: () => onUpdate({ color: undefined }),
          }}
        />
      </Disclosure>

      <BlockActions onDuplicate={onDuplicate} onRemove={onRemove} />
    </div>
  );
}
