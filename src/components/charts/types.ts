// Shared prop shapes for the reusable chart kit. Charts are presentational
// only: parents fetch and shape data; the kit renders it.

/** One row of chart data: the x/category value plus one numeric field per series. */
export type ChartDatum = Record<string, string | number | null | undefined>;

/** A plotted series (a line, a bar group member, a stack layer). */
export interface ChartSeries {
  /** Key into each datum holding this series' numeric value. */
  key: string;
  /** Display name for legend + tooltip. Defaults to the key. */
  label?: string;
  /**
   * Pin a categorical palette slot (0–7) so the entity keeps its colour when
   * sibling series are filtered away (colour follows the entity, not its row).
   */
  colorIndex?: number;
  /** Explicit CSS colour override — prefer colorIndex so slots stay validated. */
  color?: string;
}

/** One part of a whole — a pie slice or a composition-bar segment. */
export interface ChartSlice {
  label: string;
  value: number;
  /** Pin a categorical palette slot (0–7). */
  colorIndex?: number;
  /** Explicit CSS colour override — prefer colorIndex. */
  color?: string;
}

/** A series with its resolved display colour attached (internal). */
export interface ResolvedSeries extends ChartSeries {
  label: string;
  resolvedColor: string;
}
