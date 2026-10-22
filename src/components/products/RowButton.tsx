import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";

/**
 * A list row's own control in the product form: reorder, remove. Shared by
 * the option lists and the badge list.
 *
 * Borderless, and dimmed until the row is hovered or something in it takes
 * focus. Three bordered boxes per row, times five options, times two groups is
 * thirty little squares competing with the five names that are the actual
 * content, but they still have to be reachable by keyboard the moment they
 * are tabbed to, which is what `group-has-[:focus-visible]` buys that a plain
 * hover rule would not. On a touch screen there is no hover to reveal them,
 * so a coarse pointer always sees them.
 */
export function RowButton({
  label,
  onClick,
  disabled,
  destructive,
  groupName = "row",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Which named group reveals it: an option `row`, or the whole `group` card.
   *  Both class strings are spelled out because Tailwind cannot see a computed
   *  `group-hover/${name}`. */
  groupName?: "row" | "group";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-sm text-muted-foreground",
        "focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-0",
        groupName === "row"
          ? "opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100"
          : "opacity-0 group-hover/group:opacity-100 group-has-[:focus-visible]/group:opacity-100",
        "pointer-coarse:not-disabled:opacity-100",
        destructive
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
        transitionClass,
        focusRingClass,
      )}
    >
      {children}
    </button>
  );
}
