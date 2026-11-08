"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ImportFileHelp } from "@/components/products/ImportFileHelp";
import { ProductImportStory } from "@/components/products/ProductImportStory";
import { type ProductImportStoryLook, type StoryCount } from "@/components/products/product-import-story-tokens";
import { Button } from "@/components/ui/button";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { pageShellClass } from "@/components/ui/surface-styles";
import { IMPORT_ROWS_MAX } from "@/lib/products/csv";
import { cn } from "@/lib/utils";
import { LabCopyButtons, LabFitBadge, LabGroup, LabJsx, LabKnob, LabTabs } from "../lab-kit/controls";
import { LabLazy } from "../lab-kit/lazy";
import {
  LAB_KNOBS,
  LAB_OPTIONS,
  LAB_PLACEMENTS,
  decodeState,
  encodeState,
  shuffle,
  toJsx,
  withDefaults,
  type LabPlacement,
  type LabPreset,
  type LabState,
} from "./lab-model";
import { LAB_GROUPS, LAB_PRESETS, LAB_SHORTLIST, PICK_GROUP, SHORTLIST_GROUP } from "./presets";

/** Where the lab opens: the look picked from the last round. */
const OPENING = LAB_PRESETS.find((preset) => preset.group === PICK_GROUP) ?? LAB_PRESETS[0];
const FIRST: LabState = { look: withDefaults(OPENING.look), placement: "page", presetId: OPENING.id };

/** How wide each placement draws the import page's column. */
const PLACEMENT_WIDTH: Record<LabPlacement, string> = {
  page: "w-full max-w-3xl",
  phone: "w-[390px] max-w-full",
};

/** A tab's tiles: the shortlist in its order with its reasons, any other tab by group. */
function tabTiles(group: string): { preset: LabPreset; rank?: number; why?: string }[] {
  if (group !== SHORTLIST_GROUP) return LAB_PRESETS.filter((preset) => preset.group === group).map((preset) => ({ preset }));
  return LAB_SHORTLIST.flatMap((pick, i) => {
    const preset = LAB_PRESETS.find((candidate) => candidate.id === pick.id);
    return preset ? [{ preset, rank: i + 1, why: pick.why }] : [];
  });
}

/**
 * The import page's column as /products/import draws it: its heading and line,
 * the graphic, what a file needs, and the real file drop under it. `children` is the graphic.
 */
function ImportColumn({ placement, children }: { placement: LabPlacement; children: ReactNode }) {
  const t = useTranslations("Products.page.import");
  const tImport = useTranslations("Products.import");
  return (
    <div className={cn("@container mx-auto space-y-6 bg-background p-4 @md:p-6", PLACEMENT_WIDTH[placement])}>
      <div className="space-y-2">
        <h1 className="font-inter text-2xl font-semibold text-foreground">{t("heading")}</h1>
        <p className="font-inter text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {children}
      <ImportFileHelp />
      <FileDropzone
        id="product-import-lab-file"
        bold
        accept=".csv,text/csv"
        label={tImport("dropPrompt")}
        meta={tImport("rowsLimit", { max: IMPORT_ROWS_MAX })}
        onFile={() => {}}
      />
    </div>
  );
}

/** A tile's words: its name (with its shortlist rank), what it is, and its fit. */
function TileCaption({ name, note, rank, fit }: { name: string; note: string; rank?: number; fit?: LabPreset["fit"] }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold text-foreground">
          {rank !== undefined && <span className="mr-1.5 tabular-nums text-muted-foreground">{rank}.</span>}
          {name}
        </p>
        <p className={infoTextClass}>{note}</p>
      </div>
      {fit && <LabFitBadge fit={fit} className="shrink-0" />}
    </div>
  );
}

function PresetTile({
  preset,
  active,
  onOpen,
  rank,
  why,
}: {
  preset: LabPreset;
  active: boolean;
  onOpen: () => void;
  /** Its place on the shortlist, when the tile is listed there. */
  rank?: number;
  why?: string;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-3" data-lab-preset={preset.id}>
      <LabLazy>
        <ProductImportStory look={preset.look} />
      </LabLazy>
      <TileCaption name={preset.name} note={why ?? preset.note} rank={rank} fit={preset.fit} />
      <div>
        <Button type="button" variant={active ? "primary" : "secondary"} onClick={onOpen}>
          {active ? "In the playground" : "Open in the playground"}
        </Button>
      </div>
    </article>
  );
}

/**
 * The product import lab: the motion graphic at the top of /products/import, on
 * the real component, to tune live and compare. The address bar holds whatever
 * is on screen.
 */
export function ProductImportLab() {
  const [state, setState] = useState<LabState>(() => decodeState(window.location.hash) ?? FIRST);
  const [group, setGroup] = useState(PICK_GROUP);
  const [replay, setReplay] = useState(0);
  const playgroundRef = useRef<HTMLDivElement>(null);

  const { look, placement } = state;
  const preset = LAB_PRESETS.find((candidate) => candidate.id === state.presetId) ?? null;
  const edited = preset !== null && JSON.stringify(withDefaults(preset.look)) !== JSON.stringify(look);
  const jsx = toJsx(look);

  useEffect(() => {
    window.history.replaceState(null, "", `#${encodeState(state)}`);
  }, [state]);

  const set = <K extends keyof ProductImportStoryLook>(key: K, value: ProductImportStoryLook[K]) =>
    setState((current) => ({ ...current, look: withDefaults({ ...current.look, [key]: value }) }));
  const open = (next: LabPreset) => {
    setState((current) => ({ ...current, look: withDefaults(next.look), presetId: next.id }));
    playgroundRef.current?.scrollIntoView({ block: "start" });
  };

  return (
    <main className={cn(pageShellClass, "space-y-12")}>
      <header className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Product import graphic lab</h1>
        <p className="font-inter text-sm text-muted-foreground">
          The motion graphic for Import products, on the real component, in the page&apos;s own column: a cursor grabs
          products off a shelf, one at a time, drags each straight across and lets go in the Square Share catalogue. It is not on the
          page yet. Whatever is on
          screen is in the address bar, so a look can be sent as a link.
        </p>
      </header>

      <div ref={playgroundRef} className="grid scroll-mt-6 gap-8 lg:grid-cols-4" data-lab-playground>
        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setState((current) => ({ ...current, look: shuffle(), presetId: null }))}
            >
              Shuffle
            </Button>
            <Button type="button" variant="secondary" onClick={() => setReplay((n) => n + 1)}>
              Replay
            </Button>
            {preset && edited && (
              <Button type="button" variant="ghost" onClick={() => open(preset)}>
                Back to the preset
              </Button>
            )}
          </div>

          <LabGroup title="Shelf">
            <div className="space-y-1.5">
              <label htmlFor="lab-shelf" className={labelClass}>
                Shelf
              </label>
              <Select id="lab-shelf" value={look.shelf} options={LAB_OPTIONS.shelf} onChange={(shelf) => set("shelf", shelf)} />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Material</span>
              <SegmentedControl ariaLabel="Material" value={look.material} options={LAB_OPTIONS.material} onChange={(material) => set("material", material)} />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Products stand as</span>
              <SegmentedControl ariaLabel="Products stand as" value={look.form} options={LAB_OPTIONS.form} onChange={(form) => set("form", form)} />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>How many</span>
              <SegmentedControl
                ariaLabel="How many"
                value={String(look.count)}
                options={LAB_OPTIONS.count}
                onChange={(count) => set("count", Number(count) as StoryCount)}
              />
            </div>
          </LabGroup>

          <LabGroup title="Catalogue">
            <div className="space-y-1.5">
              <label htmlFor="lab-frame" className={labelClass}>
                Drawn in
              </label>
              <Select id="lab-frame" value={look.frame} options={LAB_OPTIONS.frame} onChange={(frame) => set("frame", frame)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="lab-layout" className={labelClass}>
                Where the shelf sits
              </label>
              <Select id="lab-layout" value={look.layout} options={LAB_OPTIONS.layout} onChange={(layout) => set("layout", layout)} />
            </div>
            <p className={infoTextClass}>On a phone every layout puts the shelf above.</p>
          </LabGroup>

          <LabGroup title="Motion">
            <div className="space-y-1.5">
              <span className={labelClass}>Cursor</span>
              <SegmentedControl ariaLabel="Cursor" value={look.cursor} options={LAB_OPTIONS.cursor} onChange={(cursor) => set("cursor", cursor)} />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Held product</span>
              <SegmentedControl ariaLabel="Held product" value={look.lift} options={LAB_OPTIONS.lift} onChange={(lift) => set("lift", lift)} />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Landing</span>
              <SegmentedControl ariaLabel="Landing" value={look.landing} options={LAB_OPTIONS.landing} onChange={(landing) => set("landing", landing)} />
            </div>
            <LabKnob id="lab-pace" label="Pace (over 1 is slower)" value={look.pace} {...LAB_KNOBS.pace} onChange={(pace) => set("pace", pace)} />
          </LabGroup>

          <LabGroup title="Placement">
            <SegmentedControl
              ariaLabel="Placement"
              value={placement}
              options={LAB_PLACEMENTS}
              onChange={(next) => setState((current) => ({ ...current, placement: next }))}
            />
          </LabGroup>
        </aside>

        <div className="min-w-0 space-y-4 lg:col-span-3">
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
          <div className="flex justify-center bg-muted p-4 @container" data-lab-preview>
            <ImportColumn placement={placement}>
              {/* A new look or a Replay starts the graphic from its first beat. */}
              <ProductImportStory key={`${JSON.stringify(look)}-${replay}`} look={look} />
            </ImportColumn>
          </div>
          <LabCopyButtons jsx={jsx} />
          <LabJsx jsx={jsx} />
        </div>
      </div>

      <section className="space-y-6" data-lab-presets>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Presets</h2>
          <LabTabs groups={LAB_GROUPS} active={group} count={(id) => tabTiles(id).length} onChange={setGroup} />
        </div>
        <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
          {tabTiles(group).map(({ preset: candidate, rank, why }) => (
            <PresetTile
              key={candidate.id}
              preset={candidate}
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
