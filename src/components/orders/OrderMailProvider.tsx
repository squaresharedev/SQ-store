"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * WHETHER THIS DEPLOYMENT CAN SEND EMAIL, for the parts of the order screens
 * that promise it ("we'll email the buyer that it's on its way").
 *
 * Decided on the server (emailSendingEnabled in lib/email/send.ts, which reads
 * secrets a browser must never see) and handed down once by the dashboard
 * shell, so the order panel opened from the Orders list, from the overview's
 * Recent orders and from a deep link all tell the same truth. A promise of
 * mail that will not be sent is worse than no promise: the seller stops
 * looking for the buyer's reply, and the buyer waits for a message that never
 * comes.
 *
 * Defaults to true, the case where nothing needs saying, so a component
 * rendered outside the shell (a test, a gallery) behaves as before.
 */
const OrderMailContext = createContext(true);

export function OrderMailProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return <OrderMailContext.Provider value={enabled}>{children}</OrderMailContext.Provider>;
}

/** True when the buyer will really be emailed about their order. */
export function useOrderMailEnabled(): boolean {
  return useContext(OrderMailContext);
}
