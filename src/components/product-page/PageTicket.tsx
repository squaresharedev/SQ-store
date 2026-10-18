import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { readableOn, ruleColor, subtleFill } from "./product-page-maps";

/** Where the stub ends and the ticket tears: the stub's width, spelled once as
 *  the class that sets it and once as the length the notches are cut at. */
const STUB = { width: "w-20", tear: "5rem" } as const;
/** The radius of the two half-circles punched out of the tear line. */
const NOTCH_RADIUS = "0.375rem";

/**
 * The two notches, CUT out of the ticket rather than painted over it: a mask
 * with a hole at each end of the tear line. A buyer's page can sit on any
 * colour, a gradient or a photograph, and a painted dot would have to guess
 * what is behind it; a hole shows whatever is.
 */
function tearMask(): CSSProperties {
  const hole = (y: string) =>
    `radial-gradient(circle at ${STUB.tear} ${y}, transparent ${NOTCH_RADIUS}, black calc(${NOTCH_RADIUS} + 0.5px))`;
  const image = `${hole("0")}, ${hole("100%")}`;
  return {
    maskImage: image,
    maskComposite: "intersect",
    // The same mask for engines that only know the prefixed spelling.
    WebkitMaskImage: image,
    WebkitMaskComposite: "source-in",
  };
}

/**
 * A TICKET ON A BUYER'S PAGE: a running sale on the product page, a discount
 * code that has been applied at checkout. The same coupon the seller sees in
 * their Discounts list, so a discount looks like one thing from the dashboard
 * to the till.
 *
 * Drawn entirely in the page's own INK (the colour its text is, derived from
 * whatever backdrop the seller chose): the stub is the ink solid, the body a
 * faint wash of it. So it belongs to every storefront without introducing a
 * colour of its own, and never competes with the buy button's fill. The corner
 * is the storefront's own: `radius` where the page hands one over, else
 * `rounded-sm`, which the checkout form maps to the same value.
 *
 * `muted` greys the stub, for a ticket that is there but not the one in force
 * (a code the running sale already beats).
 *
 * Server-compatible. The stub's content is the caller's; mark it `aria-hidden`
 * when the body already says the same thing in words.
 */
export function PageTicket({
  ink,
  stub,
  muted = false,
  radius,
  className,
  attributes,
  children,
}: {
  /** The page's ink (resolveInk / the checkout theme's `ink`). */
  ink: string;
  /** What comes off, short and large: "-20%". */
  stub: ReactNode;
  muted?: boolean;
  /** The corner, in px (controlRadius). Absent = `rounded-sm`. */
  radius?: number;
  className?: string;
  attributes?: Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex items-stretch overflow-hidden rounded-sm", className)}
      style={radius === undefined ? tearMask() : { ...tearMask(), borderRadius: radius }}
      {...attributes}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center border-r border-dashed border-current/50 px-2 text-lg font-bold leading-none tabular-nums",
          STUB.width,
        )}
        style={
          muted
            ? { backgroundColor: ruleColor(ink), color: ink }
            : { backgroundColor: ink, color: readableOn(ink) }
        }
      >
        {stub}
      </div>
      <div
        className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2.5"
        style={{ backgroundColor: subtleFill(ink), color: ink }}
      >
        {children}
      </div>
    </div>
  );
}
