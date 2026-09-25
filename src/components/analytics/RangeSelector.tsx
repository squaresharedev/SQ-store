"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { DatePicker } from "@/components/ui/DatePicker";
import type { AnalyticsRange, RangePreset } from "@/lib/analytics/types";

// The one control every analytics module reacts to. The range lives in the
// URL (the server page reads it and re-queries), so views are shareable and
// back/forward works — same pattern as Orders. No data access here.

const PRESET_OPTIONS = [
  { value: "30d", labelKey: "last30Days" },
  { value: "all", labelKey: "allTime" },
  { value: "custom", labelKey: "custom" },
] as const satisfies readonly { value: RangePreset; labelKey: string }[];

function buildQuery(preset: RangePreset, range: AnalyticsRange): string {
  if (preset === "all") return "?range=all";
  if (preset === "custom") {
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const query = params.toString();
    return query === "" ? "" : `?${query}`;
  }
  return ""; // 30d is the default — clean URL
}

/**
 * Preset switch (last 30 days / all time / custom) plus the shared DatePicker
 * in range mode for custom bounds. Picking "Custom" reveals the picker
 * without navigating; the URL updates once a date is chosen.
 */
export function RangeSelector({
  preset,
  range,
}: {
  preset: RangePreset;
  /** The custom bounds currently in the URL (empty for presets). */
  range: AnalyticsRange;
}) {
  const t = useTranslations("Analytics.range");
  const router = useRouter();
  const pathname = usePathname();
  const presetOptions = PRESET_OPTIONS.map(({ value, labelKey }) => ({
    value,
    label: t(labelKey),
  }));

  // Local echo so "Custom" can show the picker before any date exists in the
  // URL. Resynced when external navigation (back/forward) changes the props —
  // state adjusted during render per the React derived-reset pattern.
  const [draft, setDraft] = useState<RangePreset>(preset);
  const [syncedPreset, setSyncedPreset] = useState(preset);
  if (syncedPreset !== preset) {
    setSyncedPreset(preset);
    setDraft(preset);
  }

  function navigate(nextPreset: RangePreset, nextRange: AnalyticsRange) {
    router.replace(`${pathname}${buildQuery(nextPreset, nextRange)}`, {
      scroll: false,
    });
  }

  function handlePreset(next: RangePreset) {
    setDraft(next);
    // Custom waits for a date; the presets navigate immediately.
    if (next !== "custom") navigate(next, { from: null, to: null });
  }

  return (
    <div data-tour="analytics-range" className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        value={draft}
        options={presetOptions}
        onChange={handlePreset}
        ariaLabel={t("ariaLabel")}
      />
      {draft === "custom" && (
        <div className="w-64">
          <DatePicker
            mode="range"
            value={range}
            onChange={(next) => navigate("custom", next)}
            placeholder={t("placeholder")}
          />
        </div>
      )}
    </div>
  );
}
