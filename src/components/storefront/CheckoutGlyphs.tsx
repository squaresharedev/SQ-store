import type { CheckoutLayout } from "@/types/storefront";
import { optionGlyphFrameClass } from "./OptionCardPicker";

/**
 * The checkout's arrangements as pictures of themselves, for OptionCardPicker:
 * a seller sees where the product and the form go instead of reading a
 * description of each. Each is a small page: a bar across the top for the
 * store's name, then the arrangement itself in the page's own greys, with the
 * pay button as the one solid bar.
 */

/** A form: two field lines and the pay button. */
function FormLines() {
  return (
    <span className="flex w-full flex-col gap-1">
      <span className="h-1 w-full rounded-full bg-foreground/20" />
      <span className="h-1 w-4/5 rounded-full bg-foreground/20" />
      <span className="mt-0.5 h-1.5 w-full rounded-full bg-foreground/80" />
    </span>
  );
}

/** Showcase: the product large on a panel of its own, the form beside it.
 *  Compact: one calm column, a small summary of the order above the form. */
export function ArrangementGlyph({ layout }: { layout: CheckoutLayout }) {
  return (
    <span aria-hidden="true" className={`flex h-14 w-20 flex-col ${optionGlyphFrameClass}`}>
      <span className="h-1.5 w-full shrink-0 border-b border-border" />
      {layout === "showcase" ? (
        <span className="flex flex-1 gap-1.5 p-1.5">
          <span className="flex w-1/2 flex-col gap-1 rounded-xs bg-muted p-1">
            <span className="flex-1 rounded-xs bg-foreground/15" />
            <span className="h-1 w-3/4 rounded-full bg-foreground/30" />
          </span>
          <span className="flex flex-1 items-center">
            <FormLines />
          </span>
        </span>
      ) : (
        <span className="flex flex-1 justify-center p-1.5">
          <span className="flex w-9 flex-col gap-1">
            <span className="flex items-center gap-1 rounded-xs border border-border p-0.5">
              <span className="size-2 shrink-0 rounded-xs bg-foreground/15" />
              <span className="h-1 flex-1 rounded-full bg-foreground/30" />
            </span>
            <FormLines />
          </span>
        </span>
      )}
    </span>
  );
}
