import { BRAND_MARK } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** The brand's mark as an inline icon, in the current text colour. */
export function BrandMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${BRAND_MARK.width} ${BRAND_MARK.height}`}
      className={cn("shrink-0", className)}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={BRAND_MARK.path} />
    </svg>
  );
}
