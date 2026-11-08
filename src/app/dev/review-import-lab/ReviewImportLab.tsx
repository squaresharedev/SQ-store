"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ReviewImportBeams } from "@/components/products/ReviewImportBeams";
import { BEAM_SOURCE_COUNT, BEAM_SOURCES, importsToday, type ReviewImportBeamsLook } from "@/components/products/review-import-beams-tokens";
import { Button } from "@/components/ui/button";
import { chipButtonClass, infoTextClass, labelClass } from "@/components/ui/control-styles";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { pageShellClass } from "@/components/ui/surface-styles";
import { REVIEW_IMPORT_ROWS_MAX } from "@/lib/reviews/limits";
import { cn } from "@/lib/utils";
import { LabCopyButtons, LabFitBadge, LabGroup, LabJsx, LabKnob, LabTabs, LabToggle } from "../lab-kit/controls";
import { LabLazy } from "../lab-kit/lazy";
import {
  LAB_KNOBS,
  LAB_OPTIONS,
  LAB_PLACEMENTS,
  decodeState,
  encodeState,
  shuffle,
  toJsx,
  toggleSource,
  withDefaults,
  type LabPlacement,
  type LabPreset,
  type LabState,
} from "./lab-model";
import { LAB_GROUPS, LAB_PRESETS, LAB_SHORTLIST, PICK_GROUP, SHORTLIST_GROUP } from "./presets";

/** The platforms the importer reads today, named for the panel's note. */
const IMPORTED_TODAY = BEAM_SOURCES.filter(importsToday)
  .map((source) => LAB_OPTIONS.source.find((option) => option.value === source)?.label ?? source)
  .join(", ");

/** Where the lab opens: the look the import page ships, as the user picked it. */
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
 * The import page's column as /products/import-reviews draws it: its heading
 * and line, the graphic, and the real file drop under it. `withPage` off
 * draws the graphic alone, for a tile.
 */
function ImportColumn({ placement, withPage = true, children }: { placement: LabPlacement; withPage?: boolean; children: ReactNode }) {
  const t = useTranslations("Products.page.importReviews");
  const tImport = useTranslations("Products.reviewImport");
  if (!withPage) return children;
  return (
    <div className={cn("@container mx-auto space-y-6 bg-background p-4 @md:p-6", PLACEMENT_WIDTH[placement])}>
      <div>
        <h1 className="font-inter text-2xl font-semibold text-foreground">{t("heading")}</h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="space-y-6">
        {children}
        <FileDropzone
          id="review-import-lab-file"
          bold
          accept=".csv,text/csv"
          label={tImport("dropPrompt")}
          meta={tImport("rowsLimit", { max: REVIEW_IMPORT_ROWS_MAX })}
          onFile={() => {}}
        />
      </div>
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
        <ReviewImportBeams look={preset.look} />
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
 * The review import lab: the motion graphic at the top of
 * /products/import-reviews, on the real component, to tune live and compare.
 * The address bar holds whatever is on screen.
 */
export function ReviewImportLab() {
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

  const set = <K extends keyof ReviewImportBeamsLook>(key: K, value: ReviewImportBeamsLook[K]) =>
    setState((current) => ({ ...current, look: withDefaults({ ...current.look, [key]: value }) }));
  const open = (next: LabPreset) => {
    setState((current) => ({ ...current, look: withDefaults(next.look), presetId: next.id }));
    playgroundRef.current?.scrollIntoView({ block: "start" });
  };

  return (
    <main className={cn(pageShellClass, "space-y-12")}>
      <header className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Review import graphic lab</h1>
        <p className="font-inter text-sm text-muted-foreground">
          The motion graphic at the top of Import reviews, on the real component, in the page&apos;s own column: the
          platforms a seller&apos;s reviews live on, beams from each to the product page, and the reviews travelling
          along them. Whatever is on screen is in the address bar, so a look can be sent as a link.
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

          <LabGroup title="Platforms">
            <div className="space-y-1.5">
              <span className={labelClass}>
                Which ({BEAM_SOURCE_COUNT.min} to {BEAM_SOURCE_COUNT.max})
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platforms">
                {LAB_OPTIONS.source.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={chipButtonClass}
                    aria-pressed={look.sources.includes(option.value)}
                    onClick={() => set("sources", toggleSource(look.sources, option.value))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className={infoTextClass}>The importer reads {IMPORTED_TODAY} today; the rest it does not read yet.</p>
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Marks</span>
              <SegmentedControl ariaLabel="Marks" value={look.marks} options={LAB_OPTIONS.marks} onChange={(marks) => set("marks", marks)} />
              {look.marks === "lettered" && <p className={infoTextClass}>Reads like each company&apos;s logo: needs their permission to ship.</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="lab-layout" className={labelClass}>
                Where they sit
              </label>
              <Select id="lab-layout" value={look.layout} options={LAB_OPTIONS.layout} onChange={(layout) => set("layout", layout)} />
              <p className={infoTextClass}>On a phone every layout puts them above.</p>
            </div>
            <LabToggle id="lab-labels" label="Names beside the marks" checked={look.labels} onChange={(labels) => set("labels", labels)} />
            <div className="space-y-1.5">
              <span className={labelClass}>Colours</span>
              <SegmentedControl
                ariaLabel="Colours"
                value={look.colour}
                options={LAB_OPTIONS.colour}
                onChange={(colour) => set("colour", colour)}
                disabled={look.marks === "plain"}
              />
              {look.marks === "plain" && <p className={infoTextClass}>Plain icons are always in the app&apos;s ink.</p>}
            </div>
          </LabGroup>

          <LabGroup title="Motion">
            <div className="space-y-1.5">
              <label htmlFor="lab-traveller" className={labelClass}>
                What travels
              </label>
              <Select
                id="lab-traveller"
                value={look.traveller}
                options={LAB_OPTIONS.traveller}
                onChange={(traveller) => set("traveller", traveller)}
              />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Where it ends</span>
              <SegmentedControl
                ariaLabel="Where it ends"
                value={look.landing}
                options={LAB_OPTIONS.landing}
                onChange={(landing) => set("landing", landing)}
                disabled={look.traveller !== "review" && look.traveller !== "card"}
              />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Beam</span>
              <SegmentedControl ariaLabel="Beam" value={look.line} options={LAB_OPTIONS.line} onChange={(line) => set("line", line)} />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Light</span>
              <SegmentedControl ariaLabel="Light" value={look.glow} options={LAB_OPTIONS.glow} onChange={(glow) => set("glow", glow)} />
            </div>
            <div className="space-y-1.5">
              <span className={labelClass}>Platforms send</span>
              <SegmentedControl ariaLabel="Platforms send" value={look.carry} options={LAB_OPTIONS.carry} onChange={(carry) => set("carry", carry)} />
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
              <ReviewImportBeams key={`${JSON.stringify(look)}-${replay}`} look={look} />
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
