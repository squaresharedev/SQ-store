import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { primaryButtonClass } from "@/components/ui/control-styles";

/**
 * "Skip to main content": the first tab stop on a page, invisible until it has
 * focus, then a button in the corner. Without it a keyboard user tabs through
 * the whole navigation rail (a dozen stops on the dashboard) before reaching
 * anything on the page they came for.
 *
 * `href` names the element to land on, which needs `id` and `tabIndex={-1}` to
 * take focus. z-[60] is the search overlay's level on the app's z scale, above
 * the rail (z-50) the link would otherwise sit under.
 */
export function SkipLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        primaryButtonClass,
        "sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-3 focus-visible:z-[60]",
      )}
    >
      {children}
    </a>
  );
}
