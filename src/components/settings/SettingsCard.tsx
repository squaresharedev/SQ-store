import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CardBackdrop,
  type CardBackdropVariant,
} from "@/components/ui/CardBackdrop";

/** The `name` folded cards share, which makes them an accordion: the browser
 *  closes the open one when another is opened. */
const FOLD_GROUP = "settings-card";

/**
 * One settings card: a titled white panel holding a single form or action.
 * Sections stack a few of these with generous spacing so sparse pages still
 * feel deliberate.
 *
 * Pass `decoration` to fade a texture into the corner — reserved for the lead
 * card of a section, not every form, so it stays a signal (styles.md §2.4).
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
        "border bg-background p-6 sm:p-7 scroll-mt-20",
        decoration && "relative overflow-hidden",
        danger ? "border-destructive/40" : "border-border",
      )}
    >
      {decoration && <CardBackdrop variant={decoration} corner="tr" />}
      <div className={cn(decoration && "relative")}>
        <h2
          className={cn(
            "text-base font-semibold",
            danger ? "text-destructive" : "text-foreground",
          )}
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 font-inter text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}
