"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  CalendarClock,
  CircleDollarSign,
  Ellipsis,
  Hourglass,
  Puzzle,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { Disclosure } from "@/components/ui/Disclosure";
import { HeroMark } from "@/components/ui/HeroMark";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { helpTextClass } from "@/components/ui/control-styles";
import { PlanFeatureList } from "@/components/billing/PlanFeatureList";
import { KeepPlanButton } from "@/components/billing/KeepPlanButton";
import { PlanWordmark } from "@/components/billing/PlanWordmark";
import type { BillingActions } from "@/components/billing/billing-actions";
import { formatLongDate } from "@/lib/format/date";
import { gainsOver } from "@/lib/billing/features";
import {
  CANCELLATION_DETAIL_MAX,
  CANCELLATION_REASONS,
  type CancellationReason,
} from "@/lib/billing/cancellation";
import type { PaidPlanId } from "@/lib/billing/plans";
import type { ActionError } from "@/lib/errors";

/** The "(optional)" after a field label, a step quieter than the label. */
function optionalMarker(chunks: React.ReactNode) {
  return <span className="font-normal text-muted-foreground">{chunks}</span>;
}

/** A reason to leave, as a picture: six tiles tell apart faster than six
 *  sentences read. The words stay under each (lib/billing/cancellation.ts). */
const REASON_ICONS: Record<CancellationReason, LucideIcon> = {
  too_expensive: CircleDollarSign,
  unused: Hourglass,
  missing_features: Puzzle,
  switched_service: ArrowRightLeft,
  temporary: CalendarClock,
  other: Ellipsis,
};

type CancelPlanProps = {
  /** The paid plan being cancelled. */
  plan: PaidPlanId;
  /** When the paid period ends (ISO), the day the store moves to Free. */
  periodEnd: string;
  actions: Pick<BillingActions, "cancelPlan" | "resumePlan">;
};

/**
 * The way out of a paid plan: a button, and the one-screen dialog behind it
 * (CancelPlanDialog below).
 */
export function CancelPlanButton({
  label,
  variant = "ghost-danger",
  className,
  ...dialog
}: CancelPlanProps & {
  /** The trigger's words ("Cancel plan", "Move to Free"). */
  label: string;
  variant?: "ghost-danger" | "secondary";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
        data-cancel-plan
      >
        {label}
      </Button>
      <CancelPlanDialog open={open} onClose={() => setOpen(false)} {...dialog} />
    </>
  );
}

/**
 * EASY TO LEAVE, ON PURPOSE. One screen, one confirm, no second "are you
 * sure", no discount bait, no survey wall: the dialog shows the plan, says in
 * one sentence what happens (it runs to the end of the period paid for, then
 * Free; nothing is deleted), and keeps what Free goes without one tap away.
 * Asking WHY is optional, both the reason and the note: the answer helps us,
 * and leaving must never wait on it. The reasons are tiles to tap, and the
 * note is only asked for once one is picked, so nobody who is just leaving
 * meets an empty text box. "Keep my plan" sits beside "Cancel plan" as an
 * equal.
 *
 * The last screen says the plan is cancelled and, since it already tells the
 * person they can change their mind, lets them: "Keep my plan" beside "Done",
 * the same one-click undo Settings has (KeepPlanButton). An offer, not a
 * hurdle: Done is still the main button and nothing is in its way.
 *
 * The answer goes to plan_cancellations through cancelPlan, which the admin
 * panel reads; the action re-checks the owner and the subscription whatever
 * this renders.
 */
export function CancelPlanDialog({
  open,
  onClose,
  plan,
  periodEnd,
  actions,
}: CancelPlanProps & { open: boolean; onClose: () => void }) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const router = useRouter();
  const [reason, setReason] = React.useState<CancellationReason | null>(null);
  const [detail, setDetail] = React.useState("");
  const [error, setError] = React.useState<ActionError | null>(null);
  const [endsAt, setEndsAt] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const planName = t(`plans.${plan}.name`);
  const date = (iso: string) => formatLongDate(iso, locale);

  function close() {
    onClose();
    // Once cancelled, the page behind shows the ending state.
    if (endsAt) router.refresh();
  }

  /** Kept after all: the dialog starts over, for the next time it is opened. */
  function kept() {
    setEndsAt(null);
    setReason(null);
    setDetail("");
    onClose();
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await actions.cancelPlan({
        reason,
        detail: detail.trim() || null,
      });
      if (result.ok) setEndsAt(result.endsAt);
      else setError(result.error);
    });
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        endsAt ? t("cancel.doneTitle") : t("cancel.title", { plan: planName })
      }
      // The plan being left, then the tick once it is done.
      visual={
        endsAt ? (
          <HeroMark tone="success" icon={AnimatedCheck} />
        ) : (
          <PlanWordmark plan={plan} name={planName} className="pb-0" />
        )
      }
      description={
        endsAt
          ? undefined
          : t("cancel.keepUntil", { plan: planName, date: date(periodEnd) })
      }
      initialFocus="dialog"
      size="lg"
    >
      {endsAt ? (
        <div className="flex flex-col gap-4" data-cancel-done>
          {/* Announced, not just shown: it is the answer to the button. */}
          <p role="status" className={`${helpTextClass} text-center`}>
            {t("cancel.doneBody", { plan: planName, date: date(endsAt) })}
          </p>
          <ModalActions>
            <KeepPlanButton plan={plan} actions={actions} onKept={kept} />
            <Button onClick={close}>{t("cancel.done")}</Button>
          </ModalActions>
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-cancel-form>
          {/* Worth knowing, not worth reading every time: one line that opens. */}
          <Disclosure summary={t("cancel.loseLegend")} className={helpTextClass}>
            <PlanFeatureList
              plan={plan}
              features={gainsOver("free", plan)}
              className="sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-2.5 sm:space-y-0"
            />
          </Disclosure>

          <ChoiceCards
            name="cancel-reason"
            legend={t.rich("cancel.reasonLegend", { muted: optionalMarker })}
            variant="tiles"
            columns={3}
            options={CANCELLATION_REASONS.map((value) => {
              const Icon = REASON_ICONS[value];
              return {
                value,
                label: t(`cancel.reasons.${value}`),
                // A step quieter than the label, so the words lead.
                icon: <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />,
              };
            })}
            value={reason}
            onChange={setReason}
            optionDataAttribute="data-cancel-reason"
          />

          {/* Only once there is a reason to say more about. */}
          {reason && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="cancel-detail">
                {t.rich("cancel.detailLabel", { muted: optionalMarker })}
              </Label>
              <Textarea
                id="cancel-detail"
                rows={2}
                maxLength={CANCELLATION_DETAIL_MAX}
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder={t("cancel.detailPlaceholder")}
              />
            </div>
          )}

          {error && <ActionErrorNotice error={error} />}

          <ModalActions>
            <Button variant="secondary" onClick={close} disabled={pending}>
              {t("cancel.keep")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirm}
              disabled={pending}
              data-cancel-confirm
            >
              {pending && <Spinner />}
              {pending ? t("cancel.cancelling") : t("cancel.confirm")}
            </Button>
          </ModalActions>
        </div>
      )}
    </Modal>
  );
}
