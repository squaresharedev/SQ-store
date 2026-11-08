"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsPage } from "@/components/analytics/AnalyticsPage";
import { ANALYTICS_LOOK, type AnalyticsLook } from "@/components/analytics/look";
import { Button } from "@/components/ui/button";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { pageShellClass } from "@/components/ui/surface-styles";
import type { AnalyticsSnapshot } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";
import { LabCopyButtons, LabFitBadge, LabGroup, LabJsx, LabTabs, LabToggle } from "../lab-kit/controls";
import { LabLazy } from "../lab-kit/lazy";
import { LabThumb } from "../lab-kit/thumb";
import { LAB_SCENARIOS, buildSnapshot, type LabScenario } from "./fixtures";
import {
  LOOK_CONTROLS,
  decodeState,
  encodeState,
  lookJsx,
  shuffle,
  withDefaults,
  type LabPreset,
  type LabState,
} from "./lab-model";
import { CHOSEN_GROUP, LAB_GROUPS, LAB_PRESETS, LAB_SHORTLIST, SHORTLIST_GROUP } from "./presets";

/** The custom range the page is handed: none (the sample stores use presets). */
const NO_CUSTOM_RANGE = { from: null, to: null };

/** What the Payments tab does that this page does not, so a reader of the lab knows what each control is about. */
const WHY_CLEANER = [
  "Almost no text in the plot: no value axis, three dates under it. Analytics prints a value column and a date every two days.",
  "Faint dotted guides over one solid baseline, where analytics draws a solid line at every value label.",
  "A running total that climbs; day-by-day revenue zig-zags.",
  "The figure above the chart in a card, not laid over the plot with a blur behind it.",
  "Scrubbing reads the point into the figure; there is no tooltip box.",
  "One deep colour with a fuller wash, and an ink figure with the cents set back, instead of green on green.",
];

/** The lab opens on what /analytics renders. */
const FIRST: LabState = { look: ANALYTICS_LOOK, scenario: "growing", presetId: "chosen" };

/**
 * A tile shows only the top of the page (LabThumb crops it), which is the
 * sales section. The signal sections and the funnel below the crop are left
 * out, so a tab of tiles mounts a handful of charts each instead of every one
 * on the page. The playground preview always draws the whole page.
 */
const forTile = (snapshot: AnalyticsSnapshot): AnalyticsSnapshot => ({
  ...snapshot,
  signals: { ...snapshot.signals, available: false },
});

/** A tab's tiles: the shortlist in its order with its reasons, any other tab by group. */
function tabTiles(group: string): { preset: LabPreset; rank?: number; why?: string }[] {
  if (group !== SHORTLIST_GROUP) return LAB_PRESETS.filter((preset) => preset.group === group).map((preset) => ({ preset }));
  return LAB_SHORTLIST.flatMap((pick, i) => {
    const preset = LAB_PRESETS.find((candidate) => candidate.id === pick.id);
    return preset ? [{ preset, rank: i + 1, why: pick.why }] : [];
  });
}

/** The real analytics page body, as the dashboard frames it. */
function Page({ look, snapshot }: { look: AnalyticsLook; snapshot: AnalyticsSnapshot }) {
  return (
    <div className="bg-background p-6">
      <AnalyticsPage snapshot={snapshot} custom={NO_CUSTOM_RANGE} look={look} />
    </div>
  );
}

function PresetTile({
  preset,
  snapshot,
  active,
  onOpen,
  rank,
  why,
}: {
  preset: LabPreset;
  snapshot: AnalyticsSnapshot;
  active: boolean;
  onOpen: () => void;
  rank?: number;
  why?: string;
}) {
  return (
    <article className="flex flex-col gap-3" data-lab-preset={preset.id}>
      {/* The page has buttons of its own, so the press is a layer over it, not a wrapper. */}
      <div className="relative transition-transform duration-base hover:-translate-y-0.5">
        <LabLazy>
          <LabThumb>
            <Page look={withDefaults(preset.look)} snapshot={forTile(snapshot)} />
          </LabThumb>
        </LabLazy>
        <button
          type="button"
          onClick={onOpen}
          className="absolute inset-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Open ${preset.name}`}
        />
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-foreground">
            {rank !== undefined && <span className="mr-1.5 tabular-nums text-muted-foreground">{rank}.</span>}
            {preset.name}
          </p>
          <p className={infoTextClass}>{why ?? preset.note}</p>
        </div>
        <LabFitBadge fit={preset.fit} className="shrink-0" />
      </div>
      <div>
        <Button type="button" variant={active ? "primary" : "secondary"} onClick={onOpen}>
          {active ? "In the playground" : "Open in the playground"}
        </Button>
      </div>
    </article>
  );
}

/** The lab in solo mode: one look, full window, following the address bar. */
function Solo({ snapshots }: { snapshots: Record<LabScenario, AnalyticsSnapshot> }) {
  const [state, setState] = useState<LabState>(() => decodeState(window.location.hash) ?? FIRST);
  useEffect(() => {
    const follow = () => setState(decodeState(window.location.hash) ?? FIRST);
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  return (
    <main className={pageShellClass}>
      <Page look={state.look} snapshot={snapshots[state.scenario]} />
    </main>
  );
}

/**
 * The analytics lab: the real analytics page, drawn with any mix of the
 * Payments tab's chart look (components/analytics/look.ts), over sample stores.
 * The address bar holds whatever is on screen.
 */
export function AnalyticsLab({ solo = false }: { solo?: boolean }) {
  const snapshots = useMemo(
    () => Object.fromEntries(LAB_SCENARIOS.map((s) => [s.id, buildSnapshot(s.id)])) as Record<LabScenario, AnalyticsSnapshot>,
    [],
  );
  const [state, setState] = useState<LabState>(() => decodeState(window.location.hash) ?? FIRST);
  const [group, setGroup] = useState<string>(CHOSEN_GROUP);
  const playgroundRef = useRef<HTMLDivElement>(null);
  const hash = encodeState(state);

  useEffect(() => {
    if (!solo) window.history.replaceState(null, "", `${window.location.pathname}#${hash}`);
  }, [hash, solo]);

  if (solo) return <Solo snapshots={snapshots} />;

  const { look } = state;
  const preset = LAB_PRESETS.find((candidate) => candidate.id === state.presetId) ?? null;
  const edited = preset !== null && JSON.stringify(withDefaults(preset.look)) !== JSON.stringify(look);
  const jsx = lookJsx(look);
  const canJoin = look.lead === "card" && look.tiles === "trend";
  const scenario = LAB_SCENARIOS.find((s) => s.id === state.scenario);

  const set = <K extends keyof AnalyticsLook>(key: K, value: AnalyticsLook[K]) =>
    setState((current) => ({ ...current, look: { ...current.look, [key]: value } }));
  const open = (next: LabPreset) => {
    setState((current) => ({ ...current, look: withDefaults(next.look), presetId: next.id }));
    playgroundRef.current?.scrollIntoView({ block: "start" });
  };

  return (
    <main className={cn(pageShellClass, "max-w-[110rem] space-y-12")}>
      <header className="max-w-4xl space-y-3">
        <h1 className="text-2xl font-semibold text-foreground">Analytics lab</h1>
        <p className="font-inter text-sm text-muted-foreground">
          The real analytics page, drawn with the Payments tab&apos;s chart look whole, in parts, or one part at a time,
          over sample stores. Scrub the lines, hover the bars, and send a pick back as a link or as JSX. /analytics renders
          the Chosen look (ANALYTICS_LOOK); &quot;Before the pick&quot; is under Reference.
        </p>
        <div className="space-y-1">
          <p className={labelClass}>Why the Payments charts read cleaner</p>
          <ol className="list-decimal space-y-0.5 pl-5 font-inter text-sm text-muted-foreground">
            {WHY_CLEANER.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ol>
        </div>
      </header>

      <div ref={playgroundRef} className="grid scroll-mt-6 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]" data-lab-playground>
        <aside className="space-y-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-2 lg:pb-16">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setState((current) => ({ ...current, look: shuffle(Math.random), presetId: null }))}
            >
              Shuffle
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setState((current) => ({ ...current, look: ANALYTICS_LOOK, presetId: "chosen" }))}
            >
              Reset to shipped
            </Button>
            {preset && edited && (
              <Button type="button" variant="ghost" onClick={() => open(preset)}>
                Back to the preset
              </Button>
            )}
          </div>

          <LabGroup title="Sample store">
            <Select
              id="lab-scenario"
              value={state.scenario}
              options={LAB_SCENARIOS.map((s) => ({ value: s.id, label: s.label, description: s.note }))}
              onChange={(next) => setState((current) => ({ ...current, scenario: next }))}
            />
            {scenario && <p className={infoTextClass}>{scenario.note}</p>}
            <a
              href={`/dev/analytics-lab?solo=1#${hash}`}
              target="_blank"
              rel="noreferrer"
              className={cn(infoTextClass, "underline underline-offset-4 hover:text-foreground")}
            >
              Open this look as a full page ↗
            </a>
          </LabGroup>

          <LabGroup title="Look">
            {LOOK_CONTROLS.map((control) => (
              <div key={control.key} className="space-y-1.5" data-lab-control={control.key}>
                <p className={labelClass}>{control.label}</p>
                <SegmentedControl
                  ariaLabel={control.label}
                  value={look[control.key]}
                  options={control.options.map((option) => ({ value: option.value, label: option.label }))}
                  onChange={(value) => set(control.key, value as AnalyticsLook[typeof control.key])}
                />
                <p className={infoTextClass}>{control.hint}</p>
              </div>
            ))}
            <LabToggle id="lab-joined" label="Card and tiles joined" checked={look.joined} onChange={(on) => set("joined", on)} />
            <p className={infoTextClass}>
              {canJoin ? "One block with hairlines between, as on Payments." : "Takes effect with the Card lead and Trend tiles."}
            </p>
          </LabGroup>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-base font-semibold text-foreground" data-lab-current>
                {preset ? preset.name : "Custom"}
                {edited ? ", edited" : ""}
              </p>
              {preset && <p className={infoTextClass}>{preset.note}</p>}
            </div>
            {preset && <LabFitBadge fit={preset.fit} />}
          </div>
          <div className="overflow-hidden rounded-md border border-border" data-lab-preview>
            <Page look={look} snapshot={snapshots[state.scenario]} />
          </div>
          <LabCopyButtons jsx={jsx} />
          <LabJsx jsx={jsx} />
        </div>
      </div>

      <section className="space-y-6" data-lab-presets>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold text-foreground">Presets</h2>
            <p className={infoTextClass}>Each tile is the whole page over the playground&apos;s sample store, scaled down. Open one to use it.</p>
          </div>
          <LabTabs groups={LAB_GROUPS} active={group} count={(id) => tabTiles(id).length} onChange={setGroup} />
        </div>
        <div className="grid gap-x-8 gap-y-10 md:grid-cols-2">
          {tabTiles(group).map(({ preset: candidate, rank, why }) => (
            <PresetTile
              key={candidate.id}
              preset={candidate}
              snapshot={snapshots[state.scenario]}
              active={candidate.id === state.presetId}
              onOpen={() => open(candidate)}
              rank={rank}
              why={why}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
