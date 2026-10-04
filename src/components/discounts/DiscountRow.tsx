"use client";

import Link from "next/link";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/CopyButton";
import { Switch } from "@/components/ui/switch";
import { badgeClass, cardClass } from "@/components/ui/surface-styles";
import { ghostButtonClass, helpTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { discountEditPath } from "@/lib/discounts/paths";
import { useNow } from "@/lib/hooks/useNow";
import type { DiscountListItem } from "@/lib/discounts/summary";
import type { DiscountStatus } from "@/types/discount";
import { useDiscountWording } from "./useDiscountWording";

/** The one status worth colour is the live one; the rest step back. */
const STATUS_TONE: Record<DiscountStatus, string> = {
  active: "text-success",
  scheduled: "text-foreground",
  paused: "text-muted-foreground",
  used_up: "text-muted-foreground",
  ended: "text-muted-foreground",
};

/**
 * One discount in the list: what it is, where it stands, what it sold, and
 * (for owners and editors) the controls. A code leads with the code itself,
 * the thing a seller shares; a sale leads with what it takes off.
 */
export function DiscountRow({
  item,
  canWrite,
  busy,
  onToggle,
  onEnd,
  onDelete,
}: {
  item: DiscountListItem;
  canWrite: boolean;
  /** An action on this row is in flight. */
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEnd: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Discounts.list");
  const words = useDiscountWording();
  const switchLabelId = useId();
  const { discount, status } = item;
  const isCode = discount.kind === "code";

  // The dates are in the READER'S time zone, which only their browser knows
  // (the server renders in its own). So the line is said once the browser has
  // spoken, and holds its place until then, rather than said wrong.
  const inBrowser = useNow() !== null;
  const schedule = !inBrowser
    ? null
    : status === "ended" && discount.endsAt
      ? t("ended", { date: words.when(discount.endsAt) })
      : status === "scheduled"
        ? t("startsOn", { date: words.when(discount.startsAt) })
        : discount.endsAt
          ? t("endsOn", { date: words.when(discount.endsAt) })
          : t("noEnd");

  return (
    <li
      className={cn(cardClass, "flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between")}
      data-discount-row={discount.id}
      data-discount-kind={discount.kind}
      data-discount-status={status}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(badgeClass, STATUS_TONE[status])}>{words.status(status)}</span>
          <span className={helpTextClass}>{words.kind(discount.kind)}</span>
        </div>
        {isCode && discount.code ? (
          <div className="flex items-center gap-1">
            <span className="font-mono text-lg font-semibold tracking-wide text-foreground" data-discount-code="">
              {discount.code}
            </span>
            <CopyButton
              value={discount.code}
              messages={{
                copy: "Discounts.list.copy.copy",
                copied: "Discounts.list.copy.copied",
                failed: "Discounts.list.copy.failed",
              }}
            />
          </div>
        ) : (
          <p className="text-lg font-semibold text-foreground">{words.value(discount.kind, discount.value)}</p>
        )}
        <p className="text-sm text-foreground">
          {[
            isCode ? words.value(discount.kind, discount.value) : null,
            words.scope(discount.appliesTo, discount.productIds.length),
            isCode && discount.shareChannel ? t("channel", { channel: discount.shareChannel }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className={helpTextClass} data-discount-schedule="">
          <time dateTime={discount.endsAt ?? discount.startsAt}>{schedule ?? <>&nbsp;</>}</time>
        </p>
        <p className={helpTextClass} data-discount-orders={item.orders}>
          {[
            t("orders", { orders: item.orders }),
            item.revenue.length > 0 ? words.money(item.revenue) : null,
            isCode && discount.usageLimit !== null
              ? t("uses", { uses: item.uses, limit: discount.usageLimit })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {canWrite && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isCode && status !== "ended" && (
            <span className="flex items-center gap-2 pr-1">
              <span id={switchLabelId} className="text-sm text-foreground">
                {t("switchLabel")}
              </span>
              <Switch
                checked={discount.enabled}
                onCheckedChange={onToggle}
                disabled={busy}
                aria-labelledby={switchLabelId}
              />
            </span>
          )}
          {/* An ended sale is history (the EU price rule reads it); an ended
              code can still be given more time. */}
          {(isCode || status !== "ended") && (
            <Link href={discountEditPath(discount.id)} className={secondaryButtonClass}>
              {t("edit")}
            </Link>
          )}
          {!isCode && status === "active" && (
            <button type="button" className={secondaryButtonClass} onClick={onEnd} disabled={busy}>
              {t("endNow")}
            </button>
          )}
          <button type="button" className={ghostButtonClass} onClick={onDelete} disabled={busy}>
            {t("delete")}
          </button>
        </div>
      )}
    </li>
  );
}
