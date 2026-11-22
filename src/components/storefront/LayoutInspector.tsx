"use client";

import type { Product } from "@/types/product";
import { linkedBandIds } from "@/lib/storefront/bands";
import {
  blockKey,
  boardProductIds,
  type ButtonBlock,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";
import { BandEditor } from "./BandEditor";
import { ButtonBlockEditor, type LinkableStorefront } from "./ButtonBlockEditor";
import type { useLayoutEditing } from "./useLayoutEditing";

/**
 * The inspector for what the layout workstream adds: a selected band's panel,
 * or a selected button's. Null for anything else, so the designer drops it
 * into its own chain of block editors in two places and nothing more.
 */
export function LayoutInspector({
  layout,
  button,
  theme,
  blocks,
  header,
  bands,
  productsById,
  storefronts,
  photoUrls,
  onPhotoUrl,
  onDuplicate,
  onRemove,
}: {
  layout: ReturnType<typeof useLayoutEditing>;
  /** The selected block, when it is the one button selected. */
  button: ButtonBlock | null;
  theme: StorefrontTheme;
  blocks: readonly StorefrontBlock[];
  header: StorefrontHeader;
  bands: readonly StorefrontBand[];
  productsById: ReadonlyMap<string, Product>;
  /** This store's storefronts a button may lead to. */
  storefronts: readonly LinkableStorefront[];
  /** Display URLs by object key (the designer's page photo map). */
  photoUrls: Readonly<Record<string, string>>;
  onPhotoUrl: (key: string, url: string) => void;
  onDuplicate: (keys: readonly string[]) => void;
  onRemove: (key: string) => void;
}) {
  const band = layout.selectedBand;
  if (band) {
    return (
      <BandEditor
        key={band.id}
        band={band}
        theme={theme}
        imageUrl={band.background.kind === "image" ? (photoUrls[band.background.key] ?? null) : null}
        linked={linkedBandIds(blocks, header.links).has(band.id)}
        onPaint={(background) => layout.paintBand(band.id, background)}
        onPhotoUrl={onPhotoUrl}
        onRemove={() => layout.removeBand(band.id)}
      />
    );
  }
  if (!button) return null;
  const key = blockKey(button);
  return (
    <ButtonBlockEditor
      key={button.id}
      block={button}
      products={boardProductIds(blocks).flatMap((id) => {
        const product = productsById.get(id);
        return product ? [{ id, title: product.title }] : [];
      })}
      bands={bands}
      storefronts={storefronts}
      onUpdate={(patch) => layout.updateButton(key, patch)}
      onDuplicate={() => onDuplicate([key])}
      onRemove={() => onRemove(key)}
    />
  );
}
