"use client";

import { Hourglass, PauseCircle, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { FixFieldChips } from "@/components/products/FixFieldChips";
import { moderationNoticeId } from "@/lib/moderation/paths";
import { isAwaitingCheck } from "@/lib/moderation/removal";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import type { ProductRemoval } from "@/types/product";

/**
 * A storefront that is not public, said inside the editor where it is fixed.
 *
 * The full statement, the "I've made the changes" button and the appeal live
 * on the storefront LIST (the editor is a full-screen canvas with no room for
 * a banner, and that is where the notification lands). But a seller who then
 * opens the editor to make the change should not have to remember what it
 * was, so this strip under the header repeats the one thing they need while
 * they work: which parts to change, with a way back to the rest.
 *
 * `onDetails` goes through the editor's leave guard, like its Back button,
 * so unsaved canvas edits are not dropped on the way.
 */
export function TakedownStrip({
  removal,
  storefrontId,
  onDetails,
}: {
  removal: ProductRemoval;
  storefrontId: string;
  onDetails: (href: string) => void;
}) {
  const t = useTranslations("Products.removal");
  const paused = removal.kind === "paused";
  // Waiting on the check or on a person: nothing has been decided against it,
  // so it reads like the pause (neutral), never like a removal.
  const waiting = isAwaitingCheck(removal.kind);
  const href = `${STOREFRONT_LIST_PATH}#${moderationNoticeId(storefrontId)}`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2 sm:px-6",
        paused || waiting ? "border-border bg-muted" : "border-destructive/40 bg-destructive/5",
      )}
      data-takedown-strip={removal.kind}
    >
      {waiting ? (
        <Hourglass className="size-4 shrink-0 text-foreground" aria-hidden="true" />
      ) : paused ? (
        <PauseCircle className="size-4 shrink-0 text-foreground" aria-hidden="true" />
      ) : (
        <ShieldAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
      )}
      <p className="font-inter text-sm font-medium text-foreground">
        {removal.kind === "pending"
          ? t("titlePending", { kind: "storefront" })
          : removal.kind === "review"
            ? t("titleReview", { kind: "storefront" })
            : paused
              ? t("titlePaused", { kind: "storefront" })
              : t("title", { kind: "storefront" })}
      </p>
      {paused && removal.fields.length > 0 && (
        <FixFieldChips target="storefront" fields={removal.fields} />
      )}
      <a
        href={href}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          onDetails(href);
        }}
        className="font-inter text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline"
      >
        {t("editorDetails")}
      </a>
    </div>
  );
}
