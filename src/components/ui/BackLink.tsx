import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { backLinkClass, iconNudgeLeftClass } from "@/components/ui/control-styles";

/**
 * The arrow-and-label link every sub-page opens with to get back to where it
 * came from. One component so the styling, the arrow nudge and the focus ring
 * change in one place. Server-safe.
 */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(backLinkClass, className)}>
      <ArrowLeft
        className={`size-4 ${iconNudgeLeftClass}`}
        strokeWidth={2}
        aria-hidden="true"
      />
      {children}
    </Link>
  );
}
