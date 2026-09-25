// Screen-reader twin of a cartesian chart: the same data as a real <table>,
// visually hidden. Tooltips enhance, they never gate — every plotted value
// stays reachable without a pointer.

import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/components/charts/format";
import type { ChartDatum, ResolvedSeries } from "@/components/charts/types";

export function ChartDataTable({
  data,
  xKey,
  series,
  caption,
  xFormatter,
  valueFormatter: valueFormatterProp,
}: {
  data: ChartDatum[];
  xKey: string;
  series: ResolvedSeries[];
  caption: string;
  xFormatter?: (value: string) => string;
  valueFormatter?: (value: number) => string;
}) {
  const t = useTranslations("Common.charts");
  const locale = useLocale();
  const valueFormatter =
    valueFormatterProp ?? ((value: number) => formatNumber(value, locale));
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t("category")}</th>
          {series.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((datum, i) => {
          const raw = String(datum[xKey] ?? "");
          return (
            <tr key={i}>
              <th scope="row">{xFormatter ? xFormatter(raw) : raw}</th>
              {series.map((s) => {
                const value = datum[s.key];
                return (
                  <td key={s.key}>
                    {typeof value === "number" ? valueFormatter(value) : "—"}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
