"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Bell, Menu, Plus, Search } from "lucide-react";
import { MetricTile } from "@/components/dashboard/MetricTile";
import { NeedsAttention } from "@/components/dashboard/NeedsAttention";
import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { Button } from "@/components/ui/button";
import { infoTextClass, labelClass, topBarIconButtonClass } from "@/components/ui/control-styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { pageShellClass } from "@/components/ui/surface-styles";
import type { MetricTrend } from "@/lib/dashboard/queries";
import { cn } from "@/lib/utils";
import { LabCopyButtons, LabFitBadge, LabGroup, LabJsx, LabTabs, LabToggle } from "../lab-kit/controls";
import { LabLazy } from "../lab-kit/lazy";
import { AttentionDesign } from "./design/AttentionDesign";
import {
  DESIGN_DEFAULTS,
  LAB_FRAMES,
  LAB_LAYOUTS,
  LAB_LIMITS,
  LAB_OPTIONS,
  LAB_PHONES,
  decodeState,
  designJsx,
  encodeState,
  shuffle,
  withDefaults,
  type AttentionDesignProps,
  type LabPreset,
  type LabState,
} from "./lab-model";
import { CHOSEN_GROUP, LAB_GROUPS, LAB_PRESETS, LAB_SHORTLIST, SHORTLIST_GROUP } from "./presets";
import { SCENARIOS, scenarioById } from "./scenarios";

/** The page's side gutter on a phone (DashboardHome's px-6), so a tile is the card at a phone's width. */
const PHONE_GUTTER = 48;

/** A wavy average-order line for the metric above the card, as on the screenshot. */
const AOV_TREND: MetricTrend = {
  points: [8, 11, 7, 12, 9, 10, 6, 11, 13, 9, 12, 8, 10, 14, 9, 11, 10, 22, 9, 12, 10, 11, 9, 13, 8, 10, 12, 11, 9, 12],
  tone: "up",
};

const firstPreset = LAB_PRESETS.find((preset) => preset.group === CHOSEN_GROUP);
const FIRST: LabState = { frame: "phone", phone: "412", props: withDefaults(firstPreset?.props ?? {}), presetId: firstPreset?.id ?? null };

function tabTiles(group: string): { preset: LabPreset; rank?: number; why?: string }[] {
  if (group !== SHORTLIST_GROUP) return LAB_PRESETS.filter((preset) => preset.group === group).map((preset) => ({ preset }));
  return LAB_SHORTLIST.flatMap((choice, i) => {
    const preset = LAB_PRESETS.find((candidate) => candidate.id === choice.id);
    return preset ? [{ preset, rank: i + 1, why: choice.why }] : [];
  });
}

/** A row of choices for one prop. */
function Choice<K extends keyof typeof LAB_OPTIONS>({
  name,
  label,
  value,
  onChange,
}: {
  name: K;
  label: string;
  value: AttentionDesignProps[K];
  onChange: (value: AttentionDesignProps[K]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className={labelClass}>{label}</p>
      <SegmentedControl
        ariaLabel={label}
        value={value as string}
        options={LAB_OPTIONS[name].map((option) => ({ value: option as string, label: option }))}
        onChange={(next) => onChange(next as AttentionDesignProps[K])}
      />
    </div>
  );
}

/** The phone's top bar on Overview, drawn still: menu, title, add, search, bell, avatar. */
function PhoneTopBar() {
  const t = useTranslations("Dashboard.overview");
  return (
    <div className="flex h-14 items-center gap-2 bg-background px-4">
      <span className={topBarIconButtonClass}>
        <Menu className="size-5" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-xl font-semibold text-foreground">{t("title")}</span>
      <span className="flex items-center gap-1">
        {[Plus, Search, Bell].map((Icon, i) => (
          <span key={i} className={topBarIconButtonClass}>
            <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
          </span>
        ))}
        <span className="ml-1 size-8 rounded-full bg-secondary" />
      </span>
    </div>
  );
}

/** Recent orders under the card, as a quiet stand-in: only its place on the page matters here. */
function RecentOrdersStub() {
  const t = useTranslations("Dashboard.recentOrders");
  return (
    <ModuleCard title={t("title")}>
      <div className="space-y-3">
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center gap-3">
            <span className="size-10 shrink-0 bg-secondary" />
            <span className="h-3 flex-1 bg-secondary" />
            <span className="h-3 w-16 bg-secondary" />
          </div>
        ))}
      </div>
    </ModuleCard>
  );
}

/** The card where it lives on a phone: the Overview's top bar, the metric above it, Recent orders below. */
function OverviewPhone({ width, children }: { width: number; children: ReactNode }) {
  const t = useTranslations("Dashboard.overview");
  return (
    <div className="flex justify-center rounded-md border border-border bg-muted py-8">
      <div className="overflow-hidden rounded-[2.5rem] border-[10px] border-card-base bg-background shadow-xl">
        <div className="h-[780px] overflow-y-auto overflow-x-hidden" style={{ width }} data-lab-phone>
          <PhoneTopBar />
          <div className="space-y-4 px-6 pb-10 pt-2">
            <MetricTile label={t("avgOrder30d")} value="€1,094.95" trend={AOV_TREND} />
            {children}
            <RecentOrdersStub />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The card where it lives on a laptop: the three headline metrics above it. */
function OverviewDesktop({ children }: { children: ReactNode }) {
  const t = useTranslations("Dashboard.overview");
  return (
    <div className="rounded-md border border-border bg-muted p-6">
      <div className="mx-auto max-w-[1040px] space-y-4 bg-background p-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricTile label={t("revenue30d")} value="€32,850.00" emphasis />
          <MetricTile label={t("sales30d")} value="30" trend={AOV_TREND} />
          <MetricTile label={t("avgOrder30d")} value="€1,094.95" trend={AOV_TREND} />
        </div>
        {children}
        <RecentOrdersStub />
      </div>
    </div>
  );
}

function PresetTile({
  preset,
  scenario,
  phoneWidth,
  active,
  onOpen,
  rank,
  why,
}: {
  preset: LabPreset;
  scenario: string;
  phoneWidth: number;
  active: boolean;
  onOpen: () => void;
  rank?: number;
  why?: string;
}) {
  const props = { ...withDefaults(preset.props), scenario };
  return (
    <article className="flex flex-col gap-3" data-lab-preset={preset.id}>
      {/* The card has links of its own, so the press is a layer over it, not a wrapper. */}
      <div className="relative transition-transform duration-base hover:-translate-y-0.5">
        <LabLazy height={420}>
          <div className="flex justify-center rounded-md border border-border bg-muted p-4">
            <div inert className="max-w-full" style={{ width: phoneWidth - PHONE_GUTTER }}>
              {preset.real ? (
                <NeedsAttention items={scenarioById(scenario).items} />
              ) : (
                <AttentionDesign design={props} items={scenarioById(scenario).items} />
              )}
            </div>
          </div>
        </LabLazy>
        <button
          type="button"
          onClick={onOpen}
          className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

/**
 * The attention lab: the overview's "Needs attention" card on a phone, where
 * the shipped one wraps its actions unevenly and says a sentence per row. Tune
 * one live over real rows (lib/dashboard/attention.ts), compare the presets,
 * and send a pick back as a link or as JSX.
 */
export function AttentionLab() {
  const [state, setState] = useState<LabState>(() => decodeState(window.location.hash) ?? FIRST);
  const [group, setGroup] = useState(CHOSEN_GROUP);
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const playgroundRef = useRef<HTMLDivElement>(null);
  const hash = encodeState(state);

  useEffect(() => {
    window.history.replaceState(null, "", `#${hash}`);
  }, [hash]);

  const { props } = state;
  const preset = LAB_PRESETS.find((candidate) => candidate.id === state.presetId) ?? null;
  const edited = preset !== null && JSON.stringify({ ...withDefaults(preset.props), scenario: props.scenario }) !== JSON.stringify(props);
  const jsx = designJsx(props);
  const scenario = scenarioById(props.scenario);
  const phoneWidth = LAB_PHONES.find((phone) => phone.id === state.phone)?.width ?? 412;
  const layout = LAB_LAYOUTS.find((candidate) => candidate.id === props.layout);

  const set = <K extends keyof AttentionDesignProps>(key: K, value: AttentionDesignProps[K]) =>
    setState((current) => ({ ...current, props: { ...current.props, [key]: value } }));
  const open = (next: LabPreset) => {
    setState((current) => ({ ...current, props: { ...withDefaults(next.props), scenario: current.props.scenario }, presetId: next.id }));
    playgroundRef.current?.scrollIntoView({ block: "start" });
  };

  // Remounted on every change, so a "Show more" left open does not carry over.
  const design = useMemo(
    () =>
      preset?.real && !edited ? (
        // The real card's links are real: a press is caught before it leaves
        // the lab and reported like the renderer's.
        <div
          key={scenario.id}
          onClickCapture={(event) => {
            const link = (event.target as HTMLElement).closest("a");
            if (!link) return;
            event.preventDefault();
            setLastOpened(link.getAttribute("href"));
          }}
        >
          <NeedsAttention items={scenario.items} />
        </div>
      ) : (
        <AttentionDesign key={JSON.stringify(props)} design={props} items={scenario.items} onOpen={setLastOpened} />
      ),
    [props, scenario, preset, edited],
  );

  return (
    <main className={cn(pageShellClass, "max-w-[110rem] space-y-12")}>
      <header className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Needs attention lab</h1>
        <p className="font-inter text-sm text-muted-foreground">
          The overview&apos;s &quot;Needs attention&quot; card, redone for a phone. Every row is real: the copy, counts, order and
          destinations come from the same builder the overview uses. The phone defaults to your screenshot&apos;s width (412); try
          360 for a small Android. Press a row: the line under the preview says where it would go. Send a pick back as a link or JSX.
        </p>
      </header>

      <div ref={playgroundRef} className="grid scroll-mt-6 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]" data-lab-playground>
        <aside className="space-y-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-16 lg:pr-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setState((current) => ({ ...current, props: shuffle(current.props), presetId: null }))}
            >
              Shuffle
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setState((current) => ({ ...current, props: { ...DESIGN_DEFAULTS, scenario: current.props.scenario }, presetId: firstPreset?.id ?? null }))}
            >
              Shipped
            </Button>
            {preset && edited && (
              <Button type="button" variant="ghost" onClick={() => open(preset)}>
                Back to the preset
              </Button>
            )}
          </div>

          <LabGroup title="Store">
            <Select
              id="lab-scenario"
              value={props.scenario}
              options={SCENARIOS.map((option) => ({ value: option.id, label: option.label }))}
              onChange={(value) => set("scenario", value)}
            />
            <p className={infoTextClass}>{scenario.note}</p>
          </LabGroup>

          <LabGroup title="Preview">
            <SegmentedControl
              ariaLabel="Preview"
              value={state.frame}
              options={LAB_FRAMES.map((frame) => ({ value: frame.id, label: frame.label }))}
              onChange={(frame) => setState((current) => ({ ...current, frame }))}
            />
            {state.frame === "phone" && (
              <div className="space-y-1.5">
                <p className={labelClass}>Phone width</p>
                <SegmentedControl
                  ariaLabel="Phone width"
                  value={state.phone}
                  options={LAB_PHONES.map((phone) => ({ value: phone.id, label: phone.label }))}
                  onChange={(phone) => setState((current) => ({ ...current, phone }))}
                />
              </div>
            )}
          </LabGroup>

          <LabGroup title="Layout">
            <Select
              id="lab-layout"
              value={props.layout}
              options={LAB_LAYOUTS.map((option) => ({ value: option.id, label: option.label, description: option.note }))}
              onChange={(next) => set("layout", next)}
            />
            {layout && <p className={infoTextClass}>{layout.note}</p>}
          </LabGroup>

          <LabGroup title="Rows">
            <Choice name="marker" label="Marker" value={props.marker} onChange={(value) => set("marker", value)} />
            <Choice name="detail" label="Sentence" value={props.detail} onChange={(value) => set("detail", value)} />
            <Choice name="action" label="Action" value={props.action} onChange={(value) => set("action", value)} />
            <LabToggle id="lab-row-link" label="Whole row is the link" checked={props.rowLink} onChange={(on) => set("rowLink", on)} />
            <Choice name="urgency" label="Buyers waiting" value={props.urgency} onChange={(value) => set("urgency", value)} />
            <Choice name="density" label="Spacing" value={props.density} onChange={(value) => set("density", value)} />
          </LabGroup>

          <LabGroup title="Card">
            <div className="space-y-1.5">
              <p className={labelClass}>Rows before Show more</p>
              <SegmentedControl
                ariaLabel="Rows before Show more"
                value={String(props.limit)}
                options={LAB_LIMITS.map((limit) => ({ value: String(limit), label: limit === 0 ? "All" : String(limit) }))}
                onChange={(value) => set("limit", Number(value))}
              />
            </div>
            <Choice name="decoration" label="Texture" value={props.decoration} onChange={(value) => set("decoration", value)} />
            <LabToggle id="lab-title-count" label="Count beside the title" checked={props.titleCount} onChange={(on) => set("titleCount", on)} />
          </LabGroup>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-base font-semibold text-foreground" data-lab-current>
                {preset ? preset.name : "Custom"}
                {edited ? ", edited" : ""}
              </p>
              <p className={infoTextClass}>{preset?.note ?? layout?.note}</p>
            </div>
            {preset && <LabFitBadge fit={preset.fit} />}
          </div>
          <p className={cn(infoTextClass, "min-h-4")} data-lab-opened>
            {lastOpened ? `Would open: ${lastOpened}` : "Press a row or its action: where it would go shows here."}
          </p>
          <div data-lab-preview>
            {state.frame === "phone" ? <OverviewPhone width={phoneWidth}>{design}</OverviewPhone> : <OverviewDesktop>{design}</OverviewDesktop>}
          </div>
          <LabCopyButtons jsx={jsx} />
          <LabJsx jsx={jsx} />
        </div>
      </div>

      <section className="space-y-6" data-lab-presets>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold text-foreground">Presets</h2>
            <p className={infoTextClass}>
              Each tile is the card at the phone width above, over the store picked in the playground. Open one to tune it.
            </p>
          </div>
          <LabTabs groups={LAB_GROUPS} active={group} count={(id) => tabTiles(id).length} onChange={setGroup} />
        </div>
        <div className="grid gap-x-8 gap-y-10 md:grid-cols-2 2xl:grid-cols-3">
          {tabTiles(group).map(({ preset: candidate, rank, why }) => (
            <PresetTile
              key={candidate.id}
              preset={candidate}
              scenario={props.scenario}
              phoneWidth={phoneWidth}
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
