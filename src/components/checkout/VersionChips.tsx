import { cn } from "@/lib/utils";
import { chipStyle } from "@/components/product-page/product-page-maps";
import { SwatchDot } from "@/components/product-page/SwatchDot";
import type { SelectionChip } from "@/lib/checkout/selection";

/**
 * THE VERSION BEING BOUGHT, drawn rather than spelled out: a colour is a dot
 * of that colour beside its name, a size is a pill with the size in it. The
 * group's own name ("Colour", "Size") is what a screen reader hears first and
 * what a hover shows, because a sighted buyer does not need to be told that a
 * sage dot is a colour.
 *
 * Server-compatible. One component for the checkout's summaries and the
 * thank-you page's, so the version never reads two ways on the way through.
 */
export function VersionChips({
  chips,
  ink,
  cornerRadius,
  className,
}: {
  chips: readonly SelectionChip[];
  /** The ink of whatever the chips sit on (the page, or the showcase panel). */
  ink: string;
  cornerRadius: number;
  className?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} data-checkout-version="">
      {chips.map((chip) => (
        <li
          key={chip.label}
          className="inline-flex max-w-full items-center gap-1.5 px-2 py-1 text-xs font-medium leading-none"
          style={chipStyle(ink, cornerRadius)}
          title={chip.label}
          data-version-chip={chip.swatch ? "swatch" : "text"}
        >
          {chip.swatch && <SwatchDot color={chip.swatch} ink={ink} />}
          <span className="sr-only">{chip.label}: </span>
          <span className="truncate">{chip.value}</span>
        </li>
      ))}
    </ul>
  );
}
