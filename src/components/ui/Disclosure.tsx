import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ONE LINE THAT OPENS: the way to keep words a person may want without making
 * every person read them (styles.md §8.14). The line itself says the gist, and
 * the full text is one tap away. Where a single caveat sentence belongs behind
 * the "?" (InfoTip), a paragraph, a list or a rarely-changed field belongs
 * here.
 *
 * A native <details>, so it works without script, is announced as expandable,
 * and its contents stay in the page for find-in-page and for assistive tech.
 * Form fields folded inside it are still submitted with their form.
 *
 * Server-compatible, and the surrounding ink (it inherits `color`).
 */
export function Disclosure({
  icon: Icon,
  summary,
  children,
  open,
  className,
  attributes,
}: {
  /** What the line is about, ahead of its words. */
  icon?: LucideIcon;
  /** The gist, always visible. */
  summary: ReactNode;
  /** The full text. */
  children: ReactNode;
  /**
   * Opens it from outside, for the moment its contents need attention (a
   * folded field the server refused). The reader can still fold it again.
   */
  open?: boolean;
  className?: string;
  attributes?: Record<`data-${string}`, string>;
}) {
  return (
    <details className={cn("group", className)} open={open} {...attributes}>
      <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        {Icon && (
          <Icon className="mt-px size-3.5 shrink-0 opacity-60" strokeWidth={2} aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown
          className="mt-px size-3.5 shrink-0 opacity-60 transition-transform duration-base ease-standard group-open:rotate-180 motion-reduce:transition-none"
          strokeWidth={2}
          aria-hidden="true"
        />
      </summary>
      {/* Indented to the summary's words, past the icon when there is one. */}
      <div className={cn("pt-2", Icon && "pl-5.5")}>{children}</div>
    </details>
  );
}
