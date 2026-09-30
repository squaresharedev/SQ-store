import { Clock, PackageCheck, RotateCcw, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResolvedShipping } from "@/lib/storefront/shipping";
import { firstSentence } from "./product-page-maps";

export type TrustLine = { icon: LucideIcon; text: string };

/**
 * The facts a buyer looks for beside the button, drawn from what the seller
 * actually wrote rather than invented: when it leaves, how it gets to them, how
 * it goes back, and (in the EU) that the law is behind them either way.
 *
 * One builder for every page that shows them (the product page's buy box and
 * the checkout's pay button), so the two can never quote different terms.
 */
export function buildTrustLines({
  shipping,
  returnsText,
  isDigital,
  isEu,
  copy,
}: {
  /** The product's resolved shipping terms, or null (digital, or none set). */
  shipping: ResolvedShipping | null;
  returnsText: string | undefined;
  isDigital: boolean;
  isEu: boolean;
  /** The two fixed lines, in the buyer's language. */
  copy: { digitalDelivery: string; euRights: string };
}): TrustLine[] {
  const lines: TrustLine[] = [];
  // The dispatch line LEADS, when there is one: "when does it leave" is the
  // first thing asked of anything being posted, and it is the one fact the
  // shipping paragraph is worst at answering quickly.
  if (shipping?.dispatch) lines.push({ icon: Clock, text: shipping.dispatch });
  const shippingLine = isDigital ? copy.digitalDelivery : firstSentence(shipping?.body);
  if (shippingLine) lines.push({ icon: isDigital ? PackageCheck : Truck, text: shippingLine });
  const returnsLine = firstSentence(returnsText);
  if (returnsLine) lines.push({ icon: RotateCcw, text: returnsLine });
  if (isEu) lines.push({ icon: ShieldCheck, text: copy.euRights });
  return lines;
}

export function TrustList({
  lines,
  ruleColor,
  layout = "list",
  className,
}: {
  lines: readonly TrustLine[];
  ruleColor: string;
  /**
   * `list`: one fact per line under a hairline, the product page's buy box.
   * `badges`: the same facts as a centred row of icon-led badges, for right
   * under the checkout's pay button, where they are glanced at on the way to
   * the click rather than read.
   */
  layout?: "list" | "badges";
  className?: string;
}) {
  if (lines.length === 0) return null;
  const badges = layout === "badges";
  return (
    <ul
      className={cn(
        "text-xs",
        badges
          ? "flex flex-wrap justify-center gap-x-4 gap-y-1.5"
          : "flex flex-col gap-2 border-t pt-4",
        className,
      )}
      style={badges ? undefined : { borderColor: ruleColor }}
      data-product-trust={layout}
      // Every line here is the first sentence of a policy the seller wrote, so
      // the policies are what a click wants.
      data-setting-hotspot="policies"
    >
      {lines.map(({ icon: Icon, text }) => (
        <li key={text} className={cn("flex gap-1.5", badges ? "items-center" : "items-start gap-2")}>
          <Icon
            className={cn("size-3.5 shrink-0 opacity-60", !badges && "mt-px")}
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="opacity-80">{text}</span>
        </li>
      ))}
    </ul>
  );
}
