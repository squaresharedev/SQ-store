import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * One scannable group of the product form: a bordered card with an icon chip,
 * a title, and a one-line explanation, so a seller can jump straight to the
 * section they came to change (form-UX research: grouped, labeled sections
 * beat a flat field stack for scanning).
 */
export function FormSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-md border border-border bg-card p-5 shadow-xs"
    >
      <div className="mb-5 flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground">
          <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="font-inter text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}
