import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { iconNudgeRightClass, primaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

/**
 * The nudge towards 2FA, for the places a person is already thinking about
 * how they sign in (beside the password card). Renders nothing once it's on.
 */
export function TwoFactorPrompt({ enabled }: { enabled: boolean }) {
  if (enabled) return null;
  return (
    <section
      aria-labelledby="two-factor-prompt-title"
      className="flex flex-col gap-4 border border-foreground bg-background p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7"
    >
      <div className="flex min-w-0 items-start gap-3">
        <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-foreground" />
        <div className="min-w-0">
          <h2 id="two-factor-prompt-title" className="text-base font-semibold text-foreground">
            Your password is the only lock on this account
          </h2>
          <p className="mt-1 font-inter text-sm leading-relaxed text-muted-foreground">
            Turn on two-factor authentication so signing in also needs a code
            from your phone. It takes about a minute.
          </p>
        </div>
      </div>
      <Link
        href="/settings/security?setup=1"
        className={cn(primaryButtonClass, "group/btn shrink-0")}
      >
        Turn on 2FA
        <ArrowRight aria-hidden className={cn("size-4", iconNudgeRightClass)} />
      </Link>
    </section>
  );
}
