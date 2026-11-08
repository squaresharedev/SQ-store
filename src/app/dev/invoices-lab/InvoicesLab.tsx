"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { LabCopyButtons, LabFitBadge, LabGroup, LabJsx, LabTabs, LabToggle } from "../lab-kit/controls";
import { LabLazy } from "../lab-kit/lazy";
import { LabThumb } from "../lab-kit/thumb";
import { invoicesScenarios, type InvoicesScenario } from "../invoices/fixtures";
import { InvoicesDesign } from "./design/InvoicesDesign";
import {
  DESIGN_DEFAULTS,
  LAB_ACCENTS,
  LAB_FRAMES,
  LAB_LAYOUTS,
  LAB_OPTIONS,
  decodeState,
  designJsx,
  encodeState,
  shuffle,
  withDefaults,
  type InvoicesDesignProps,
  type LabPreset,
  type LabState,
} from "./lab-model";
import { CHOSEN_GROUP, LAB_GROUPS, LAB_PRESETS, LAB_SHORTLIST, SHORTLIST_GROUP } from "./presets";

/** The settings column a design is drawn at in a tile before it is scaled down. */
const TILE_WIDTH = 860;
const PHONE_WIDTH = 390;

const TOGGLE_LABELS: Record<(typeof import("./lab-model").LAB_TOGGLES)[number], string> = {
  showNumber: "Invoice number column",
  showPlan: "Description column",
  showMethod: "Payment method column",
  groupByYear: "Headings per year",
  spendChart: "The year's spend as bars",
  exportCsv: "Export CSV button",
};

const firstPreset = LAB_PRESETS.find((preset) => preset.group === CHOSEN_GROUP);
const FIRST: LabState = { frame: "desktop", props: withDefaults(firstPreset?.props ?? {}), presetId: firstPreset?.id ?? null };

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
  value: InvoicesDesignProps[K];
  onChange: (value: InvoicesDesignProps[K]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className={labelClass}>{label}</p>
      <SegmentedControl
        ariaLabel={label}
        value={value as string}
        options={LAB_OPTIONS[name].map((option) => ({ value: option as string, label: option }))}
        onChange={(next) => onChange(next as InvoicesDesignProps[K])}
      />
    </div>
  );
}

function PresetTile({
  preset,
  scenarios,
  now,
  active,
  onOpen,
  rank,
  why,
}: {
  preset: LabPreset;
  scenarios: Record<string, InvoicesScenario>;
  now: Date;
  active: boolean;
  onOpen: () => void;
  rank?: number;
  why?: string;
}) {
  const props = withDefaults(preset.props);
  const ignore = useCallback(() => {}, []);
  return (
    <article className="flex flex-col gap-3" data-lab-preset={preset.id}>
      {/* The design has buttons of its own, so the press is a layer over it, not a wrapper. */}
      <div className="relative transition-transform duration-base hover:-translate-y-0.5">
        <LabLazy>
          <LabThumb width={TILE_WIDTH} maxHeight={1100}>
            <InvoicesDesign design={props} scenario={scenarios[props.scenario] ?? scenarios.active!} now={now} onOpen={ignore} />
          </LabThumb>
        </LabLazy>
        <button type="button" onClick={onOpen} className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${preset.name}`} />
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
      <div className="flex items-center gap-3">
        <Button type="button" variant={active ? "primary" : "secondary"} onClick={onOpen}>
          {active ? "In the playground" : "Open in the playground"}
        </Button>
        <span className={infoTextClass}>{LAB_LAYOUTS.find((layout) => layout.id === props.layout)?.label}</span>
      </div>
    </article>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center rounded-md border border-border bg-neutral-100 py-8">
      <div className="overflow-hidden rounded-[2.5rem] border-[10px] border-neutral-900 bg-background shadow-xl">
        <div className="h-[780px] overflow-y-auto overflow-x-hidden" style={{ width: PHONE_WIDTH }} data-lab-phone>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The invoices lab: Settings › Billing & invoices after the billing pages
 * sellers know (Stripe, Vercel, Shopify, GitHub, Linear, Notion), over the same
 * fake store states as /dev/invoices. Tune one live, press its rows and
 * buttons, and send a pick back as a link or as JSX.
 */
export function InvoicesLab() {
  const now = useMemo(() => new Date(), []);
  const scenarioList = useMemo(() => invoicesScenarios(now), [now]);
  const scenarios = useMemo(() => Object.fromEntries(scenarioList.map((scenario) => [scenario.value, scenario])), [scenarioList]);
  const scenarioIds = useMemo(() => scenarioList.map((scenario) => scenario.value), [scenarioList]);
  const [state, setState] = useState<LabState>(() => decodeState(window.location.hash, scenarioIds) ?? FIRST);
  const [group, setGroup] = useState(CHOSEN_GROUP);
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const playgroundRef = useRef<HTMLDivElement>(null);
  const hash = encodeState(state);

  useEffect(() => {
    window.history.replaceState(null, "", `#${hash}`);
  }, [hash]);

  const { props } = state;
  const preset = LAB_PRESETS.find((candidate) => candidate.id === state.presetId) ?? null;
  const edited = preset !== null && JSON.stringify(withDefaults(preset.props)) !== JSON.stringify(props);
  const jsx = designJsx(props);
  const layout = LAB_LAYOUTS.find((candidate) => candidate.id === props.layout);
  const scenario = scenarios[props.scenario] ?? scenarioList[0]!;

  const set = <K extends keyof InvoicesDesignProps>(key: K, value: InvoicesDesignProps[K]) =>
    setState((current) => ({ ...current, props: { ...current.props, [key]: value } }));
  const open = (next: LabPreset) => {
    setState((current) => ({ frame: current.frame, props: { ...withDefaults(next.props), scenario: current.props.scenario }, presetId: next.id }));
    playgroundRef.current?.scrollIntoView({ block: "start" });
  };

  const design = (
    <InvoicesDesign key={`${props.scenario}-${props.layout}`} design={props} scenario={scenario} now={now} onOpen={setLastOpened} />
  );

  return (
    <main className={cn(pageShellClass, "max-w-[110rem] space-y-12")}>
      <header className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Billing &amp; invoices lab</h1>
        <p className="font-inter text-sm text-muted-foreground">
          Settings › Billing &amp; invoices redone after the billing pages sellers already know: Stripe&apos;s customer portal,
          Vercel, Shopify, GitHub, Linear and Notion. Every design runs on the same fake store states as /dev/invoices. Press rows,
          Update, Export and Pay now: the line under the preview says where a real one would go. Send a pick back as a link or JSX.
        </p>
      </header>

      <div ref={playgroundRef} className="grid scroll-mt-6 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]" data-lab-playground>
        <aside className="space-y-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-16 lg:pr-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setState((current) => ({ ...current, props: shuffle(current.props), presetId: null }))}>
              Shuffle
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setState((current) => ({ ...current, props: { ...DESIGN_DEFAULTS, scenario: current.props.scenario }, presetId: null }))}
            >
              Reset
            </Button>
            {preset && edited && (
              <Button type="button" variant="ghost" onClick={() => open(preset)}>
                Back to the preset
              </Button>
            )}
          </div>

          <LabGroup title="Store state">
            <Select
              id="lab-scenario"
              value={props.scenario}
              options={scenarioList.map((option) => ({ value: option.value, label: option.label }))}
              onChange={(value) => set("scenario", value)}
            />
            <SegmentedControl
              ariaLabel="Preview"
              value={state.frame}
              options={LAB_FRAMES.map((frame) => ({ value: frame.id, label: frame.label }))}
              onChange={(frame) => setState((current) => ({ ...current, frame }))}
            />
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

          <LabGroup title="Colour">
            <div className="grid grid-cols-2 gap-2">
              {LAB_ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  onClick={() => set("accent", accent.accent)}
                  className={cn("flex items-center gap-2 rounded-sm border p-1.5 text-left hover:bg-accent", props.accent === accent.accent ? "border-foreground" : "border-border")}
                >
                  <span className="h-4 w-7 shrink-0 rounded-sm" style={{ background: accent.accent }} />
                  <span className={infoTextClass}>{accent.label}</span>
                </button>
              ))}
            </div>
          </LabGroup>

          <LabGroup title="Surfaces">
            <Choice name="radius" label="Corners" value={props.radius} onChange={(value) => set("radius", value)} />
            <Choice name="cards" label="Cards" value={props.cards} onChange={(value) => set("cards", value)} />
            <Choice name="density" label="Rows" value={props.density} onChange={(value) => set("density", value)} />
          </LabGroup>

          <LabGroup title="Card and status">
            <Choice name="cardMark" label="The card on file" value={props.cardMark} onChange={(value) => set("cardMark", value)} />
            <Choice name="status" label="Invoice status" value={props.status} onChange={(value) => set("status", value)} />
          </LabGroup>

          <LabGroup title="Invoice list">
            <Choice name="rowOpens" label="A row opens" value={props.rowOpens} onChange={(value) => set("rowOpens", value)} />
            <Choice name="download" label="Download" value={props.download} onChange={(value) => set("download", value)} />
            {(Object.keys(TOGGLE_LABELS) as (keyof typeof TOGGLE_LABELS)[]).map((key) => (
              <LabToggle key={key} id={`lab-${key}`} label={TOGGLE_LABELS[key]} checked={props[key]} onChange={(on) => set(key, on)} />
            ))}
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
            {lastOpened ? `Would open: ${lastOpened}` : "Press anything in the design: where it would go shows here."}
          </p>
          <div data-lab-preview>
            {state.frame === "phone" ? (
              <PhoneFrame>{design}</PhoneFrame>
            ) : (
              <div className="rounded-md border border-border bg-neutral-100 p-6">
                <div className="mx-auto max-w-[860px] overflow-hidden rounded-md">{design}</div>
              </div>
            )}
          </div>
          <LabCopyButtons jsx={jsx} />
          <LabJsx jsx={jsx} />
        </div>
      </div>

      <section className="space-y-6" data-lab-presets>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold text-foreground">Presets</h2>
            <p className={infoTextClass}>Each tile is the whole section at settings width, scaled down. Open one to use it.</p>
          </div>
          <LabTabs groups={LAB_GROUPS} active={group} count={(id) => tabTiles(id).length} onChange={setGroup} />
        </div>
        <div className="grid gap-x-8 gap-y-10 md:grid-cols-2">
          {tabTiles(group).map(({ preset: candidate, rank, why }) => (
            <PresetTile
              key={candidate.id}
              preset={candidate}
              scenarios={scenarios}
              now={now}
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
