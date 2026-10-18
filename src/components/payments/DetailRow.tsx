import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { eyebrowClass } from "@/components/ui/surface-styles";

/** Label + value row shared by the payments detail modals (read-only display). */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  /** Alignment only, for a row that sits at the far end of its line. */
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className={eyebrowClass}>{label}</span>
      {children}
    </div>
  );
}
