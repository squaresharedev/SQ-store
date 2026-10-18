"use client";

import { useState } from "react";
import { Ban, Check, Landmark, Wallet, X, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { formatOrderDate, formatOrderDateTime } from "@/lib/format/date";
import { useNow } from "@/lib/hooks/useNow";
import { EASE_STANDARD, POP } from "@/components/ui/motion-tokens";
import { iconTileClass } from "@/components/ui/surface-styles";
import type { Payout, PayoutStatus } from "@/lib/payments/types";
import { DetailRow } from "./DetailRow";
import { payoutProgress } from "./payout-progress";

/**
 * How each status draws the track: the ink of the pixels the money has
 * covered (ink unless said otherwise), and what the bank wears once the
 * outcome is known. Colour is spent only where it means something: green for
 * arrived, red for turned away, and then only on the bank.
 */
const LOOK: Record<
  PayoutStatus,
  { lit?: string; bank?: string; badge?: { icon: LucideIcon; tone: string } }
> = {
  paid: {
    lit: "text-success",
    bank: "bg-success/15 text-success",
    badge: { icon: Check, tone: "bg-success text-background" },
  },
  in_transit: {},
  pending: {},
  failed: {
    bank: "bg-destructive/10 text-destructive",
    badge: { icon: X, tone: "bg-destructive text-destructive-foreground" },
  },
  canceled: {
    bank: "text-muted-foreground",
    badge: { icon: Ban, tone: "bg-muted-foreground text-background" },
  },
};

/** The two ends of the track: the square tile the Payout method card uses. */
const STOP = cn(iconTileClass, "relative size-12 transition-colors duration-slow ease-standard");

/** Lighting the whole track (s); a shorter run takes its share, so the pace is the same. */
const FILL_SECONDS = 0.7;

/** No pixel lit: where the light starts from. */
const UNLIT = "inset(0% 100% 0% 0%)";

/**
 * A PAYOUT AS ONE PICTURE: the balance, the bank, and a track of pixels
 * between them lit as far as the money has got, with a date under each end.
 * Unlit, it is still in the balance; part lit, it is on its way; all green
 * with a tick on the bank, it arrived; unlit with a red cross on the bank, the
 * bank turned it away; a struck date, it is not coming.
 *
 * The light runs out once from the balance when the dialog opens, and a paid
 * bank shows its tick when the light gets there. Nothing else moves, and under
 * reduced motion it opens as it ends.
 *
 * The picture is decoration (aria-hidden): the dates under it are real text,
 * and the dialog states the status in words beside the amount.
 */
export function PayoutTrack({ payout, className }: { payout: Payout; className?: string }) {
  const t = useTranslations("Payments.payoutModal");
  const locale = useLocale();
  const still = useReducedMotion();
  const now = useNow();

  const status: PayoutStatus = payout.status in LOOK ? payout.status : "pending";
  const look = LOOK[status];
  const progress = payoutProgress({ ...payout, status }, now);
  // The bank shows the outcome once the light has reached it; at once when
  // there is no light to wait for.
  const [arrived, setArrived] = useState(Boolean(still) || progress === 0);
  const lapsed = status === "failed" || status === "canceled";
  const Badge = look.badge?.icon;

  return (
    <div data-payout-track={status} className={className}>
      <div aria-hidden="true" className="flex items-center gap-4">
        <span className={STOP}>
          <Wallet className="size-5" strokeWidth={2} />
        </span>

        {/* The dim track fits itself to whole pixels; the lit ones lie on it. */}
        <div className="flex-1">
          <div className="pixel-trail relative mx-auto text-border">
            <motion.span
              className={cn("pixel-trail absolute inset-0", look.lit ?? "text-foreground")}
              initial={still ? false : { clipPath: UNLIT }}
              animate={{ clipPath: `inset(0% ${100 - progress * 100}% 0% 0%)` }}
              transition={{ duration: FILL_SECONDS * progress, ease: EASE_STANDARD }}
              onAnimationComplete={() => setArrived(true)}
            />
          </div>
        </div>

        <span className={cn(STOP, arrived && look.bank)}>
          <Landmark className="size-5" strokeWidth={2} />
          {Badge && (
            <motion.span
              className={cn(
                "absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-popover",
                look.badge?.tone,
              )}
              initial={false}
              animate={{ scale: arrived ? 1 : 0 }}
              transition={POP}
            >
              <Badge className="size-3" strokeWidth={3} />
            </motion.span>
          )}
        </span>
      </div>

      <div className="mt-3 flex justify-between gap-4">
        <DetailRow label={t("initiated")}>
          <span className="text-sm text-foreground">
            {formatOrderDateTime(payout.createdAt, locale)}
          </span>
        </DetailRow>
        <DetailRow label={t(status === "paid" ? "arrived" : "arrives")} className="items-end text-right">
          <span className={cn("text-sm text-foreground", lapsed && "text-muted-foreground line-through")}>
            {formatOrderDate(payout.arrivalDate, locale)}
          </span>
        </DetailRow>
      </div>
    </div>
  );
}
