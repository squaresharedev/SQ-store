"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Eye, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useDelayedPending } from "@/lib/hooks/useDelayedPending";
import { setActiveAccount } from "@/lib/team/actions";
import type { TeamRole } from "@/lib/team/permissions";

/**
 * Slim banner shown while the dashboard is pointed at ANOTHER person's store
 * (i.e. you're viewing it as a team member, not your own). Makes the context —
 * and, for viewers, the read-only state — unmistakable, and offers a one-click
 * jump back to your own store.
 */
export function ViewingBanner({
  storeName,
  role,
  ownAccountId,
}: {
  storeName: string;
  role: TeamRole;
  ownAccountId: string;
}) {
  const t = useTranslations("Nav.viewingBanner");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const showSpinner = useDelayedPending(pending);
  const readOnly = role === "viewer";

  function backToOwn() {
    startTransition(async () => {
      await setActiveAccount(ownAccountId);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-accent px-4 py-2 text-sm md:px-6">
      <Eye className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-foreground">
        {t.rich("viewing", {
          storeName,
          role,
          store: (chunks) => <span className="font-semibold">{chunks}</span>,
        })}
        {readOnly && (
          <span className="font-inter text-muted-foreground">{t("readOnly")}</span>
        )}
      </p>
      <button
        type="button"
        onClick={backToOwn}
        disabled={pending}
        aria-busy={pending || undefined}
        className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-1 font-inter text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {/* The spinner takes the icon's place, so the button does not grow. */}
        {showSpinner ? <Spinner className="size-3.5" /> : <X className="size-3.5" aria-hidden />}
        {t("backToYourStore")}
      </button>
    </div>
  );
}
