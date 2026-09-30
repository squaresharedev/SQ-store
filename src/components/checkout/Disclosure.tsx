import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

/**
 * ONE LINE THAT OPENS: the checkout's way of keeping words a buyer may want
 * without making every buyer read them. An icon says what the line is about,
 * the line itself says the gist, and the full text is one tap away. A native
 * <details>, so it works without script, is announced as expandable, and its
 * contents stay in the page for find-in-page and for assistive tech.
 *
 * Server-compatible, and the page's own ink (it inherits `color`).
 */
export function Disclosure({
  icon: Icon,
  summary,
  children,
  attributes,
}: {
  icon: LucideIcon;
  /** The gist, always visible. */
  summary: ReactNode;
  /** The full text. */
  children: ReactNode;
  attributes?: Record<`data-${string}`, string>;
}) {
  return (
    <details className="group" {...attributes}>
      <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        <Icon className="mt-px size-3.5 shrink-0 opacity-60" strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown
          className="mt-px size-3.5 shrink-0 opacity-60 transition-transform duration-base ease-standard group-open:rotate-180"
          strokeWidth={2}
          aria-hidden="true"
        />
      </summary>
      {/* Indented to the summary's words, past the icon. */}
      <div className="pt-2 pl-5.5">{children}</div>
    </details>
  );
}
