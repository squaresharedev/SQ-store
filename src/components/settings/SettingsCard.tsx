import { cn } from "@/lib/utils";
import {
  CardBackdrop,
  type CardBackdropVariant,
} from "@/components/ui/CardBackdrop";

/**
 * One settings card: a titled white panel holding a single form or action.
 * Sections stack a few of these with generous spacing so sparse pages still
 * feel deliberate.
 *
 * Pass `decoration` to fade a texture into the corner — reserved for the lead
 * card of a section, not every form, so it stays a signal (styles.md §2.4).
 */
export function SettingsCard({
  title,
  description,
  danger,
  decoration,
  children,
}: {
  title: string;
  description?: string;
  /** Red border treatment for danger-zone cards. */
  danger?: boolean;
  /** Fade a decorative texture into the top-right corner. Omit for plain cards. */
  decoration?: CardBackdropVariant;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "border bg-white p-6 sm:p-7",
        decoration && "relative overflow-hidden",
        danger ? "border-red-200" : "border-neutral-200",
      )}
    >
      {decoration && <CardBackdrop variant={decoration} corner="tr" />}
      <div className={cn(decoration && "relative")}>
        <h2
          className={cn(
            "text-base font-semibold",
            danger ? "text-red-600" : "text-neutral-900",
          )}
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 font-inter text-sm leading-relaxed text-neutral-500">
            {description}
          </p>
        )}
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}
