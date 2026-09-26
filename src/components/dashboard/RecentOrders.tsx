"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { iconNudgeRightClass, infoTextClass } from "@/components/ui/control-styles";
import { badgeClass } from "@/components/ui/surface-styles";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import { cn } from "@/lib/utils";
import type { DashboardOrder, OrderStatus } from "@/lib/dashboard/queries";
import { formatCents, formatOrderDate } from "@/lib/dashboard/format";
import type { OrderView } from "@/types/order-view";
import { ModuleCard, ModuleEmptyText } from "./ModuleCard";


const STATUS_CLASSES: Record<OrderStatus, string> = {
  paid: "text-success",
  refunded: "text-danger-strong",
  disputed: "text-danger-strong",
  pending: "text-muted-foreground",
};

function StatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations("Orders.status");
  const known: OrderStatus = STATUS_CLASSES[status] ? status : "pending";
  return (
    <span
      className={cn(
        badgeClass,
        STATUS_CLASSES[known],
      )}
    >
      {t(known)}
    </span>
  );
}

/** A click the browser should keep: new tab, new window, download, etc. */
function isModifiedClick(event: MouseEvent) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** The latest ~5 orders across all statuses. */
export function RecentOrders({
  orders,
  details = [],
  id,
}: {
  orders: DashboardOrder[];
  /** Full detail for these rows, read with the page. A row found here opens
   *  its panel in place, instantly; one that is not falls back to its link. */
  details?: OrderView[];
  id?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [selected, setSelected] = useState<OrderView | null>(null);
  const detailById = new Map(details.map((order) => [order.id, order]));

  return (
    <ModuleCard title={t("Dashboard.recentOrders.title")} id={id}>
      {orders.length === 0 ? (
        <ModuleEmptyText>{t("Dashboard.recentOrders.empty")}</ModuleEmptyText>
      ) : (
        <ul className="divide-y divide-border">
          {orders.map((order, index) => {
            const detail = order.id ? detailById.get(order.id) : undefined;
            return (
              <li
                key={order.id ?? `${order.created_at}-${index}`}
                className="first:[&>a]:pt-0 last:[&>a]:pb-0"
              >
                {/* The whole row is the target. A plain click opens the
                    order's panel right here, no page change, since the detail
                    came with the page. The href stays the real
                    /orders?order=<id> deep link, so a new tab (or a row whose
                    detail did not load) still lands on that order. An id-less
                    row (an older cached RPC payload) lands on the list rather
                    than a dead link. */}
                <Link
                  href={order.id ? `/orders?order=${order.id}` : "/orders"}
                  onClick={(event) => {
                    if (!detail || isModifiedClick(event)) return;
                    event.preventDefault();
                    setSelected(detail);
                  }}
                  aria-haspopup={detail ? "dialog" : undefined}
                  className="group/btn -mx-2 flex items-center gap-2 rounded-sm px-2 py-2.5 transition-colors duration-base ease-standard hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {order.product_title}
                      </p>
                      <p className={infoTextClass}>
                        {t(
                          order.channel === "marketplace"
                            ? "Orders.channel.marketplace"
                            : "Orders.channel.embed",
                        )}{" "}
                        ·{" "}
                        {formatOrderDate(order.created_at, locale)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={order.status} />
                      <span className="font-inter text-sm font-medium text-foreground">
                        {formatCents(order.amount_cents, order.currency, locale)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight
                    className={cn("size-4 shrink-0 text-muted-foreground", iconNudgeRightClass)}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {selected && (
        <OrderDetailSheet order={selected} onClose={() => setSelected(null)} />
      )}
    </ModuleCard>
  );
}
