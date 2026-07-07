"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, X } from "lucide-react";
import { setActiveAccount } from "@/lib/team/actions";
import { ROLE_LABELS, type TeamRole } from "@/lib/team/permissions";

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
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
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
        Viewing <span className="font-semibold">{storeName}</span> as{" "}
        {ROLE_LABELS[role]}
        {readOnly && (
          <span className="font-inter text-muted-foreground"> · read-only</span>
        )}
      </p>
      <button
        type="button"
        onClick={backToOwn}
        disabled={pending}
        className="flex shrink-0 items-center gap-1 rounded-[0.375rem] px-2 py-1 font-inter text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <X className="size-3.5" aria-hidden />
        Back to your store
      </button>
    </div>
  );
}
