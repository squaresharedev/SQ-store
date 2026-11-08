"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/switch";
import { badgeClass, pageShellClass } from "@/components/ui/surface-styles";
import { nextPlanUp, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { encodeLabHash } from "../lab-kit/state";
import { RailFooter } from "./RailFooter";
import { CANDIDATES, REJECTED, SIZES, type Candidate, type ChipProps } from "./variants";
import { CHOSEN, readGeometry, WidthPlayground, WIDTHS, type PillGeometry } from "./width-lab";

const FIT_CLASS: Record<Candidate["fit"], string> = {
  "on-brand": "text-success",
  stretch: "text-foreground",
  "off-brand": "text-muted-foreground",
};

/** The plans that still have one to upgrade to: the chip only shows on these. */
const UPGRADABLE = ["free", "starter"] as const satisfies readonly PlanId[];
type Upgradable = (typeof UPGRADABLE)[number];

/** How long a copy button says "Copied". */
const COPIED_MS = 1500;
const HASH_KEY = "option=";

/** What each tile is called in the lab: widths W1 to W16, sizes by letter, the twenty by number. */
function tagOf(candidate: Candidate) {
  const width = WIDTHS.findIndex((preset) => preset.id === candidate.id);
  if (width >= 0) return `W${width + 1}`;
  const size = SIZES.indexOf(candidate);
  return size >= 0 ? String.fromCharCode(65 + size) : String(CANDIDATES.indexOf(candidate) + 1);
}
const TAGS = new Set([...WIDTHS, ...SIZES, ...CANDIDATES].map(tagOf));

/** The option a link points at, by its tag. */
function linkedOption(): string | null {
  const at = window.location.hash.indexOf(HASH_KEY);
  const tag = at < 0 ? "" : decodeURIComponent(window.location.hash.slice(at + HASH_KEY.length));
  return TAGS.has(tag) ? tag : null;
}

function OptionTile({
  tag,
  candidate,
  chip,
  guide,
  picked,
  onCopy,
  copied,
  onTry,
}: {
  tag: string | null;
  candidate: Candidate;
  chip: ChipProps;
  guide: boolean;
  picked: boolean;
  onCopy?: () => void;
  copied?: boolean;
  /** Loads this tile into the playground. */
  onTry?: () => void;
}) {
  const { Chip } = candidate;
  return (
    <article
      id={tag === null ? undefined : `option-${tag}`}
      data-lab-option={candidate.id}
      className={cn("flex scroll-mt-6 flex-col gap-3 p-3", picked && "bg-muted ring-2 ring-foreground")}
    >
      <RailFooter guide={guide}>
        <Chip {...chip} />
      </RailFooter>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">
          {tag !== null && <span className="mr-1.5 tabular-nums text-muted-foreground">{tag}.</span>}
          {candidate.name}
        </p>
        <span className={cn(badgeClass, "shrink-0", FIT_CLASS[candidate.fit])}>{candidate.fit}</span>
      </div>
      <p className={infoTextClass}>{candidate.note}</p>
      {(onCopy || onTry) && (
        <div className="flex flex-wrap gap-2">
          {onTry && (
            <Button type="button" variant="secondary" onClick={onTry}>
              Try in playground
            </Button>
          )}
          {onCopy && (
            <Button type="button" variant="secondary" onClick={onCopy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

const GRID = "grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/**
 * The plan chip lab for the rail's Upgrade chip. No. 8 of the first twenty was
 * picked and 36px kept from the sizes after it; now its width is in play: a
 * playground, sixteen widths (W1 to W16), then the earlier rounds. Hover a chip
 * to see its arrow loop; a copied link opens the lab on that option, or on the
 * playground as it was.
 */
export function PlanChipLab() {
  const [plan, setPlan] = useState<Upgradable>("free");
  const [guide, setGuide] = useState(true);
  const [geometry, setGeometry] = useState<PillGeometry>(readGeometry);
  const [picked, setPicked] = useState<string | null>(linkedOption);
  const [copied, setCopied] = useState<string | null>(null);
  const guideId = useId();

  useEffect(() => {
    if (picked !== null) document.getElementById(`option-${picked}`)?.scrollIntoView({ block: "center" });
    // Only on arrival: a link lands on its option.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = nextPlanUp(plan);
  if (!next) return null;
  const chip: ChipProps = { plan, next };

  /** The playground lives in the address bar, so a version can be sent as a link. */
  const play = (nextGeometry: PillGeometry) => {
    setGeometry(nextGeometry);
    setPicked(null);
    window.history.replaceState(null, "", `#${encodeLabHash(nextGeometry)}`);
  };

  const copy = async (tag: string) => {
    window.history.replaceState(null, "", `#${HASH_KEY}${tag}`);
    setPicked(tag);
    await navigator.clipboard.writeText(window.location.href);
    setCopied(tag);
    window.setTimeout(() => setCopied(null), COPIED_MS);
  };

  const tile = (candidate: Candidate, onTry?: () => void) => {
    const tag = tagOf(candidate);
    return (
      <OptionTile
        key={candidate.id}
        tag={tag}
        candidate={candidate}
        chip={chip}
        guide={guide}
        picked={picked === tag}
        onCopy={() => copy(tag)}
        copied={copied === tag}
        onTry={onTry}
      />
    );
  };

  const groups = [...new Set(CANDIDATES.map((candidate) => candidate.group))];

  return (
    <main className={cn(pageShellClass, "space-y-12")}>
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Upgrade chip</h1>
          <p className="font-inter text-sm text-muted-foreground">
            No. 8 at 36px and 202px wide ships on the rail; the first row holds it beside the pick as sent and a width
            either side. Everything sits in the rail&apos;s footer above Settings at the rail&apos;s real width, and
            the dashed line is where Settings&apos; label starts. The playground opens on the pick.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch id={guideId} checked={guide} onCheckedChange={setGuide} />
            <label htmlFor={guideId} className={labelClass}>
              Alignment guide
            </label>
          </div>
          <SegmentedControl
            ariaLabel="Store's plan"
            value={plan}
            options={UPGRADABLE.map((id) => ({ value: id, label: id === "free" ? "On Free" : "On Starter" }))}
            onChange={setPlan}
          />
        </div>
      </header>

      <section className="space-y-4" data-lab-group="chosen">
        <h2 className="text-lg font-semibold text-foreground">Chosen</h2>
        <div className={GRID}>
          {CHOSEN.map((candidate) => {
            const { geometry: chosen } = candidate;
            return (
              <OptionTile
                key={candidate.id}
                tag={null}
                candidate={candidate}
                chip={chip}
                guide={guide}
                picked={false}
                onTry={chosen && (() => play(chosen))}
              />
            );
          })}
        </div>
      </section>

      <WidthPlayground plan={plan} guide={guide} geometry={geometry} onChange={play} />

      <section className="space-y-4" data-lab-group="widths">
        <h2 className="text-lg font-semibold text-foreground">Widths at 36px</h2>
        <div className={GRID}>
          {WIDTHS.map((preset) =>
            tile(preset, () => {
              play(preset.geometry);
              document.querySelector("[data-lab-playground]")?.scrollIntoView({ block: "start" });
            }),
          )}
        </div>
      </section>

      <section className="space-y-4" data-lab-group="sizes">
        <h2 className="text-lg font-semibold text-foreground">Sizes (turned down; 36px kept from C)</h2>
        <div className={GRID}>{SIZES.map((size) => tile(size))}</div>
      </section>

      {groups.map((group) => (
        <section key={group} className="space-y-4" data-lab-group={group}>
          <h2 className="text-lg font-semibold text-foreground">{group}</h2>
          <div className={GRID}>{CANDIDATES.filter((candidate) => candidate.group === group).map((candidate) => tile(candidate))}</div>
        </section>
      ))}

      <section className="space-y-4 border-t border-border pt-8" data-lab-group="reference">
        <h2 className="text-lg font-semibold text-foreground">Reference</h2>
        <div className={GRID}>
          <OptionTile tag={null} candidate={REJECTED} chip={chip} guide={guide} picked={false} />
        </div>
      </section>
    </main>
  );
}
