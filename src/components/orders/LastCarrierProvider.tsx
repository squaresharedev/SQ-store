"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { carrierFor, withCarrier, type CarrierHabits } from "@/lib/predictions";
import type { CarrierId } from "@/types/order-view";

type LastCarrier = {
  /** The carrier the ship form starts on for a parcel to `country`, or null. */
  carrierFor: (country: string | null | undefined) => CarrierId | null;
  /** Called once a parcel ships with a carrier, so the next one to the same
   *  place starts on it. */
  remember: (carrier: CarrierId, country: string | null) => void;
};

/**
 * THE CARRIER THIS STORE SHIPS WITH, per destination country, which the ship
 * form opens on: most sellers ship one way at home and another abroad. The
 * dashboard shell reads it for the active store on the server
 * (getCarrierHabits in lib/orders/queries.ts), like OrderMailProvider, so the
 * order panel opened from anywhere starts the same, on any device, and never
 * with another store's carrier. A parcel shipped since that read wins, for the
 * store it was shipped from: the shell is not rendered again by a ship.
 *
 * Outside the shell (a test, a gallery) the form opens on "Other" as before.
 */
const LastCarrierContext = createContext<LastCarrier>({
  carrierFor: () => null,
  remember: () => {},
});

export function LastCarrierProvider({
  storeId,
  habits,
  children,
}: {
  /** The active store, so a carrier used in one is never offered in another. */
  storeId: string;
  habits: CarrierHabits;
  children: ReactNode;
}) {
  const [used, setUsed] = useState<{ storeId: string; habits: CarrierHabits } | null>(null);
  const value = useMemo<LastCarrier>(() => {
    const current = used?.storeId === storeId ? used.habits : habits;
    return {
      carrierFor: (country) => carrierFor(current, country),
      remember: (carrier, country) => setUsed({ storeId, habits: withCarrier(current, carrier, country) }),
    };
  }, [used, storeId, habits]);
  return <LastCarrierContext.Provider value={value}>{children}</LastCarrierContext.Provider>;
}

export function useLastCarrier(): LastCarrier {
  return useContext(LastCarrierContext);
}
