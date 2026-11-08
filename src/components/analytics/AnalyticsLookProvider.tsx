"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ChartStyleProvider } from "@/components/charts";
import { ANALYTICS_LOOK, type AnalyticsLook } from "@/components/analytics/look";

const AnalyticsLookContext = createContext<AnalyticsLook>(ANALYTICS_LOOK);

/** Hands the page's look to the charts inside it, and its axes to every kit
 *  chart among them. AnalyticsPage sets it once around the whole page. */
export function AnalyticsLookProvider({ look, children }: { look: AnalyticsLook; children: ReactNode }) {
  const chartStyle = useMemo(() => ({ axes: look.axes }), [look.axes]);
  return (
    <AnalyticsLookContext.Provider value={look}>
      <ChartStyleProvider value={chartStyle}>{children}</ChartStyleProvider>
    </AnalyticsLookContext.Provider>
  );
}

/** The look the analytics page is drawn in (ANALYTICS_LOOK outside one). */
export function useAnalyticsLook(): AnalyticsLook {
  return useContext(AnalyticsLookContext);
}
