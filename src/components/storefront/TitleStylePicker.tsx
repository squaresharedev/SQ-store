"use client";

import { TITLE_STYLES, type TitleStyle } from "@/types/storefront";
import { OptionCardPicker } from "./OptionCardPicker";

const TITLE_STYLE_LABELS: Record<TitleStyle, string> = {
  bar: "Bar",
  overlay: "Overlay",
  shadow: "Shadow",
};

/** Miniature card depicting one title style: where the title line sits and
 *  what backs it (solid bar, translucent overlay, or gradient shadow). */
function StyleGlyph({ style }: { style: TitleStyle }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-10 flex-col overflow-hidden rounded-sm border border-border bg-background"
    >
      <span className="relative flex-1 bg-muted">
        {style === "overlay" && (
          <span className="absolute inset-x-0 bottom-0 flex h-3.5 items-center border-t border-border bg-background/85 px-1">
            <span className="h-1 w-5 rounded-full bg-foreground/70" />
          </span>
        )}
        {style === "shadow" && (
          <span className="absolute inset-x-0 bottom-0 flex h-5 items-end bg-gradient-to-t from-neutral-900/70 to-transparent px-1 pb-1">
            <span className="h-1 w-5 rounded-full bg-background/90" />
          </span>
        )}
      </span>
      {style === "bar" && (
        <span className="flex h-3.5 items-center border-t border-border bg-background px-1">
          <span className="h-1 w-5 rounded-full bg-foreground/70" />
        </span>
      )}
    </span>
  );
}

/**
 * Visual style picker for the tile's title area: a solid bar below the image,
 * a translucent bar over the image, or text on a gradient shadow.
 */
export function TitleStylePicker({
  value,
  onChange,
}: {
  value: TitleStyle;
  onChange: (style: TitleStyle) => void;
}) {
  return (
    <OptionCardPicker
      value={value}
      options={TITLE_STYLES.map((style) => ({
        value: style,
        label: TITLE_STYLE_LABELS[style],
        glyph: <StyleGlyph style={style} />,
      }))}
      onChange={onChange}
      ariaLabel="Title style"
    />
  );
}
