import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { infoTextClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { cardClass, iconTileClass } from "@/components/ui/surface-styles";

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
      className={cn(cardClass, "p-5")}
    >
      <div className="mb-5 flex items-center gap-3">
        <span className={cn(iconTileClass, "size-9")}>
          <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className={infoTextClass}>
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}
