"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * WHETHER THIS MEMBER MAY TAKE AN ORDER BACK (orders.refund, the owner's alone
 * in lib/team/permissions.ts).
 *
 * Decided on the server and handed down once by the dashboard shell, like
 * OrderMailProvider beside it, so the order panel opened from the Orders list,
 * from the overview's Recent orders and from a deep link all agree, without a
 * second permission prop threaded through every screen in between.
 *
 * Cosmetic, as every client permission is: the server action and the database
 * function both refuse a member who may not (lib/orders/actions.ts,
 * public.order_refund).
 *
 * Defaults to false, so a panel rendered outside the shell (a test, a gallery)
 * offers no refund unless it asks for one.
 *
 * Also carries the name of the store being viewed, for a member who may not:
 * "only the owner can" is a dead end, "only the owner of Clay & Co can" is
 * who to ask.
 */
type OrderRefundAccess = { allowed: boolean; storeName: string | null };

const OrderRefundContext = createContext<OrderRefundAccess>({ allowed: false, storeName: null });

export function OrderRefundProvider({
  allowed,
  storeName = null,
  children,
}: {
  allowed: boolean;
  /** The store being viewed, when it is someone else's. */
  storeName?: string | null;
  children: ReactNode;
}) {
  return (
    <OrderRefundContext.Provider value={{ allowed, storeName }}>{children}</OrderRefundContext.Provider>
  );
}

/** True when the reader may refund orders in the store being viewed. */
export function useCanRefundOrders(): boolean {
  return useContext(OrderRefundContext).allowed;
}

/** The store being viewed when it is someone else's, else null. */
export function useRefundStoreName(): string | null {
  return useContext(OrderRefundContext).storeName;
}
