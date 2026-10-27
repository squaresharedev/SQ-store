"use client";

import Link from "@/components/ui/AppLink";
import { useId, type HTMLAttributes } from "react";
import {
  BadgePercent,
  Ban,
  Banknote,
  CalendarClock,
  ChevronDown,
  Gauge,
  Infinity as InfinityIcon,
  Megaphone,
  Package,
  Pencil,
  PowerOff,
  ShoppingBag,
  Tag,
  Ticket,
  TimerOff,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/CopyButton";
import { Meter, type MeterTone } from "@/components/ui/Meter";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/Tooltip";
import { badgeClass } from "@/components/ui/surface-styles";
import {
  focusRingClass,
  iconButtonClass,
  iconDangerButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { formatCents } from "@/lib/format/money";
import type { CoveredProduct } from "@/lib/discounts/covered";
import { discountEditPath } from "@/lib/discounts/paths";
import { runProgress, usageProgress } from "@/lib/discounts/progress";
import { useNow } from "@/lib/hooks/useNow";
import type { DiscountListItem } from "@/lib/discounts/summary";
import type { DiscountKind, DiscountStatus } from "@/types/discount";
import { useDiscountWording } from "./useDiscountWording";

// THE PARTS A DISCOUNT'S ROW IS BUILT FROM: what it says, in which words, under
// which data attributes, and the controls with their names. DiscountRow only
// arranges them as a ticket. See /dev/discounts for every state.

/** What the row is handed. */
export type DiscountRowProps = {
  item: DiscountListItem;
  /** The products it covers, each with what one costs under it
   *  (lib/discounts/covered.ts). The row opens to list them. */
  products: readonly CoveredProduct[];
  canWrite: boolean;
  /** An action on this row is in flight. */
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEnd: () => void;
  onDelete: () => void;
};

/** A sale is a price tag; a code is a ticket someone hands over. */
export const DISCOUNT_KIND_ICONS: Record<DiscountKind, LucideIcon> = {
  automatic: Tag,
  code: Ticket,
};

/**
 * Each status as a chip, for the ticket's stub. The stub is ink while the
 * discount is live and grey otherwise, so the live chip is the green that
 * reads on ink and every other chip is the page's own surface on the grey.
 * A dot for live and a glyph for the rest, so the five never rely on colour.
 */
const STATUS_LOOK: Record<DiscountStatus, { chip: string; icon: LucideIcon | null }> = {
  active: { chip: "bg-success-dark/20 text-success-dark", icon: null },
  scheduled: { chip: "bg-background text-foreground", icon: CalendarClock },
  paused: { chip: "bg-background text-muted-foreground", icon: PowerOff },
  used_up: { chip: "bg-background text-muted-foreground", icon: Ban },
  ended: { chip: "bg-background text-muted-foreground", icon: TimerOff },
};

/** The glyphs the facts lead with, named once so each is drawn the same
 *  wherever a discount is described. */
export const DISCOUNT_FACT_ICONS = {
  value: BadgePercent,
  scope: Package,
  channel: Megaphone,
  schedule: CalendarClock,
  noEnd: InfinityIcon,
  orders: ShoppingBag,
  revenue: Banknote,
  uses: Gauge,
} as const satisfies Record<string, LucideIcon>;

const COPY_MESSAGES = {
  copy: "Discounts.list.copy.copy",
  copied: "Discounts.list.copy.copied",
  failed: "Discounts.list.copy.failed",
} as const;

/** A fact's line: its glyph, then its words. Shared by the plain facts and the
 *  one that is a button (the products a discount covers). */
const FACT = "flex min-w-0 items-center gap-2 font-inter text-sm";
const FACT_ICON = "size-4 shrink-0 text-muted-foreground";

/**
 * Everything a row says, in words, plus the two fractions it draws.
 *
 * The dates are in the READER'S time zone, which only their browser knows (the
 * server renders in its own). So anything dated is null until the browser has
 * spoken, and a row holds its place until then rather than say it wrong.
 */
export function useDiscountRowFacts(item: DiscountListItem) {
  const t = useTranslations("Discounts.list");
  const words = useDiscountWording();
  const now = useNow();
  const { discount, status } = item;
  const isCode = discount.kind === "code";

  // The one date line the row has room for: when it starts if it has not yet,
  // otherwise when it ends (or ended).
  const schedule =
    now === null
      ? null
      : status === "scheduled"
        ? t("startsOn", { date: words.when(discount.startsAt) })
        : discount.endsAt === null
          ? t("noEnd")
          : status === "ended"
            ? t("ended", { date: words.when(discount.endsAt) })
            : t("endsOn", { date: words.when(discount.endsAt) });

  // How far through its run: nothing before it starts, all of it once it is
  // over (the server already knows both), the clock's answer in between, and
  // null for a run with no end to be a fraction of.
  const run =
    status === "scheduled"
      ? 0
      : status === "ended"
        ? 1
        : discount.endsAt === null
          ? null
          : now === null
            ? 0
            : runProgress(discount, now);

  return {
    isCode,
    /** In force right now: the one state a row spends ink on. */
    live: status === "active",
    /** Ink for what is live or coming; muted for off, spent and over. */
    tone: (status === "active" || status === "scheduled" ? "ink" : "muted") as MeterTone,
    figure: words.figure(discount.value),
    value: words.value(discount.kind, discount.value),
    kind: words.kind(discount.kind),
    scope: words.scope(discount.appliesTo, discount.productIds.length),
    channel: isCode && discount.shareChannel ? t("channel", { channel: discount.shareChannel }) : null,
    schedule,
    /** The instant that line is about. */
    scheduleInstant: status === "scheduled" ? discount.startsAt : (discount.endsAt ?? discount.startsAt),
    run,
    orders: t("orders", { orders: item.orders }),
    revenue: item.revenue.length > 0 ? words.money(item.revenue) : null,
    uses:
      isCode && discount.usageLimit !== null
        ? t("uses", { uses: item.uses, limit: discount.usageLimit })
        : null,
    used: isCode ? usageProgress(item.uses, discount.usageLimit) : null,
  };
}

export type DiscountRowFacts = ReturnType<typeof useDiscountRowFacts>;

/** Where the discount stands, as the chip on the ticket's stub. */
export function DiscountStatusBadge({ status, className }: { status: DiscountStatus; className?: string }) {
  const words = useDiscountWording();
  const { chip, icon: Icon } = STATUS_LOOK[status];
  return (
    <span className={cn(badgeClass, "inline-flex shrink-0 items-center gap-1.5", chip, className)}>
      {Icon ? (
        <Icon className="size-3" strokeWidth={2} aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      {words.status(status)}
    </span>
  );
}

/**
 * One fact, led by its glyph: the icon is what the eye finds, the words are
 * there for whoever wants them. `quiet` is for a fact that says "nothing yet".
 */
export function DiscountFact({
  icon: Icon,
  quiet = false,
  className,
  children,
  ...rest
}: {
  icon: LucideIcon;
  quiet?: boolean;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn(FACT, quiet ? "text-muted-foreground" : "text-foreground", className)} {...rest}>
      <Icon className={FACT_ICON} strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** What a row is called: the code itself (the thing a seller shares), with a
 *  copy button, or for a sale what it takes off. */
export function DiscountTitle({ item, facts }: { item: DiscountListItem; facts: DiscountRowFacts }) {
  const { code } = item.discount;
  if (!facts.isCode || !code) {
    return <p className="text-lg font-semibold leading-tight text-foreground">{facts.value}</p>;
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span
        className="truncate font-mono text-lg font-semibold leading-tight tracking-wide text-foreground"
        data-discount-code=""
      >
        {code}
      </span>
      <CopyButton value={code} messages={COPY_MESSAGES} />
    </div>
  );
}

/**
 * Which products it covers, as the fact that OPENS: pressing it unfolds the
 * list inside the ticket (DiscountProductsPanel, which the row places and
 * names with `panelId`). A plain fact when there is nothing to list.
 */
export function DiscountScope({
  facts,
  count,
  open,
  onOpenChange,
  panelId,
}: {
  facts: DiscountRowFacts;
  /** How many products the panel would list. */
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelId: string;
}) {
  if (count === 0) return <DiscountFact icon={DISCOUNT_FACT_ICONS.scope}>{facts.scope}</DiscountFact>;
  const Icon = DISCOUNT_FACT_ICONS.scope;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => onOpenChange(!open)}
      // The negative margin gives the hover wash room without moving the
      // glyph out of line with the facts beside it.
      className={cn(
        FACT,
        "-mx-1.5 -my-0.5 rounded-none px-1.5 py-0.5 text-foreground hover:bg-accent",
        transitionClass,
        focusRingClass,
      )}
      data-discount-scope=""
    >
      <Icon className={FACT_ICON} strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0">{facts.scope}</span>
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-base ease-standard motion-reduce:transition-none",
          open && "rotate-180",
        )}
        strokeWidth={2}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * The products a discount covers, each with what one of it costs under the
 * discount: the regular price struck through beside the new one, or the
 * regular price alone where the discount does not lower it. Scrolls inside
 * itself, so a discount on a whole catalogue does not push the list off the
 * page.
 */
export function DiscountProductsPanel({
  id,
  products,
  className,
}: {
  id: string;
  products: readonly CoveredProduct[];
  className?: string;
}) {
  const t = useTranslations("ProductPage.sale");
  const locale = useLocale();
  return (
    <ul
      id={id}
      className={cn(
        "grid max-h-72 gap-x-6 gap-y-2.5 overflow-y-auto font-inter text-sm @2xl:grid-cols-2 @5xl:grid-cols-3",
        className,
      )}
      data-discount-products={products.length}
    >
      {products.map((product) => {
        const regular = formatCents(product.regularCents, product.currency, locale);
        const now = formatCents(product.nowCents, product.currency, locale);
        const lowered = product.nowCents < product.regularCents;
        return (
          <li key={product.id} className="flex min-w-0 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <ProductThumb src={product.imageUrl} className="size-9 rounded-sm" />
              <span className="min-w-0 truncate text-foreground">{product.title}</span>
            </span>
            {lowered ? (
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                {/* Heard once as a sentence, not as two loose numbers. */}
                <span className="sr-only">{t("wasNow", { was: regular, now })}</span>
                <del aria-hidden="true" className="text-muted-foreground">
                  {regular}
                </del>
                <span aria-hidden="true" className="font-medium text-foreground">
                  {now}
                </span>
              </span>
            ) : (
              <span className="shrink-0 tabular-nums text-muted-foreground">{regular}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** When it starts, ends or ended. Holds its line until the browser has said
 *  what time zone the reader is in. */
export function DiscountSchedule({ item, facts }: { item: DiscountListItem; facts: DiscountRowFacts }) {
  const open = item.discount.endsAt === null && item.status !== "scheduled";
  return (
    <DiscountFact
      icon={open ? DISCOUNT_FACT_ICONS.noEnd : DISCOUNT_FACT_ICONS.schedule}
      data-discount-schedule=""
    >
      <time dateTime={facts.scheduleInstant}>{facts.schedule ?? <>&nbsp;</>}</time>
    </DiscountFact>
  );
}

/** How far through its run it is, as a bar under the date. */
export function DiscountRunMeter({ facts }: { facts: DiscountRowFacts }) {
  return <Meter value={facts.run} tone={facts.tone} />;
}

/** How many orders it brought in. */
export function DiscountOrders({ item, facts }: { item: DiscountListItem; facts: DiscountRowFacts }) {
  return (
    <DiscountFact icon={DISCOUNT_FACT_ICONS.orders} quiet={item.orders === 0} data-discount-orders={item.orders}>
      {facts.orders}
    </DiscountFact>
  );
}

/** What those orders took, when there are any. */
export function DiscountRevenue({ facts }: { facts: DiscountRowFacts }) {
  if (facts.revenue === null) return null;
  return (
    <DiscountFact icon={DISCOUNT_FACT_ICONS.revenue} className="font-medium tabular-nums">
      {facts.revenue}
    </DiscountFact>
  );
}

/** A limited code's uses, said and drawn. Nothing for a code with no limit. */
export function DiscountUsage({ facts }: { facts: DiscountRowFacts }) {
  if (facts.uses === null) return null;
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <DiscountFact icon={DISCOUNT_FACT_ICONS.uses}>{facts.uses}</DiscountFact>
      <Meter value={facts.used} tone={facts.tone} />
    </span>
  );
}

/**
 * The controls, for owners and editors: a code is switched on and off, a
 * running sale is ended, and either is edited or deleted. Icons, each with its
 * word on hover and as its accessible name.
 */
export function DiscountRowActions({
  item,
  busy,
  onToggle,
  onEnd,
  onDelete,
  className,
}: Omit<DiscountRowProps, "canWrite" | "products"> & { className?: string }) {
  const t = useTranslations("Discounts.list");
  const switchLabelId = useId();
  const { discount, status } = item;
  const isCode = discount.kind === "code";

  return (
    <div className={cn("flex shrink-0 flex-wrap items-center gap-2", className)}>
      {isCode && status !== "ended" && (
        <Tooltip label={t("switchLabel")} className="relative pr-1">
          <span id={switchLabelId} className="sr-only">
            {t("switchLabel")}
          </span>
          <Switch
            checked={discount.enabled}
            onCheckedChange={onToggle}
            disabled={busy}
            aria-labelledby={switchLabelId}
          />
        </Tooltip>
      )}
      {/* An ended sale is history (the EU price rule reads it); an ended
          code can still be given more time. */}
      {(isCode || status !== "ended") && (
        <Tooltip label={t("edit")}>
          <Link href={discountEditPath(discount.id)} aria-label={t("edit")} className={iconButtonClass}>
            <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
          </Link>
        </Tooltip>
      )}
      {!isCode && status === "active" && (
        <Tooltip label={t("endNow")}>
          <button
            type="button"
            aria-label={t("endNow")}
            className={iconDangerButtonClass}
            onClick={onEnd}
            disabled={busy}
          >
            <TimerOff className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      <Tooltip label={t("delete")}>
        <button
          type="button"
          aria-label={t("delete")}
          className={iconDangerButtonClass}
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}
