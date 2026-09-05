import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { InfoTip } from "@/components/ui/InfoTip";
import { cn } from "@/lib/utils";
import { cardClass, iconTileClass } from "@/components/ui/surface-styles";
import type {
  ProductFormSectionId,
  ProductFormSectionState,
} from "@/lib/products/form-datapoints";

/** The DOM id a section anchors at, so the index rail and a `#hash` agree. */
export function sectionAnchorId(id: string): string {
  return `product-section-${id}`;
}

/**
 * One scannable group of the product form: a bordered card with an icon chip,
 * a title, and a one-line explanation, so a seller can jump straight to the
 * section they came to change (form-UX research: grouped, labeled sections
 * beat a flat field stack for scanning).
 *
 * THE SUMMARY IS THE SCANNING AFFORDANCE. A heading alone says what a section
 * is FOR; it does not say whether this product has anything in it. On a form
 * this long that is the question being asked on nearly every visit — "did I
 * add the photos?" — and answering it in the header means not opening the
 * section to find out. It is deliberately the same string the index rail
 * shows, from the same snapshot, so the two can never disagree.
 *
 * Also the agent surface's anchor: `data-product-section` and
 * `data-product-section-state` make every section addressable without matching
 * on a heading string (see docs/product-form-datapoints.md).
 */
export function FormSection({
  id,
  icon: Icon,
  title,
  description,
  state = "empty",
  summary,
  children,
}: {
  id: ProductFormSectionId;
  icon: LucideIcon;
  title: string;
  /** Revealed by the "?" beside the heading. Empty for a section whose own
   *  fields already explain it, which then shows no "?" at all. */
  description: string;
  state?: ProductFormSectionState;
  /** What this section currently holds, e.g. "3 photos". */
  summary?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={sectionAnchorId(id)}
      aria-labelledby={`${sectionAnchorId(id)}-heading`}
      data-product-section={id}
      data-product-section-state={state}
      // `scroll-mt` clears the sticky TopBar (h-14) when the index rail
      // jumps here; without it the anchor lands underneath the bar and the
      // heading you asked for is the one thing you cannot see.
      className={cn(cardClass, "scroll-mt-20 p-5")}
    >
      <div className="mb-4 flex items-center gap-3">
        <span className={cn(iconTileClass, "size-9")}>
          <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <h2
            id={`${sectionAnchorId(id)}-heading`}
            className="text-base font-semibold text-foreground"
          >
            {title}
          </h2>
          {/* THE DESCRIPTION IS BEHIND THE "?", not printed under the heading.
              Nine sections meant nine permanent sentences explaining what each
              one is for — read once, on the first visit ever, and in the way
              on every visit after. The summary beside the title is what a
              returning seller actually wants from a header, so it gets the
              space; the explanation stays one keystroke or hover away.

              And a section whose fields carry their own "?" gets none here: an
              empty description means no button, rather than a fourth info
              button on a card that already has three. */}
          {description && <InfoTip label={`What ${title} is for`}>{description}</InfoTip>}
          {summary && (
            <span
              className={cn(
                "min-w-0 truncate font-inter text-xs",
                // The one tone in this header: a section with a problem.
                // Everything else stays muted so the exception is visible.
                state === "invalid" ? "text-destructive" : "text-muted-foreground",
              )}
              data-product-section-summary=""
            >
              {summary}
            </span>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
