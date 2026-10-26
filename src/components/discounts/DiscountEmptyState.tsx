import Link from "@/components/ui/AppLink";
import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AddShowcase } from "@/components/ui/AddShowcase";
import { primaryButtonClass } from "@/components/ui/control-styles";
import { emptyShowcaseClass, placeholderBarClass } from "@/components/ui/surface-styles";
import { Cutout } from "@/components/products/ProductEmptyState";
import { NEW_DISCOUNT_PATH } from "@/lib/discounts/paths";

/**
 * The two kinds of discount either side of the create card, drawn as the
 * coupons the list fills up with (DiscountRow): a SALE on the left, with the
 * product it lowers, and a CODE on the right, with the code itself. Standing
 * tickets here, not the list's wide ones, so the pair and the card fit the
 * frame the way the product and storefront pictures do.
 *
 * Display-only stand-ins: the code is an example, not a real one, so it reads
 * the same in every language (like the storefront boards' shop names).
 */
const EXAMPLE_CODE = "SUMMER20";

/** The stub's height, set per size on the ticket and read by both the stub and
 *  the tear mask, so the notches always sit on the tear line. */
const STUB_HEIGHT = "var(--ticket-stub)";
/** The half-circles punched out where the stub tears off, matching the list's
 *  `size-4` notches. */
const NOTCH_RADIUS = "0.5rem";

/**
 * The notches are CUT out of the ticket (a mask with a hole at each end of the
 * tear line) rather than painted over it, so the page and the card behind show
 * through them, and the shadow follows the hole.
 */
function tearMask(): CSSProperties {
  const hole = (x: string) =>
    `radial-gradient(circle at ${x} ${STUB_HEIGHT}, transparent ${NOTCH_RADIUS}, black calc(${NOTCH_RADIUS} + 0.5px))`;
  const image = `${hole("0")}, ${hole("100%")}`;
  return {
    maskImage: image,
    maskComposite: "intersect",
    // The same mask for engines that only know the prefixed spelling.
    WebkitMaskImage: image,
    WebkitMaskComposite: "source-in",
  };
}

/** A standing coupon: the figure on an ink stub, a tear line, then the body. */
function Ticket({ stub, children }: { stub: string; children: ReactNode }) {
  return (
    // The shadow is a filter on the OUTSIDE: a box-shadow would be clipped by
    // the mask, and a filter inside it would be cut at the notches.
    <div className="size-full drop-shadow-lg [--ticket-stub:2.75rem] sm:[--ticket-stub:3.5rem]">
      <div
        className="flex size-full flex-col overflow-hidden rounded-md border border-border bg-card"
        style={tearMask()}
      >
        <div className="flex h-[var(--ticket-stub)] shrink-0 items-center justify-center border-b border-dashed border-background/50 bg-foreground text-xl font-bold leading-none tracking-tight text-background tabular-nums sm:text-3xl">
          {stub}
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 sm:gap-3">
          {children}
        </div>
      </div>
    </div>
  );
}

/** The price line of a sale: the new price in ink, the old one a shorter, lighter bar. */
function PriceBars() {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(placeholderBarClass, "w-8 bg-foreground sm:w-10")} />
      <span className={cn(placeholderBarClass, "w-5 sm:w-6")} />
    </div>
  );
}

const SALE_TICKET = (
  <Ticket stub="-20%">
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Cutout src="/empty-state/tshirt.webp" width={470} height={480} />
    </div>
    <PriceBars />
  </Ticket>
);

const CODE_TICKET = (
  <Ticket stub="-10%">
    <span className="border border-dashed border-border px-2 py-1.5 font-mono text-[0.625rem] font-semibold tracking-wider text-foreground sm:text-sm">
      {EXAMPLE_CODE}
    </span>
    <div className="flex flex-col items-center gap-1.5">
      <span className={cn(placeholderBarClass, "w-14 sm:w-20")} />
      <span className={cn(placeholderBarClass, "w-9 sm:w-12")} />
    </div>
  </Ticket>
);

/**
 * The discounts list with nothing in it. The create card is the call to
 * action; a reader sees the two coupons on their own, with nothing to press.
 */
export function DiscountEmptyState({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations("Discounts");
  return (
    <div className={emptyShowcaseClass} data-discounts-empty="">
      <div className="flex flex-col items-center">
        <AddShowcase
          card={
            canWrite
              ? { href: NEW_DISCOUNT_PATH, label: t("page.create"), className: "h-32 w-28 rounded-md sm:h-40 sm:w-44" }
              : undefined
          }
          className="[--showcase-tuck:1.25rem] sm:[--showcase-tuck:2rem]"
          exampleClassName="mt-4 h-40 w-28 sm:h-56 sm:w-40"
          left={SALE_TICKET}
          right={CODE_TICKET}
        />
        <h2 className="mt-10 text-lg font-semibold text-foreground">{t("empty.title")}</h2>
        <p className="mt-1 max-w-md font-inter text-sm text-muted-foreground">
          {canWrite ? t("empty.hint") : t("empty.hintReadOnly")}
        </p>
        {/* The card is easy to read as part of the picture, so the action is
            also spelled out as a plain button. */}
        {canWrite && (
          <Link href={NEW_DISCOUNT_PATH} className={cn(primaryButtonClass, "mt-6")}>
            {t("page.create")}
          </Link>
        )}
      </div>
    </div>
  );
}
