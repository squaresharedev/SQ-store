import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import {
  TRADER_IDENTITY_FIELDS,
  TRADER_IDENTITY_HEADLINE,
  traderIdentityFix,
  traderIdentityHref,
  type TraderIdentityField,
} from "@/lib/settings/trader-identity";
import { cn } from "@/lib/utils";

/**
 * The seller-facing half of the publish gate: what is missing, what it blocks,
 * and a button that goes straight to the field that fixes it.
 *
 * Two shapes, one message. `SellerDetailsBanner` is the strip the dashboard
 * shell hangs under the top bar on every page, so the state is impossible to
 * miss wherever the seller happens to be working; `SellerDetailsNotice` is the
 * boxed version that sits inside the surface actually being blocked (the
 * product form's Visibility section, the embed modal), where it can afford to
 * spell out why each field is needed.
 *
 * Server components — no state, one link — so they cost nothing to render on
 * the pages that already know the answer.
 *
 * Both render NOTHING when `missing` is empty, so callers can hand over the
 * gate's output unconditionally instead of guarding at every call site.
 */

/** The full-width strip in the dashboard chrome. */
export function SellerDetailsBanner({
  missing,
}: {
  missing: readonly TraderIdentityField[];
}) {
  if (missing.length === 0) return null;
  return (
    <div
      // A standing condition the seller has to act on, not a live announcement:
      // `status` would be re-read on every navigation inside the shell, which
      // is most of them.
      role="note"
      aria-label="Seller details required"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-sm md:px-6"
    >
      <ShieldAlert
        className="size-4 shrink-0 text-destructive"
        strokeWidth={2}
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-foreground">
        <span className="font-semibold">{TRADER_IDENTITY_HEADLINE}</span>{" "}
        <span className="font-inter text-muted-foreground">
          {traderIdentityFix(missing)}
        </span>
      </p>
      <Link
        href={traderIdentityHref(missing)}
        className="shrink-0 rounded-sm border border-destructive/40 px-2 py-1 font-inter text-xs font-medium text-destructive transition-colors duration-base ease-standard hover:bg-destructive hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        Add seller details
      </Link>
    </div>
  );
}

/** The boxed version, for inside the surface being blocked. */
export function SellerDetailsNotice({
  missing,
  /** What this seller is being stopped from doing, as a verb phrase. */
  blocks = "publish or sell anything",
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
  blocks?: string;
  detailed?: boolean;
  newTab?: boolean;
  className?: string;
}) {
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
            You can&apos;t {blocks} until your seller details are complete.
          </p>
          <p className="font-inter text-sm text-destructive/80">
            Buyers have to be able to see who they are buying from and how to
            reach you before they order. These are shown on your product pages
            for that reason only, never used for marketing.
          </p>
        </div>
        {detailed && (
          <ul className="space-y-1 font-inter text-sm text-muted-foreground">
            {fields.map((field) => (
              <li key={field.key}>
                <span className="font-medium text-foreground">
                  {field.label}
                </span>{" "}
                — {field.why}
              </li>
            ))}
          </ul>
        )}
        <Link
          href={traderIdentityHref(missing)}
          {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          // Outlined, not a solid fill: this dashboard's only solid buttons are
          // its black primaries, and a solid red one reads as "delete" rather
          // than "go and fix it". Same treatment as the chrome's banner, so
          // the two say the same thing in the same voice.
          className="inline-flex items-center rounded-sm border border-destructive/40 px-3 py-1.5 font-inter text-xs font-medium text-destructive transition-colors duration-base ease-standard hover:bg-destructive hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          Add seller details
          {newTab && <span className="sr-only"> (opens in a new tab)</span>}
        </Link>
      </div>
    </div>
  );
}
