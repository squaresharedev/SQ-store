"use client";

// Internal helpers shared by the chart components — not part of the kit's
// public surface (import from "@/components/charts" instead).

import { useEffect, useState } from "react";
import { CATEGORICAL, CHART } from "@/components/charts/theme";
import type { ChartSeries, ChartSlice, ResolvedSeries } from "@/components/charts/types";

/** Auto-assignment stops after the calm slots (ink → grey → light grey →
 *  blue). Green and red exist only for deliberate pinning (colorIndex 4/5)
 *  when a part MEANS good/bad — they never appear as arbitrary "series 5",
 *  where they would fake semantics and can land red beside green (the classic
 *  colourblind trap). */
const AUTO_SLOTS = 4;

/**
 * Attach display colours to series. Slots run monochrome-first, so one series
 * wears the near-black ink and a comparison series naturally recedes to grey;
 * blue is the 4th slot. Slots never cycle: unpinned series past the 4th fall
 * back to the de-emphasis grey — fold them into an "Other" series instead.
 */
export function resolveSeries(series: ChartSeries[]): ResolvedSeries[] {
  if (
    process.env.NODE_ENV !== "production" &&
    series.some((s, i) => !s.color && s.colorIndex === undefined && i >= AUTO_SLOTS)
  ) {
    console.warn(
      `charts: more than ${AUTO_SLOTS} unpinned series; extras render in the de-emphasis grey. ` +
        "Fold the tail into an 'Other' series, or pin colours deliberately (colorIndex).",
    );
  }
  return series.map((s, i) => ({
    ...s,
    label: s.label ?? s.key,
    resolvedColor:
      s.color ??
      (s.colorIndex !== undefined
        ? CATEGORICAL[s.colorIndex % CATEGORICAL.length]
        : i < AUTO_SLOTS
          ? CATEGORICAL[i]
          : CHART.other),
  }));
}

/** Slice colour: explicit → pinned slot → monochrome-first order, with the
 *  same 4-slot cap as series (the folded "Other" wears the de-emphasis grey). */
export function resolveSliceColor(slice: ChartSlice, index: number): string {
  if (slice.color) return slice.color;
  if (slice.colorIndex !== undefined) return CATEGORICAL[slice.colorIndex % CATEGORICAL.length];
  return index < AUTO_SLOTS ? CATEGORICAL[index] : CHART.other;
}

/** True once the client reports prefers-reduced-motion — charts then skip
 *  entrance animation (SSR renders static, so the default false never flashes). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return; // jsdom
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Legend-hover highlight state: the hovered series stays at full strength,
 *  the rest recede (via dimmableClass/dimmedClass on the series layer). */
export function useSeriesHighlight() {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  return { highlighted, setHighlighted };
}
