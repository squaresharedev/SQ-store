"use client";

import {
  CreditCard,
  Flag,
  Info,
  ListFilter,
  Package,
  ShieldAlert,
  ShoppingBag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { focusRingInsetClass, transitionClass } from "@/components/ui/control-styles";
import { FilterSelect, type FilterOption } from "@/components/orders/FilterSelect";
import { TYPE_LABEL } from "@/lib/notifications/presentation";
import type { NotificationFacets, NotificationFilter } from "@/lib/notifications/filters";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notifications/types";

/** One icon per category, in the same tones as the row's type dot. */
const TYPE_ICON: Record<NotificationType, { icon: LucideIcon; tone?: string }> = {
  team: { icon: Users },
  order: { icon: ShoppingBag, tone: "text-success" },
  payment: { icon: CreditCard, tone: "text-success" },
  stock: { icon: Package, tone: "text-destructive" },
  system: { icon: Info, tone: "text-muted-foreground" },
  security: { icon: ShieldAlert, tone: "text-destructive" },
  policy: { icon: Flag, tone: "text-destructive" },
};

/**
 * The notification history's filter bar: All / Unread, and a category.
 *
 * Categories are only offered when the reader has something in them. The app
 * can emit seven kinds, several of which most sellers never receive, and a
 * menu full of options that always come back empty teaches people the filter
 * is broken. The selected category is always kept, so a filter arrived at by
 * URL can still be seen and undone.
 *
 * The Unread toggle counts within the chosen category, so the number beside
 * it is always what pressing it will show.
 */
export function NotificationFilters({
  filter,
  facets,
  onChange,
}: {
  filter: NotificationFilter;
  facets: NotificationFacets;
  onChange: (next: NotificationFilter) => void;
}) {
  const t = useTranslations("Notifications");
  const tRoot = useTranslations();

  const unreadInView = filter.type ? (facets.byType[filter.type]?.unread ?? 0) : facets.unread;

  const categories = NOTIFICATION_TYPES.filter(
    (type) => type === filter.type || (facets.byType[type]?.total ?? 0) > 0,
  );
  const categoryOptions: FilterOption<NotificationType | "">[] = [
    { value: "", label: t("filters.allCategories"), icon: ListFilter },
    ...categories.map((type) => ({
      value: type,
      label: tRoot(TYPE_LABEL[type]),
      ...TYPE_ICON[type],
    })),
  ];

  const statuses = [
    { unread: false, label: t("filters.all") },
    { unread: true, label: t("filters.unread") },
  ];

  return (
    <div
      role="search"
      aria-label={t("filters.label")}
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      <div
        role="group"
        aria-label={t("filters.show")}
        className="flex border border-border bg-background"
      >
        {statuses.map((status, index) => {
          const active = filter.unread === status.unread;
          return (
            <button
              key={status.label}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...filter, unread: status.unread })}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium",
                transitionClass,
                focusRingInsetClass,
                index > 0 && "border-l border-border",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {status.label}
              {status.unread && unreadInView > 0 && (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center font-inter text-xs leading-5 tabular-nums",
                    active ? "bg-primary-foreground text-primary" : "bg-secondary text-foreground",
                  )}
                >
                  {unreadInView > 99 ? "99+" : unreadInView}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {categories.length > 0 && (
        <FilterSelect
          id="notifications-category"
          variant="button"
          ariaLabel={t("filters.category")}
          value={filter.type ?? ""}
          options={categoryOptions}
          mutedValue=""
          onChange={(value) => onChange({ ...filter, type: value === "" ? null : value })}
          triggerClassName="py-2"
        />
      )}
    </div>
  );
}
