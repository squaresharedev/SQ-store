import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CardBackdrop,
  type CardBackdropVariant,
} from "@/components/ui/CardBackdrop";

/** The `name` folded cards share, which makes them an accordion: the browser
 *  closes the open one when another is opened. */
const FOLD_GROUP = "settings-card";

/** The open card's padding, and the art slot pulled back out through it so
 *  the art's top and right edges are the card's own. The art never shows
 *  below sm (see ART_SHOWN_CLASS), so only that step is undone. */
const CARD_PAD_CLASS = "p-6 sm:p-7";
const ART_BLEED_CLASS = "sm:-mr-7 sm:-mt-7";
/** The art only once the header is wide enough to keep a readable text column
 *  beside it, measured on the header row itself since the settings rails, not
 *  the screen, decide how wide a card is. The header is the @container, never
 *  the card: containment would re-anchor ui/Popover's fixed phone sheet for
 *  every picker in the card's body. */
const ART_SHOWN_CLASS = "hidden @xl:block";

/**
 * One settings card: a titled white panel holding a single form or action.
 * Sections stack a few of these with generous spacing so sparse pages still
 * feel deliberate.
 *
 * Pass `decoration` to fade a texture into the corner — reserved for the lead
 * card of a section, not every form, so it stays a signal (styles.md §2.4).
 * Pass `art` instead for a picture in that corner (ui/TransitFlow): it sits
 * flush in the card's top-right corner, so the card's edges cut it, and
 * beside the title, so the description wraps before it rather than running
 * under it. Left out wherever the header is too narrow to give it room.
 *
 * Pass `fold` where the same cards are shown inside a dialog (the shipping
 * settings, opened over the product form): each card is then ONE LINE THAT
 * OPENS, its title and the gist of its description, so the dialog reads as a
 * short list instead of a page (styles.md §8.14). Only one is open at a time.
 * A native <details>, so the fields of a folded card are still in the form
 * and are still submitted with it.
 */
export function SettingsCard({
  id,
  title,
  description,
  danger,
  decoration,
  art,
  fold,
  children,
}: {
  /** Anchor target, so universal search can deep-link to this exact card.
   *  `scroll-mt` clears the sticky top bar the anchor would otherwise land
   *  under. */
  id?: string;
  title: string;
  description?: string;
  /** Red border treatment for danger-zone cards. */
  danger?: boolean;
  /** Fade a decorative texture into the top-right corner. Omit for plain cards. */
  decoration?: CardBackdropVariant;
  /** A decorative picture flush in the top-right corner, beside the title.
   *  Not shown while folded. */
  art?: React.ReactNode;
  /** Draw the card as one line that opens; `open` starts it opened. */
  fold?: "closed" | "open";
  children: React.ReactNode;
}) {
  if (fold) {
    return (
      <details
        id={id}
        name={FOLD_GROUP}
        open={fold === "open"}
        className={cn(
          "group border bg-background scroll-mt-20",
          danger ? "border-destructive/40" : "border-border",
        )}
      >
        <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block text-base font-semibold",
                danger ? "text-destructive" : "text-foreground",
              )}
            >
              {title}
            </span>
            {description && (
              // One line while folded, the whole sentence once it is open.
              <span className="mt-0.5 block truncate font-inter text-sm text-muted-foreground group-open:whitespace-normal">
                {description}
              </span>
            )}
          </span>
          <ChevronDown
            className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-standard group-open:rotate-180 motion-reduce:transition-none"
            strokeWidth={2}
            aria-hidden="true"
          />
        </summary>
        <div className="px-4 pb-4">{children}</div>
      </details>
    );
  }

  return (
    <section
      id={id}
      className={cn(
        "border bg-background scroll-mt-20",
        CARD_PAD_CLASS,
        decoration && "relative overflow-hidden",
        danger ? "border-destructive/40" : "border-border",
      )}
    >
      {decoration && <CardBackdrop variant={decoration} corner="tr" />}
      <div className={cn(decoration && "relative")}>
        <div className="@container flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <h2
              className={cn(
                "text-base font-semibold",
                danger ? "text-destructive" : "text-foreground",
              )}
            >
              {title}
            </h2>
            {description && (
              // Pretty-wrapped beside art: the narrower column otherwise
              // strands the last word on a line of its own.
              <p
                className={cn(
                  "mt-1 font-inter text-sm leading-relaxed text-muted-foreground",
                  art && "text-pretty",
                )}
              >
                {description}
              </p>
            )}
          </div>
          {art && <div className={cn(ART_SHOWN_CLASS, ART_BLEED_CLASS)}>{art}</div>}
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}
