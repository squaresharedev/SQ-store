"use client";

import { linkedBandIds } from "@/lib/storefront/bands";
import {
  blockKey,
  type ButtonBlock,
  type CarouselBlock,
  type StorefrontBlock,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";
import { BandEditor } from "./BandEditor";
import { ButtonBlockEditor } from "./ButtonBlockEditor";
import { CarouselBlockEditor } from "./CarouselBlockEditor";
import type { useLayoutEditing } from "./useLayoutEditing";

/**
 * The inspector for what the layout workstream adds: a selected band's panel,
 * a selected button's, or a selected carousel's. Null for anything else, so
 * the designer drops it into its own chain of block editors in two places and
 * nothing more. Where links may lead and the uploads' display URLs come from
 * the hook's editor value (the same one LayoutEditorProvider hands the
 * header's section).
 */
export function LayoutInspector({
  layout,
  button,
  carousel = null,
  theme,
  blocks,
  header,
  onDuplicate,
  onRemove,
}: {
  layout: ReturnType<typeof useLayoutEditing>;
  /** The selected block, when it is the one button selected. */
  button: ButtonBlock | null;
  /** The selected block, when it is the one carousel selected. */
  carousel?: CarouselBlock | null;
  theme: StorefrontTheme;
  blocks: readonly StorefrontBlock[];
  header: StorefrontHeader;
  onDuplicate: (keys: readonly string[]) => void;
  onRemove: (key: string) => void;
}) {
  const { editor } = layout;
  const band = layout.selectedBand;
  if (band) {
    return (
      <BandEditor
        key={band.id}
        band={band}
        theme={theme}
        imageUrl={band.background.kind === "image" ? (editor.photoUrls[band.background.key] ?? null) : null}
        linked={linkedBandIds(blocks, header.links).has(band.id)}
        onPaint={(background) => layout.paintBand(band.id, background)}
        onPhotoUrl={editor.onPhotoUrl}
        onRemove={() => layout.removeBand(band.id)}
      />
    );
  }
  if (carousel) {
    const key = blockKey(carousel);
    return (
      <CarouselBlockEditor
        key={carousel.id}
        block={carousel}
        catalog={layout.catalog}
        onChange={(productIds) => layout.updateCarousel(key, productIds)}
        onDuplicate={() => onDuplicate([key])}
        onRemove={() => onRemove(key)}
      />
    );
  }
  if (!button) return null;
  const key = blockKey(button);
  return (
    <ButtonBlockEditor
      key={button.id}
      block={button}
      choices={editor}
      onUpdate={(patch) => layout.updateButton(key, patch)}
      onDuplicate={() => onDuplicate([key])}
      onRemove={() => onRemove(key)}
    />
  );
}
