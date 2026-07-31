"use client";

import {
  tooltipLabelClass,
  tooltipValueClass,
  tooltipWrapperClass,
} from "@/components/charts/theme";
import { formatNumber } from "@/components/charts/format";

// Shared tooltip body for every cartesian chart (Recharts `content={...}` —
// never the default tooltip). One readout lists every series at the hovered
// x, so the pointer never has to land on a 2px line. Values lead (semibold),
// series names follow (muted); the coloured dot beside each row carries
// identity — text never wears the series colour.

/** Structural subset of recharts' tooltip content props — typing only what we
 *  read keeps the component compatible with the wide ValueType/NameType
 *  generics across chart types. */
export interface ChartTooltipEntry {
  /** Recharts allows function dataKeys; we only ever stringify it. */
  dataKey?: unknown;
  name?: string | number;
  value?: number | string | ReadonlyArray<number | string>;
  color?: string;
  payload?: unknown;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  valueFormatter = formatNumber,
  labelFormatter,
  colorFor,
}: {
  active?: boolean;
  payload?: ReadonlyArray<ChartTooltipEntry>;
  label?: string | number;
  valueFormatter?: (value: number) => string;
  labelFormatter?: (label: string) => string;
  /** Resolves a series key to its display colour (survives Recharts omitting
   *  `color` on some mark types). */
  colorFor?: (key: string) => string | undefined;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const heading =
    label === undefined
      ? null
      : labelFormatter
        ? labelFormatter(String(label))
        : String(label);
  return (
    <div className={`${tooltipWrapperClass} chart-tip-enter`}>
      {heading !== null && <p className={tooltipLabelClass}>{heading}</p>}
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {payload.map((entry, i) => {
          const value = typeof entry.value === "number" ? entry.value : null;
          const key = entry.dataKey !== undefined ? String(entry.dataKey) : String(i);
          const color = colorFor?.(key) ?? entry.color;
          return (
            <li key={key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className={tooltipLabelClass}>{String(entry.name ?? key)}</span>
              </span>
              <span className={tooltipValueClass}>
                {value === null ? "—" : valueFormatter(value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
