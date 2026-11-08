"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { infoTextClass } from "@/components/ui/control-styles";
import { ASCII_SHAPES, riseFromTop } from "@/components/ui/gradient-ascii-tokens";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import {
  LabCopyButtons,
  LabFitBadge,
  LabGroup as Group,
  LabJsx,
  LabKnob as Knob,
  LabTabs,
  LabToggle as Toggle,
} from "../lab-kit/controls";
import {
  LAB_CLICK_EFFECTS,
  LAB_GLYPHS,
  LAB_PALETTES,
  LAB_PLACEMENTS,
  LAB_SLIDERS,
  LAB_SURFACES,
  decodeState,
  encodeState,
  shuffle,
  toJsx,
  withDefaults,
  type LabPreset,
  type LabProps,
  type LabState,
} from "./lab-model";
import { LabLazy } from "../lab-kit/lazy";
import { Placement } from "./Placement";
import { LAB_GROUPS, LAB_PRESETS, LAB_SHORTLIST, SHORTLIST_GROUP } from "./presets";

const FIRST: LabState = {
  placement: LAB_PRESETS[0].placement,
  props: withDefaults(LAB_PRESETS[0].props),
  presetId: LAB_PRESETS[0].id,
};

/** A tab's tiles: the shortlist in its order with its reasons, any other tab by group. */
function tabTiles(group: string): { preset: LabPreset; rank?: number; why?: string }[] {
  if (group !== SHORTLIST_GROUP) return LAB_PRESETS.filter((preset) => preset.group === group).map((preset) => ({ preset }));
  return LAB_SHORTLIST.flatMap((pick, i) => {
    const preset = LAB_PRESETS.find((candidate) => candidate.id === pick.id);
    return preset ? [{ preset, rank: i + 1, why: pick.why }] : [];
  });
}

const MAX_STOPS = 8;
const HEX = /^#[0-9a-f]{6}$/i;

/** A palette drawn as the strip it makes. */
const rampStyle = (colors: readonly string[]): CSSProperties => ({
  background: `linear-gradient(to right, ${colors.join(", ")})`,
});

function PresetTile({
  preset,
  mcpUrl,
  active,
  onOpen,
  rank,
  why,
}: {
  preset: LabPreset;
  mcpUrl: string;
  active: boolean;
  onOpen: () => void;
  /** Its place on the shortlist, when the tile is listed there. */
  rank?: number;
  why?: string;
}) {
  return (
    <article className="flex flex-col gap-3" data-lab-preset={preset.id}>
      <LabLazy>
        <Placement placement={preset.placement} props={withDefaults(preset.props)} mcpUrl={mcpUrl} />
      </LabLazy>
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
        <span className={infoTextClass}>{LAB_PLACEMENTS.find((p) => p.id === preset.placement)?.label}</span>
      </div>
    </article>
  );
}

/**
 * The ASCII lab: one field to tune live, shown where it would sit, and every
 * preset to load into it. The address bar holds whatever is on screen.
 */
export function AsciiLab({ mcpUrl }: { mcpUrl: string }) {
  const [state, setState] = useState<LabState>(() => decodeState(window.location.hash) ?? FIRST);
  // Bumped to remount the field, which plays its intro again.
  const [fieldKey, setFieldKey] = useState(0);
  // The first tab with anything in it: the tabs are listed in the order to look at them.
  const [group, setGroup] = useState(() => LAB_GROUPS.find((tab) => tabTiles(tab.id).length)?.id ?? SHORTLIST_GROUP);
  const playgroundRef = useRef<HTMLDivElement>(null);

  const { props } = state;
  const preset = LAB_PRESETS.find((candidate) => candidate.id === state.presetId) ?? null;
  const edited = preset !== null && JSON.stringify(withDefaults(preset.props)) !== JSON.stringify(props);
  const jsx = toJsx(props);

  useEffect(() => {
    window.history.replaceState(null, "", `#${encodeState(state)}`);
  }, [state]);

  const set = <K extends keyof LabProps>(key: K, value: LabProps[K]) =>
    setState((current) => ({ ...current, props: { ...current.props, [key]: value } }));
  const replay = () => setFieldKey((key) => key + 1);
  const open = (next: LabPreset) => {
    setState({ placement: next.placement, props: withDefaults(next.props), presetId: next.id });
    replay();
    playgroundRef.current?.scrollIntoView({ block: "start" });
  };

  const setStop = (index: number, value: string) =>
    set("colors", props.colors.map((color, i) => (i === index ? value : color)));
  const corner = props.shape === "rise" ? riseFromTop(1, props.scale) : ([1, 0] as const);
  const topEdge = props.shape === "rise" ? riseFromTop(0.5, props.scale) : ([0.5, 0] as const);

  return (
    <main className={cn(pageShellClass, "space-y-12")}>
      <header className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">ASCII lab</h1>
        <p className="font-inter text-sm text-muted-foreground">
          Tune a field live and see it where it would sit on Settings &gt; Connected apps. Whatever is on screen is in the
          address bar, so a variation can be sent as a link. Move the pointer over a field to scramble it, click for the
          wave.
        </p>
      </header>

      <div ref={playgroundRef} className="grid scroll-mt-6 gap-8 lg:grid-cols-3" data-lab-playground>
        <aside className="space-y-5 lg:sticky lg:top-6 lg:max-h-screen lg:self-start lg:overflow-y-auto lg:pb-16 lg:pr-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setState((current) => ({ ...current, props: shuffle(), presetId: null }));
                replay();
              }}
            >
              Shuffle
            </Button>
            <Button type="button" variant="secondary" onClick={replay}>
              Replay intro
            </Button>
            {preset && edited && (
              <Button type="button" variant="ghost" onClick={() => open(preset)}>
                Back to the preset
              </Button>
            )}
          </div>

          <Group title="Where">
            <Select
              id="lab-placement"
              value={state.placement}
              options={LAB_PLACEMENTS.map((placement) => ({ value: placement.id, label: placement.label }))}
              onChange={(placement) => setState((current) => ({ ...current, placement }))}
            />
            <SegmentedControl
              ariaLabel="Surface"
              value={props.surface}
              options={LAB_SURFACES.map((surface) => ({ value: surface, label: surface === "light" ? "Light page" : "Dark slab" }))}
              onChange={(surface) => set("surface", surface)}
            />
          </Group>

          <Group title="Shape">
            <Select
              id="lab-shape"
              value={props.shape}
              options={ASCII_SHAPES.map((shape) => ({ value: shape, label: shape }))}
              onChange={(shape) => set("shape", shape)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => set("center", [0.5, 0.5])}>
                Middle
              </Button>
              <Button type="button" variant="ghost" onClick={() => set("center", topEdge)}>
                Top edge
              </Button>
              <Button type="button" variant="ghost" onClick={() => set("center", corner)}>
                Top-right corner
              </Button>
            </div>
            <Knob id="lab-center-x" label="Centre, across" value={props.center[0]} min={-1} max={2} step={0.01} onChange={(x) => set("center", [x, props.center[1]])} />
            <Knob id="lab-center-y" label="Centre, down" value={props.center[1]} min={-2} max={2} step={0.01} onChange={(y) => set("center", [props.center[0], y])} />
          </Group>

          <Group title="Colour">
            <div className="grid grid-cols-2 gap-2">
              {LAB_PALETTES.map((palette) => (
                <button
                  key={palette.id}
                  type="button"
                  onClick={() => set("colors", palette.colors)}
                  className="flex flex-col gap-1 rounded-sm border border-border p-1.5 text-left hover:bg-accent"
                >
                  <span className="h-3 rounded-sm" style={rampStyle(palette.colors)} />
                  <span className={infoTextClass}>{palette.label}</span>
                </button>
              ))}
            </div>
            <div className="h-3 rounded-sm" style={rampStyle(props.colors)} />
            <ul className="space-y-1.5">
              {props.colors.map((color, index) => (
                <li key={index} className="flex items-center gap-2">
                  {HEX.test(color) ? (
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => setStop(index, event.target.value)}
                      aria-label={`Stop ${index + 1}`}
                      className="h-9 w-10 shrink-0 cursor-pointer rounded-sm border border-border bg-background p-0.5"
                    />
                  ) : (
                    <span className="h-9 w-10 shrink-0 rounded-sm border border-border" style={{ background: color }} />
                  )}
                  <Input
                    value={color}
                    onChange={(event) => setStop(index, event.target.value)}
                    aria-label={`Stop ${index + 1}, any CSS colour`}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={props.colors.length <= 2}
                    onClick={() => set("colors", props.colors.filter((_, i) => i !== index))}
                    aria-label={`Remove stop ${index + 1}`}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={props.colors.length >= MAX_STOPS}
                onClick={() => set("colors", [...props.colors, props.colors[props.colors.length - 1]])}
              >
                Add a stop
              </Button>
              <Button type="button" variant="secondary" onClick={() => set("colors", [...props.colors].reverse())}>
                Reverse
              </Button>
            </div>
            <p className={infoTextClass}>Darkest to lightest. On a light page the darkest is the core; on a dark slab the lightest glows.</p>
          </Group>

          <Group title="Glyphs">
            <div className="flex flex-wrap gap-1.5">
              {LAB_GLYPHS.map((glyphs) => (
                <button
                  key={glyphs.id}
                  type="button"
                  title={glyphs.label}
                  onClick={() => set("characters", glyphs.characters)}
                  className={cn(
                    "rounded-sm border px-2 py-1 font-mono text-xs hover:bg-accent",
                    props.characters === glyphs.characters ? "border-foreground" : "border-border",
                  )}
                >
                  {glyphs.characters.trim() || glyphs.label}
                </button>
              ))}
            </div>
            <Input
              value={props.characters}
              onChange={(event) => set("characters", event.target.value)}
              aria-label="Characters, faintest to fullest"
              className="font-mono"
            />
          </Group>

          <Group title="Tune">
            {LAB_SLIDERS.map((slider) => (
              <Knob
                key={slider.key}
                id={`lab-${slider.key}`}
                label={slider.label}
                value={props[slider.key]}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                onChange={(value) => set(slider.key, value)}
              />
            ))}
          </Group>

          <Group title="Pointer and intro">
            <Toggle id="lab-scramble" label="Scramble under the pointer" checked={props.pointerScramble} onChange={(on) => set("pointerScramble", on)} />
            <Toggle id="lab-intro" label="Decode in on arrival" checked={props.intro} onChange={(on) => set("intro", on)} />
            <SegmentedControl
              ariaLabel="Click effect"
              value={props.clickEffect}
              options={LAB_CLICK_EFFECTS.map((effect) => ({ value: effect, label: `Click: ${effect}` }))}
              onChange={(effect) => set("clickEffect", effect)}
            />
          </Group>
        </aside>

        <div className="min-w-0 space-y-4 lg:col-span-2">
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
          <div key={fieldKey} data-lab-preview>
            <Placement placement={state.placement} props={props} mcpUrl={mcpUrl} />
          </div>
          <LabCopyButtons jsx={jsx} />
          <LabJsx jsx={jsx} />
        </div>
      </div>

      <section className="space-y-6" data-lab-presets>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold text-foreground">Presets</h2>
            <p className={infoTextClass}>A tab at a time: a browser keeps only so many live fields on one page.</p>
          </div>
          <LabTabs groups={LAB_GROUPS} active={group} count={(id) => tabTiles(id).length} onChange={setGroup} />
        </div>
        <div className="grid gap-x-8 gap-y-10 md:grid-cols-2">
          {tabTiles(group).map(({ preset: candidate, rank, why }) => (
            <PresetTile
              key={candidate.id}
              preset={candidate}
              mcpUrl={mcpUrl}
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
