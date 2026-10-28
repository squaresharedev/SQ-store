"use client";

import { useState } from "react";
import Link from "@/components/ui/AppLink";
import { ChevronRight } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { iconNudgeRightClass, infoTextClass } from "@/components/ui/control-styles";
import { badgeClass } from "@/components/ui/surface-styles";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import { cn } from "@/lib/utils";
import { isModifiedClick } from "@/lib/utils/modified-click";
import { ORDERS_PATH } from "@/lib/dashboard/paths";
import { orderDetailPath } from "@/lib/orders/paths";
import type { DashboardOrder, OrderStatus } from "@/lib/dashboard/queries";
import { formatCents, formatOrderDate } from "@/lib/dashboard/format";
import type { OrderView } from "@/types/order-view";
import type { OrderGlance } from "@/lib/orders/queries";
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

/** The latest ~5 orders across all statuses. */
export function RecentOrders({
  orders,
  details = [],
  glances = {},
  id,
  canFulfil = false,
}: {
  orders: DashboardOrder[];
  /** Full detail for these rows, read with the page. A row found here opens
   *  its panel in place, instantly; one that is not falls back to its link. */
  details?: OrderView[];
  /** Photo and unit count per row, keyed by order id. A row without one shows
   *  the placeholder tile and counts as a single unit. */
  glances?: Record<string, OrderGlance>;
  id?: string;
  /** Whether the viewer may mark orders shipped from the panel. */
  canFulfil?: boolean;
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
            const glance = order.id ? glances[order.id] : undefined;
            const quantity = glance?.quantity ?? detail?.quantity ?? 1;
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
                  href={order.id ? orderDetailPath(order.id) : ORDERS_PATH}
                  onClick={(event) => {
                    if (!detail || isModifiedClick(event)) return;
                    event.preventDefault();
                    setSelected(detail);
                  }}
                  aria-haspopup={detail ? "dialog" : undefined}
                  className="group/btn -mx-2 flex items-center gap-3 rounded-sm px-2 py-2.5 transition-colors duration-base ease-standard hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <ProductThumb src={glance?.photoUrl} loading="lazy" className="size-10" />
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      {/* "2 × Lamp" when more than one was bought; a lone
                          unit is just its name (same rule as the orders list). */}
                      <p className="truncate text-sm font-medium text-foreground">
                        {quantity > 1
                          ? t("Orders.detail.packLine", { quantity, title: order.product_title })
                          : order.product_title}
                      </p>
                      <p className={infoTextClass}>
                        {t(`Orders.channel.${order.channel}`)}{" "}
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
        <OrderDetailSheet
          order={selected}
          onClose={() => setSelected(null)}
          canFulfil={canFulfil}
          onOrderChange={setSelected}
        />
      )}
    </ModuleCard>
  );
}
