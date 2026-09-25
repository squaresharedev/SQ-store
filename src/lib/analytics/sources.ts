import {
  CalendarCheck,
  Eye,
  Mail,
  MousePointerClick,
  Receipt,
  ScanEye,
  type LucideIcon,
} from "lucide-react";
import type { SignalKind } from "@/lib/analytics/signals";
import type { MessageKey } from "@/i18n/types";

// THE SOURCE REGISTRY: the one place that says what the analytics page
// measures, and therefore what it draws.
//
// WHY THIS EXISTS. The page used to be a hand-written list of chart cards, one
// per thing orders can tell you. Every new measurable surface (an email signup
// block, a calendar booking block) would have meant editing the page, the
// skeleton, the empty states and the machine-readable payload in four separate
// places, and forgetting one of them is how a feature ships half-instrumented.
//
// Instead the page maps over this array. A source declares the
// signal kind it counts, the panels it wants and what unit it is in; the
// section component knows how to render any source that shape. Shipping
// bookings is then: add the kind to signals.ts + the SQL CHECK, write the
// producer, and flip `awaiting` off here.
//
// A SOURCE THE SELLER DOES NOT RUN IS NOT SHOWN AT ALL. Registered is not the
// same as relevant: a seller with no booking block has no reason to scroll
// past a bookings section, and a placeholder for a feature they have not
// adopted pushes the numbers they came for further down the page. See
// isSourceRelevant() below for the exact test, which is "is this yours", not
// "does this exist".
//
// AND A SOURCE LIGHTS UP ON ITS OWN. `awaiting` is a DEFAULT, not a lock:
// resolveSourceState() treats any source with real rows as live no matter what
// this file says, and relevance keys off the BLOCK rather than the data, so a
// signup block placed today gets its (empty, honest) section immediately
// instead of only after a stranger has already signed up. Neither needs a
// deploy. What a source must never do is show an invented figure: MetricTile's
// `pending` state is the precedent for saying so out loud instead.

/** Which panels a source's section renders, in this order. */
export type SourcePanel = "trend" | "channels" | "weekdays" | "storefronts";

/**
 * A source's COPY is not in this file. Every sentence about a source (its
 * label, description, count noun, tile and panel titles) lives in the catalogue
 * under `Analytics.sources.<id>`, keyed by the same id this registry and the
 * data attributes use. The noun is not a word the section splices into a
 * sentence: languages decline it differently in "Total views" and "No views in
 * this range", so each sentence is its own message.
 */
export type AnalyticsSource = {
  /** Stable id. Used as the section anchor, as the `data-analytics-source`
   *  value and as the catalogue key for its copy, so it is part of the
   *  machine-readable contract: do not rename one without updating
   *  docs/analytics-datapoints.md. */
  id: SignalKind;
  icon: LucideIcon;
  panels: SourcePanel[];
  /**
   * Set while nothing writes this kind yet. `reason` names what ships it, so
   * the placeholder answers "why is this empty" instead of just saying it is.
   * Removing it is a one-line change once the producer lands.
   */
  awaiting?: { reason: MessageKey; readyToChart: MessageKey };
  /**
   * The storefront block that produces this signal, if one does. This is what
   * makes a source RELEVANT before it has any data: a seller who has placed
   * the block should see the section waiting, and a seller who has not should
   * never see it at all.
   *
   * Must match a `StorefrontBlock["type"]` value. The two future ones below do
   * not exist in the schema yet, so they simply never match, which is exactly
   * the behaviour wanted until those blocks ship.
   */
  blockType?: string;
  /** True when the signal can carry money (value_cents), e.g. a paid booking. */
  carriesValue?: boolean;
};

/**
 * Every non-order source, in page order. Views first because it is the top of
 * the funnel and the only one live today; the rest read down towards the sale.
 */
export const SIGNAL_SOURCES: AnalyticsSource[] = [
  {
    id: "storefront_view",
    icon: Eye,
    panels: ["trend", "storefronts", "channels"],
  },
  {
    id: "product_click",
    icon: MousePointerClick,
    panels: ["trend", "storefronts", "channels"],
    awaiting: {
      reason: "Analytics.sources.product_click.awaiting",
      readyToChart: "Analytics.sources.product_click.readyToChart",
    },
    blockType: "product",
  },
  {
    id: "product_view",
    icon: ScanEye,
    panels: ["trend", "storefronts", "channels"],
    blockType: "product",
  },
  {
    id: "email_signup",
    icon: Mail,
    panels: ["trend", "storefronts", "weekdays"],
    awaiting: {
      reason: "Analytics.sources.email_signup.awaiting",
      readyToChart: "Analytics.sources.email_signup.readyToChart",
    },
    blockType: "email_signup",
  },
  {
    id: "booking",
    icon: CalendarCheck,
    panels: ["trend", "weekdays", "storefronts"],
    awaiting: {
      reason: "Analytics.sources.booking.awaiting",
      readyToChart: "Analytics.sources.booking.readyToChart",
    },
    blockType: "booking",
    carriesValue: true,
  },
];

/** The sales section is not a signal source (orders carry money, refunds and a
 *  status lifecycle), but it shares the section chrome and the data-attribute
 *  contract, so its identity lives here too. Its copy is `Analytics.sales`. */
export const SALES_SOURCE = {
  id: "sales" as const,
  icon: Receipt,
};

/** Look up a source by kind. */
export function findSource(kind: SignalKind): AnalyticsSource | undefined {
  return SIGNAL_SOURCES.find((source) => source.id === kind);
}

/**
 * Is this source showing real numbers?
 *
 * `awaiting` is only the default. A source with rows in the range is live
 * regardless, which is what makes a new producer light its own section up with
 * no code change. `total` is the count for the source's kind over the range.
 */
export function resolveSourceState(
  source: AnalyticsSource,
  total: number,
): "live" | "awaiting" {
  if (total > 0) return "live";
  return source.awaiting ? "awaiting" : "live";
}

/**
 * Should this seller see this source at all?
 *
 * The question is "is this yours", never "does this exist". Three ways in,
 * and they answer three different situations:
 *
 *   1. It has a live producer (no `awaiting`). Storefront views are measured
 *      for everyone, so a zero there is a real answer worth showing.
 *   2. This account has EVER recorded the kind. Deliberately all-time rather
 *      than range-scoped: a seller with signups last quarter should not watch
 *      the section vanish when they switch to "last 30 days".
 *   3. The block that feeds it is on one of their storefronts. This is the one
 *      that makes the page right BEFORE any data exists: place a signup block
 *      and the section is there, empty and waiting, instead of appearing only
 *      once a stranger has signed up.
 *
 * Anything else is a feature this seller has not adopted, and it is not shown.
 */
export function isSourceRelevant(
  source: AnalyticsSource,
  context: { everRecorded: readonly string[]; activeBlockTypes: readonly string[] },
): boolean {
  // A source with no awaiting AND no blockType is platform-wide (e.g.
  // storefront_view). Always show it: a zero there is a real answer.
  // A source with no awaiting but WITH a blockType (e.g. product_view) is
  // only relevant for sellers who use that block or have already recorded it.
  if (!source.awaiting && !source.blockType) return true;
  if (context.everRecorded.includes(source.id)) return true;
  return source.blockType
    ? context.activeBlockTypes.includes(source.blockType)
    : false;
}
