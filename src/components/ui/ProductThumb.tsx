import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A product's photo as a small square: the picture when it has one, a quiet
 * placeholder glyph when it does not. Size it at the call site (`size-14` by
 * default). Decorative: the product's name is always beside it.
 */
export function ProductThumb({
  src,
  className,
}: {
  src?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("size-14 shrink-0 overflow-hidden rounded-sm bg-muted", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
        <img src={src} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center">
          <ImageIcon className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
