"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { ProductPageImage } from "@/types/product";
import type { ImageFit } from "@/types/storefront";
import { useOptionSelection } from "./OptionContext";

/**
 * The product's photos. Filtered by what is chosen: photos tied to a chosen
 * option first, then the untied ones; a selection with no photos of its own
 * simply shows the shared set, so picking a version never empties the gallery.
 *
 * A photo tie names ONE option, so a shirt photographed in blue shows for blue
 * in every size, and a motor photographed at 750 W shows at 750 W in every
 * colour. When both axes have photos of their own, both are shown, in the
 * seller's gallery order.
 *
 * Plain <img> on purpose (the same call ProductTileContent makes): the URLs
 * are signed R2 GETs with query strings, which next/image would only proxy.
 */
export function ProductGallery({
  images,
  title,
  fit,
  radius,
  ink,
}: {
  images: ProductPageImage[];
  title: string;
  fit: ImageFit;
  /** Surface radius in px, from the theme's corner radius. */
  radius: number;
  ink: string;
}) {
  const { selectedIds } = useOptionSelection();
  // A stable identity for "which options are chosen", so the memo and the
  // reset below compare by value rather than by Set identity.
  const selectionKey = useMemo(() => [...selectedIds].sort().join(","), [selectedIds]);

  const visible = useMemo(() => {
    const own = images.filter((image) => image.optionId && selectedIds.has(image.optionId));
    const shared = images.filter((image) => !image.optionId);
    return own.length > 0 ? [...own, ...shared] : shared;
    // selectedIds is rebuilt whenever the selection changes; selectionKey is
    // what actually decides the result, so it is the honest dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, selectionKey]);

  // The chosen photo, remembered together with the selection it was chosen
  // under: a new selection restarts at its first photo without an effect, and
  // a shorter set clamps.
  const [chosen, setChosen] = useState<{ selection: string; index: number }>({
    selection: selectionKey,
    index: 0,
  });
  const index = chosen.selection === selectionKey ? chosen.index : 0;
  const setIndex = (next: number) => setChosen({ selection: selectionKey, index: next });
  const current = visible[Math.min(index, Math.max(visible.length - 1, 0))];

  const frameStyle: CSSProperties = {
    borderRadius: `${radius}px`,
    backgroundColor: ink === "#ffffff" ? "rgba(255,255,255,0.08)" : "rgba(23,23,23,0.04)",
  };
  const fitClass = fit === "cover" ? "object-cover" : "object-contain";

  if (visible.length === 0) {
    return (
      <div
        className="flex aspect-square w-full items-center justify-center text-sm opacity-60"
        style={frameStyle}
        data-product-gallery="empty"
      >
        No photo yet
      </div>
    );
  }

  // One gallery: a hero with thumbnails under it. The "one after another"
  // variant that used to live here was the same photos in a longer scroll,
  // and thumbnails read any number of them.
  return (
    <div className="flex flex-col gap-3" data-product-gallery="thumbnails">
      <figure className="aspect-square w-full overflow-hidden" style={frameStyle}>
        {current && (
          /* eslint-disable-next-line @next/next/no-img-element -- signed R2 URL */
          <img
            key={current.url}
            src={current.url}
            alt={current.alt}
            className={cn("size-full", fitClass)}
            decoding="async"
          />
        )}
      </figure>
      {visible.length > 1 && (
        <div
          role="group"
          aria-label={`Photos of ${title}`}
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {visible.map((image, i) => {
            const active = i === Math.min(index, visible.length - 1);
            return (
              <button
                key={image.url}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Photo ${i + 1} of ${visible.length}`}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "size-16 shrink-0 overflow-hidden transition-opacity duration-base ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                  active ? "opacity-100" : "opacity-55 hover:opacity-85",
                )}
                style={{
                  borderRadius: `${Math.min(radius, 12)}px`,
                  boxShadow: active ? `inset 0 0 0 2px ${ink}` : undefined,
                  outlineColor: ink,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URL */}
                <img
                  src={image.url}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
