import { cn } from "@/lib/utils";

/**
 * Giant, faint decorative arrow that bleeds off one screen edge — the shared
 * background motif from the sign-in/up page, reused across settings so empty
 * whitespace feels intentional.
 *
 * Purely decorative: aria-hidden, pointer-events-none, and rendered at
 * `--decor-opacity` (globals.css) so content layered above keeps full
 * contrast. The parent must be `relative overflow-hidden`; place this before
 * the content so it stacks behind it.
 */
export function BackgroundArrow({
  side = "left",
  className,
}: {
  side?: "left" | "right";
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 hidden -translate-y-1/2 select-none text-neutral-900 opacity-(--decor-opacity) md:block",
        side === "left" ? "-left-24" : "-right-24",
        className,
      )}
    >
      <svg
        width="600"
        height="600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        style={{ overflow: "visible" }}
      >
        {/* Shaft extended well past the icon's own bounds so it bleeds off the
            screen edge and gets clipped by the parent's overflow-hidden, while
            the tip (second path) stays anchored in place. Left points
            northeast, right points the opposite (southwest). */}
        {side === "left" ? (
          <>
            <path d="M-13 37 17 7" />
            <path d="M7 7h10v10" />
          </>
        ) : (
          <>
            <path d="M37 -13 7 17" />
            <path d="M17 17H7V7" />
          </>
        )}
      </svg>
    </div>
  );
}
