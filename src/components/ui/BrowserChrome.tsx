import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const DOTS = [0, 1, 2] as const;

/**
 * The top bar of a DRAWN browser window: three dots and an address pill. For
 * pictures of "a page on a website" (the embed hero, the buy button story),
 * never real chrome. What sits in the address pill is the caller's: a glyph and
 * a domain, or a placeholder bar. Illustrative, so put it inside something
 * `aria-hidden`.
 */
export function BrowserChrome({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 border-b border-border bg-secondary px-3 py-2", className)}>
      <div className="flex gap-1.5">
        {DOTS.map((dot) => (
          <span key={dot} className="size-2.5 rounded-full bg-border" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-background px-3 py-1 font-inter text-xs text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
