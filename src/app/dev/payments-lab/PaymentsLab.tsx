"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { pageShellClass } from "@/components/ui/surface-styles";
import { PAYMENTS_SCENARIOS, PAYMENTS_SCENARIO_NOTES, type PaymentsScenario } from "@/lib/payments/scenarios";
import { cn } from "@/lib/utils";
import { LabCopyButtons, LabFitBadge, LabGroup, LabJsx, LabTabs, LabToggle } from "../lab-kit/controls";
import { LabLazy } from "../lab-kit/lazy";
import { LabThumb } from "../lab-kit/thumb";
import { buildLabData, type LabData } from "./fixtures";
import { PaymentsDesign } from "./design/PaymentsDesign";
import {
  DESIGN_DEFAULTS,
  LAB_ACCENTS,
  LAB_FRAMES,
  LAB_LAYOUTS,
  LAB_OPTIONS,
  LAB_RANGES,
  decodeState,
  designJsx,
  encodeState,
  shuffle,
  withDefaults,
  type LabPreset,
  type LabState,
  type PaymentsDesignProps,
} from "./lab-model";
import { LAB_GROUPS, LAB_PRESETS, LAB_SHORTLIST, SHORTLIST_GROUP } from "./presets";

/** A phone's viewport. */
const PHONE = { width: 390, height: 844 };

const FIRST: LabState = {
  frame: "desktop",
  props: withDefaults(LAB_SHORTLIST.length ? (LAB_PRESETS.find((p) => p.id === LAB_SHORTLIST[0].id)?.props ?? {}) : {}),
  presetId: LAB_SHORTLIST[0]?.id ?? null,
};

/** A tab's tiles: the shortlist in its order with its reasons, any other tab by group. */
function tabTiles(group: string): { preset: LabPreset; rank?: number; why?: string }[] {
  if (group !== SHORTLIST_GROUP) return LAB_PRESETS.filter((preset) => preset.group === group).map((preset) => ({ preset }));
  return LAB_SHORTLIST.flatMap((pick, i) => {
    const preset = LAB_PRESETS.find((candidate) => candidate.id === pick.id);
    return preset ? [{ preset, rank: i + 1, why: pick.why }] : [];
  });
}

function PresetTile({
  preset,
  data,
  active,
  onOpen,
  rank,
  why,
}: {
  preset: LabPreset;
  data: Record<PaymentsScenario, LabData>;
  active: boolean;
  onOpen: () => void;
  rank?: number;
  why?: string;
}) {
  const props = withDefaults(preset.props);
  return (
    <article className="flex flex-col gap-3" data-lab-preset={preset.id}>
      {/* The tile's design has buttons of its own, so the press is a layer over it, not a wrapper. */}
      <div className="relative transition-transform duration-base hover:-translate-y-0.5">
        <LabLazy>
          <LabThumb>
            <PaymentsDesign design={props} data={data[props.scenario]} />
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

/** A row of choices for one prop. */
function Choice<K extends keyof typeof LAB_OPTIONS>({
  name,
  label,
  value,
  onChange,
}: {
  name: K;
  label: string;
  value: PaymentsDesignProps[K];
  onChange: (value: PaymentsDesignProps[K]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className={labelClass}>{label}</p>
      <SegmentedControl
        ariaLabel={label}
        value={value as string}
        options={LAB_OPTIONS[name].map((option) => ({ value: option as string, label: option }))}
        onChange={(next) => onChange(next as PaymentsDesignProps[K])}
      />
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

function ColourField({ label, value, onChange, allowEmpty = false }: { label: string; value: string; onChange: (value: string) => void; allowEmpty?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={HEX.test(value) ? value : "#000000"}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-9 w-10 shrink-0 cursor-pointer rounded-sm border border-border bg-background p-0.5"
      />
      <Input value={value} onChange={(event) => onChange(event.target.value.trim())} aria-label={`${label}, hex`} placeholder={allowEmpty ? "derived" : undefined} className="font-mono text-xs" />
      {allowEmpty && value && (
        <Button type="button" variant="ghost" onClick={() => onChange("")} aria-label={`Clear ${label}`}>
          ×
        </Button>
      )}
    </div>
  );
}

/**
 * The phone preview: the design in a box a phone wide. The designs lay out by
 * container queries, so this is their real phone layout. (Not an iframe: the
 * app sends X-Frame-Options: DENY on every page, dev ones included.) Today's
 * page still uses screen breakpoints, so its phone view here is only rough.
 */
function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center rounded-md border border-border bg-[#f6f6f7] py-8">
      <div className="overflow-hidden rounded-[2.5rem] border-[10px] border-neutral-900 bg-background shadow-xl">
        <div className="overflow-x-hidden overflow-y-auto" style={{ width: PHONE.width, height: PHONE.height }} data-lab-phone>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The lab page in solo mode: one design, full window, following the address bar. For "Open this design as a full page". */
function Solo({ data }: { data: Record<PaymentsScenario, LabData> }) {
  const [state, setState] = useState<LabState>(() => decodeState(window.location.hash) ?? FIRST);
  useEffect(() => {
    const follow = () => setState(decodeState(window.location.hash) ?? FIRST);
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  return <PaymentsDesign key={`${state.props.range}-${state.props.scenario}`} design={state.props} data={data[state.props.scenario]} />;
}

/**
 * The payments lab: one design of the Payments tab to tune live, over any
 * simulated story, and every preset to load into it. The address bar holds
 * whatever is on screen.
 */
export function PaymentsLab({ solo = false }: { solo?: boolean }) {
  const data = useMemo(() => buildLabData(), []);
  const [state, setState] = useState<LabState>(() => decodeState(window.location.hash) ?? FIRST);
  const [group, setGroup] = useState(() => LAB_GROUPS.find((tab) => tabTiles(tab.id).length)?.id ?? SHORTLIST_GROUP);
  const playgroundRef = useRef<HTMLDivElement>(null);
  const hash = encodeState(state);

  useEffect(() => {
    if (!solo) window.history.replaceState(null, "", `#${hash}`);
  }, [hash, solo]);

  if (solo) return <Solo data={data} />;

  const { props } = state;
  const preset = LAB_PRESETS.find((candidate) => candidate.id === state.presetId) ?? null;
  const edited = preset !== null && JSON.stringify(withDefaults(preset.props)) !== JSON.stringify(props);
  const jsx = designJsx(props);
  const layout = LAB_LAYOUTS.find((candidate) => candidate.id === props.layout);

  const set = <K extends keyof PaymentsDesignProps>(key: K, value: PaymentsDesignProps[K]) =>
    setState((current) => ({ ...current, props: { ...current.props, [key]: value } }));
  const open = (next: LabPreset) => {
    setState((current) => ({ frame: current.frame, props: withDefaults(next.props), presetId: next.id }));
    playgroundRef.current?.scrollIntoView({ block: "start" });
  };

  return (
    <main className={cn(pageShellClass, "max-w-[110rem] space-y-12")}>
      <header className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Payments lab</h1>
        <p className="font-inter text-sm text-muted-foreground">
          Redesigns of the Payments tab after the dashboards sellers already know (Stripe, Mercury, Wise, Shopify, Polar),
          over the same simulated stories the real tab uses. Tune one live, scrub its chart, click its rows, and send a pick
          back as a link or as JSX. Photos on sale rows are stand-ins from the sample storefront.
        </p>
      </header>

      <div ref={playgroundRef} className="grid scroll-mt-6 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]" data-lab-playground>
        <aside className="space-y-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-2 lg:pb-16">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setState((current) => ({ ...current, props: shuffle(current.props), presetId: null }))}>
              Shuffle
            </Button>
            <Button type="button" variant="secondary" onClick={() => setState((current) => ({ ...current, props: { ...DESIGN_DEFAULTS, scenario: current.props.scenario }, presetId: null }))}>
              Reset
            </Button>
            {preset && edited && (
              <Button type="button" variant="ghost" onClick={() => open(preset)}>
                Back to the preset
              </Button>
            )}
          </div>

          <LabGroup title="Story">
            <Select
              id="lab-scenario"
              value={props.scenario}
              options={PAYMENTS_SCENARIOS.map((scenario) => ({ value: scenario, label: scenario, description: PAYMENTS_SCENARIO_NOTES[scenario] }))}
              onChange={(scenario) => set("scenario", scenario)}
            />
            <SegmentedControl
              ariaLabel="Preview"
              value={state.frame}
              options={LAB_FRAMES.map((frame) => ({ value: frame.id, label: frame.label }))}
              onChange={(frame) => setState((current) => ({ ...current, frame }))}
            />
            <a href={`/dev/payments-lab?solo=1#${hash}`} target="_blank" rel="noreferrer" className={cn(infoTextClass, "underline underline-offset-4 hover:text-foreground")}>
              Open this design as a full page ↗
            </a>
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
                  onClick={() => setState((current) => ({ ...current, props: { ...current.props, accent: accent.accent, accent2: accent.accent2 ?? "" } }))}
                  className={cn("flex items-center gap-2 rounded-sm border p-1.5 text-left hover:bg-accent", props.accent === accent.accent ? "border-foreground" : "border-border")}
                >
                  <span className="h-4 w-7 shrink-0 rounded-sm" style={{ background: `linear-gradient(135deg, ${accent.accent}, ${accent.accent2 ?? accent.accent})` }} />
                  <span className={infoTextClass}>{accent.label}</span>
                </button>
              ))}
            </div>
            <p className={labelClass}>Accent</p>
            <ColourField label="Accent" value={props.accent} onChange={(value) => HEX.test(value) && set("accent", value)} />
            <p className={labelClass}>Second colour (gradients, the dollar pocket)</p>
            <ColourField label="Second colour" value={props.accent2} allowEmpty onChange={(value) => (value === "" || HEX.test(value)) && set("accent2", value)} />
          </LabGroup>

          <LabGroup title="Surfaces">
            <Choice name="hero" label="Balance surface" value={props.hero} onChange={(value) => set("hero", value)} />
            <Choice name="page" label="Page" value={props.page} onChange={(value) => set("page", value)} />
            <Choice name="cards" label="Cards" value={props.cards} onChange={(value) => set("cards", value)} />
            <Choice name="radius" label="Corners" value={props.radius} onChange={(value) => set("radius", value)} />
          </LabGroup>

          <LabGroup title="Chart">
            <Choice name="chart" label="Style" value={props.chart} onChange={(value) => set("chart", value)} />
            <Choice name="metric" label="Draws" value={props.metric} onChange={(value) => set("metric", value)} />
            <div className="space-y-1.5">
              <p className={labelClass}>Range it opens on</p>
              <SegmentedControl
                ariaLabel="Range"
                value={String(props.range)}
                options={LAB_RANGES.map((range) => ({ value: String(range), label: `${range} days` }))}
                onChange={(range) => set("range", Number(range) as PaymentsDesignProps["range"])}
              />
            </div>
            <LabToggle id="lab-compare" label="The period before, dashed" checked={props.compare} onChange={(on) => set("compare", on)} />
            <LabToggle id="lab-glow" label="Glow under the line" checked={props.glow} onChange={(on) => set("glow", on)} />
          </LabGroup>

          <LabGroup title="Figures">
            <Choice name="cents" label="Cents" value={props.cents} onChange={(value) => set("cents", value)} />
            <Choice name="figures" label="Weight" value={props.figures} onChange={(value) => set("figures", value)} />
          </LabGroup>

          <LabGroup title="Lists">
            <Choice name="avatars" label="Row leads with" value={props.avatars} onChange={(value) => set("avatars", value)} />
            <Choice name="rows" label="Activity" value={props.rows} onChange={(value) => set("rows", value)} />
            <Choice name="status" label="Payout status" value={props.status} onChange={(value) => set("status", value)} />
            <Choice name="bank" label="Bank" value={props.bank} onChange={(value) => set("bank", value)} />
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
          <div data-lab-preview>
            {state.frame === "phone" ? (
              <PhoneFrame>
                <PaymentsDesign key={`${props.range}-${props.scenario}`} design={props} data={data[props.scenario]} />
              </PhoneFrame>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <PaymentsDesign key={`${props.range}-${props.scenario}`} design={props} data={data[props.scenario]} />
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
            <p className={infoTextClass}>Each tile is the whole tab, scaled down. Open one to use it.</p>
          </div>
          <LabTabs groups={LAB_GROUPS} active={group} count={(id) => tabTiles(id).length} onChange={setGroup} />
        </div>
        <div className="grid gap-x-8 gap-y-10 md:grid-cols-2">
          {tabTiles(group).map(({ preset: candidate, rank, why }) => (
            <PresetTile key={candidate.id} preset={candidate} data={data} active={candidate.id === state.presetId} onOpen={() => open(candidate)} rank={rank} why={why} />
          ))}
        </div>
      </section>
    </main>
  );
}
