import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  CardBackdrop,
  type CardBackdropTone,
  type CardBackdropVariant,
} from "@/components/ui/CardBackdrop";

/** Shared card shell for dashboard modules: bordered surface, title row,
 *  optional action link in the corner (styles.md §8.7).
 *
 *  Pass `decoration` to fade a dot-grid / grid / glow texture into the card's
 *  top-right corner (see CardBackdrop) — reserved for the modules that matter,
 *  not every panel. */
export function ModuleCard({
  title,
  action,
  id,
  className,
  decoration,
  decorationTone,
  children,
}: {
  title: string;
  /** Small link/button rendered opposite the title. */
  action?: ReactNode;
  id?: string;
  className?: string;
  /** Fade a decorative texture into the top-right corner. Omit for plain cards. */
  decoration?: CardBackdropVariant;
  decorationTone?: CardBackdropTone;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-md border border-border bg-card p-4 shadow-xs",
        decoration && "relative overflow-hidden",
        className,
      )}
    >
      {decoration && (
        <CardBackdrop variant={decoration} corner="tr" tone={decorationTone} />
      )}
      <div className={cn(decoration && "relative")}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {action}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Muted one-liner used by every module's empty state. */
export function ModuleEmptyText({ children }: { children: ReactNode }) {
  return <p className="font-inter text-sm text-muted-foreground">{children}</p>;
}
