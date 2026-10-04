import { Package, Store, TriangleAlert, Users } from "lucide-react";
import type { MarkGlyph } from "@/components/ui/HeroMark";
import { helpTextClass } from "@/components/ui/control-styles";
import type { PlanLimitKey } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/** The glyph each capped thing wears on its tile. */
const LIMIT_ICONS: Record<PlanLimitKey, MarkGlyph> = {
  storefronts: Store,
  teamSeats: Users,
  products: Package,
};

/** A circle of radius 15.9155 is 100 long, so a dash of N is N percent. */
const RING_RADIUS = 15.9155;
const RING_LENGTH = 100;
const RING_STROKE = 2.5;

/**
 * One capped thing against its plan, as a tile: the thing's glyph and name, a
 * ring that fills toward the cap with the number used inside it, and one line
 * saying what that leaves ("2 left", "Full", "2 over"). The ring is the same
 * size whatever the cap, so 3 of 5 and 8 of 500 read the same way; the line
 * under it carries the exact room left. The ring stays the same calm dark in
 * every state (a full ring, the cap reached, is not an alarm): the signal is
 * the line under it, a quiet pill for "Full" and a red-tinted one for "over".
 * An uncapped thing has nothing to fill: an empty ring, the count, and the
 * word for no cap.
 *
 * Server-compatible: it only paints what it is given. `label` is the full
 * sentence ("Storefronts: 5 of 3"), the ring's accessible name; `status` is
 * the line under the ring, worded by the caller.
 */
export function UsageMeter({
  kind,
  name,
  used,
  cap,
  label,
  ofCap,
  status,
}: {
  kind: PlanLimitKey;
  name: string;
  used: number;
  /** null = no cap on this plan. */
  cap: number | null;
  label: string;
  /** Under the number inside the ring: "/ 3", or the sign for "no cap". */
  ofCap: string;
  /** "2 left", "Full" or "2 over"; for an uncapped thing, the word for no cap. */
  status: string | null;
}) {
  const Icon = LIMIT_ICONS[kind];
  const over = cap !== null && used > cap;
  const full = cap !== null && used === cap;
  const fraction = cap === null ? 0 : cap === 0 ? (used > 0 ? 1 : 0) : Math.min(1, used / cap);

  return (
    <li
      data-billing-usage={kind}
      data-over={over || undefined}
      className="flex flex-col items-center gap-3 rounded-md border border-border p-4 text-center"
    >
      <div className="flex flex-col items-center gap-1.5 font-inter text-sm font-medium text-foreground">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
        <span className="min-h-10 text-balance">{name}</span>
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={cap ?? undefined}
        aria-valuenow={cap === null ? undefined : Math.min(used, cap)}
        className="relative size-24"
      >
        <svg viewBox="0 0 36 36" aria-hidden className="size-full -rotate-90">
          <circle cx="18" cy="18" r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} className="stroke-muted" />
          {fraction > 0 && (
            <circle
              cx="18"
              cy="18"
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${fraction * RING_LENGTH} ${RING_LENGTH}`}
              className="stroke-primary transition-[stroke-dasharray] duration-slow ease-standard motion-reduce:transition-none"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-inter text-2xl font-semibold leading-none tabular-nums text-foreground">{used}</span>
          <span className="mt-1 font-inter text-xs text-muted-foreground">{ofCap}</span>
        </div>
      </div>

      <p
        className={cn(
          helpTextClass,
          "flex items-center gap-1.5",
          (over || full) && "rounded-full px-2.5 py-0.5 text-xs font-medium",
          over && "bg-destructive/10 text-destructive",
          full && "bg-secondary text-foreground",
        )}
      >
        {over && <TriangleAlert aria-hidden className="size-3.5 shrink-0" />}
        {status}
      </p>
    </li>
  );
}
