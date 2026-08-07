import { lastUsedBadgeClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

/**
 * "Last used" pill on the sign-in option this browser signed in with last.
 *
 * Not `aria-hidden`: which option you used last is exactly the thing a
 * returning user is trying to remember, so it belongs in the accessible name
 * of the control it sits on ("Continue with Google, last used") rather than
 * being a sighted-only cue.
 */
export function LastUsedBadge({ className }: { className?: string }) {
  return <span className={cn(lastUsedBadgeClass, className)}>Last used</span>;
}
