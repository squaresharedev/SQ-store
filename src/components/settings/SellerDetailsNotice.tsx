import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { iconNudgeRightClass } from "@/components/ui/control-styles";
import {
  TRADER_IDENTITY_FIELDS,
  TRADER_IDENTITY_HEADLINE,
  traderIdentityFix,
  traderIdentityHref,
  type TraderIdentityField,
} from "@/lib/settings/trader-identity";
import type { MessageKey } from "@/i18n/types";
import { cn } from "@/lib/utils";

/**
 * The seller-facing half of the publish gate: what is missing, what it blocks,
 * and a button that goes straight to the field that fixes it.
 *
 * Two shapes, one message. `SellerDetailsBanner` is the strip the dashboard
 * shell hangs under the top bar, so the state is hard to miss wherever the
 * seller happens to be working; `SellerDetailsNotice` is the boxed version that
 * sits inside the surface actually being blocked (the product form's
 * Visibility section, the embed modal), where it can afford to spell out why
 * each field is needed.
 *
 * Server components — no state, one link — so they cost nothing to render on
 * the pages that already know the answer.
 *
 * Both render NOTHING when `missing` is empty, so callers can hand over the
 * gate's output unconditionally instead of guarding at every call site.
 */

/**
 * What a notice can say it is blocking. Each maps to a whole sentence of its
 * own: the blocked action is not a fragment that survives being spliced into
 * another language's grammar.
 */
const BLOCK_HEADLINES = {
  publishOrSell: "Settings.sellerDetails.headline.publishOrSell",
  putProductOnSale: "Settings.sellerDetails.headline.putProductOnSale",
  importLiveProducts: "Settings.sellerDetails.headline.importLiveProducts",
  embedStorefront: "Settings.sellerDetails.headline.embedStorefront",
  publishStorefront: "Settings.sellerDetails.headline.publishStorefront",
} as const satisfies Record<string, MessageKey>;

export type SellerDetailsBlock = keyof typeof BLOCK_HEADLINES;

/** The full-width strip in the dashboard chrome. */
export function SellerDetailsBanner({
  missing,
  audience = "owner",
}: {
  missing: readonly TraderIdentityField[];
  /**
   * Who is reading. A team member working on someone else's store can see that
   * store's gap but cannot close it: their Settings edits their OWN profile,
   * never the owner's. So they get the fact without the link, rather than a
   * button into a form that would save details to the wrong account and leave
   * this banner exactly where it was.
   */
  audience?: "owner" | "member";
}) {
  const t = useTranslations();
  if (missing.length === 0) return null;
  const member = audience === "member";
  const fix = traderIdentityFix(missing);
  return (
    <div
      // A standing condition the seller has to act on, not a live announcement:
      // `status` would be re-read on every navigation inside the shell, which
      // is most of them.
      role="note"
      aria-label={t("Settings.sellerDetails.bannerLabel")}
      // No rule underneath: the tint alone separates it from the page, and a
      // red line under a red strip read as a second, louder warning.
      className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-destructive/5 px-4 py-2 text-sm md:px-6"
    >
      <ShieldAlert
        className="size-4 shrink-0 text-destructive"
        strokeWidth={2}
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-foreground">
        <span className="font-semibold">
          {member
            ? t("Settings.sellerDetails.memberHeadline")
            : t(TRADER_IDENTITY_HEADLINE.key)}
        </span>{" "}
        <span className="font-inter text-muted-foreground">
          {member
            ? t("Settings.sellerDetails.memberFix")
            : t(fix.key, fix.values)}
        </span>
      </p>
      {!member && (
        <Link
          href={traderIdentityHref(missing)}
          // Sharp, like every other CTA (control-styles' brand rule), with the
          // "go" arrow the product's other forward links carry. Neutral grey
          // instead of destructive red to signal this is a helpful action, not risky.
          className="group/btn inline-flex shrink-0 items-center gap-1 rounded-none border border-border px-2 py-1 font-inter text-xs font-medium text-muted-foreground transition-colors duration-base ease-standard hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          {t("Settings.sellerDetails.addLink")}
          <ArrowRight
            className={cn("size-3.5", iconNudgeRightClass)}
            strokeWidth={2}
            aria-hidden
          />
        </Link>
      )}
    </div>
  );
}

/** The boxed version, for inside the surface being blocked. */
export function SellerDetailsNotice({
  missing,
  /** What this seller is being stopped from doing. */
  blocks = "publishOrSell",
  /** Spell out why each missing field is needed. Off in tight spaces. */
  detailed = true,
  /**
   * Open Settings in a new tab instead of navigating. For surfaces with
   * unsaved work behind them — the storefront designer — where sending someone
   * away mid-edit is a worse outcome than an extra tab.
   */
  newTab = false,
  className,
}: {
  missing: readonly TraderIdentityField[];
  blocks?: SellerDetailsBlock;
  detailed?: boolean;
  newTab?: boolean;
  className?: string;
}) {
  const t = useTranslations();
  if (missing.length === 0) return null;
  const fields = TRADER_IDENTITY_FIELDS.filter((field) =>
    missing.includes(field.key),
  );

  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3",
        className,
      )}
    >
      <ShieldAlert
        className="mt-0.5 size-4 shrink-0 text-destructive"
        strokeWidth={2}
        aria-hidden
      />
      <div className="min-w-0 space-y-2">
        <div className="space-y-0.5">
          <p className="font-inter text-sm font-medium text-destructive">
            {t(BLOCK_HEADLINES[blocks])}
          </p>
          {/* Full destructive, not /80: faded over this bg-destructive/5 panel
              it lands at 4.04:1, under the 4.5:1 AA minimum (axe flagged it on
              /products/new, while the line above, same colour at full strength
              on the same background, passes). The weight difference carries the
              hierarchy instead of the tint. */}
          <p className="font-inter text-sm text-destructive">
            {t("Settings.sellerDetails.reason")}
          </p>
        </div>
        {detailed && (
          <ul className="space-y-1 font-inter text-sm text-muted-foreground">
            {fields.map((field) => (
              <li key={field.key}>
                <span className="font-medium text-foreground">
                  {t(field.label)}
                </span>
                : {t(field.why)}
              </li>
            ))}
          </ul>
        )}
        <Link
          href={traderIdentityHref(missing)}
          {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          // Outlined, not a solid fill: this dashboard's only solid buttons are
          // its black primaries, and a solid red one reads as "delete" rather
          // than "go and fix it". Neutral grey instead of destructive red to
          // signal this is a helpful action. Same treatment as the chrome's
          // banner, so the two say the same thing in the same voice.
          className="inline-flex items-center rounded-sm border border-border px-3 py-1.5 font-inter text-xs font-medium text-muted-foreground transition-colors duration-base ease-standard hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {t("Settings.sellerDetails.addLink")}
          {newTab && (
            <span className="sr-only">{t("Settings.sellerDetails.opensInNewTab")}</span>
          )}
        </Link>
      </div>
    </div>
  );
}
