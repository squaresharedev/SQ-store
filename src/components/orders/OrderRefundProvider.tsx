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
 */
const OrderRefundContext = createContext(false);

export function OrderRefundProvider({
  allowed,
  children,
}: {
  allowed: boolean;
  children: ReactNode;
}) {
  return <OrderRefundContext.Provider value={allowed}>{children}</OrderRefundContext.Provider>;
}

/** True when the reader may refund orders in the store being viewed. */
export function useCanRefundOrders(): boolean {
  return useContext(OrderRefundContext);
}
