"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "@/components/ui/AppLink";
import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { MarkedPlanName } from "@/components/billing/PlanWordmark";
import { NAV_ITEM_CLASSES } from "@/components/dashboard/Sidebar";
import { ArrowLoopIcon, useArrowLoop } from "@/components/ui/action-icons";
import { iconNudgeRightClass, iconNudgeUpRightClass } from "@/components/ui/control-styles";
import { eyebrowClass, inkBadgeClass } from "@/components/ui/surface-styles";
import { plansHref } from "@/lib/billing/paths";
import type { PaidPlanId, PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/**
 * Twenty candidates for the rail's Upgrade chip, each its own small component
 * so they can differ in build, not only in colour. Every one sits on a visible
 * chip and its arrow moves the way it points on hover and keyboard focus.
 * Lab only: raw colours and arbitrary values are allowed here; the winner's
 * are promoted to tokens when it moves into components/billing/PlanChip.
 */

export type ChipProps = { plan: PlanId; next: PaidPlanId };

export type Candidate = {
  id: string;
  name: string;
  note: string;
  fit: "on-brand" | "stretch" | "off-brand";
  group: string;
  Chip: (props: ChipProps) => ReactNode;
};

/** The rail row every candidate starts from, and the hover group its arrow listens to. */
const ROW = cn(NAV_ITEM_CLASSES, "group/btn");
/** For candidates that move as well as recolour (a lift, a press). */
const MOVE = "transition duration-base ease-standard motion-reduce:transition-none";

/** The trailing "upgrade" arrow, leaning up-right. */
function Diag({ className }: { className?: string }) {
  return <ArrowUpRight aria-hidden strokeWidth={2} className={cn("size-4 shrink-0", iconNudgeUpRightClass, className)} />;
}

/** A forward arrow, moving right. */
function Forward({ className }: { className?: string }) {
  return <ArrowRight aria-hidden strokeWidth={2} className={cn("size-4 shrink-0", iconNudgeRightClass, className)} />;
}

/** The link every candidate is: the plans page, with the current plan said to screen readers. */
export function ChipLink({
  plan,
  className,
  style,
  onMouseEnter,
  children,
}: {
  plan: PlanId;
  className: string;
  style?: CSSProperties;
  onMouseEnter?: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("Billing");
  return (
    <Link href={plansHref("sidebar")} data-plan-chip={plan} className={className} style={style} onMouseEnter={onMouseEnter}>
      <span className="sr-only">{t("chip.label", { plan: t(`plans.${plan}.name`) })}. </span>
      {children}
    </Link>
  );
}

/** The word on the chip. */
export function UpgradeWord() {
  return useTranslations("Billing")("chip.upgrade");
}

// ── Outlined and quiet ──────────────────────────────────────────────────

function SplitChip({ plan }: ChipProps) {
  const t = useTranslations("Billing");
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-full gap-0 overflow-hidden border border-border p-0")}>
      <span className="self-stretch border-r border-border bg-muted px-3 py-2.5 font-inter text-xs font-medium uppercase leading-5 tracking-wide text-muted-foreground">
        {t(`plans.${plan}.name`)}
      </span>
      <span className="flex flex-1 items-center justify-between bg-background px-3 py-2.5 text-foreground transition-colors duration-base ease-standard group-hover/btn:bg-accent">
        {t("chip.upgrade")}
        <Diag />
      </span>
    </ChipLink>
  );
}

function NextPlanMark({ plan, next }: ChipProps) {
  const t = useTranslations("Billing");
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-full border border-border bg-background text-foreground hover:bg-accent")}>
      {t("chip.upgrade")}
      <span className="ml-auto font-semibold">
        <MarkedPlanName plan={next} name={t(`plans.${next}.name`)} />
      </span>
      <Diag />
    </ChipLink>
  );
}

function BadgeInside({ plan, next }: ChipProps) {
  const t = useTranslations("Billing");
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-full border border-border bg-background py-2 pr-2 text-foreground hover:bg-accent")}>
      {t("chip.upgrade")}
      <span className={cn(inkBadgeClass, "ml-auto")}>
        {t(`plans.${next}.name`)}
        <ArrowUpRight aria-hidden strokeWidth={2.25} className={cn("size-3", iconNudgeUpRightClass)} />
      </span>
    </ChipLink>
  );
}

function DashedSlot({ plan }: ChipProps) {
  return (
    <ChipLink
      plan={plan}
      className={cn(ROW, "w-full justify-between border border-dashed border-foreground/30 text-foreground hover:border-foreground hover:bg-accent")}
    >
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

function Keycap({ plan }: ChipProps) {
  return (
    <ChipLink
      plan={plan}
      className={cn(
        ROW,
        MOVE,
        "w-full justify-between border border-b-4 border-border bg-background text-foreground hover:bg-accent active:translate-y-0.5 active:border-b-2",
      )}
    >
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

// ── Ink ─────────────────────────────────────────────────────────────────

function InkPill({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-fit rounded-full bg-foreground px-4 py-2 text-background hover:bg-foreground/85")}>
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

function PrimaryBar({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-full justify-between rounded-none bg-primary text-primary-foreground hover:bg-primary/90")}>
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

function ArrowLoop({ plan }: ChipProps) {
  // Two arrows in a clipped disc: the first leaves through the top-right
  // corner while the second comes in from the bottom-left to take its place.
  const slide = "absolute transition-transform duration-slow ease-entrance motion-reduce:transition-none";
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-full rounded-full border border-border bg-background py-1.5 pr-1.5 text-foreground hover:bg-accent")}>
      <UpgradeWord />
      <span aria-hidden className="relative ml-auto flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground text-background">
        <ArrowUpRight strokeWidth={2.25} className={cn(slide, "size-3.5 group-hover/btn:translate-x-5 group-hover/btn:-translate-y-5 group-focus-visible/btn:translate-x-5 group-focus-visible/btn:-translate-y-5")} />
        <ArrowUpRight strokeWidth={2.25} className={cn(slide, "size-3.5 -translate-x-5 translate-y-5 group-hover/btn:translate-x-0 group-hover/btn:translate-y-0 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:translate-y-0")} />
      </span>
    </ChipLink>
  );
}

function ShineSweep({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, "relative w-full justify-between overflow-hidden bg-foreground text-background hover:bg-foreground/90")}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-slow ease-standard group-hover/btn:translate-x-[320%] motion-reduce:hidden"
      />
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────

function PlanCard({ plan }: ChipProps) {
  const t = useTranslations("Billing");
  return (
    <ChipLink
      plan={plan}
      className={cn(ROW, MOVE, "relative w-full flex-col items-start gap-0.5 rounded-md border border-border bg-background p-3 text-foreground shadow-xs hover:shadow-sm")}
    >
      <span className={eyebrowClass}>{t("chip.label", { plan: t(`plans.${plan}.name`) })}</span>
      <span className="text-base font-semibold">{t("chip.upgrade")}</span>
      <Diag className="absolute right-3 top-3" />
    </ChipLink>
  );
}

function FloatingCard({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, MOVE, "w-full justify-between rounded-md bg-background py-3 text-foreground shadow-md hover:-translate-y-0.5 hover:shadow-lg")}>
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

function NightSlab({ plan, next }: ChipProps) {
  const t = useTranslations("Billing");
  return (
    <ChipLink plan={plan} className={cn(ROW, "relative isolate w-full flex-col items-start gap-0.5 overflow-hidden rounded-md bg-card-base p-3 text-white")}>
      {/* A purple glow from the top-right corner that brightens on hover. */}
      <span
        aria-hidden
        className="absolute inset-0 -z-10 opacity-70 transition-opacity duration-slow ease-standard group-hover/btn:opacity-100"
        style={{ background: "radial-gradient(120% 140% at 100% 0%, rgba(168, 85, 247, 0.55), transparent 60%)" }}
      />
      <span className="font-inter text-xs font-medium uppercase tracking-wide text-white/60">{t("chip.upgrade")}</span>
      <span className="text-base font-semibold">{t("upsell.title", { plan: t(`plans.${next}.name`) })}</span>
      <Diag className="absolute right-3 top-3" />
    </ChipLink>
  );
}

// ── Purple ──────────────────────────────────────────────────────────────

function PurpleSpark({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-fit rounded-full bg-acid/10 px-3 py-1.5 text-acid-ink hover:bg-acid/15")}>
      <Sparkles aria-hidden strokeWidth={2} className="size-4 shrink-0" />
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

function SolidPurple({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-full justify-between bg-acid-ink text-white hover:bg-acid-ink/90")}>
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

function GradientRim({ plan }: ChipProps) {
  return (
    <ChipLink
      plan={plan}
      className={cn(ROW, "w-full justify-between rounded-full border-[1.5px] border-transparent text-foreground")}
      style={{
        background:
          "linear-gradient(var(--background), var(--background)) padding-box, linear-gradient(90deg, #a855f7, #ec4899, #f59e0b) border-box",
      }}
    >
      <UpgradeWord />
      <Diag className="text-acid-ink" />
    </ChipLink>
  );
}

function FlowingRim({ plan }: ChipProps) {
  // The suggestion chips' flowing rim (globals.css .suggestion-surface), in purples.
  return (
    <ChipLink
      plan={plan}
      className={cn(ROW, "suggestion-surface w-full justify-between rounded-none border border-transparent text-foreground")}
      style={{ "--flow-stops": "#7e22ce, #a855f7 25%, #e9d5ff 50%, #a855f7 75%, #7e22ce" } as CSSProperties}
    >
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

function AccentEdge({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-full justify-between rounded-none border-l-2 border-acid-ink bg-acid/5 text-foreground hover:bg-acid/10")}>
      <UpgradeWord />
      <Diag className="text-acid-ink" />
    </ChipLink>
  );
}

function LiveDot({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-fit rounded-full border border-border bg-background px-3 py-1.5 text-foreground hover:bg-accent")}>
      <span aria-hidden className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-acid opacity-60 motion-reduce:hidden" />
        <span className="relative size-2 rounded-full bg-acid-ink" />
      </span>
      <UpgradeWord />
      <Diag />
    </ChipLink>
  );
}

// ── Character ───────────────────────────────────────────────────────────

function MonoTag({ plan }: ChipProps) {
  return (
    <ChipLink
      plan={plan}
      className={cn(ROW, "w-fit rounded-none border border-foreground px-2.5 py-1.5 font-mono text-xs uppercase tracking-widest text-foreground hover:bg-foreground hover:text-background")}
    >
      <UpgradeWord />
      <Forward className="size-3.5" />
    </ChipLink>
  );
}

/** Half-circle bites out of both ends, the way a ticket stub is cut. */
const TICKET_MASK =
  "radial-gradient(circle 9px at left center, #0000 97%, #000) left / 51% 100% no-repeat, radial-gradient(circle 9px at right center, #0000 97%, #000) right / 51% 100% no-repeat";

function Ticket({ plan }: ChipProps) {
  return (
    <ChipLink
      plan={plan}
      className={cn(ROW, "w-full gap-0 rounded-none bg-muted py-0 pl-5 pr-0 text-foreground hover:bg-border/70")}
      style={{ mask: TICKET_MASK, WebkitMask: TICKET_MASK }}
    >
      <span className="flex-1 py-2.5"><UpgradeWord /></span>
      <span className="flex items-center self-stretch border-l border-dashed border-foreground/25 px-4">
        <Diag />
      </span>
    </ChipLink>
  );
}

/** The twenty, in the order the lab numbers them. */
export const CANDIDATES: readonly Candidate[] = [
  { id: "split", group: "Outlined and quiet", name: "Plan and action", fit: "on-brand", Chip: SplitChip, note: "Two halves: the plan you are on in a grey tab, then Upgrade with its arrow." },
  { id: "next-mark", group: "Outlined and quiet", name: "Next plan, with its mark", fit: "on-brand", Chip: NextPlanMark, note: "Outlined chip naming the plan one step up, wearing its own mark (Starter's purple spark, Pro's crown)." },
  { id: "badge-inside", group: "Outlined and quiet", name: "Plan badge inside", fit: "on-brand", Chip: BadgeInside, note: "Outlined chip with the next plan as an ink badge at its end, the arrow riding in the badge." },
  { id: "dashed", group: "Outlined and quiet", name: "Dashed slot", fit: "stretch", Chip: DashedSlot, note: "A dashed outline like an empty slot waiting to be filled; it goes solid on hover." },
  { id: "keycap", group: "Outlined and quiet", name: "Keycap", fit: "stretch", Chip: Keycap, note: "A thick bottom edge like a keyboard key, pressing down when clicked." },
  { id: "ink-pill", group: "Ink", name: "Ink pill", fit: "on-brand", Chip: InkPill, note: "A compact black pill only as wide as its word." },
  { id: "primary-bar", group: "Ink", name: "Primary bar", fit: "on-brand", Chip: PrimaryBar, note: "Full-width, square-cornered black bar: the app's primary button, in the rail." },
  { id: "arrow-loop", group: "Ink", name: "Arrow loop", fit: "on-brand", Chip: ArrowLoop, note: "Outlined pill with a black disc; on hover the arrow flies out top-right and a new one slides in from bottom-left." },
  { id: "shine", group: "Ink", name: "Shine sweep", fit: "stretch", Chip: ShineSweep, note: "A black chip that a streak of light crosses on hover." },
  { id: "plan-card", group: "Cards", name: "Plan card", fit: "on-brand", Chip: PlanCard, note: "A small two-line card: the plan you are on as a label, Upgrade set larger, the arrow in its corner." },
  { id: "floating", group: "Cards", name: "Floating card", fit: "on-brand", Chip: FloatingCard, note: "Borderless white card on a soft shadow that lifts a little on hover." },
  { id: "night", group: "Cards", name: "Night slab", fit: "on-brand", Chip: NightSlab, note: "A black card with a purple glow in its corner, \"Get more with Starter\" under an Upgrade label; the glow brightens on hover." },
  { id: "purple-spark", group: "Purple", name: "Purple spark pill", fit: "stretch", Chip: PurpleSpark, note: "Pale purple pill led by a sparkle, purple words." },
  { id: "solid-purple", group: "Purple", name: "Solid purple", fit: "stretch", Chip: SolidPurple, note: "Full-width purple chip with white words: the rail's one colour." },
  { id: "gradient-rim", group: "Purple", name: "Gradient rim", fit: "stretch", Chip: GradientRim, note: "White pill with a thin purple, pink and amber border." },
  { id: "flowing-rim", group: "Purple", name: "Flowing purple rim", fit: "stretch", Chip: FlowingRim, note: "The suggestion chips' slowly turning rim, in purples instead of greens." },
  { id: "accent-edge", group: "Purple", name: "Accent edge", fit: "stretch", Chip: AccentEdge, note: "A faint purple wash with a purple bar down its left edge, like a callout." },
  { id: "live-dot", group: "Purple", name: "Live dot", fit: "stretch", Chip: LiveDot, note: "Outlined pill led by a softly pulsing purple dot." },
  { id: "mono-tag", group: "Character", name: "Mono tag", fit: "stretch", Chip: MonoTag, note: "Square ink outline, spaced capitals in the code font, a forward arrow; it fills black on hover." },
  { id: "ticket", group: "Character", name: "Ticket stub", fit: "off-brand", Chip: Ticket, note: "A grey ticket with bites out of both ends and a perforation before the arrow." },
];

// ── Sizes: the word on Settings' text column ────────────────────────────

/**
 * The shipped chip at one size. Settings' label starts 40px into the row (12px
 * padding, a 20px icon, an 8px gap), so every size puts "Upgrade" there too:
 * behind an empty icon-sized slot, behind the disc or a sparkle standing in
 * the icon's place, or with the pill itself starting at the icon column. The
 * arrow is half the disc, so the loop always clears it.
 */
function sizedPill({ pill, disc, arrow, lead }: { pill: string; disc: string; arrow: string; lead: "slot" | "disc" | "sparkle" | "none" }) {
  return function SizedPill({ plan }: ChipProps) {
    const [loopScope, playLoop] = useArrowLoop();
    const discMark = (
      <span
        aria-hidden
        className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground text-background", disc, lead !== "disc" && "ml-auto")}
      >
        <ArrowLoopIcon scope={loopScope} className={arrow} strokeWidth={2.25} />
      </span>
    );
    return (
      <ChipLink plan={plan} onMouseEnter={playLoop} className={cn(ROW, "rounded-full bg-muted py-0 text-foreground hover:bg-border", pill)}>
        {lead === "slot" && <span aria-hidden className="size-5 shrink-0" />}
        {lead === "sparkle" && <Sparkles aria-hidden strokeWidth={1.75} className="size-5 shrink-0" />}
        {lead === "disc" && discMark}
        <span data-chip-word>
          <UpgradeWord />
        </span>
        {lead !== "disc" && discMark}
      </ChipLink>
    );
  };
}

/** Twelve sizes of the shipped chip, lettered in the lab, all lined up with Settings. */
export const SIZES: readonly Candidate[] = [
  { id: "size-row", group: "Sizes", name: "Rail row, 40px", fit: "on-brand", Chip: sizedPill({ pill: "w-full h-10 pr-1.5", disc: "size-7", arrow: "size-3.5", lead: "slot" }), note: "The shipped chip at its own height, the word moved onto Settings' column." },
  { id: "size-compact", group: "Sizes", name: "Compact, 32px", fit: "on-brand", Chip: sizedPill({ pill: "w-full h-8 pr-1", disc: "size-6", arrow: "size-3", lead: "slot" }), note: "Shorter than the rows around it, with a smaller disc." },
  { id: "size-small", group: "Sizes", name: "Small, 36px", fit: "on-brand", Chip: sizedPill({ pill: "w-full h-9 pr-1", disc: "size-7", arrow: "size-3.5", lead: "slot" }), note: "A little under the row height; the disc nearly fills it." },
  { id: "size-roomy", group: "Sizes", name: "Roomy, 44px", fit: "on-brand", Chip: sizedPill({ pill: "w-full h-11 pr-1.5", disc: "size-8", arrow: "size-4", lead: "slot" }), note: "A step taller than the rows, with a bigger disc." },
  { id: "size-large", group: "Sizes", name: "Large, 48px", fit: "on-brand", Chip: sizedPill({ pill: "w-full h-12 pr-1.5", disc: "size-9", arrow: "size-4.5", lead: "slot" }), note: "A full button's height, same word size." },
  { id: "size-slim", group: "Sizes", name: "Slim, 28px", fit: "stretch", Chip: sizedPill({ pill: "w-full h-7 pr-1", disc: "size-5", arrow: "size-2.5", lead: "slot" }), note: "A thin strip, the disc the size of an icon." },
  { id: "size-disc-icon", group: "Sizes", name: "Disc as the icon, 32px", fit: "on-brand", Chip: sizedPill({ pill: "w-full h-8", disc: "size-5", arrow: "size-2.5", lead: "disc" }), note: "The disc moves to the left, exactly where Settings' gear sits, and the word follows it." },
  { id: "size-disc-icon-40", group: "Sizes", name: "Disc as the icon, 40px", fit: "on-brand", Chip: sizedPill({ pill: "w-full h-10 pl-2.5 gap-1.5", disc: "size-6", arrow: "size-3", lead: "disc" }), note: "The same at the row's height, the disc a little bigger than the gear." },
  { id: "size-sparkle", group: "Sizes", name: "Sparkle in the icon's place, 40px", fit: "on-brand", Chip: sizedPill({ pill: "w-full h-10 pr-1.5", disc: "size-7", arrow: "size-3.5", lead: "sparkle" }), note: "A sparkle where Settings has its gear, the disc still on the right." },
  { id: "size-sparkle-hug", group: "Sizes", name: "Sparkle, hugging, 36px", fit: "on-brand", Chip: sizedPill({ pill: "w-fit h-9 pr-1", disc: "size-7", arrow: "size-3.5", lead: "sparkle" }), note: "Only as wide as sparkle, word and disc." },
  { id: "size-icon-column", group: "Sizes", name: "Starts at the icon column, 36px", fit: "on-brand", Chip: sizedPill({ pill: "mx-3 h-9 pl-7 pr-1", disc: "size-7", arrow: "size-3.5", lead: "none" }), note: "The pill's round end starts where the gear starts, so it is narrower than the rows." },
  { id: "size-tall", group: "Sizes", name: "Tall, 56px, larger word", fit: "stretch", Chip: sizedPill({ pill: "w-full h-14 pr-2 text-base", disc: "size-10", arrow: "size-5", lead: "slot" }), note: "A big call to action: a larger word over the same starting point." },
];

/** What came before, for comparison: the bare row today and the chip that was turned down. */
function Rejected({ plan }: ChipProps) {
  return (
    <ChipLink plan={plan} className={cn(ROW, "w-full border border-border bg-background py-1.5 pr-1.5 text-foreground shadow-xs hover:bg-accent")}>
      <span aria-hidden className="size-5 shrink-0" />
      <UpgradeWord />
      <span aria-hidden className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-sm bg-foreground text-background">
        <ArrowUpRight strokeWidth={2.25} className={cn("size-3.5", iconNudgeUpRightClass)} />
      </span>
    </ChipLink>
  );
}

export const REJECTED: Candidate = {
  id: "rejected",
  group: "Reference",
  name: "Outline with an ink disc",
  fit: "on-brand",
  Chip: Rejected,
  note: "The chip shipped first and turned down.",
};
