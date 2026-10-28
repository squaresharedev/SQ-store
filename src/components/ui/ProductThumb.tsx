import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A product's photo as a small square: the picture when it has one, a quiet
 * placeholder glyph when it does not. Size it at the call site (`size-14` by
 * default). Decorative: the product's name is always beside it.
 *
 * `loading="lazy"` is for lists (a row per order or review), where rows below
 * the fold should not fetch until they come near. Leave it eager anywhere the
 * thumb may mount hidden and be revealed (a dialog step, an animation beat),
 * or it pops in late. Decoding is always async: the photo is the full upload,
 * and scaling it down must not hold up the page.
 */
export function ProductThumb({
  src,
  className,
  loading,
}: {
  src?: string | null;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  return (
    <div className={cn("size-14 shrink-0 overflow-hidden rounded-sm bg-muted", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
        <img
          src={src}
          alt=""
          draggable={false}
          loading={loading}
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <ImageIcon className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
